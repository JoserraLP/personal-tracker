# Tasks — Núcleo base personal-tracker (poda)

Fuente de verdad: `specs/00-overview.md` (núcleo base: Auth Google + dashboard
vacío + Firestore + configuración SDD). Sin issues de GitHub en esta fase. Sin
`git commit` ni `git push`.

| Task | Owner | Files | Spec refs | Depends | Done when (resumen BDD) | Status |
|---|---|---|---|---|---|---|
| BASE | tech-lead | `js/config.js`, `js/firebase.js`, `js/allowed-emails.js`, `js/app.js`, `index.html`, `css/app.css`, `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `opencode.jsonc`, `.opencode/` | REQ-A\*, REQ-D\*, REQ-F\* | — | Núcleo operativo: login Google con allowlist en dos copias, máquina `loading → {login\|allowed\|denied}`, barra superior con logout, nav placeholder vacía, estado vacío «Selecciona o añade una categoría para empezar» y Firestore/Auth inicializados con el SDK 10.13.0 sobre `js/config.js` | done |
| P-1 | tech-lead | (borrados) `js/catalog.js`, `js/api-*.js`, `js/seed/`, `js/repositories/`, `js/services/`, `js/ui/`, `cloudflare/`, `tests/`, `openspec/`, specs antiguas (`01..05`, `001..004`), `spec.md`, `more specs.txt` | `specs/00-overview.md` §1, §5 | — | Eliminados módulos, vistas, servicios, adaptadores, seeds y tests de funciones antiguas; conservados intactos `js/config.js`, `js/firebase.js`, `js/allowed-emails.js`, `index.html`, `css/app.css`, `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `opencode.jsonc`, `.opencode/`, `manifest.json`, `resources/` | done |
| P-2 | dev-frontend | `index.html`, `js/app.js`, `css/app.css` | REQ-A1..A4, REQ-D1..D3, REQ-C1..C3 | P-1 | Shell del núcleo: login Google con error en español, allowlist permite/deniega, logout y «Volver», barra superior con foto/nombre/email, nav vacía, estado vacío exacto, `<meta charset="UTF-8">` primera etiqueta de `<head>`, cero imports rotos | done |
| P-3 | devops | `package.json`, `manifest.json`, `README.md` | REQ-F2, REQ-C1 | P-2 | `package.json` mínimo sin scripts/devDependencies de tests obsoletos, `manifest.json` y `README.md` coherentes con el núcleo; ficheros tocados en UTF-8 sin BOM | done |
| P-3b | tech-lead | `specs/00-overview.md`, `tasks.md` | REQ-C4 | P-3 | `specs/` reducida a la especificación mínima del núcleo (REQ-A/D/F + AC + convenciones) y `tasks.md` reiniciado con BASE y este histórico; UTF-8 sin BOM | done |
| P-4 | code-reviewer | (read-only) | REQ-A\*, REQ-D\*, REQ-F\*, REQ-C\* | P-3b | Revisión sin imports rotos ni referencias muertas, sin restos de categorías/funciones antiguas, charset y codificación correctos, árbol listo para probar en `http://localhost:5500` | done |

## Cambio «movies» (Películas) — delta aprobado

Fuente de verdad: `openspec/changes/movies/specs-delta.md` (namespace `*-M*`).
Micro-tareas de 1–2 ficheros, un solo escritor por fichero, dependencias
explícitas. Reflejo de `openspec/changes/movies/tasks.md` (T-M01..T-M14,
pendientes). Specs citadas por ID (`rg "API-M01" openspec/changes/movies/`).

| Task | Owner | Files | Spec refs | Depends | Done when (resumen BDD) | Status |
|---|---|---|---|---|---|---|
| T-M01 | dev-backend | `js/movies/tmdbClient.js` | API-M01..M08, ALG-M05, NFR-M04 | — | Cliente ESM con `searchMovies`, `fetchTrendingWeek/Popular/TopRated/Upcoming`, `getMovieDetail`, `isTmdbConfigured`, `posterUrl/backdropUrl/trailerUrl`; `language=es-ES` + `api_key`; errores como `TmdbError` con `code`; sin clave ⇒ `NO_API_KEY` sin red; timeout 10 s; AC-M01..AC-M06 | done |
| T-M02 | dev-backend | `js/firebase.js` | REQ-F1, DB-M01, ALG-M03 | — | Reexporta `Timestamp` y `writeBatch` (CDN solo aquí); sin cambios de comportamiento; UTF-8 sin BOM | done |
| T-M03 | dev-backend | `js/movies/moviesRepository.js` | DB-M01..M03, SEC-M02, SEC-M03, ALG-M03, ALG-M06 | T-M01, T-M02 | CRUD `users/{uid}/movies` y `movie_collections` vía `auth.currentUser`; upsert sin duplicados; `watch/unwatch/setStatus` (ALG-M03); `deleteCollection` por lotes; caché 30 días; `SESSION_EXPIRED` sin sesión; AC-M07, AC-M08, AC-M10, AC-M11, AC-M21 | done |
| T-M04 | tech-lead | `js/movies/moviesState.js` | ALG-M01, ALG-M02, ALG-M04, UI-M09, D-M08 | T-M03 | Funciones puras `computeStats`, `filterMovies`, `sortMovies`, `parseUserRating`, `STATUS_LABELS`, `SORT_OPTIONS`, `TMDB_GENRES_ES`; nulls al final, collación `es-ES`; AC-M09, AC-M12, AC-M18..AC-M20 | done |
| T-M05 | dev-frontend | `index.html` | UI-M01..M08, REQ-C2, D-M05 | — | `#nav-movies` y `#movies-section` con todos los IDs estables (stats, 3 pestañas, grids, filtros, formularios, `<dialog id="movie-detail">`) + `css/movies.css`; `#app-empty` intacto; AC-M25 | done |
| T-M06 | dev-frontend | `css/movies.css` | UI-M10, NFR-M02 | T-M05 | Estilos de sección, pestañas, stats, tarjetas, grids, estados vacío/error y diálogo; sin romper el shell | done |
| T-M07 | dev-frontend | `js/movies/moviesView.js` | UI-M01..M04, ALG-M01 | T-M04, T-M05 | `mountMovies()`: pestañas, stats en español (AC-M20), 4 listas + búsqueda con debounce 300 ms, tarjetas `w500` con estados error/vacío | done |
| T-M08 | dev-frontend | `js/movies/moviesView.js` | UI-M05, ALG-M02 | T-M07 | Mi biblioteca: filtros combinables, orden (7 claves), contador, estados vacíos; AC-M14, AC-M18, AC-M19 | done |
| T-M09 | dev-frontend | `js/movies/moviesView.js` | UI-M06, UI-M08, ALG-M03, ALG-M04, ALG-M06, D-M09 | T-M08 | Ficha `<dialog>` completa: metadatos, tráiler, «Dónde ver», estado/favorito/±1, nota 0–10, reseña spoiler, colecciones, caché, alta manual, avisos es; AC-M01, AC-M04, AC-M06, AC-M08, AC-M10..AC-M15, AC-M21, AC-M24, AC-M26, AC-M27 | done |
| T-M10 | dev-frontend | `js/movies/moviesView.js` | UI-M07, DB-M02 | T-M09 | Colecciones: crear/renombrar/describir/eliminar, recuento, filtrado; AC-M15, AC-M16 | done |
| T-M11 | dev-frontend | `js/app.js` | UI-M01, REQ-D2 (MOD), REQ-D3 (MOD) | T-M10 | `#nav-movies` alterna `#movies-section` con `aria-expanded` y `#app-empty` conservado; AC-M17 | done |
| T-M12 | devops | `firestore.rules` | SEC-M01..M03, REQ-F2 (MOD) | — | `match /movie_collections/{id}` owner-only + `isValidMovieDoc()` en `movies`; reglas previas intactas; AC-M22, AC-M23 | done |
| T-M13 | devops | `firestore.indexes.json` | DB-M04, REQ-F2 (MOD) | T-M12 | 6 índices compuestos de DB-M04 (`collectionGroup:"movies"`), estructura preservada | done |
| T-M14 | code-reviewer | (read-only) `openspec/changes/movies/*.md` + `git diff` | todos `*-M*` | T-M11, T-M13 | Auditoría sin hallazgos abiertos (2 rondas de fixes: REQ-C5 en `js/app.js`/`css/app.css`, AC-M26..M27, citas REQ-M, NFR-M01/M05 medibles, ALG-M03 unwatch→0, UI-M05/M09); cero inconsistencias de IDs entre specs-delta y tasks | done |

## Ops — App Check (#96)

App Check quedó en modo supervisión tras denegar escrituras por error (403
antes de evaluar reglas). T-AC01 prepara el modo depuración local para una
futura activación en firme (delta SEC-M pendiente de especificar). T-AC01 se
revirtió a petición del usuario; la causa real fue otra: `isValidMovieDoc()`
usaba `list.all(...)`, sintaxis inexistente en el lenguaje de reglas, que el
CLI publica con warnings y que en ejecución deniega todo create/update de
películas (issue #97, T-AC02).

| Task | Owner | Files | Spec refs | Depends | Done when (resumen BDD) | Status |
|---|---|---|---|---|---|---|
| T-AC01 | dev-backend | `js/firebase.js` | petición usuario (#96) | — | En localhost/127.0.0.1 se define `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` antes de la inicialización de Firebase (coincidencia exacta de hostname); en producción nunca se asigna; `node --check` OK; UTF-8 sin BOM. Revisado y aprobado; seguimiento: el flag queda inerte hasta integrar el debug provider / `initializeAppCheck` con reCAPTCHA (futura delta SEC-\*) | done (revertida) |
| T-AC02 | devops | `firestore.rules` | SEC-M02/M03 (MOD, #97) | — | Sin `list.all(...)` en `firestore.rules` (las 3 cláusulas de tipo por elemento eliminadas); resto de validaciones intacto (owner-only, status, isFavorite, hasSpoilers, watchCount 0–1000, userRating 0–10, userReview ≤2000, tamaños ≤20/≤50/≤30, source); `firebase deploy --only firestore:rules --dry-run` compila sin warnings; UTF-8 sin BOM. Revisado y aprobado | done |

## Cambio «series» (Series) — delta aprobado

Fuente de verdad: `openspec/changes/series/specs-delta.md` (namespace `*-S*`).
Micro-tareas de 1–2 ficheros, un solo escritor por fichero, dependencias
explícitas. Reflejo de `openspec/changes/series/tasks.md` (T-S01..T-S14,
pendientes). Specs citadas por ID (`rg "API-S01" openspec/changes/series/`).
T-S06..T-S10 comparten `js/series/seriesView.js`: en cadena, no en paralelo.

| Task | Owner | Files | Spec refs | Depends | Done when (resumen BDD) | Status |
|---|---|---|---|---|---|---|
| T-S01 | dev-backend | `js/series/tmdbTvClient.js` | API-S01..S09, ALG-S05, ALG-S07, NFR-S04 | — | Cliente ESM independiente de `js/movies/*`: exporta `searchSeries`, `fetchTrendingWeek`, `fetchPopularSeries`, `fetchTopRatedSeries`, `fetchOnTheAir`, `getSeriesDetail`, `getSeasonDetail`, `isTmdbConfigured`, `posterUrl/backdropUrl/stillUrl/trailerUrl`, `clearSeasonCache` con las firmas de specs-delta; `language=es-ES` + `api_key` en todas las llamadas; `TmdbError` con `code`; caché de temporada `Map` por `seriesId:seasonNumber`; sin clave ⇒ `NO_API_KEY` sin red; timeout 10 s; AC-S01..AC-S06, AC-S29 (parcial) verificables | done |
| T-S02 | dev-backend | `js/series/seriesRepository.js` | DB-S01..S04, SEC-S03, ALG-S03, ALG-S06, ALG-S08, ALG-S09, NFR-S06 | T-S01, T-S03 | CRUD de `users/{uid}/series`, `…/series/{id}/episodes` y `series_collections` sin parámetro `uid` (usa `auth.currentUser`); `addFromTmdb` upsert sin duplicados con inicialización de progreso (AC-S07); `addManual` sin red (AC-S08); `setEpisodeWatched`/`unmarkEpisode`/`markSeason`/`unmarkSeason` en `writeBatch` único con contadores recalculados y `applyStatusRules` (AC-S11, AC-S12, AC-S19, AC-S20); `ensureDetailCached` 30 días (AC-S29); `deleteCollection` limpia `collectionIds` por lotes; `SESSION_EXPIRED` sin sesión; UTF-8 sin BOM | done |
| T-S03 | tech-lead | `js/series/seriesState.js` | ALG-S01, ALG-S02, ALG-S03, ALG-S04, ALG-S09, UI-S12, D-S08 | — | Funciones puras `computeSeriesStats`, `filterSeries`, `sortSeries`, `computeCurrentEpisode`, `episodeKey`, `parseUserRating`, mapas `STATUS_LABELS`, `TMDB_STATUS_LABELS`, `SORT_OPTIONS`, `TV_GENRES_ES`; nulls al final, collación `es-ES`, progress con `numberOfEpisodes:null` al final; AC-S09, AC-S15, AC-S24, AC-S25, AC-S26 pasan con datos de prueba | done |
| T-S04 | dev-frontend | `index.html` | UI-S01..S11, REQ-C2, D-S05 | — | `#nav-series` en `#app-nav` y esqueleto completo de `#series-section` (stats, 3 pestañas con paneles, grids, filtros, formularios, `<dialog id="series-detail">` con el bloque de episodios, `<dialog id="series-episode-review">`) con todos los IDs estables de UI-S01..S11 y el `<link rel="stylesheet" href="./css/series.css">`; `#movies-section` y `#app-empty` intactos; `<meta charset>` primera etiqueta; UTF-8 sin BOM; AC-S30 | done |
| T-S05 | dev-frontend | `css/series.css` | UI-S13, NFR-S02 | T-S04 | Estilos de sección, pestañas, barra de stats, tarjetas, barras de progreso, filas de episodios, grids responsivos, estados vacíos/error y diálogos con foco visible; reglas de `css/app.css` y `css/movies.css` sin romper el shell | done |
| T-S06 | dev-frontend | `js/series/seriesView.js` | UI-S01..S04, ALG-S01, REQ-S12 | T-S03, T-S04 | `mountSeries()` monta la sección: conmutación de pestañas, barra de estadísticas con labels es (AC-S26), catálogo con 4 listas + búsqueda instantánea (debounce 300 ms, ≥2 chars), tarjetas con imagen `w500`, barra «6/24 · 25%» y «+1 Episodio», estados de error/vacío en español (AC-S10) | done |
| T-S07 | dev-frontend | `js/series/seriesView.js` | UI-S05, ALG-S02, REQ-S13 | T-S06 | Mi biblioteca: buscador, filtros combinables (estado/favoritos, género, colección, rango), «Limpiar filtros», selector de 7 órdenes, contador «1 serie»/«N series», estados vacíos; AC-S13 (favorito desde la tarjeta), AC-S24 y AC-S25 verificables en pantalla | done |
| T-S08 | dev-frontend | `js/series/seriesView.js` | UI-S06, ALG-S04, ALG-S06, D-S09 | T-S07 | Ficha: metadatos TMDB (AC-S04), voto TMDB separado de la nota personal (AC-S32), estado de emisión traducido, tráiler, «Dónde ver», estado/favorito/progreso/«+1 Episodio» (AC-S11), revisionados con fechas (AC-S14), nota 0–10 con medios puntos (AC-S15), reseña con spoiler (AC-S16), etiquetas, selector de colecciones (AC-S22), «Actualizar datos» con caché (AC-S29), alta manual con avisos en español (AC-S08, AC-S01, AC-S06), aviso de cambios sin guardar y borrado con confirmación (AC-S31) | done |
| T-S09 | dev-frontend | `js/series/seriesView.js` | UI-S07..S09, ALG-S03, ALG-S07, ALG-S08 | T-S08 | Bloque de episodios: selector de temporada con carga perezosa + caché de sesión, fila completa (nº, título, sinopsis, still, «TMDB 7,9», visto, favorito, puntuación, comentario con indicador), marcado/desmarcado masivo de temporada en lote, filtros «Todos los capítulos»/«Solo favoritos»/«Con comentario», diálogo de comentario con spoilers y borrado; degradación manual (D-S14); AC-S17, AC-S18, AC-S20, AC-S21 verificables | done |
| T-S10 | dev-frontend | `js/series/seriesView.js` | UI-S10, UI-S11, DB-S03, REQ-S02 | T-S09 | Mis colecciones: crear/renombrar/describir/eliminar, recuento «N series», clic para filtrar la biblioteca; alta manual completa con validación en español; AC-S08 y AC-S22 verificables | done |
| T-S11 | dev-frontend | `js/app.js` | UI-S01, REQ-D2 (MOD), REQ-D3 (MOD) | T-S10 | `#nav-series` alterna `#series-section` de forma excluyente con `#movies-section`, mantiene `aria-expanded`, oculta/muestra `#app-empty` conservando su texto, importa `seriesView` sin errores de consola; AC-S23 | done |
| T-S12 | devops | `firestore.rules` | SEC-S01..S03, REQ-F2 (MOD) | — | `match /series/{document=**}` sustituye a `series/{itemId}` con el mismo owner-only (`isAllowedUser() && isOwner(userId)`) y **sin** funciones `isValid*`; `match /series_collections/{id}` con la misma regla limpia; el resto de matches y funciones previas intactos; AC-S27 y AC-S28 pasan con reglas desplegadas | done |
| T-S13 | devops | `firestore.indexes.json` | DB-S05, REQ-S15, REQ-F2 (MOD) | T-S12 | Los 6 índices compuestos de DB-S05 añadidos con `collectionGroup:"series"` y estructura existente preservada; sin índices redundantes; `firebase deploy --only firestore:indexes --dry-run` sin errores | done |
| T-S14 | code-reviewer | (solo lectura) `openspec/changes/series/*.md` + `git diff` | todos los `*-S*` | T-S11, T-S13 | Auditoría sin hallazgos abiertos de ambigüedad/testabilidad/cobertura AC; cero inconsistencias de IDs entre specs-delta y tasks | todo |

## Estado

- BASE, P-1, P-2, P-3, P-3b y P-4 completados. Árbol podado y verificado.
- Delta `openspec/changes/movies/` auditado y aprobado (sin hallazgos
  residuales). T-M01..T-M14 completadas y sincronizadas en `tasks.md` raíz y en
  GitHub Issues (issues cerradas).
- Mapa de issues (cambio `movies`): T-M01=#81, T-M02=#80, T-M03=#84,
  T-M04=#88, T-M05=#85, T-M06=#87, T-M07=#90, T-M08=#91, T-M09=#92,
  T-M10=#93, T-M11=#94, T-M12=#86, T-M13=#89, T-M14=#95. Las issues bloqueadas
  llevan etiqueta `blocked` y se liberan cerrando su dependencia.
- Delta `openspec/changes/series/` aprobado: T-S01..T-S14 sincronizadas en
  `tasks.md` raíz (pendientes) y en GitHub Issues. Mapa de issues (cambio
  `series`): T-S01=#98, T-S02=#102, T-S03=#99, T-S04=#100, T-S05=#103,
  T-S06=#104, T-S07=#105, T-S08=#106, T-S09=#107, T-S10=#108, T-S11=#109,
  T-S12=#101, T-S13=#110, T-S14=#111. T-S01, T-S03, T-S04 y T-S12 con etiqueta
  `ready`; el resto `blocked` hasta cerrar su dependencia. T-S04 (#100)
  completada, auditada (code-reviewer sin bloqueos, AC-S30 PASS) y cerrada;
  T-S05 (#103) y T-S06 (#104) liberadas con etiqueta `ready`. T-S12 (#101)
  completada (`match /series/{document=**}` + `series_collections`, dry-run
  compilado sin errores; code-reviewer sin bloqueos, AC-S27/S28 PASS) y
  cerrada; T-S13 (#110) liberada con etiqueta `ready`.
- T-S13 (#110) completada: 6 índices compuestos de DB-S05 con
  `collectionGroup:"series"` añadidos en `firestore.indexes.json` (+50 líneas),
  estructura previa preservada y sin índices redundantes; dry-run
  `firestore:indexes` sin errores; code-reviewer PASS sin rondas de fix.
  Cerrada; T-S14 (#111) liberada con etiqueta `ready`.
- T-S08 (#106) completada: ficha de serie completa y alta manual en
  `js/series/seriesView.js` (code-reviewer sin bloqueos tras 1 ronda de fixes;
  qa: AC-S04/S32/S11/S14/S15/S16/S22-selector/S29-caché/S08/S01/S06/S31 PASS
  dentro del alcance de T-S08; CRUD de colecciones y bloque de episodios
  quedan en T-S10/T-S09). Cerrada; T-S09 (#107) liberada con etiqueta `ready`.
- T-S09 (#107) completada: bloque de episodios (selector perezoso con caché,
  filas completas, marcado masivo en lote, filtros, diálogo de comentario con
  spoilers y borrado, degradación manual D-S14) en `js/series/seriesView.js`;
  code-reviewer sin bloqueos tras 1 ronda de fixes (refresco de temporadas
  registradas en series manuales, ALG-S07/D-S14); qa: AC-S17/S18/S20/S21 PASS.
  Cerrada; T-S10 (#108) liberada con etiqueta `ready`.
- Hallazgos de P-4 diferidos (no bloquean el núcleo): comentarios obsoletos en
  `js/config.js` (claves TMDB/Books/IGDB/Steam y refs a `cloudflare/` y
  `scripts/`), `js/firebase.js` (cita `db.js`) y `js/allowed-emails.js` (cita la
  spec 001 eliminada). `js/config.js` se conserva INTACTO por decisión del
  usuario; su limpieza se hará en la próxima fase de especificación.
- Árbol listo para prueba local en `http://localhost:5500` antes del reset de
  Git por el usuario.
