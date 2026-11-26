# specs-delta — Cambio «movies» (Películas)

Base: `specs/00-overview.md`. Namespace de este cambio: `*-M*`. Los requisitos
MODIFIED conservan su ID base. Textos explicativos en español; identificadores,
campos y valores internos en inglés.

---

## ADDED Requirements

### Resumen (REQ-M)

| ID | Requisito | Prioridad |
|---|---|---|
| REQ-M01 | Integración con TMDB API v3 (búsqueda, 4 listas de exploración, ficha) con degradación si falta la clave o hay fallo de red | must |
| REQ-M02 | Alta manual de películas sin conexión o sin resultados en TMDB | must |
| REQ-M03 | Metadatos completos en tarjeta y ficha: poster, backdrop, títulos es/original, fecha, duración, géneros, sinopsis, director, reparto, tráiler y `vote_average`/`vote_count` | must |
| REQ-M04 | Repositorio personal en `users/{uid}/movies/{movieId}` con caché de metadatos TMDB (sin llamadas a la API para renderizar la biblioteca) | must |
| REQ-M05 | Estados `watchlist|watching|watched|dropped` + interruptor de favorito (`isFavorite`) desde tarjeta y ficha | must |
| REQ-M06 | Rewatches: `watchCount` con +1/−1/manual y `watchDates: timestamp[]` automático | must |
| REQ-M07 | `userRating` (0–10, medios puntos), `userReview`, `tags` y `hasSpoilers` | must |
| REQ-M08 | Colecciones propias (`movie_collections`) con multi-asignación (`collectionIds`) y filtrado por colección | must |
| REQ-M09 | Sección con 3 pestañas: «Explorar catálogo», «Mi biblioteca», «Mis colecciones» | must |
| REQ-M10 | Búsqueda instantánea + filtros combinables + 7 claves de orden en Mi biblioteca | must |
| REQ-M11 | Barra de estadísticas rápidas (vistas, visionados, horas, pendientes, nota media personal vs TMDB) | must |
| REQ-M12 | Reglas/índices Firestore, arquitectura modular `js/movies/` sin frameworks y UTF-8 sin BOM | must |

---

### API — Cliente TMDB (API-M)

Base URL: `https://api.themoviedb.org/3`. Parámetros fijos de toda petición:
`api_key` (desde `TMDB_API_KEY` de `js/config.js`), `language=es-ES`,
`include_adult=false`. Un único punto de red: `js/movies/tmdbClient.js` (no
importa URLs de CDN, cumple REQ-C1).

| ID | Método | Path | Request (query) | Response | Errores |
|---|---|---|---|---|---|
| API-M01 | GET | `/search/movie` | `query` (≥2 chars), `year?`, `page=1` | `TmdbPagedResult` | `NO_API_KEY`, `NETWORK`, `HTTP_401`, `HTTP_429`, `PARSE` |
| API-M02 | GET | `/trending/movie/week` | `page=1` | `TmdbPagedResult` | ídem |
| API-M03 | GET | `/movie/popular` | `page=1` | `TmdbPagedResult` | ídem |
| API-M04 | GET | `/movie/top_rated` | `page=1` | `TmdbPagedResult` | ídem |
| API-M05 | GET | `/movie/upcoming` | `page=1` | `TmdbPagedResult` | ídem |
| API-M06 | GET | `/movie/{id}` | `append_to_response=credits,videos,watch/providers` | `TmdbMovieDetail` | ídem + `HTTP_404` |
| API-M07 | — | `https://image.tmdb.org/t/p/w500{posterPath}` · `…/w1280{backdropPath}` | — | `string` URL o `null` si `path == null` | — |
| API-M08 | — | `https://www.youtube.com/watch?v={trailerKey}` | — | `string` URL o `null` | — |

Contratos TypeScript (`js/movies/tmdbClient.js`):

```ts
export type TmdbErrorCode =
  | "NO_API_KEY" | "NETWORK" | "HTTP_401" | "HTTP_429" | "HTTP_404" | "PARSE";
export class TmdbError extends Error { readonly code: TmdbErrorCode; }

export interface TmdbMovieSummary {
  id: number;
  title: string;               // title (es-ES)
  originalTitle: string;       // original_title
  posterPath: string | null;   // "/abc.jpg"
  releaseDate: string | null;  // "YYYY-MM-DD"
  genreIds: number[];          // genre_ids
  overview: string;
  voteAverage: number | null;  // vote_average
  voteCount: number | null;    // vote_count
}
export interface TmdbMovieDetail extends TmdbMovieSummary {
  backdropPath: string | null;
  runtime: number | null;      // minutos
  genres: string[];            // genres[].name en es-ES
  director: string | null;     // credits.crew job === "Director"
  cast: string[];              // primeros 5 de credits.cast
  trailerKey: string | null;   // videos: YouTube, type "Trailer" (si no, primer YouTube)
  watchProviders: string[];    // watch/providers → results.ES (flatrate|buy|rent), ≤10; [] si no hay
}
export interface TmdbPagedResult {
  page: number; totalPages: number; results: TmdbMovieSummary[];
}

export function isTmdbConfigured(): boolean;                 // TMDB_API_KEY.trim() !== ""
export function searchMovies(query: string, year?: number | null, page?: number): Promise<TmdbPagedResult>;
export function fetchTrendingWeek(page?: number): Promise<TmdbPagedResult>;
export function fetchPopular(page?: number): Promise<TmdbPagedResult>;
export function fetchTopRated(page?: number): Promise<TmdbPagedResult>;
export function fetchUpcoming(page?: number): Promise<TmdbPagedResult>;
export function getMovieDetail(tmdbId: number): Promise<TmdbMovieDetail>;
export function posterUrl(path: string | null, size?: "w92" | "w185" | "w500"): string | null; // default w500
export function backdropUrl(path: string | null, size?: "w780" | "w1280"): string | null;      // default w1280
export function trailerUrl(key: string | null): string | null;
```

Comportamiento: `fetch` con `AbortController` y timeout 10 s; cualquier error se
lanza como `TmdbError` (nunca promesa rechazada sin capturar); `isTmdbConfigured()
=== false` ⇒ las funciones lanzan `NO_API_KEY` sin hacer red (ver ALG-M05).

---

### Data model (DB-M)

#### DB-M01 — `users/{uid}/movies/{movieId}`

| Campo | Tipo | Restricciones / notas |
|---|---|---|
| `movieId` (doc id) | string | `String(tmdbId)` si `source=="tmdb"`; auto-ID de Firestore si `source=="manual"` |
| `source` | `"tmdb" \| "manual"` | — |
| `tmdbId` | `number \| null` | id TMDB; `null` en manual |
| `title` | string | 1–200, título en es-ES |
| `originalTitle` | string | 0–200 |
| `posterPath` | `string \| null` | ruta TMDB (`/xxx.jpg`) |
| `backdropPath` | `string \| null` | ruta TMDB |
| `releaseDate` | `string \| null` | `"YYYY-MM-DD"` |
| `releaseYear` | `number \| null` | derivado de `releaseDate`; `null` en manual sin año |
| `runtime` | `number \| null` | minutos |
| `genreIds` | `number[]` | ≤30 ids TMDB (fuente del filtro de género) |
| `genres` | `string[]` | nombres es-ES; puede estar `[]` hasta abrir la ficha |
| `overview` | string | ≤2000; `""` si no hay |
| `director` | `string \| null` | — |
| `cast` | `string[]` | ≤10 |
| `trailerKey` | `string \| null` | clave YouTube |
| `watchProviders` | `string[]` | ≤10, `[]` si no hay |
| `tmdbRating` | `number \| null` | `vote_average`; `null` en manual |
| `tmdbVoteCount` | `number \| null` | `vote_count`; `null` en manual |
| `detailCachedAt` | `timestamp \| null` | ver ALG-M06 |
| `status` | `"watchlist" \| "watching" \| "watched" \| "dropped"` | valor interno inglés |
| `isFavorite` | boolean | — |
| `watchCount` | number | entero 0–1000 |
| `watchDates` | `timestamp[]` | ≤1000 entradas, ascendente |
| `lastWatchedAt` | `timestamp \| null` | último elemento de `watchDates` o `null` |
| `userRating` | `number \| null` | 0–10, paso 0.5 (ALG-M04) |
| `userReview` | `string \| null` | ≤2000 |
| `tags` | `string[]` | ≤20 elems, ≤30 chars c/u |
| `hasSpoilers` | boolean | — |
| `collectionIds` | `string[]` | ≤50 ids de `movie_collections` |
| `addedAt` | `timestamp` | `serverTimestamp()` en alta |
| `updatedAt` | `timestamp` | `serverTimestamp()` en cada escritura |

#### DB-M02 — `users/{uid}/movie_collections/{collectionId}`

| Campo | Tipo | Restricciones |
|---|---|---|
| `name` | string | 1–60, único por usuario (el repo comprueba duplicados antes de crear) |
| `description` | `string \| null` | ≤300 |
| `createdAt` / `updatedAt` | `timestamp` | `serverTimestamp()` |

No almacena `movieIds`: las películas referencian con `collectionIds` (una
pelicula puede estar en 0, 1 o varias colecciones) y el recuento se calcula en
cliente.

#### DB-M03 — Convención de identidad y upsert

- Alta desde catálogo: `addFromTmdb` hace upsert por doc id `String(tmdbId)`;
  si ya existe **no** pisa campos personales (`status`, `userRating`, …) y
  devuelve el id existente (sin duplicados).
- Alta manual: auto-ID + `source:"manual"`, `tmdbId:null`, `tmdbRating:null`.
  No se deduplica por título (existen remakes): solo el upsert por `tmdbId`
  evita duplicados en el origen TMDB.
- Ninguna función del repo acepta `uid` paramétrico: el uid sale de
  `auth.currentUser` (ver SEC-M03).

#### DB-M04 — Índices compuestos requeridos (`firestore.indexes.json`)

`queryScope: COLLECTION`, `collectionGroup: "movies"`. Solo filtros van al
servidor (el orden se aplica en cliente, D-M03):

| # | Campos |
|---|---|
| 1 | `status ASC` + `genreIds CONTAINS` |
| 2 | `status ASC` + `collectionIds CONTAINS` |
| 3 | `status ASC` + `genreIds CONTAINS` + `collectionIds CONTAINS` |
| 4 | `isFavorite ASC` + `genreIds CONTAINS` |
| 5 | `isFavorite ASC` + `collectionIds CONTAINS` |
| 6 | `isFavorite ASC` + `genreIds CONTAINS` + `collectionIds CONTAINS` |

`status` (un valor) y `isFavorite` son exclusivos entre sí («favoritos» es el
pseudofiltro de estado), por eso no se necesitan índices cruzados entre ambos.

---

### Security (SEC-M)

| ID | Regla |
|---|---|
| SEC-M01 | `match /movie_collections/{id}`: `allow read, create, update, delete` solo si `isAllowedUser() && isOwner(userId)`; escrituras validadas por `isValidMovieCollection()` (`name` 1–60 string; `description` null o string ≤300) |
| SEC-M02 | Se amplía el match existente `movies/{itemId}` (garantía owner-only intacta; solo se sustituye el `allow read, write` por permisos create/update/delete equivalentes): create/update exigen `isValidMovieDoc()`, con validaciones **condicionales** (solo se exigen si el campo está presente, patrón del `isValidEntry()` existente, para no romper documentos parciales) — `status` ∈ estados válidos, `isFavorite`/`hasSpoilers` bool, `watchCount` entero 0–1000, `userRating` null o number 0–10 (el paso 0.5 lo valida el cliente, ALG-M04), `userReview` null o ≤2000, `tags` ≤20 strings ≤30, `collectionIds` ≤50 strings, `genreIds` ≤30 numbers, `source` ∈ `["tmdb","manual"]`; borrado libre del dueño |
| SEC-M03 | El cliente solo construye rutas `users/{auth.uid}/…`; el repo lanza `SESSION_EXPIRED` si no hay sesión. Toda consulta exige `isAllowedUser()` (allowlist) además del owner. Sin acceso cruzado entre usuarios |

Las funciones `isAllowedUser()`, `isOwner()` y los matches existentes se
conservan intactos (REQ-F2 MODIFIED).

---

### UI (UI-M)

Textos visibles en español (`es-ES`), IDs estables (REQ-C2). Contenedor:
`#movies-section` dentro de `#app-main`, inicialmente `hidden`.

| ID | Pantalla / componente | IDs estables | API usada |
|---|---|---|---|
| UI-M01 | Entrada de nav + sección con 3 pestañas (`role="tablist"`, `aria-selected`) | `nav-movies` («Películas»), `movies-section`, `movies-tab-catalog` («Explorar catálogo»), `movies-tab-library` («Mi biblioteca»), `movies-tab-collections` («Mis colecciones»), `movies-panel-catalog`, `movies-panel-library`, `movies-panel-collections` | — |
| UI-M02 | Barra de estadísticas superior (siempre visible, sobre las pestañas) | `movies-stats`, `movies-stats-watched` («Vistas»), `movies-stats-rewatches` («Visionados»), `movies-stats-hours` («Horas»), `movies-stats-pending` («Pendientes»), `movies-stats-avg-user` («Mi nota media»), `movies-stats-avg-tmdb` («Nota media TMDB») | ALG-M01 |
| UI-M03 | Explorar catálogo: buscador instantáneo (debounce 300 ms, ≥2 chars) + 4 secciones «Tendencias de la semana», «Populares», «Mejor valoradas», «Próximos estrenos» (página 1); con resultados de búsqueda las listas se ocultan | `movies-catalog-search`, `movies-catalog-results`, `movies-catalog-sections`, `movies-catalog-grid`, `movies-catalog-empty` («Sin resultados para «X».»), `movies-catalog-error` | API-M01..M05 |
| UI-M04 | Tarjeta de película (compartida catálogo/biblioteca) | `<article class="movie-card">`: `movie-card-open` (poster + título + año + `★ vote_average`), `movie-card-add` (solo catálogo: alta inmediata con `status:"watchlist"`; si ya está en biblioteca, botón desactivado con «En biblioteca» — no es un control de favorito), `movie-card-favorite` (solo tarjetas de biblioteca, `aria-pressed`, alterna `isFavorite`), badge de estado en español, `movie-card-watchcount` («×N» si >1) | API-M07, DB-M01 |
| UI-M05 | Mi biblioteca: buscador instantáneo + filtros combinables + orden | `movies-library-search`, `movies-library-status` (opciones: «Todos», «Pendientes», «Viendo», «Vistas», «Abandonadas», «Favoritas»; etiquetas de filtro en plural porque agrupan estados, mientras el badge individual usa las formas singulares de UI-M09), `movies-library-genre` (diccionario estático es-ES), `movies-library-collection` («Todas» + nombres), `movies-library-rating-min`, `movies-library-rating-max` (0–10, paso 0.5), `movies-library-clear` («Limpiar filtros»), `movies-library-sort` («Fecha de añadido», «Último visionado», «Mi puntuación», «Puntuación TMDB», «Veces vista», «Año de estreno», «Título (A-Z)»; defecto «Fecha de añadido»), `movies-library-count` («1 película» en singular, «N películas» en plural), `movies-library-grid`, `movies-library-empty`, `movies-library-error` | DB-M01, ALG-M02 |
| UI-M06 | Ficha: `<dialog id="movie-detail">` con dos bloques. **Catálogo**: `movie-detail-poster`, `movie-detail-backdrop`, `movie-detail-title`, `movie-detail-original-title`, `movie-detail-release` (fecha es-ES), `movie-detail-runtime` («148 min»), `movie-detail-genres`, `movie-detail-overview`, `movie-detail-director`, `movie-detail-cast`, `movie-detail-trailer` («Ver tráiler», `target="_blank" rel="noopener noreferrer"`), `movie-detail-providers` («Dónde ver», sección oculta si `[]`), `movie-detail-tmdb-rating` («TMDB 8,4 (12.345 votos)»). **Seguimiento**: `movie-detail-status` (select de 4 estados), `movie-detail-favorite` (`aria-pressed`), `movie-detail-watch-count`, `movie-detail-watch-inc` («+1»), `movie-detail-watch-dec` («−1»), `movie-detail-watch-input` (edición manual), `movie-detail-watch-dates` (lista de fechas es-ES), `movie-detail-user-rating` (0–10 step 0.5, vacío = sin nota), `movie-detail-review` (textarea), `movie-detail-spoilers` (checkbox «Mi reseña contiene spoilers»), `movie-detail-tags` (coma-separado), `movie-detail-collections` (checkbox por colección), `movie-detail-save` («Guardar»), `movie-detail-refresh` («Actualizar datos»), `movie-detail-delete` («Eliminar»: pide confirmación con «¿Eliminar esta película de tu biblioteca?» y solo borra al aceptar), `movie-detail-close` («Cerrar»), `movie-detail-dirty-warning` («Cambios sin guardar», visible solo con cambios pendientes de rating/reseña/etiquetas/spoiler), `movie-detail-spoiler-warning` («Contiene spoilers» + «Mostrar reseña») | API-M06, DB-M01, ALG-M03..M06 |
| UI-M07 | Mis colecciones: crear / renombrar / describir / eliminar y entrar a filtrar | `movies-collections-form`, `movies-collection-name`, `movies-collection-description`, `movies-collection-submit` («Crear colección»), `movies-collections-list`, `movies-collection-item` (nombre, «N películas», `movies-collection-open`, `movies-collection-rename`, `movies-collection-delete`), `movies-collections-empty` («Aún no tienes colecciones.») | DB-M02 |
| UI-M08 | Alta manual + avisos | `movies-manual-open` («Añadir manualmente»), `movies-manual-form`, `movies-manual-title` (obligatorio), `movies-manual-year`, `movies-manual-runtime`, `movies-manual-overview`, `movies-manual-genres` (multi-select del diccionario), `movies-manual-submit` («Guardar película»), `movies-manual-error`; `movies-tmdb-warning` («No se pudo conectar con TMDB. Puedes añadir la película manualmente.» o «Falta la clave de TMDB: búsqueda desactivada.», `role="status"`); `movies-error` (`role="alert"`) | REQ-M02, ALG-M05 |
| UI-M09 | Mapa de etiquetas (valor interno inglés → texto UI español) | `watchlist`→«Pendiente», `watching`→«Viendo», `watched`→«Vista», `dropped`→«Abandonada» (formas singulares: rotulan el badge de una película, frente al plural de los filtros de UI-M05); exportado como `STATUS_LABELS` desde `moviesState.js` | DB-M01 |
| UI-M10 | Accesibilidad y codificación | Foco inicial en el título del diálogo, ESC cierra y devuelve foco al disparador; todo input/select con `<label>`; botones icono con `aria-label`; `aria-pressed` en favorito; errores en `role="alert"`; UTF-8 sin BOM y sin caracteres de reemplazo | NFR-M02, NFR-M03 |

---

### Logic (ALG-M)

| ID | Algoritmo | Regla |
|---|---|---|
| ALG-M01 | `computeStats(movies)` (puro) | `totalWatched` = nº de `status=="watched"`; `totalRewatches` = Σ `watchCount` (todas); `totalHours` = Σ(`runtime × watchCount`)/60 solo con `runtime != null`, 1 decimal con coma es-ES; `pendingCount` = nº `status=="watchlist"`; `avgUserRating` = media de `userRating != null`, 1 decimal; `avgTmdbRating` = media de `tmdbRating != null`, 1 decimal. Vacío ⇒ todas las stats en «—» |
| ALG-M02 | `filterMovies` + `sortMovies` (puros) | Servidor: 1 igualdad (`status` o `isFavorite==true`) + ≤2 `array-contains` (`genreIds`, `collectionIds`). Cliente: búsqueda sobre `title`+`originalTitle` con `normalize("NFD")` + quitar marcas + minúsculas; rango `userRating` (si algún extremo está fijado, los docs con `userRating null` se excluyen). Orden siempre en cliente: `addedAt`/`lastWatchedAt`/`userRating`/`tmdbRating`/`watchCount`/`releaseYear` DESC, `title` ASC con `Intl.Collator("es-ES")`; **nulls siempre al final**; desempate: `title` ASC para `addedAt`, `title` ASC para el resto. Claves: `addedAt`, `lastWatchedAt`, `userRating`, `tmdbRating`, `watchCount`, `releaseYear`, `title` |
| ALG-M03 | Escrituras de rewatch (`watch`, `unwatch`, `setStatus`) | `setStatus(x → "watched")`: `watchCount+1`, `watchDates.push(ahora)`, `lastWatchedAt=ahora`. `setStatus` a otro estado: solo cambia `status`. `watch()` («+1»): `watchCount+1` (tope 1000), push de hoy, `lastWatchedAt=ahora`. `unwatch()` («−1»): `watchCount−1` (mín 0), `pop()` de `watchDates`, `lastWatchedAt` = último elemento o `null`. **Al llegar a 0**: `watchDates=[]`, `lastWatchedAt=null` y `status` pasa a `"watchlist"` si era `"watched"` (nunca queda `"watched"` con 0 visionados); `"watching"` y `"dropped"` se conservan porque expresan intención del usuario. Edición manual a `N`: `watchCount=N`; si `N < longitud` trunca `watchDates` a los últimos `N`; si `N > longitud` no inventa fechas. «Hoy» = `Timestamp` de fecha local del cliente; `updatedAt` con `serverTimestamp()` |
| ALG-M04 | `parseUserRating(raw)` (puro) | Acepta `«7,5»`/`«7.5»` → 7.5. Vacío/`null` → `null`. Fuera de 0–10 o no múltiplo de 0.5 → lanza error con mensaje en español («Introduce una nota entre 0 y 10, en medios puntos.»), no se guarda |
| ALG-M05 | Resolución de clave y errores | Orden: `TMDB_API_KEY` de `js/config.js` → si vacía, `isTmdbConfigured()==false` y las llamadas lanzan `NO_API_KEY` sin red. Mapeo a UI: `NO_API_KEY` → «Falta la clave de TMDB: búsqueda desactivada.»; `NETWORK`/`HTTP_429`/`HTTP_401` → «No se pudo conectar con TMDB. Puedes añadir la película manualmente.»; `HTTP_404` → «Película no encontrada en TMDB. Puedes añadirla manualmente.»; `PARSE` → «Respuesta no válida de TMDB. Puedes añadir la película manualmente.»; en todos los casos el alta manual sigue operativa |
| ALG-M06 | Caché de detalle | La biblioteca se renderiza **solo** con los campos del doc (ninguna llamada TMDB). Al abrir la ficha: si `detailCachedAt` es reciente (<30 días) usar el cache; si no, `getMovieDetail` y guardar en el doc con `detailCachedAt=now`. Si la recarga falla pero hay cache, mostrar el cache + aviso en español. `movie-detail-refresh` fuerza la recarga |

---

## MODIFIED Requirements

### REQ-D2 (MODIFIED) — Navegación con la primera categoría

`#app-nav` conserva `aria-label="Navegación principal"` y pasa de estar vacía a
contener una entrada estática «Películas» (`#nav-movies`, tipo `button`,
`aria-expanded`). Es la primera de las categorías que se irán añadiendo; el
resto de la nav sigue sin enlaces.

### REQ-D3 (MODIFIED) — Estado vacío condicional

`#app-empty` («Selecciona o añade una categoría para empezar») sigue visible al
entrar en `allowed`. Queda **oculto** mientras `#movies-section` esté visible y
vuelve al pulsar de nuevo «Películas» (toggle). El texto no cambia.

### REQ-F2 (MODIFIED) — Infraestructura: extensión puntual

`firebase.json`, `opencode.jsonc` y `.opencode/` no se tocan. Este cambio sí
**extiende** `firestore.rules` (SEC-M01/M02) y `firestore.indexes.json`
(DB-M04). No se elimina ningún match ni función auxiliar existente; el único
cambio sobre una regla previa es el match `movies/{itemId}`, que conserva el
acceso owner-only y añade validación de campos (SEC-M02). La publicación
sigue siendo manual: reglas por consola Firebase; índices con
`firebase deploy --only firestore:indexes` o consola.

---

## REMOVED Requirements

Ninguno. (Los requisitos del núcleo base se conservan; solo se modifican
REQ-D2, REQ-D3 y REQ-F2.)

---

## Acceptance criteria (BDD) — AC-M

- **AC-M01 (API-M01, ALG-M05):** Dado `TMDB_API_KEY` vacío en `js/config.js`,
  Cuando se abre «Explorar catálogo», Entonces se muestra
  «Falta la clave de TMDB: búsqueda desactivada.», no hay peticiones de red ni
  excepciones sin capturar, y «Añadir manualmente» sigue funcionando.
- **AC-M02 (API-M01):** Dado `TMDB_API_KEY` válida, Cuando se busca
  «Inception» (≥2 caracteres, con debounce), Entonces aparecen resultados con
  título en español, año de estreno y puntuación TMDB visibles.
- **AC-M03 (API-M02..M05):** Dada sesión con clave, Cuando se abre el catálogo
  sin búsqueda activa, Entonces las cuatro listas (tendencias, populares, mejor
  valoradas, próximos estrenos) muestran tarjetas con póster, título y año.
- **AC-M04 (API-M06):** Dada la ficha de TMDB con
  `append_to_response=credits,videos,watch/providers`, Cuando se abre el
  diálogo, Entonces se ven poster, backdrop, título original, fecha, duración,
  géneros, sinopsis, director, reparto, enlace a tráiler y «TMDB 8,4 (12.345
  votos)».
- **AC-M05 (API-M07, API-M08):** Dado un movie con `posterPath`, Cuando se
  renderiza una tarjeta, Entonces la imagen apunta a
  `https://image.tmdb.org/t/p/w500/…`; sin `posterPath` se muestra placeholder;
  con `trailerKey` el enlace apunta a `https://www.youtube.com/watch?v=…`.
- **AC-M06 (API-M, ALG-M05):** Dada una caída de red o error 429 de TMDB,
  Cuando se busca un título, Entonces se ve «No se pudo conectar con TMDB.
  Puedes añadir la película manualmente.» y la app sigue operativa.
- **AC-M07 (DB-M01, DB-M03):** Dada una película añadida desde el catálogo,
  Cuando se lee `users/{uid}/movies/{tmdbId}`, Entonces el documento contiene
  metadatos cacheados, `status:"watchlist"`, `watchCount:0`,
  `isFavorite:false`, `collectionIds:[]`, `addedAt` y `updatedAt`; volver a
  añadir la misma no crea un segundo documento.
- **AC-M08 (REQ-M02, DB-M03):** Dado el alta manual con título «Película
  local» y sin conexión, Cuando se guarda, Entonces aparece en la biblioteca
  con `source:"manual"`, `tmdbId:null` y cero llamadas a `fetch` de TMDB.
- **AC-M09 (UI-M09):** Dados los cuatro valores internos, Cuando se muestra
  cada película, Entonces la etiqueta visible es «Pendiente», «Viendo»,
  «Vista» y «Abandonada» respectivamente, nunca el valor interno en inglés.
- **AC-M10 (ALG-M03):** Dada una película con `watchCount:2` y dos
  `watchDates`, Cuando se pulsa «+1», Entonces `watchCount` pasa a 3 y se
  añade la fecha actual; Cuando se pulsa «−1», Entonces vuelve a 2 y se elimina
  la última fecha; Cuando se pulsa «−1» hasta llegar a 0, Entonces `watchCount`
  queda en 0, `watchDates` queda vacío, `lastWatchedAt` pasa a `null` y el
  `status` cambia de `"watched"` a `"watchlist"` («Pendiente»), nunca permanece
  en «Vista» con 0 visionados.
- **AC-M11 (ALG-M03):** Dada una película en `watching`, Cuando se cambia el
  estado a «Vista», Entonces `watchCount` incrementa en 1, `watchDates` incluye
  hoy y `lastWatchedAt` es la fecha/hora actual.
- **AC-M12 (ALG-M04):** Dado el campo de nota personal, Cuando se introduce
  «7,5», Entonces se guarda `userRating:7.5`; Cuando se introduce «11» o
  «0,3», Entonces no se guarda y aparece «Introduce una nota entre 0 y 10, en
  medios puntos.»
- **AC-M13 (UI-M06):** Dada una reseña con `hasSpoilers:true`, Cuando se abre
  la ficha, Entonces la reseña está oculta tras «Contiene spoilers» y el botón
  «Mostrar reseña» la revela; al desmarcar la casilla se muestra directamente.
- **AC-M14 (UI-M04, UI-M06):** Dada una película en biblioteca, Cuando se
  pulsa el favorito de la tarjeta o de la ficha, Entonces `isFavorite` queda en
  `true` en Firestore y el icono sigue activo tras recargar la página.
- **AC-M15 (DB-M01, UI-M07):** Dadas las colecciones «Maratón Nolan» y
  «Obras maestras», Cuando Inception se asigna a ambas y Interstellar solo a
  la primera, Entonces el filtro por colección lista exactamente esas
  películas en cada caso, y una película puede pertenecer a varias a la vez.
- **AC-M16 (UI-M07, DB-M02):** Dada «Maratón Nolan» con 2 películas, Cuando
  se elimina la colección, Entonces desaparece de «Mis colecciones» y el id
  desaparece de `collectionIds` de esas películas (verificado reabriendo sus
  fichas).
- **AC-M17 (UI-M01, REQ-D2, REQ-D3):** Dada la sesión en `allowed`, Cuando se
  pulsa «Películas», Entonces `#app-empty` se oculta y se muestran las tres
  pestañas; Cuando se pulsa otra vez, Entonces vuelve `#app-empty` con su
  texto original.
- **AC-M18 (ALG-M02):** Dada una biblioteca con varias películas, Cuando se
  combinan estado «Vistas» + género «Drama» + una colección + rango 8–10,
  Entonces solo se listan las que cumplen los cuatro; «Limpiar filtros»
  restaura la lista completa.
- **AC-M19 (ALG-M02):** Dada una biblioteca con «Amélie» (title con acento) y
  películas sin `userRating`, Cuando se ordena por «Título (A-Z)», Entonces el
  orden respeta la colación `es-ES`; Cuando se ordena por «Mi puntuación»,
  Entonces ninguna película desaparece y las sin nota quedan al final.
- **AC-M20 (ALG-M01):** Dadas A (`watched`, 120 min, `watchCount:3`,
  `userRating:8.5`, `tmdbRating:8.4`), B (`watched`, 90 min,
  `watchCount:1`, `userRating:7`, `tmdbRating:7.6`) y C (`watchlist`),
  Cuando se carga la barra de estadísticas, Entonces: Vistas=2,
  Visionados=4, Horas=7,5, Pendientes=1, «Mi nota media»=7,8 y «Nota media
  TMDB»=8,0 (C excluida de las medias).
- **AC-M21 (ALG-M06):** Dada una película con `detailCachedAt` de hace 5
  días, Cuando se abre su ficha, Entonces `getMovieDetail` **no** se invoca
  (0 peticiones a `api.themoviedb.org` en la pestaña Network de DevTools al
  reabrir); Cuando se pulsa
  «Actualizar datos», Entonces se invoca exactamente una vez y
  `detailCachedAt` se actualiza.
- **AC-M22 (SEC-M01, SEC-M03):** Dado el usuario A autenticado, Cuando intenta
  leer o escribir `users/{uid_B}/movies` o `users/{uid_B}/movie_collections`,
  Entonces Firestore responde `permission-denied` y la UI no muestra datos de
  otros usuarios.
- **AC-M23 (SEC-M02):** Dado un intento de crear un documento con
  `status:"bogus"` o `watchCount:-1` o `userRating:11`, Cuando se envía,
  Entonces Firestore rechaza la escritura.
- **AC-M24 (API-M06, UI-M06):** Dada una película con `vote_average:8.4` y
  `vote_count:12345` y nota personal 8.5, Cuando se abre la ficha, Entonces se
  muestran por separado «TMDB 8,4 (12.345 votos)» y «Mi nota 8,5», sin
  mezclar ambas métricas.
- **AC-M25 (UI-M10, NFR-M03):** Dados los ficheros del cambio, Cuando se
  inspeccionan, Entonces están en UTF-8 sin BOM, con tildes y eñe correctas,
  todos los IDs de UI-M01..M08 presentes en `index.html` y cero errores de
  consola al cargar.
- **AC-M26 (UI-M06, D-M09):** Dados rating/reseña/etiquetas modificados sin
  pulsar «Guardar», Cuando el aviso `movie-detail-dirty-warning` («Cambios sin
  guardar») está visible y se pulsa «Cerrar», Entonces los cambios no se
  persisten y al reabrir la ficha se ven los valores guardados previamente.
- **AC-M27 (UI-M06):** Dada la ficha de una película, Cuando se pulsa
  «Eliminar» y se cancela la confirmación «¿Eliminar esta película de tu
  biblioteca?», Entonces el documento sigue en `users/{uid}/movies`; Cuando se
  confirma, Entonces desaparece de la biblioteca y del recuento de colecciones.

---

## Non-functional

| ID | Categoría | Límite medible |
|---|---|---|
| NFR-M01 | Rendimiento | Filtrado + orden + stats de 500 documentos ≤100 ms en portátil medio; render inicial de la sección ≤1 s. **Done-when**: benchmark con 500 documentos sintéticos registra p95 ≤100 ms y la sección queda visible ≤1 s tras pulsar la pestaña; ambos valores anotados en el PR |
| NFR-M02 | Accesibilidad | Diálogo con foco inicial, ESC cierra y restaura foco; todos los controles con label/`aria-label`; contraste AA |
| NFR-M03 | Codificación | UTF-8 sin BOM en todos los ficheros tocados; `<meta charset="UTF-8">` intacto; cero caracteres de reemplazo |
| NFR-M04 | Cuota TMDB | ≤1 petición de detalle por película cada 30 días; búsqueda con debounce 300 ms y mínimo 2 caracteres; timeout 10 s |
| NFR-M05 | Arquitectura | Cero dependencias nuevas; ESM nativos sin build; solo `js/firebase.js` importa URLs de CDN; módulos de `js/movies/` sin importar la vista entre sí salvo `moviesView` que orquesta. **Done-when**: `package.json` sin `dependencies` nuevas, `rg "cdn\.jsdelivr|googleapis" js/movies/` da 0 coincidencias de CDN (las URLs base de API-M no cuentan) y cada módulo carga con `node --input-type=module` sin error |

---

## Decisions and open questions

- **D-M01 — Clave TMDB.** Se reutiliza `TMDB_API_KEY` de `js/config.js` (ya
  existe, decisión previa del usuario de no reescribir config.js). Sin
  ajustes de usuario en Firestore ni UI de ajustes: si está vacía, degradación
  + alta manual (ALG-M05). Reduce alcance y evita una pantalla no pedida.
- **D-M02 — id del documento.** `String(tmdbId)` para TMDB (upsert barato,
  sin duplicados); auto-ID para manual.
- **D-M03 — Orden en cliente.** Firestore excluye documentos sin el campo
  ordenado: ordenar en servidor descartaría silenciosamente películas sin
  `userRating`/`lastWatchedAt`. Con escala personal el orden en cliente es
  correcto y testeable; al servidor solo van los filtros.
- **D-M04 — Estadísticas en cliente.** Sin documentos de agregado: se calculan
  del snapshot de biblioteca (`computeStats`, puro).
- **D-M05 — Ficha como `<dialog>` nativo.** Gestiona ESC, foco y capa sin
  librerías.
- **D-M06 — Transición a `watched`.** Suma +1 a `watchCount` y añade la fecha
  (consistente con «+1»); el usuario puede corregir con «−1» o edición manual.
- **D-M07 — Rango de puntuación en cliente.** Evita la explosión de índices
  compuestos (inequality + igualdad + array-contains); el resto de filtros van
  a servidor (DB-M04).
- **D-M08 — Géneros.** Filtro por `genreIds` (number) con diccionario estático
  `TMDB_GENRES_ES` en `moviesState.js`; el alta manual usa un multi-select de
  ese diccionario para que el filtro siempre funcione.
- **D-M09 — Guardado en la ficha.** Favorito, estado, ±1 y colecciones se
  guardan de inmediato; rating, reseña, etiquetas y spoiler requieren
  «Guardar»; «Cerrar» descarta los pendientes con aviso
  `movie-detail-dirty-warning` («Cambios sin guardar»), visible solo mientras
  haya cambios pendientes.
- **Q-M01 — Tests (no bloqueante).** ¿Abrir cambio aparte para Vitest +
  tests unitarios de `moviesState`/`tmdbClient` (puros, mockeables)? Los AC ya
  son verificables manualmente; queda fuera de este cambio.
