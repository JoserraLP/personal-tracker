# Spec 002: Catálogo unificado de ocio

## 1. Feature Target & Git Context
- **Target Branch:** `dev`
- **Feature Branch:** `feat/002-unified-catalog`
- **Scope:** nuevo bloque de la app tras el login (spec 001); datos privados del propietario.

## 2. Vision and scope
- Goal: seguimiento personal por pestañas de películas, series, videojuegos, libros, anime, con estados, progreso, valoración, reseña y rewatch/rejugada.
- Users: único propietario autenticado.
- Out of scope: amigos/social, recomendaciones, sincronización con streaming, importación masiva, offline.

## 3. Requirements
| ID | Requirement | Priority |
|---|---|---|
| REQ-001 | Tipos de medio: `movie`, `series`, `game`, `book`, `anime`. | must |
| REQ-002 | Estados: `pending`, `in_progress`, `completed`, `paused`, `abandoned`. | must |
| REQ-003 | Colección Firestore separada por tipo + pestaña UI separada. | must |
| REQ-004 | Datos privados: lectura y escritura solo del propietario. | must |
| REQ-005 | Búsqueda/autocompletado en APIs públicas para alta rápida: TMDB (pelis/series), TMDB (anime, D-005), RAWG/IGDB (juegos), Google Books (libros). | must |
| REQ-006 | Autorelleno desde API: póster, sinopsis, año, género, duración. | must |
| REQ-007 | Alta manual para ítems no presentes en ninguna API. | must |
| REQ-008 | Valoración (1-10), reseña corta y fecha de visionado/finalización. | must |
| REQ-009 | Series: progreso por temporada y episodio + "siguiente episodio" visible en la ficha. | must |
| REQ-010 | Juegos: horas jugadas, % completado, plataforma, logros. | must |
| REQ-011 | Rewatch/rejugada: varias entradas de visionado por título, cada una con fecha y nota. | should |
| REQ-012 | Filtrado y ordenación por tipo, estado, título, fecha y valoración. | should |
| REQ-013 | Edición y borrado de ítems y sesiones. | must |
| REQ-014 | Validación de campos (título obligatorio, rangos numéricos). | must |

## 4. Contracts

### 4.1 API (externas)
| ID | Provider | Endpoint | Uso | Respuesta normalizada |
|---|---|---|---|---|
| API-001 | TMDB | `GET /search/movie` | buscar películas | `SearchResult` |
| API-002 | TMDB | `GET /search/tv` | buscar series/anime | `SearchResult` |
| API-003 | TMDB | `GET /movie/{id}`, `/tv/{id}` | detalle (duración, géneros) | `SearchResult` |
| API-004 | RAWG/IGDB | `GET /games` (search) | buscar juegos | `SearchResult` |
| API-005 | Google Books | `GET /volumes` | buscar libros | `SearchResult` |

`SearchResult`: `{ source, externalId, mediaType, title, year?, posterUrl?, synopsis?, genres[], durationMinutes? }`.

API error contract: fallo normalizado `{ ok:false, provider, code: 'timeout'|'unauthorized'|'rate_limited'|'not_found'|'unknown', message }`; éxito vacío `{ ok:true, items:[] }`. El cliente hace autofill parcial (campos ausentes → null) y nunca bloquea el guardado.

### 4.2 Data (Firestore)
Colecciones: `users/{uid}/movies|series|games|books|anime/{itemId}` (privadas, owner-only).

| ID | Entidad | Campos (tipo, restricciones) | Relaciones |
|---|---|---|---|
| DB-001 | CatalogItem (base) | `id` string (doc); `mediaType` enum; `title` string (req, 1-200); `originalTitle` string?; `year` number? (1888-2100); `posterUrl` string? (URL); `synopsis` string? (≤2000); `genres` string[] (≤10); `status` enum (REQ-002); `rating` number? (1-10, entero); `review` string? (≤500); `durationMinutes` number? (≥0); `source` {provider, externalId?}; `createdAt`, `updatedAt` timestamp; `sessions` Session[] | — |
| DB-002 | MovieItem | base (durationMinutes = runtime) | — |
| DB-003 | SeriesItem | base + `currentSeason` number? (≥1); `currentEpisode` number? (≥1); `totalSeasons` number?; `totalEpisodes` number?; `nextEpisode` string? (calc: si currentEpisode<totalEpisodes → "S{cs}E{ce+1}"; si no y currentSeason<totalSeasons → "S{cs+1}E1"; si no → "Finalizado"; si faltan totales → null) | sessions |
| DB-004 | GameItem | base + `hoursPlayed` number? (≥0); `completionPercent` number? (0-100); `platform` string?; `achievementsUnlocked` number?; `achievementsTotal` number? | sessions |
| DB-005 | BookItem | base + `author` string?; `pagesTotal` number? (≥0); `pagesRead` number? (0..pagesTotal si pagesTotal != null; si no, ≥0) | sessions |
| DB-006 | AnimeItem | base + `currentSeason`? number (≥1), `currentEpisode` number (≥1), `totalSeasons`? number, `totalEpisodes`? number, `nextEpisode`? string (mismo cálculo que DB-003) | sessions |
| DB-007 | Session (rewatch/replay) | `id` string; `date` timestamp (req); `note` string? (≤500); `rating` number? (1-10, entero); `progress` string? (libre) | pertenece a CatalogItem |

### 4.3 UI
| ID | Pantalla | Componentes | API usada |
|---|---|---|---|
| UI-001 | Pestañas de catálogo (Pelis/Series/Juegos/Libros/Anime) | `CatalogTabs`, `ItemList`, `ItemCard` | Firestore |
| UI-002 | Ficha de ítem | `ItemDetail`, `ProgressBar`, `SessionList`, `RatingScale` | Firestore |
| UI-003 | Búsqueda/alta rápida | `SearchModal`, `SearchResults`, `ItemForm` | API-001..006 |
| UI-004 | Alta manual | `ManualForm` | Firestore |
| UI-005 | Filtros/orden | `FilterBar` | Firestore (query) |

## 5. Acceptance criteria (BDD)
- AC-001 (REQ-003): Given un usuario autenticado, When abre el catálogo, Then ve pestañas separadas por tipo y cada una lista sus ítems.
- AC-002 (REQ-002): Given un ítem, When cambia su estado a cualquiera de los 5, Then se persiste y el filtro por estado lo refleja.
- AC-003 (REQ-005/006): Given resultado de TMDB movie, When se añade, Then póster, sinopsis, año, géneros y durationMinutes se autorellenan; campos ausentes → null.
- AC-011 (REQ-005/006): Given resultado de TMDB TV, When se añade, Then campos autorellenados (duración desde episode_run_time si existe).
- AC-012 (REQ-005/006): Given resultado de Google Books, When se añade, Then título, autor, año, sinopsis y póster se autorellenan; duración null.
- AC-013 (REQ-005/006): Given resultado de RAWG/IGDB, When se añade, Then nombre, año y póster se autorellenan; sinopsis opcional.
- AC-014 (REQ-005): Given búsqueda sin resultados, Then se muestra estado vacío.
- AC-015 (REQ-005): Given fallo de API (timeout/401/rate-limit), Then se muestra error y se permite alta manual.
- AC-016 (REQ-012): Given filtro por estado/tipo y opción de orden, When se aplica, Then la lista se actualiza.
- AC-017 (REQ-013): Given un ítem, When se edita o borra (y sus sesiones), Then los cambios persisten.
- AC-004 (REQ-007): Given un ítem no presente en APIs, When lo crea manualmente con título, Then se guarda sin datos externos.
- AC-005 (REQ-008): Given un ítem completado, When añade valoración/reseña/fecha, Then se persisten y se muestran en la ficha.
- AC-006 (REQ-009): Given una serie en curso, When actualiza temporada/episodio, Then la ficha muestra "siguiente episodio" calculado.
- AC-007 (REQ-010): Given un juego en curso, When actualiza horas/%/plataforma/logros, Then se persisten y se muestran.
- AC-008 (REQ-011): Given un título visto varias veces, When añade sesiones con fecha y nota, Then todas se listan y son editables/borrables.
- AC-009 (REQ-004): Given reglas probadas en emulador Firebase con cuenta propietaria y no propietaria, When la no propietaria lee/escribe, Then denegado (403).
- AC-010 (REQ-014): Given título vacío o rating fuera de 1-10 (p.ej. 0, 11, 7.5), When intenta guardar, Then se bloquea con mensaje.

## 6. Non-functional
- Privacidad: reglas Firestore owner-only para las 6 colecciones (lectura y escritura).
- Rendimiento: paginación por cursor a partir de 100 ítems por tipo (Q-004 resuelto).
- Accesibilidad: navegación por teclado en pestañas, modales con foco atrapado, etiquetas ARIA en rating.
- Seguridad: claves de APIs públicas (TMDB/RAWG/Google Books) solo no secretas; proxy IGDB mantiene secretos.

## 7. Decisions and open questions
- D-001: colecciones separadas por tipo (decisión del usuario); unificación solo en UI por pestañas.
- D-002: datos privados (sin amigos) (decisión del usuario).
- D-003: valoración en escala 1-10 entero.
- D-004: sesiones embebidas en el documento del ítem (array `sessions`).
- D-005: anime se busca vía TMDB /search/tv (filtro animación) con Jikan opcional.
- D-006: reutilizar colecciones existentes movies/series/books/games y ajustar reglas a owner-only.
- Q-001: resuelto — anime vía TMDB /search/tv (Jikan opcional).
- Q-002: resuelto — reutilizar colecciones existentes y ajustar reglas a owner-only (D-006).
- Q-003: resuelto — umbral 100 ítems, orden por updatedAt desc.

## 8. Execution matrix
| Task ID | Role | Component | Spec Reference | Status |
|---|---|---|---|---|
| T1 | Spec Architect | `spec.md` | §1-7 | done |
| T2 | Tech Lead | `firestore.rules` (6 colecciones owner-only) | §4.2, AC-009 | todo |
| T3 | Junior Dev 2 (Backend) | `js/catalog.js` (CRUD + sessions) | §4.2, DB-001..008 | todo |
| T4 | Junior Dev 1 (Frontend) | `index.html`, `css/app.css`, `js/app.js` (pestañas, ficha, formularios) | §4.3, UI-001..005 | todo |
| T5 | Junior Dev 2 (Backend) | clientes API (`js/api-tmdb.js`, `js/api-rawg.js`, `js/api-books.js`) | §4.1, API-001..005 | todo |
| T6 | QA & Test Engineer | tests unitarios de validación y normalización | REQ-014, AC-010 | todo |
| T7 | DevOps & Release | PR, merge a `dev` | todos | todo |
| T8 | Reviewer | auditoría contra spec | todos | todo |
