# Spec 003: Dashboard estilo IMDB del catálogo

## 1. Feature Target & Git Context
- **Target Branch:** `dev`
- **Feature Branch:** `feat/003-imdb-dashboard`
- **Scope:** nuevo bloque de presentación sobre el catálogo del spec 002 (datos ya almacenados); solo tras login (spec 001).

## 2. Vision and scope
- Goal: dashboard general con resumen/estadísticas del catálogo + pestañas por tipo, cada ítem con ficha modal estilo IMDB (póster grande, sinopsis, rating, metadata adicional, progreso, sesiones), datos extra consultados a APIs públicas con alta manual como fallback.
- Users: único propietario autenticado.
- Out of scope: amigos/social, recomendaciones, sincronización con streaming, offline completo, edición de metadatos de terceros.

## 3. Requirements
| ID | Requirement | Priority |
|---|---|---|
| REQ-001 | Pestaña «Dashboard» primera: resumen + estadísticas del catálogo. | must |
| REQ-002 | Pestañas por tipo (pelis, series, juegos, libros, anime) con tarjetas. | must |
| REQ-003 | Ficha modal estilo IMDB por ítem, abierta al hacer clic en la lista. | must |
| REQ-004 | Metadata adicional (reparto, director, duración, plataformas, episodios) consultada a APIs; alta manual si no existe. | must |
| REQ-005 | Estadísticas: totales por tipo/estado, media de valoración, horas jugadas, completados, recientes. | must |
| REQ-006 | Responsive (móvil) y tema oscuro (variables existentes). | must |
| REQ-007 | Acceso solo tras login (spec 001), sin gating adicional. | must |
| REQ-008 | Modal con foco atrapado, Escape y clic en backdrop para cerrar, ARIA roles `dialog`, `tablist`, `tab`, `tabpanel`, `button`; foco devuelve al elemento que abrió el modal. | must |
| REQ-009 | Caché de metadata en Firestore: válida 30 días; se refresca si `metadataFetchedAt` es null o anterior a 30 días (o si el usuario fuerza reintento). | should |
| REQ-010 | Indicador de carga y error con reintento en la ficha. | must |

## 4. Contracts

### 4.1 API (externas, detalle)
| ID | Provider | Endpoint | Uso | Respuesta |
|---|---|---|---|---|
| API-001 | TMDB | `GET /movie/{id}` | detalle de película (reparto, director, duración, géneros) | `ItemMetadata` |
| API-002 | TMDB | `GET /tv/{id}` + `/credits` | detalle de serie/anime (reparto, creador, temporadas, episodios) | `ItemMetadata` |
| API-003 | IGDB | `POST /v4/games` (por id) | detalle de juego (plataformas, desarrollador, sinopsis, portada) | `ItemMetadata` |
| API-004 | Google Books | `GET /volumes/{id}` | detalle de libro (autores, editorial, páginas, categorías) | `ItemMetadata` |

`ItemMetadata`: `{ title?, year?, posterUrl?, backdropUrl?, synopsis?, genres[], durationMinutes?, director?, cast[], platforms[], developers[], publisher?, authors[], pageCount?, seasons?, episodes?, tagline?, language? }` (campos opcionales; serializados como null).

Casos de error (§4.1): `externalId` inexistente (404) → `{ok:false, code:'not_found'}`; rate limit → `rate_limited`; fallo OAuth IGDB → `unauthorized`; fallo parcial de créditos TMDB → metadatos disponibles + aviso; fallo de escritura de caché en Firestore → se muestra sin caché con reintento.

Contrato de error (spec 002, §4.1, fallo normalizado `{ ok:false, provider, code, message }`): `{ ok:false, provider, code, message }` o `{ ok:true, item }`.

### 4.2 Data (Firestore)
Extiende CatalogItem (spec 002, DB-001) con campos opcionales de metadata (sin romper compatibilidad):

| ID | Entidad | Campos añadidos (tipo, restricciones) |
|---|---|---|
| DB-001 | CatalogItem (base, spec 002) | sin cambios |
| DB-002 | ItemMetadata (embebido) | `director` string? (≤200); `cast` string[] (≤20, cada ≤100); `backdropUrl` string? (URL); `tagline` string? (≤300); `platforms` string[] (≤10); `developers` string[] (≤10); `publisher` string? (≤200); `authors` string[] (≤10); `pageCount` number? (≥0); `seasons` number? (≥0); `episodes` number? (≥0); `language` string? (≤50); `metadataSource` enum (`tmdb`,`igdb`,`googlebooks`,`manual`); `metadataFetchedAt` timestamp? |
| DB-003 | SeriesItem/AnimeItem | base + metadata + `nextEpisode` (spec 002) |

Reglas: los campos de metadata son opcionales; validación solo de tipos/rangos; escritura owner-only (spec 002, REQ-004).

### 4.3 UI
| ID | Pantalla | Componentes | API usada |
|---|---|---|---|
| UI-001 | Pestaña Dashboard (primera) | `DashboardView`, `StatCard`, `RecentList`, `StatusChart` | Firestore (agregación en cliente) |
| UI-002 | Pestañas por tipo | `TypeTabs`, `ItemList`, `ItemCard` (spec 002) | Firestore |
| UI-003 | Ficha modal IMDB | `ItemModal`, `MetadataSection`, `CastList`, `ProgressSection`, `SessionList` | API-001..004 + Firestore |
| UI-004 | Edición manual de metadata | `MetadataForm` | Firestore |

## 5. Acceptance criteria (BDD)
- AC-001 (REQ-001): Given un usuario autenticado, When abre el catálogo, Then la primera pestaña es «Dashboard» con resumen y estadísticas.
- AC-002 (REQ-002): Given el dashboard, When cambia a una pestaña de tipo, Then ve las tarjetas de ese tipo.
- AC-003 (REQ-003): Given una tarjeta, When hace clic, Then se abre el modal IMDB con póster, título, año, géneros, sinopsis, rating y estado.
- AC-004 (REQ-004): Given un ítem con `source.externalId`, When se abre el modal, Then se consultan metadatos adicionales a la API y se muestran (reparto, director, etc.); si la API falla o no hay id, se permite añadir manualmente; Given alta manual, When se guarda con campos válidos, Then se persiste y se muestra; When campos inválidos, Then se bloquea con mensaje.
- AC-005 (REQ-005): Given el dashboard, When hay ítems, Then muestra totales por tipo/estado, media de valoración (solo ítems con rating, excluye sin valorar), horas jugadas, completados y recientes (2 listas de 5: añadidos y completados).
- AC-006 (REQ-006): Given un viewport móvil, When se usa el dashboard y el modal, Then se adaptan sin scroll horizontal.
- AC-007 (REQ-008): Given el modal abierto, When pulsa Escape o clic en el backdrop, Then se cierra y el foco vuelve al elemento que lo abrió.
- AC-008 (REQ-009): Given metadatos cacheados con `metadataFetchedAt` < 30 días, When se reabre el modal, Then no se repite la llamada a la API; si es null o ≥30 días, se refresca.
- AC-009 (REQ-010): Given fallo de red, When se abre el modal, Then muestra error con botón de reintento y opción manual; Given `externalId` inexistente (404), Then muestra error «no encontrado» y permite alta manual; Given API parcial (TMDB credits falla), Then muestra metadatos disponibles y avisa; Given error `rate_limited` o `unauthorized`, Then muestra mensaje específico con reintento; Given fallo de escritura de caché en Firestore, Then se muestra sin caché con reintento.

## 6. Non-functional
- Responsive: breakpoints existentes (mobile ≤640px); modal a pantalla completa en móvil.
- Accesibilidad: foco atrapado en modal, Escape, ARIA roles (dialog, tablist, tabpanel).
- Privacidad: metadata en colecciones owner-only (spec 002).
- Rendimiento: metadata se carga bajo demanda (no en listado); caché en Firestore.

## 7. Decisions and open questions
- D-001: dashboard es la primera pestaña (decisión del usuario).
- D-002: metadata adicional se consulta a APIs y se cachea en Firestore (`metadataFetchedAt`).
- D-003: alta manual como fallback cuando no hay API o falla.
- D-004: tema oscuro reutilizando variables CSS existentes.
- D-005: estadísticas del dashboard = contadores por tipo/estado + media de rating (solo valorados) + horas jugadas + completados + 5 recientes.
- D-006: metadata embebida en CatalogItem (campos opcionales), no subdocumento.
- D-007: dashboard usa tarjetas/contadores (sin gráficos externos).
- Q-001: resuelto (D-005).
- Q-002: resuelto (D-006).
- Q-003: resuelto (D-007).

## 8. Execution matrix
| Task ID | Role | Component | Spec Reference | Status |
|---|---|---|---|---|
| T1 | Spec Architect | `spec.md` | §1-7 | done |
| T2 | Tech Lead | `firestore.rules` (metadata fields, sin cambios de reglas) | §4.2 | todo |
| T3 | Junior Dev 2 (Backend) | clientes de detalle en `js/api-tmdb.js`, `js/api-games.js`, `js/api-books.js` | §4.1, API-001..004 | todo |
| T4 | Junior Dev 2 (Backend) | `js/catalog.js` (metadata + caché) | §4.2, DB-002, REQ-009 | todo |
| T5 | Junior Dev 1 (Frontend) | `index.html`, `css/app.css`, `js/app.js` (dashboard, tabs, modal IMDB) | §4.3, UI-001..004 | todo |
| T6 | QA & Test Engineer | tests unitarios (validación metadata, estadísticas) | REQ-005, AC-005 | todo |
| T7 | DevOps & Release | PR, merge a `dev` | todos | todo |
| T8 | Reviewer | auditoría contra spec | todos | todo |
