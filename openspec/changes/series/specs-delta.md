# specs-delta — Cambio «series» (Series)

Base: `specs/00-overview.md`. Namespace de este cambio: `*-S*`. Los requisitos
MODIFIED conservan su ID base. Textos explicativos en español; identificadores,
campos y valores internos en inglés.

---

## ADDED Requirements

### Resumen (REQ-S)

| ID | Requisito | Prioridad |
|---|---|---|
| REQ-S01 | Integración con TMDB API v3 rama TV (búsqueda, 4 listas de exploración, ficha, detalle de temporada) con degradación si falta la clave o hay fallo de red | must |
| REQ-S02 | Alta manual de series sin conexión o sin resultados en TMDB | must |
| REQ-S03 | Metadatos completos en tarjeta y ficha: poster, backdrop, títulos es/original, fecha de estreno, temporadas/episodios, estado de emisión, cadenas, géneros, sinopsis, creadores, reparto, tráiler y `vote_average`/`vote_count` | must |
| REQ-S04 | Repositorio personal en `users/{uid}/series/{seriesId}` con subcolección `episodes` y caché de metadatos TMDB (sin llamadas a la API para renderizar la biblioteca) | must |
| REQ-S05 | Estados `watchlist|watching|watched|dropped` + interruptor de favorito de serie (`isFavorite`) desde tarjeta y ficha | must |
| REQ-S06 | Progreso global: `currentSeason`, `currentEpisode`, `watchedEpisodesCount`, barra `vistos / total`, botón rápido «+1 Episodio» y transiciones automáticas de estado (D-S06) | must |
| REQ-S07 | Revisionados: `rewatchCount` con +1/−1 y `watchDates: timestamp[]` | must |
| REQ-S08 | `userRating` (0–10, medios puntos, independiente de `tmdbRating`), `userReview`, `tags` y `hasSpoilers` a nivel de serie | must |
| REQ-S09 | Seguimiento por capítulo en `episodes/{S01E01}`: `watched`, `watchedAt`, `isFavorite`, `userRating`, `userReview`, `hasSpoilers` | must |
| REQ-S10 | UI de episodios: selector de temporada, fila con nº/título/sinopsis/NOTA TMDB/visto/favorito/nota/comentario con indicadores, marcado masivo de temporada y filtros «Todos los capítulos»/«Solo favoritos»/«Con comentario» | must |
| REQ-S11 | Colecciones propias (`series_collections`) con multi-asignación (`collectionIds`) y filtrado por colección | must |
| REQ-S12 | Sección con 3 pestañas: «Explorar catálogo», «Mi biblioteca», «Mis colecciones» (acceso desde la navegación principal) | must |
| REQ-S13 | Búsqueda instantánea + filtros combinables + 7 claves de orden en Mi biblioteca | must |
| REQ-S14 | Barra de estadísticas rápidas (completadas, en curso, episodios vistos, capítulos favoritos, horas, mi nota media vs nota media TMDB) | must |
| REQ-S15 | Reglas/índices Firestore limpios (owner-only sin validaciones restrictivas), arquitectura modular `js/series/` sin frameworks y UTF-8 sin BOM | must |

---

### API — Cliente TMDB TV (API-S)

Base URL: `https://api.themoviedb.org/3`. Parámetros fijos de toda petición:
`api_key` (desde `TMDB_API_KEY` de `js/config.js`), `language=es-ES`,
`include_adult=false`. Un único punto de red: `js/series/tmdbTvClient.js` (no
importa URLs de CDN, cumple REQ-C1). **No** se importa nada de
`js/movies/tmdbClient.js`: cada categoría conserva su cliente (aislamiento).

| ID | Método | Path | Request (query) | Response | Errores |
|---|---|---|---|---|---|
| API-S01 | GET | `/search/tv` | `query` (≥2 chars), `first_air_date_year?`, `page=1` | `TmdbPagedResult` | `NO_API_KEY`, `NETWORK`, `HTTP_401`, `HTTP_429`, `PARSE` |
| API-S02 | GET | `/trending/tv/week` | `page=1` | `TmdbPagedResult` | ídem |
| API-S03 | GET | `/tv/popular` | `page=1` | `TmdbPagedResult` | ídem |
| API-S04 | GET | `/tv/top_rated` | `page=1` | `TmdbPagedResult` | ídem |
| API-S05 | GET | `/tv/on_the_air` | `page=1` | `TmdbPagedResult` | ídem |
| API-S06 | GET | `/tv/{series_id}` | `append_to_response=credits,videos,watch/providers` | `TmdbSeriesDetail` | ídem + `HTTP_404` |
| API-S07 | GET | `/tv/{series_id}/season/{season_number}` | — | `TmdbSeasonDetail` | ídem + `HTTP_404` |
| API-S08 | — | `https://image.tmdb.org/t/p/w500{posterPath}` · `…/w1280{backdropPath}` · `…/w300{stillPath}` | — | `string` URL o `null` si `path == null` | — |
| API-S09 | — | `https://www.youtube.com/watch?v={trailerKey}` | — | `string` URL o `null` | — |

Contratos TypeScript (`js/series/tmdbTvClient.js`):

```ts
export type TmdbErrorCode =
  | "NO_API_KEY" | "NETWORK" | "HTTP_401" | "HTTP_429" | "HTTP_404" | "PARSE";
export class TmdbError extends Error { readonly code: TmdbErrorCode; }

export interface TmdbSeriesSummary {
  id: number;
  name: string;                 // name (es-ES)
  originalName: string;         // original_name
  posterPath: string | null;     // "/abc.jpg"
  firstAirDate: string | null;   // "YYYY-MM-DD"
  genreIds: number[];           // genre_ids
  overview: string;
  voteAverage: number | null;   // vote_average
  voteCount: number | null;     // vote_count
}
export interface TmdbSeriesDetail extends TmdbSeriesSummary {
  backdropPath: string | null;
  numberOfSeasons: number | null;   // number_of_seasons
  numberOfEpisodes: number | null;  // number_of_episodes
  tmdbStatus: string | null;        // crudo: "Returning Series" | "Ended" | "Canceled" | "In Production"
  networks: string[];               // networks[].name, ≤10
  episodeRuntime: number | null;    // episode_run_time[0]; si falta, media de la temporada 1 cargada; si no, null (minutos)
  genres: string[];                 // genres[].name en es-ES
  creators: string[];                // createdBy[].name, ≤10
  cast: string[];                   // primeros 5 de credits.cast
  trailerKey: string | null;        // videos: YouTube, type "Trailer" (si no, primer YouTube)
  watchProviders: string[];         // watch/providers → results.ES (flatrate|buy|rent), ≤10; [] si no hay
  seasons: Array<{                  // sin especiales (season_number > 0 y name != "Especiales" cuando sea detectable)
    seasonNumber: number;
    name: string;
    airDate: string | null;
    episodeCount: number;
  }>;
}
export interface TmdbEpisodeSummary {
  seasonNumber: number;
  episodeNumber: number;
  name: string;                 // name (es-ES)
  overview: string;             // sinopsis breve
  airDate: string | null;
  runtime: number | null;       // minutos
  stillPath: string | null;     // "/xxx.jpg"
  voteAverage: number | null;   // vote_average del episodio
}
export interface TmdbSeasonDetail {
  id: number;
  name: string;
  seasonNumber: number;
  episodes: TmdbEpisodeSummary[];
}
export interface TmdbPagedResult {
  page: number; totalPages: number; results: TmdbSeriesSummary[];
}

export function isTmdbConfigured(): boolean;                 // TMDB_API_KEY.trim() !== ""
export function searchSeries(query: string, firstAirYear?: number | null, page?: number): Promise<TmdbPagedResult>;
export function fetchTrendingWeek(page?: number): Promise<TmdbPagedResult>;
export function fetchPopularSeries(page?: number): Promise<TmdbPagedResult>;
export function fetchTopRatedSeries(page?: number): Promise<TmdbPagedResult>;
export function fetchOnTheAir(page?: number): Promise<TmdbPagedResult>;
export function getSeriesDetail(seriesId: number): Promise<TmdbSeriesDetail>;
export function getSeasonDetail(seriesId: number, seasonNumber: number): Promise<TmdbSeasonDetail>;
export function posterUrl(path: string | null, size?: "w92" | "w185" | "w500"): string | null;  // default w500
export function backdropUrl(path: string | null, size?: "w780" | "w1280"): string | null;       // default w1280
export function stillUrl(path: string | null, size?: "w185" | "w300"): string | null;             // default w300
export function trailerUrl(key: string | null): string | null;
export function clearSeasonCache(): void;                    // solo para pruebas/depuración
```

Comportamiento:

- `fetch` con `AbortController` y timeout 10 s; cualquier error se lanza como
  `TmdbError` (nunca promesa rechazada sin capturar);
  `isTmdbConfigured() === false` ⇒ las funciones lanzan `NO_API_KEY` sin hacer
  red (ALG-S05).
- **Caché de temporada en memoria** (ALG-S07): `getSeasonDetail` guarda el
  resultado en un `Map` de módulo con clave `"{seriesId}:{seasonNumber}"`;
  dentro de la misma sesión no se repite la petición. No se persiste.
- `getSeriesDetail` no cachea aquí: la persistencia es responsabilidad del
  repositorio (`detailCachedAt`, ALG-S06).

---

### Data model (DB-S)

#### DB-S01 — `users/{uid}/series/{seriesId}`

| Campo | Tipo | Restricciones / notas |
|---|---|---|
| `seriesId` (doc id) | string | `String(tmdbId)` si `source=="tmdb"`; auto-ID de Firestore si `source=="manual"` |
| `source` | `"tmdb" \| "manual"` | — |
| `tmdbId` | `number \| null` | id TMDB; `null` en manual |
| `name` | string | 1–200, título en es-ES |
| `originalName` | string | 0–200 |
| `posterPath` | `string \| null` | ruta TMDB (`/xxx.jpg`) |
| `backdropPath` | `string \| null` | ruta TMDB |
| `firstAirDate` | `string \| null` | `"YYYY-MM-DD"` |
| `firstAirYear` | `number \| null` | derivado de `firstAirDate`; `null` en manual sin año |
| `numberOfSeasons` | `number \| null` | `number_of_seasons` |
| `numberOfEpisodes` | `number \| null` | `number_of_episodes`; `null` ⇒ barra de progreso oculta (solo contador) |
| `tmdbStatus` | `string \| null` | crudo de TMDB; etiqueta UI en UI-S09 |
| `networks` | `string[]` | ≤10 |
| `episodeRuntime` | `number \| null` | minutos. Regla única: `episode_run_time[0]` de TMDB si existe; si no, media de `runtime` de los episodios de la temporada 1 una vez cargada; si no, `null` ⇒ se usan 45 min en las horas (ALG-S01, D-S13) |
| `genreIds` | `number[]` | ≤30 ids TV de TMDB (fuente del filtro de género) |
| `genres` | `string[]` | nombres es-ES; puede estar `[]` hasta abrir la ficha |
| `overview` | string | ≤2000; `""` si no hay |
| `creators` | `string[]` | ≤10 |
| `cast` | `string[]` | ≤5 (los primeros 5 de `credits.cast`, según contrato API-S06) |
| `trailerKey` | `string \| null` | clave YouTube |
| `watchProviders` | `string[]` | ≤10, `[]` si no hay |
| `tmdbRating` | `number \| null` | `vote_average`; `null` en manual |
| `tmdbVoteCount` | `number \| null` | `vote_count`; `null` en manual |
| `detailCachedAt` | `timestamp \| null` | ver ALG-S06 |
| `status` | `"watchlist" \| "watching" \| "watched" \| "dropped"` | valor interno inglés |
| `isFavorite` | boolean | favorito de **serie** |
| `currentSeason` | number | entero ≥1; siguiente episodio a ver (posición 1,1 al inicio) |
| `currentEpisode` | number | entero ≥1 |
| `watchedEpisodesCount` | number | entero 0–100000; contador de episodios vistos (D-S12) |
| `favoriteEpisodesCount` | number | entero 0–100000; contador de episodios con `isFavorite:true` (alimenta la stat «Capítulos favoritos», D-S04) |
| `rewatchCount` | number | entero 0–1000; revisionados de la serie |
| `watchDates` | `timestamp[]` | ≤1000 entradas, ascendente |
| `lastWatchedAt` | `timestamp \| null` | último elemento de `watchDates` o `null` |
| `userRating` | `number \| null` | 0–10, paso 0.5 (ALG-S04); **independiente** de `tmdbRating` |
| `userReview` | `string \| null` | ≤2000 |
| `tags` | `string[]` | ≤20 elems, ≤30 chars c/u |
| `hasSpoilers` | boolean | — |
| `collectionIds` | `string[]` | ≤50 ids de `series_collections` |
| `addedAt` | `timestamp` | `serverTimestamp()` en alta |
| `updatedAt` | `timestamp` | `serverTimestamp()` en cada escritura |

Los campos personales y de progreso se inicializan en el alta (AC-S07); los
campos TMDB opcionales pueden ser `null`/`[]` en una serie manual.

#### DB-S02 — `users/{uid}/series/{seriesId}/episodes/{episodeKey}`

| Campo | Tipo | Restricciones / notas |
|---|---|---|
| `episodeKey` (doc id) | string | formato estandar `S01E01`: `S` + temporada con 2 dígitos + `E` + episodio con 2 dígitos, mayúsculas (ALG-S03) |
| `seasonNumber` | number | entero ≥1 (redundante con la clave; se guarda para consultar/ordenar) |
| `episodeNumber` | number | entero ≥1 |
| `episodeName` | string | ≤200; `""` si la serie es manual o TMDB no lo aporta |
| `watched` | boolean | — |
| `watchedAt` | `timestamp \| null` | instante en que se marcó; `null` si no está visto |
| `isFavorite` | boolean | episodio favorito **de esta serie** |
| `userRating` | `number \| null` | 0–10, paso 0.5; se muestra junto a la nota TMDB del episodio |
| `userReview` | string | ≤2000; `""` si no hay comentario |
| `hasSpoilers` | boolean | oculta/muestra el comentario |
| `updatedAt` | `timestamp` | `serverTimestamp()` en cada escritura |

- **Creación perezosa (D-S10)**: un episodio sin actividad no tiene documento.
  El doc se crea (upsert por `episodeKey`) en la primera interacción: marcar
  visto, alternar favorito, guardar nota o guardar comentario.
- No se guarda metadato de TMDB por episodio en Firestore: sinopsis, duración,
  `still_path` y `vote_average` viven en la petición de temporada (ALG-S07).

#### DB-S03 — `users/{uid}/series_collections/{collectionId}`

| Campo | Tipo | Restricciones |
|---|---|---|
| `name` | string | 1–60, único por usuario (el repo comprueba duplicados antes de crear) |
| `description` | `string \| null` | ≤300 |
| `createdAt` / `updatedAt` | timestamp | `serverTimestamp()` |

No almacena `seriesIds`: las series referencian con `collectionIds` (una serie
puede estar en 0, 1 o varias colecciones) y el recuento se calcula en cliente.

#### DB-S04 — Convención de identidad, contadores y upsert

- Alta desde catálogo: `addFromTmdb` hace upsert por doc id `String(tmdbId)`;
  si ya existe **no** pisa campos personales (`status`, `userRating`,
  `currentSeason`, …) y devuelve el id existente (sin duplicados).
- Alta manual: auto-ID + `source:"manual"`, `tmdbId:null`, `tmdbRating:null`.
  No se deduplica por título (existen remakes y versiones): solo el upsert por
  `tmdbId` evita duplicados en el origen TMDB.
- **Lote único por acción de episodio**: cada escritura de episodio (individual
  o masiva) se envía en un `writeBatch` junto con la actualización del documento
  padre (`watchedEpisodesCount`, `favoriteEpisodesCount`, `currentSeason`,
  `currentEpisode`, `lastWatchedAt`, `status`, `updatedAt`). Los contadores se
  **recalculan** a partir del conjunto de claves vistas/favoritas recibido, no se
  incrementan a ciegas: así un lote perdido no descompensa el contador en la
  siguiente escritura (NFR-S06).
- Ninguna función del repo acepta `uid` paramétrico: el uid sale de
  `auth.currentUser` (SEC-S03).

#### DB-S05 — Índices compuestos requeridos (`firestore.indexes.json`)

`queryScope: COLLECTION`, `collectionGroup: "series"`. Solo filtros van al
servidor (el orden se aplica en cliente, D-S03):

| # | Campos |
|---|---|
| 1 | `status ASC` + `genreIds CONTAINS` |
| 2 | `status ASC` + `collectionIds CONTAINS` |
| 3 | `status ASC` + `genreIds CONTAINS` + `collectionIds CONTAINS` |
| 4 | `isFavorite ASC` + `genreIds CONTAINS` |
| 5 | `isFavorite ASC` + `collectionIds CONTAINS` |
| 6 | `isFavorite ASC` + `genreIds CONTAINS` + `collectionIds CONTAINS` |

`status` (un valor) y `isFavorite` son exclusivos entre sí («Favoritas» es el
pseudofiltro de estado), por eso no se necesitan índices cruzados entre ambos.
La subcolección `episodes` se lee con una única consulta de colección por serie
(`collection(seriesDoc, "episodes")`, sin orden ni igualdades cruzadas): no
requiere índice compuesto.

---

### Security (SEC-S)

| ID | Regla |
|---|---|
| SEC-S01 | `match /series/{document=**}` sustituye al match simple `series/{itemId}`: `allow read, write: if isAllowedUser() && isOwner(userId);` **sin validación de campos**. El wildcard recursivo cubre `users/{uid}/series/{seriesId}` **y** `users/{uid}/series/{seriesId}/episodes/{episodeKey}` con una sola regla, de modo que campos opcionales, `null` y documentos parciales nunca se bloquean (la validación de formato es responsabilidad del cliente: ALG-S03/ALG-S04) |
| SEC-S02 | `match /series_collections/{id}` (nuevo): misma regla limpia `allow read, write: if isAllowedUser() && isOwner(userId);` sin `isValid*()` |
| SEC-S03 | El cliente solo construye rutas `users/{auth.uid}/…`; el repo lanza `SESSION_EXPIRED` si no hay sesión. Toda consulta exige `isAllowedUser()` (allowlist) además del owner. Sin acceso cruzado entre usuarios |

`isAllowedUser()`, `isOwner()` y **todos** los matches previos (movies,
movie_collections, entries, …) se conservan intactos (REQ-F2 MODIFIED). La
diferencia con el cambio `movies` es deliberada: aquí no se añaden
`isValidSeries*()` porque los documentos combinan campos opcionales y nulos de
dos fuentes (TMDB + usuario) y cualquier validación restrictiva rompería el
alta manual y los borrados parciales.

---

### UI (UI-S)

Textos visibles en español (`es-ES`), IDs estables (REQ-C2). Contenedor:
`#series-section` dentro de `#app-main`, inicialmente `hidden`.

| ID | Pantalla / componente | IDs estables | API usada |
|---|---|---|---|
| UI-S01 | Entrada de nav + sección con 3 pestañas (`role="tablist"`, `aria-selected`) | `nav-series` («Series»), `series-section`, `series-tab-catalog` («Explorar catálogo»), `series-tab-library` («Mi biblioteca»), `series-tab-collections` («Mis colecciones»), `series-panel-catalog`, `series-panel-library`, `series-panel-collections` | — |
| UI-S02 | Barra de estadísticas superior (siempre visible, sobre las pestañas) | `series-stats`, `series-stats-watched` («Completadas»), `series-stats-watching` («En curso»), `series-stats-episodes` («Episodios vistos»), `series-stats-favorites` («Capítulos favoritos»), `series-stats-hours` («Horas»), `series-stats-avg-user` («Mi nota media»), `series-stats-avg-tmdb` («Nota media TMDB») | ALG-S01 |
| UI-S03 | Explorar catálogo: buscador instantáneo (debounce 300 ms, ≥2 chars) + 4 secciones «Tendencias de la semana», «Populares», «Mejor valoradas», «En emisión» (página 1); con resultados de búsqueda las listas se ocultan | `series-catalog-search`, `series-catalog-results`, `series-catalog-sections`, `series-catalog-grid`, `series-catalog-empty` («Sin resultados para «X».»), `series-catalog-error` | API-S01..S05 |
| UI-S04 | Tarjeta de serie (compartida catálogo/biblioteca) | `<article class="series-card">`: `series-card-open` (poster + título + año + `★ vote_average`), `series-card-add` (solo catálogo: alta inmediata con `status:"watchlist"`; si ya está en biblioteca, botón desactivado con «En biblioteca»), `series-card-favorite` (solo tarjetas de biblioteca, `aria-pressed`, alterna `isFavorite`), `series-card-progress` (barra «6/24» + «25%»; se oculta sin `numberOfEpisodes`), `series-card-next` («+1 Episodio», solo biblioteca; deshabilitado con etiqueta «Completada» cuando `numberOfEpisodes != null` y `watchedEpisodesCount >= numberOfEpisodes`), badge de estado en español, `series-card-rewatch` («×N» si `rewatchCount > 1`) | API-S08, DB-S01 |
| UI-S05 | Mi biblioteca: buscador instantáneo + filtros combinables + orden | `series-library-search`, `series-library-status` (opciones: «Todos», «Pendientes», «Viendo», «Completadas», «Abandonadas», «Favoritas»), `series-library-genre` (diccionario estático TV es-ES), `series-library-collection` («Todas» + nombres), `series-library-rating-min`, `series-library-rating-max` (0–10, paso 0.5), `series-library-clear` («Limpiar filtros»), `series-library-sort` («Fecha de añadido», «Último episodio visto», «Progreso», «Mi puntuación», «Puntuación TMDB», «Año de estreno», «Título (A-Z)»; defecto «Fecha de añadido»), `series-library-count` («1 serie» en singular, «N series» en plural), `series-library-grid`, `series-library-empty`, `series-library-error` | DB-S01, ALG-S02 |
| UI-S06 | Ficha: `<dialog id="series-detail">` con tres bloques. **Catálogo**: `series-detail-poster`, `series-detail-backdrop`, `series-detail-title`, `series-detail-original-title`, `series-detail-first-air` (fecha es-ES), `series-detail-counts` («3 temporadas · 24 episodios»), `series-detail-tmdb-status` («En emisión»/«Finalizada»/«Cancelada»…), `series-detail-networks`, `series-detail-genres`, `series-detail-overview`, `series-detail-creators`, `series-detail-cast`, `series-detail-trailer` («Ver tráiler», `target="_blank" rel="noopener noreferrer"`), `series-detail-providers` («Dónde ver», sección oculta si `[]`), `series-detail-tmdb-rating` («TMDB 8,4 (12.345 votos)»). **Seguimiento**: `series-detail-status` (select de 4 estados), `series-detail-favorite` (`aria-pressed`), `series-detail-progress` (barra «6/24 · 25%»), `series-detail-next` («+1 Episodio»), `series-detail-rewatch-count`, `series-detail-rewatch-inc` («+1»), `series-detail-rewatch-dec` («−1»), `series-detail-watch-dates` (lista de fechas es-ES), `series-detail-user-rating` (0–10 step 0.5, vacío = sin nota), `series-detail-review` (textarea), `series-detail-spoilers` (checkbox «Mi reseña contiene spoilers»), `series-detail-tags` (coma-separado), `series-detail-collections` (checkbox por colección), `series-detail-save` («Guardar»), `series-detail-refresh` («Actualizar datos»), `series-detail-delete` («Eliminar»: pide confirmación con «¿Eliminar esta serie de tu biblioteca?»), `series-detail-close` («Cerrar»), `series-detail-dirty-warning` («Cambios sin guardar»), `series-detail-spoiler-warning` («Contiene spoilers» + «Mostrar reseña») | API-S06, DB-S01, ALG-S03..S06 |
| UI-S07 | Bloque de episodios **dentro** de la ficha | `series-detail-season` (select «Temporada 1…N»), `series-detail-season-watch` («Marcar temporada como vista»), `series-detail-season-unwatch` («Desmarcar temporada»), `series-detail-episodes-filter` (opciones: «Todos los capítulos», «Solo favoritos», «Con comentario»), `series-detail-episodes` (lista de `article.episode-row`), `series-detail-episodes-empty` («Sin capítulos en esta temporada.» / «Sin capítulos con ese filtro.»), `series-detail-episodes-error` («No se pudo cargar la temporada. Inténtalo de nuevo.», `role="alert"`) | API-S07, DB-S02, ALG-S03, ALG-S07, ALG-S08 |
| UI-S08 | Fila de episodio | `<article class="episode-row">`: `episode-row-label` («T1E3»), `episode-row-name` (título), `episode-row-overview` (sinopsis breve), `episode-row-still` (imagen `w300` o placeholder), `episode-row-tmdb-rating` («TMDB 7,9»), `episode-row-watched` (checkbox «Visto», etiqueta persistente), `episode-row-favorite` (estrella, `aria-pressed`), `episode-row-rating` (selector 0–10 paso 0.5, vacío = sin nota; se muestra junto a la nota TMDB), `episode-row-review-btn` («Comentario»: abre `<dialog id="series-episode-review">`), `episode-row-indicator` (punto/indicador si el capítulo tiene comentario o es favorito), `episode-row-spoiler-warning` («Contiene spoilers» + «Mostrar comentario») | DB-S02, UI-S09 |
| UI-S09 | Diálogo de comentario de capítulo: `<dialog id="series-episode-review">` con `series-episode-review-title` («T1E3 · Nombre»), `series-episode-review-text` (textarea), `series-episode-review-spoilers` (checkbox «Este comentario contiene spoilers»), `series-episode-review-save` («Guardar»), `series-episode-review-delete` («Eliminar comentario»), `series-episode-review-close` («Cerrar»). El guardado es **inmediato** (sin «Guardar» en la fila): cerrar sin guardar descarta lo tecleado | DB-S02 |
| UI-S10 | Mis colecciones: crear / renombrar / describir / eliminar y entrar a filtrar | `series-collections-form`, `series-collection-name`, `series-collection-description`, `series-collection-submit` («Crear colección»), `series-collections-list`, `series-collection-item` (nombre, «N series», `series-collection-open`, `series-collection-rename`, `series-collection-delete`), `series-collections-empty` («Aún no tienes colecciones.») | DB-S03 |
| UI-S11 | Alta manual + avisos | `series-manual-open` («Añadir manualmente»), `series-manual-form`, `series-manual-name` (obligatorio), `series-manual-year`, `series-manual-seasons`, `series-manual-episodes`, `series-manual-overview`, `series-manual-genres` (multi-select del diccionario), `series-manual-submit` («Guardar serie»), `series-manual-error`; `series-tmdb-warning` («No se pudo conectar con TMDB. Puedes añadir la serie manualmente.» o «Falta la clave de TMDB: búsqueda desactivada.», `role="status"`); `series-error` (`role="alert"`) | REQ-S02, ALG-S05 |
| UI-S12 | Mapa de etiquetas (valor interno inglés → texto UI español) | Serie: `watchlist`→«Pendiente», `watching`→«Viendo», `watched`→«Completada», `dropped`→«Abandonada». Estado TMDB: `Returning Series`→«En emisión», `Ended`→«Finalizada», `Canceled`→«Cancelada», `In Production`→«En producción», otro →«—». Exportado como `STATUS_LABELS` y `TMDB_STATUS_LABELS` desde `seriesState.js` | DB-S01 |
| UI-S13 | Accesibilidad y codificación | Foco inicial en el título del diálogo, ESC cierra y devuelve foco al disparador; todo input/select con `<label>`; botones icono con `aria-label`; `aria-pressed` en favoritos; errores en `role="alert"`; UTF-8 sin BOM y sin caracteres de reemplazo | NFR-S02, NFR-S03 |

---

### Logic (ALG-S)

| ID | Algoritmo | Regla |
|---|---|---|
| ALG-S01 | `computeSeriesStats(series)` (puro) | `completedCount` = nº `status=="watched"`; `watchingCount` = nº `status=="watching"`; `totalEpisodes` = Σ `watchedEpisodesCount`; `favoriteEpisodes` = Σ `favoriteEpisodesCount`; `totalHours` = Σ(`watchedEpisodesCount × (episodeRuntime ?? 45)`)/60, 1 decimal con coma es-ES; `pendingCount` = nº `status=="watchlist"` (reservado para el futuro; la barra no lo muestra); `avgUserRating` = media de `userRating != null`; `avgTmdbRating` = media de `tmdbRating != null`. `totalHours` y ambas medias usan **redondeo comercial** a 1 decimal (`Math.round(x * 10) / 10`) y se muestran con coma es-ES (7,75 → «7,8»). Vacío ⇒ todas las stats en «—» |
| ALG-S02 | `filterSeries` + `sortSeries` (puros) | Servidor: 1 igualdad (`status` o `isFavorite==true`) + ≤2 `array-contains` (`genreIds`, `collectionIds`). Cliente: búsqueda sobre `name`+`originalName` con `normalize("NFD")` + quitar marcas + minúsculas; rango `userRating` con extremos **inclusivos** en ambos lados (8–10 incluye 8 y 10; si algún extremo está fijado, los docs con `userRating null` se excluyen). Orden siempre en cliente: `addedAt`/`lastWatchedAt`/`userRating`/`tmdbRating`/`firstAirYear` DESC, `name` ASC con `Intl.Collator("es-ES")`, `progress` DESC (razón `watchedEpisodesCount / numberOfEpisodes`; docs sin `numberOfEpisodes` ⇒ `null`); **nulls siempre al final**; desempate: `name` ASC para `addedAt` y el resto. Claves: `addedAt`, `lastWatchedAt`, `progress`, `userRating`, `tmdbRating`, `firstAirYear`, `name` |
| ALG-S03 | `episodeKey` + progreso (`setEpisodeWatched`, `unmarkEpisode`, `computeCurrentEpisode`, `applyStatusRules`) (puros salvo la escritura) | `episodeKey(s, e)` = `S${pad2(s)}E${pad2(e)}`. Marcar: `episode.watched=true`, `watchedAt=ahora`; recalcular contadores sobre el conjunto de claves vistas/favoritas; `computeCurrentEpisode(watchedKeys, seasonLengths)` devuelve la primera posición `(season, episode)` en orden natural no incluida en `watchedKeys` (recorriendo 1..N por temporada; `seasonLengths` = nº de episodios conocidos por temporada de TMDB, y si falta, el máximo episodio visto en esa temporada); sin episodios vistos ⇒ `(1,1)`; todo visto ⇒ la posición siguiente a la última. `applyStatusRules`: al pasar a ≥1 episodio visto con `status=="watchlist"` ⇒ `"watching"`; si `numberOfEpisodes != null` y el contador `>= numberOfEpisodes` ⇒ `"watched"`; al desmarcar, si el contador queda por debajo de `numberOfEpisodes` y `status=="watched"` ⇒ `"watching"`; si el contador llega a 0 y `status ∈ {watched, watching}` ⇒ `"watchlist"`; `"dropped"` **nunca** cambia automáticamente. Desmarcar también revierte `watchedAt` a `null` |
| ALG-S04 | `parseUserRating(raw)` (puro) | Acepta `«7,5»`/`«7.5»` → 7.5. Vacío/`null` → `null`. Fuera de 0–10 o no múltiplo de 0.5 → lanza error con mensaje en español («Introduce una nota entre 0 y 10, en medios puntos.»), no se guarda |
| ALG-S05 | Resolución de clave y errores | Orden: `TMDB_API_KEY` de `js/config.js` → si vacía, `isTmdbConfigured()==false` y las llamadas lanzan `NO_API_KEY` sin red. Mapeo a UI: `NO_API_KEY` → «Falta la clave de TMDB: búsqueda desactivada.»; `NETWORK`/`HTTP_429`/`HTTP_401` → «No se pudo conectar con TMDB. Puedes añadir la serie manualmente.»; `HTTP_404` → «Serie no encontrada en TMDB. Puedes añadirla manualmente.» (en temporada: «Temporada no encontrada en TMDB.»); `PARSE` → «Respuesta no válida de TMDB. Puedes añadir la serie manualmente.»; en todos los casos el alta manual sigue operativa |
| ALG-S06 | Caché de detalle | La biblioteca se renderiza **solo** con los campos del doc (ninguna llamada TMDB). Al abrir la ficha: si `detailCachedAt` es reciente (<30 días) usar el cache; si no, `getSeriesDetail` y guardar en el doc con `detailCachedAt=now`. Si la recarga falla pero hay cache, mostrar el cache + aviso en español. `series-detail-refresh` fuerza la recarga |
| ALG-S07 | Carga de temporada | Al cambiar `series-detail-season` (o al abrir la ficha con el `currentSeason`): `getSeasonDetail` con caché de sesión por `seriesId:seasonNumber`. Cada fila fusiona TMDB (`name`, `overview`, `runtime`, `still_path`, `vote_average`) con el doc de episodio correspondiente si existe (fuente de verdad de lo personal). Sin TMDB (serie manual o fallo con datos previos) se muestran las filas ya conocidas + aviso; sin datos en absoluto ⇒ `series-detail-episodes-error`. Serie manual sin `tmdbId`: el bloque lista solo los episodios registrados (docs existentes) y mantiene «+1 Episodio» operativo |
| ALG-S08 | Marcado masivo de temporada | `markSeason(season, episodes)` sube **un solo `writeBatch`** con los upserts de episodio (≤400 por lote; si una temporada superara ese número se divide en lotes sucesivos) y **una** actualización del padre con los contadores recalculados y `applyStatusRules`; `unmarkSeason` idem con `watched=false`, `watchedAt=null`. La desmarcada no elimina documentos (conserva favoritos/notas/comentarios del capítulo) |
| ALG-S09 | Revisionados (`incRewatch`, `decRewatch`) | `incRewatch()`: `rewatchCount+1` (tope 1000), `watchDates.push(ahora)` manteniendo orden ascendente, `lastWatchedAt=ahora`. `decRewatch()`: `rewatchCount−1` (mín 0), `pop()` de `watchDates`, `lastWatchedAt` = último elemento de la lista o `null` si queda vacía (`watchDates` nunca queda con más entradas que `rewatchCount`). «Ahora» = `Timestamp` de la fecha local del cliente; `updatedAt` con `serverTimestamp()`. No toca `watchedEpisodesCount` ni `status` |

---

## MODIFIED Requirements

### REQ-D2 (MODIFIED) — Navegación con las categorías

`#app-nav` conserva `aria-label="Navegación principal"` y contiene las entradas
estáticas de las categorías: «Películas» (`#nav-movies`) y «Series»
(`#nav-series`, tipo `button`, `aria-expanded`, `aria-controls`). Cada entrada
alterna su sección de forma **excluyente**: activar una sección oculta la(s)
otra(s). El resto de la nav sigue sin enlaces.

### REQ-D3 (MODIFIED) — Estado vacío condicional

`#app-empty` («Selecciona o añade una categoría para empezar») sigue visible al
entrar en `allowed`. Queda **oculto** mientras `#movies-section` **o**
`#series-section` estén visibles y vuelve al pulsar de nuevo la categoría
activa (toggle). El texto no cambia.

### REQ-F2 (MODIFIED) — Infraestructura: extensión puntual

`firebase.json`, `opencode.jsonc` y `.opencode/` no se tocan. Este cambio sí
**extiende** `firestore.rules` (SEC-S01/S02) y `firestore.indexes.json`
(DB-S05). No se elimina ningún match ni función auxiliar existente; sobre una
regla previa solo se sustituye el match `series/{itemId}` por
`series/{document=**}`, conservando el mismo owner-only
(`isAllowedUser() && isOwner(userId)`) y **sin** añadir validaciones de campos.
La publicación sigue siendo manual: reglas por consola Firebase; índices con
`firebase deploy --only firestore:indexes` o consola.

---

## REMOVED Requirements

Ninguno. (Los requisitos del núcleo base y del cambio `movies` se conservan;
solo se modifican REQ-D2, REQ-D3 y REQ-F2.)

---

## Acceptance criteria (BDD) — AC-S

- **AC-S01 (API-S01, ALG-S05):** Dado `TMDB_API_KEY` vacío en `js/config.js`,
  Cuando se abre «Explorar catálogo», Entonces se muestra «Falta la clave de
  TMDB: búsqueda desactivada.», no hay peticiones de red ni excepciones sin
  capturar, y «Añadir manualmente» sigue funcionando.
- **AC-S02 (API-S01):** Dada `TMDB_API_KEY` válida, Cuando se busca «dark» (≥2
  caracteres, con debounce), Entonces aparecen resultados con título en español,
  año de estreno (`first_air_date`) y puntuación TMDB visibles.
- **AC-S03 (API-S02..S05):** Dada sesión con clave, Cuando se abre el catálogo
  sin búsqueda activa, Entonces las cuatro listas (Tendencias de la semana,
  Populares, Mejor valoradas, En emisión) muestran tarjetas con póster, título
  y año.
- **AC-S04 (API-S06):** Dada la ficha de TMDB con
  `append_to_response=credits,videos,watch/providers`, Cuando se abre el
  diálogo, Entonces se ven poster, backdrop, título original, fecha de
  estreno, «3 temporadas · 24 episodios», estado de emisión traducido
  (p. ej. «En emisión»), cadenas, géneros, sinopsis, creadores, reparto,
  enlace a tráiler y «TMDB 8,4 (12.345 votos)».
- **AC-S05 (API-S07, API-S08):** Dada una serie con `posterPath`, `backdropPath`
  y `stillPath`, Cuando se renderiza tarjeta/ficha/fila, Entonces las imágenes
  apuntan a `https://image.tmdb.org/t/p/w500/…`, `…/w1280/…` y `…/w300/…`
  respectivamente; sin ruta se muestra placeholder; con `trailerKey` el enlace
  apunta a `https://www.youtube.com/watch?v=…`.
- **AC-S06 (API-S, ALG-S05):** Dada una caída de red o error 429 de TMDB,
  Cuando se busca un título, Entonces se ve «No se pudo conectar con TMDB.
  Puedes añadir la serie manualmente.» y la app sigue operativa.
- **AC-S07 (DB-S01, DB-S04):** Dada una serie añadida desde el catálogo,
  Cuando se lee `users/{uid}/series/{tmdbId}`, Entonces el documento contiene
  metadatos cacheados, `status:"watchlist"`, `currentSeason:1`,
  `currentEpisode:1`, `watchedEpisodesCount:0`, `favoriteEpisodesCount:0`,
  `isFavorite:false`, `rewatchCount:0`, `collectionIds:[]`, `addedAt` y
  `updatedAt`; volver a añadir la misma no crea un segundo documento.
- **AC-S08 (REQ-S02, DB-S04):** Dado el alta manual con nombre «Serie local» y
  sin conexión, Cuando se guarda, Entonces aparece en la biblioteca con
  `source:"manual"`, `tmdbId:null` y cero llamadas a `fetch` de TMDB.
- **AC-S09 (UI-S12):** Dados los cuatro valores internos, Cuando se muestra
  cada serie, Entonces la etiqueta visible es «Pendiente», «Viendo»,
  «Completada» y «Abandonada» respectivamente, nunca el valor interno en
  inglés.
- **AC-S10 (DB-S01, UI-S04, UI-S06):** Dada una serie con
  `numberOfEpisodes:24` y `watchedEpisodesCount:6`, Cuando se muestra la
  tarjeta y la ficha, Entonces la barra indica «6/24» y «25%»; Cuando se marca
  un episodio más, Entonces el contador pasa a 7 y ambas barras se actualizan.
- **AC-S11 (ALG-S03, DB-S04):** Dada una serie sin episodios vistos
  (`status:"watchlist"`, `currentSeason:1, currentEpisode:1`), Cuando se pulsa
  «+1 Episodio», Entonces se crea `episodes/S01E01` con `watched:true` y
  `watchedAt` igual a la hora actual, `watchedEpisodesCount` pasa a 1,
  `lastWatchedAt` es la hora actual, `currentEpisode` pasa a 2 y el `status`
  cambia automáticamente a `"watching"` («Viendo»). Dada una serie en
  `"watching"` con `currentSeason:1, currentEpisode:3` y los episodios
  `S01E01`/`S01E02` vistos, Cuando se pulsa «+1 Episodio», Entonces se crea
  `episodes/S01E03` con `watched:true`, el contador suma 1, `currentEpisode`
  pasa a 4 y el `status` permanece en `"watching"`.
- **AC-S12 (ALG-S03):** Dada una serie con `numberOfEpisodes:24` y 23 vistos,
  Cuando se marca el último episodio, Entonces el `status` pasa automáticamente
  a `"watched"` («Completada»); Cuando se desmarca un episodio, Entonces vuelve
  a `"watching"` y `currentSeason/currentEpisode` apuntan al primer episodio no
  visto; Cuando se desmarcan todos, Entonces el contador queda en 0 y el
  `status` pasa a `"watchlist"` (nunca queda «Completada» con 0 episodios);
  una serie en `"dropped"` nunca cambia por estas reglas.
- **AC-S13 (UI-S04, UI-S06):** Dada una serie en biblioteca, Cuando se pulsa
  el favorito de la tarjeta o el de la ficha, Entonces `isFavorite` queda en
  `true` en Firestore y el icono sigue activo tras recargar la página.
- **AC-S14 (REQ-S07, ALG-S09):** Dada una serie con `rewatchCount:0` y `watchDates:[]`,
  Cuando se pulsa «+1» de revisionados, Entonces `rewatchCount` pasa a 1 y
  `watchDates` incluye la fecha actual; Cuando se pulsa «−1» hasta 0, Entonces
  `rewatchCount` queda en 0, `watchDates` queda vacío y `lastWatchedAt` pasa a
  `null`.
- **AC-S15 (ALG-S04):** Dado el campo de nota personal, Cuando se introduce
  «7,5», Entonces se guarda `userRating:7.5`; Cuando se introduce «11» o
  «0,3», Entonces no se guarda y aparece «Introduce una nota entre 0 y 10, en
  medios puntos.».
- **AC-S16 (UI-S06):** Dada una reseña de serie con `hasSpoilers:true`, Cuando
  se abre la ficha, Entonces la reseña está oculta tras «Contiene spoilers» y
  «Mostrar reseña» la revela; al desmarcar la casilla se muestra directamente.
- **AC-S17 (API-S07, UI-S08):** Dada la temporada 1 de una serie con 3
  episodios, Cuando se selecciona «Temporada 1», Entonces cada fila muestra
  número («T1E2»), título, sinopsis breve, «TMDB 7,9», la imagen `still`, el
  checkbox «Visto», la estrella de favorito, el selector de puntuación personal
  y el botón «Comentario»; un episodio con comentario o favorito muestra su
  indicador visual.
- **AC-S18 (DB-S02, UI-S09):** Dado el episodio `S01E02`, Cuando se guarda un
  comentario con spoiler, Entonces existe `episodes/S01E02` con
  `userReview:"…"`, `hasSpoilers:true` y el texto queda oculto tras
  «Contiene spoilers» con «Mostrar comentario»; Cuando se usa «Eliminar
  comentario», Entonces `userReview` queda `""` y `hasSpoilers:false`.
- **AC-S19 (DB-S02, DB-S04, UI-S02):** Dada una serie con
  `favoriteEpisodesCount:0`, Cuando se marca la estrella de un episodio, Entonces
  el doc del episodio tiene `isFavorite:true`, el contador del padre pasa a 1 y
  la stat «Capítulos favoritos» lo refleja tras recargar la biblioteca.
- **AC-S20 (ALG-S08):** Dada una temporada de 10 episodios sin ver, Cuando se
  pulsa «Marcar temporada como vista», Entonces los 10 episodios quedan
  `watched:true` con `watchedAt`, `watchedEpisodesCount` suma exactamente 10,
  los contadores del padre son coherentes y `status` aplica ALG-S03; Cuando se
  pulsa «Desmarcar temporada», Entonces `watched:false`, `watchedAt:null`, el
  contador baja 10 y los favoritos/notas/comentarios existentes **se conservan**.
- **AC-S21 (UI-S07, ALG-S07):** Dada una temporada con 2 favoritos y 1
  comentario, Cuando se aplica «Solo favoritos», Entonces solo se listan los 2;
  Cuando se aplica «Con comentario», Entonces solo el que tiene `userReview`
  distinto de vacío; Cuando se vuelve a «Todos los capítulos», Entonces se
  listan todos; con un filtro sin resultados se ve «Sin capítulos con ese
  filtro.».
- **AC-S22 (UI-S10, DB-S03):** Dadas las colecciones «Miniseries» y «Para ver
  en pareja», Cuando una serie se asigna a ambas y otra solo a la primera,
  Entonces el filtro por colección lista exactamente esas series en cada caso,
  y una serie puede pertenecer a varias a la vez; Cuando se elimina una
  colección, Entonces desaparece de «Mis colecciones» y su id desaparece de
  `collectionIds` de esas series.
- **AC-S23 (UI-S01, REQ-D2 (MOD), REQ-D3 (MOD)):** Dada la sesión en
  `allowed`, Cuando se pulsa «Series», Entonces `#app-empty` se oculta,
  `#movies-section` queda oculto y se muestran las tres pestañas de Series;
  Cuando se pulsa «Series» de nuevo, Entonces vuelve `#app-empty` con su texto
  original.
- **AC-S24 (ALG-S02):** Dada una biblioteca con varias series, Cuando se
  combinan estado «Completadas» + género «Drama» + una colección + rango 8–10,
  Entonces solo se listan las que cumplen los cuatro; «Limpiar filtros»
  restaura la lista completa.
- **AC-S25 (ALG-S02):** Dada una biblioteca con «Dark» y series sin
  `userRating`, Cuando se ordena por «Título (A-Z)», Entonces el orden respeta
  la colación `es-ES`; Cuando se ordena por «Mi puntuación», Entonces ninguna
  serie desaparece y las sin nota quedan al final; Cuando se ordena por
  «Progreso», Entonces las series con `numberOfEpisodes:null` quedan al final.
- **AC-S26 (ALG-S01):** Dadas A (`watched`, 78 episodios vistos,
  `episodeRuntime:45`, `favoriteEpisodesCount:12`, `userRating:8.5`,
  `tmdbRating:8.4`), B (`watching`, 10 episodios vistos, `episodeRuntime:null`,
  `userRating:7`, `tmdbRating:7.6`) y C (`watchlist`, sin episodios), Cuando se
  carga la barra de estadísticas, Entonces: «Completadas»=1, «En curso»=1,
  «Episodios vistos»=88, «Capítulos favoritos»=12, «Horas»=66,0 (88×45/60,
  con 45 min para el runtime desconocido), «Mi nota media»=7,8 y «Nota media
  TMDB»=8,0 (C excluida de las medias).
- **AC-S27 (SEC-S01, SEC-S02, SEC-S03):** Dado el usuario A autenticado,
  Cuando intenta leer o escribir `users/{uid_B}/series`,
  `users/{uid_B}/series/{id}/episodes/{key}` o
  `users/{uid_B}/series_collections`, Entonces Firestore responde
  `permission-denied` y la UI no muestra datos de otros usuarios.
- **AC-S28 (SEC-S01):** Dada la regla de `series`, Cuando se escribe un
  documento con `userRating:null`, `tmdbRating:null`, `status:"dropped"`,
  `userReview:""` o campos personales ausentes, Entonces la escritura se
  acepta (sin validaciones restrictivas); Cuando un episodio se escribe con
  `userRating:null`, Entonces también se acepta. La validación de formato
  (0–10, longitud) la aplica el cliente.
- **AC-S29 (API-S06, ALG-S06):** Dada una serie con `detailCachedAt` de hace 5
  días, Cuando se abre su ficha, Entonces `getSeriesDetail` **no** se invoca
  (0 peticiones a `api.themoviedb.org` al reabrir); Cuando se pulsa
  «Actualizar datos», Entonces se invoca exactamente una vez y `detailCachedAt`
  se actualiza. Al cambiar de temporada dos veces en la misma sesión, Entonces
  `getSeasonDetail` se invoca una sola vez por temporada.
- **AC-S30 (UI-S13, NFR-S03):** Dados los ficheros del cambio, Cuando se
  inspeccionan, Entonces están en UTF-8 sin BOM, con tildes y eñe correctas,
  todos los IDs de UI-S01..S11 presentes en `index.html` y cero errores de
  consola al cargar.
- **AC-S31 (UI-S06):** Dados rating/reseña/etiquetas modificados sin pulsar
  «Guardar», Cuando el aviso `series-detail-dirty-warning` («Cambios sin
  guardar») está visible y se pulsa «Cerrar», Entonces los cambios no se
  persisten y al reabrir la ficha se ven los valores guardados previamente;
  Cuando se pulsa «Eliminar» y se cancela «¿Eliminar esta serie de tu
  biblioteca?», Entonces el documento sigue en `users/{uid}/series`.
- **AC-S32 (API-S06, UI-S06):** Dada una serie con `vote_average:8.4`,
  `vote_count:12345` y nota personal 8.5, Cuando se abre la ficha, Entonces se
  muestran por separado «TMDB 8,4 (12.345 votos)» y «Mi nota 8,5», sin mezclar
  ambas métricas.

---

## Non-functional

| ID | Categoría | Límite medible |
|---|---|---|
| NFR-S01 | Rendimiento | Filtrado + orden + stats de 500 documentos ≤100 ms en portátil medio; render inicial de la sección ≤1 s. **Done-when**: benchmark con 500 documentos sintéticos registra p95 ≤100 ms y la sección queda visible ≤1 s tras pulsar la pestaña; ambos valores anotados en el PR |
| NFR-S02 | Accesibilidad | Diálogo con foco inicial, ESC cierra y restaura foco; todos los controles con label/`aria-label`; contraste AA |
| NFR-S03 | Codificación | UTF-8 sin BOM en todos los ficheros tocados; `<meta charset="UTF-8">` intacto; cero caracteres de reemplazo |
| NFR-S04 | Cuota TMDB | ≤1 petición de detalle por serie cada 30 días; 1 petición de temporada por sesión y temporada; búsqueda con debounce 300 ms y mínimo 2 caracteres; timeout 10 s |
| NFR-S05 | Arquitectura | Cero dependencias nuevas; ESM nativos sin build; solo `js/firebase.js` importa URLs de CDN; `js/movies/*` y `js/series/*` no se importan entre sí; los módulos de `js/series/` no importan la vista salvo `seriesView`, que orquesta. **Done-when**: `package.json` sin `dependencies` nuevas, `rg "cdn\.jsdelivr|googleapis" js/series/` da 0 coincidencias de CDN (las URLs base de API-S no cuentan) y cada módulo carga con `node --input-type=module` sin error |
| NFR-S06 | Consistencia de escritura | Cada acción sobre episodios viaja en un `writeBatch` con la actualización del padre; los contadores se recalculan, nunca se incrementan a ciegas; ≤400 escrituras de episodio por lote. **Done-when**: marcar una temporada de 24 episodios produce exactamente 1 lote (o N lotes ≤400) y `watchedEpisodesCount` coincide con `COUNT(episodes where watched==true)` |

---

## Decisions and open questions

- **D-S01 — Clave TMDB.** Se reutiliza `TMDB_API_KEY` de `js/config.js`
  (misma decisión D-M01): sin ajustes de usuario ni pantalla nueva; si está
  vacía, degradación + alta manual (ALG-S05).
- **D-S02 — id del documento.** `String(tmdbId)` para TMDB (upsert barato, sin
  duplicados); auto-ID para manual.
- **D-S03 — Orden en cliente.** Firestore excluye documentos sin el campo
  ordenado: ordenar en servidor descartaría series sin `userRating`,
  `firstAirYear` o progreso. Al servidor solo van los filtros.
- **D-S04 — Estadísticas en cliente con contadores agregados.** Sin documentos
  de agregado ni `collectionGroup` (que exigiría reglas especiales): los
  contadores `watchedEpisodesCount` y `favoriteEpisodesCount` viven en el
  documento padre y se suman desde el snapshot de biblioteca (`computeSeriesStats`,
  puro). Es el precio de no cargar los miles de documentos de `episodes`.
- **D-S05 — Ficha como `<dialog>` nativo.** Gestiona ESC, foco y capa sin
  librerías; el comentario de capítulo usa un segundo `<dialog>` para no
  saturar la fila.
- **D-S06 — Transiciones automáticas de estado.** Confirmado con el usuario:
  primer episodio visto ⇒ `watching`; contador alcanza `numberOfEpisodes` ⇒
  `watched`; desmarcar hasta 0 ⇒ `watchlist`; `dropped` nunca automático. El
  cambio manual de estado sigue permitido en cualquier momento (ALG-S03).
- **D-S07 — Rango de puntuación en cliente.** Evita la explosión de índices
  compuestos (igualdad + array-contains + desigualdad), igual que D-M07.
- **D-S08 — Géneros de TV.** Filtro por `genreIds` (número) con diccionario
  estático `TV_GENRES_ES` en `seriesState.js` (ids de TV, distintos de los de
  cine: 10759 «Acción y aventura», 16 «Animación», 35 «Comedia», 80 «Crimen»,
  99 «Documental», 18 «Drama», 10751 «Familia», 10765 «Ciencia ficción y
  fantasía», 10764 «Realidad», 10767 «Programas de entrevistas», 10768 «Guerra
  y política», 37 «Western»). El alta manual usa un multi-select de ese
  diccionario para que el filtro siempre funcione.
- **D-S09 — Guardado en la ficha.** Favorito, estado, revisionados, «+1
  Episodio» y colecciones se guardan de inmediato; rating, reseña, etiquetas
  y spoiler de la **serie** requieren «Guardar» con aviso `dirty-warning`. En
  cambio, las acciones de **episodio** (visto, favorito, puntuación,
  comentario) se guardan inmediatamente: son muchos y están fuera del bloque
  con «Guardar».
- **D-S10 — Documentos de episodio perezosos.** Solo existen si hay actividad
  del usuario; los episodios no vistos y sin datos personales no consumen
  escrituras (y evitan miles de docs por serie larga).
- **D-S11 — Contadores en el padre.** `watchedEpisodesCount` y
  `favoriteEpisodesCount` se actualizan en el mismo `writeBatch` que el doc de
  episodio, recalculados desde el conjunto de claves (NFR-S06), de modo que la
  barra de progreso y las estadísticas no necesitan leer la subcolección.
- **D-S12 — Vocabulario `watchedEpisodes`.** El término de vocabulario
  «watchedEpisodes» se materializa como **contador** `watchedEpisodesCount`
  (número) en el documento padre; no existe ningún campo de tipo array con
  las claves vistas (inflaría el documento padre, justo lo que evita REQ-S04).
  El conjunto de claves solo existe en memoria durante la escritura.
- **D-S13 — Horas estimadas.** `episodeRuntime` del doc (regla única de
  DB-S01: `episode_run_time[0]`, o en su defecto la media de `runtime` de la
  temporada 1 cargada) × `watchedEpisodesCount`; con `episodeRuntime:null` se
  usan 45 min por episodio (valor documentado en ALG-S01 y verificado en
  AC-S26).
- **D-S14 — Degradación de la pestaña de episodios.** La pestaña depende de
  TMDB (títulos, sinopsis, notas); si no hay clave/red, una serie manual sigue
  permitiendo marcar episodios con «+1 Episodio» y ver los ya registrados
  (ALG-S07), nunca una pantalla en blanco.
- **Q-S01 — Tests (no bloqueante).** ¿Abrir cambio aparte para Vitest + tests
  unitarios de `seriesState`/`tmdbTvClient` (puros, mockeables)? Los AC ya son
  verificables manualmente; queda fuera de este cambio.
- **Q-S02 — Paginación.** Como en `movies`: página 1 de cada lista; ¿añadir
  «Cargar más» en un cambio futuro?
