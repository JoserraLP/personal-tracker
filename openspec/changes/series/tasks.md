# tasks.md — Cambio «series» (Series)

Plan de implementación del delta `openspec/changes/series/` (fuente de
especificación: `specs-delta.md`). Reglas: 1–2 ficheros por tarea, propiedad
disjoint (un solo escritor por fichero), dependencias explícitas, owner único.
Los ID de spec se citan tal cual (`rg "API-S0" openspec/changes/series/`).
Estados: `todo` | `doing` | `review` | `fix` | `done` | `blocked`.

T-S06..T-S10 comparten `js/series/seriesView.js`: van **en cadena** (un solo
escritor por fichero), no en paralelo. T-S01, T-S03, T-S04 y T-S12 sí son
paralelas (ficheros disjoint); T-S02 va tras T-S01 y T-S03 porque el repo usa
`episodeKey`/`computeCurrentEpisode` de `seriesState.js` (sin ciclo).

| Task | Owner | Files | Spec refs | Depends | Done when (BDD) | Status |
|---|---|---|---|---|---|---|
| T-S01 | dev-backend | `js/series/tmdbTvClient.js` | API-S01..S09, ALG-S05, ALG-S07, NFR-S04 | — | Cliente ESM independiente de `js/movies/*`: exporta `searchSeries`, `fetchTrendingWeek`, `fetchPopularSeries`, `fetchTopRatedSeries`, `fetchOnTheAir`, `getSeriesDetail`, `getSeasonDetail`, `isTmdbConfigured`, `posterUrl/backdropUrl/stillUrl/trailerUrl`, `clearSeasonCache` con las firmas de specs-delta; `language=es-ES` + `api_key` en todas las llamadas; `TmdbError` con `code`; caché de temporada `Map` por `seriesId:seasonNumber`; sin clave ⇒ `NO_API_KEY` sin red; timeout 10 s; AC-S01, AC-S02, AC-S03, AC-S04, AC-S05, AC-S06, AC-S29 (parcial) verificables | todo |
| T-S02 | dev-backend | `js/series/seriesRepository.js` | DB-S01..S04, SEC-S03, ALG-S03, ALG-S06, ALG-S08, ALG-S09, NFR-S06 | T-S01, T-S03 | CRUD de `users/{uid}/series`, `…/series/{id}/episodes` y `series_collections` sin parámetro `uid` (usa `auth.currentUser`); `addFromTmdb` upsert sin duplicados con inicialización de progreso (AC-S07); `addManual` sin red (AC-S08); `setEpisodeWatched`/`unmarkEpisode`/`markSeason`/`unmarkSeason` en `writeBatch único` con contadores recalculados y `applyStatusRules` (AC-S11, AC-S12, AC-S19, AC-S20); `ensureDetailCached` 30 días (AC-S29); `deleteCollection` limpia `collectionIds` por lotes; `SESSION_EXPIRED` sin sesión; UTF-8 sin BOM | todo |
| T-S03 | tech-lead | `js/series/seriesState.js` | ALG-S01, ALG-S02, ALG-S03, ALG-S04, ALG-S09, UI-S12, D-S08 | — | Funciones puras `computeSeriesStats`, `filterSeries`, `sortSeries`, `computeCurrentEpisode`, `episodeKey`, `parseUserRating`, mapas `STATUS_LABELS`, `TMDB_STATUS_LABELS`, `SORT_OPTIONS`, `TV_GENRES_ES`; nulls al final, collación `es-ES`, progress con `numberOfEpisodes:null` al final; AC-S09, AC-S15, AC-S24, AC-S25, AC-S26 pasan con datos de prueba | todo |
| T-S04 | dev-frontend | `index.html` | UI-S01..S11, REQ-C2, D-S05 | — | `#nav-series` en `#app-nav` y esqueleto completo de `#series-section` (stats, 3 pestañas con paneles, grids, filtros, formularios, `<dialog id="series-detail">` con el bloque de episodios, `<dialog id="series-episode-review">`) con todos los IDs estables de UI-S01..S11 y el `<link rel="stylesheet" href="./css/series.css">`; `#movies-section` y `#app-empty` intactos; `<meta charset>` primera etiqueta; UTF-8 sin BOM; AC-S30 | todo |
| T-S05 | dev-frontend | `css/series.css` | UI-S13, NFR-S02 | T-S04 | Estilos de sección, pestañas, barra de stats, tarjetas, barras de progreso, filas de episodio, grids responsivos, estados vacíos/error y diálogos con foco visible; reglas de `css/app.css` y `css/movies.css` sin romper el shell | todo |
| T-S06 | dev-frontend | `js/series/seriesView.js` | UI-S01, UI-S02, UI-S03, UI-S04, ALG-S01, REQ-S12 | T-S03, T-S04 | `mountSeries()` monta la sección: conmutación de pestañas, barra de estadísticas con labels es (AC-S26), catálogo con 4 listas + búsqueda instantánea (debounce 300 ms, ≥2 chars), tarjetas con imagen `w500`, barra «6/24 · 25%» y «+1 Episodio», estados de error/vacío en español (AC-S10) | todo |
| T-S07 | dev-frontend | `js/series/seriesView.js` | UI-S05, ALG-S02, REQ-S13 | T-S06 | Mi biblioteca: buscador, filtros combinables (estado/favoritos, género, colección, rango), «Limpiar filtros», selector de 7 ordenes, contador «1 serie»/«N series», estados vacíos; AC-S13 (favorito desde la tarjeta), AC-S24 y AC-S25 verificables en pantalla | todo |
| T-S08 | dev-frontend | `js/series/seriesView.js` | UI-S06, ALG-S04, ALG-S06, D-S09 | T-S07 | Ficha: metadatos TMDB (AC-S04), voto TMDB separado de la nota personal (AC-S32), estado de emisión traducido, tráiler, «Dónde ver», estado/favorito/progreso/«+1 Episodio» (AC-S11), revisionados con fechas (AC-S14), nota 0–10 con medios puntos (AC-S15), reseña con spoiler (AC-S16), etiquetas, selector de colecciones (AC-S22), «Actualizar datos» con caché (AC-S29), alta manual con avisos en español (AC-S08, AC-S01, AC-S06), aviso de cambios sin guardar y borrado con confirmación (AC-S31) | todo |
| T-S09 | dev-frontend | `js/series/seriesView.js` | UI-S07, UI-S08, UI-S09, ALG-S03, ALG-S07, ALG-S08 | T-S08 | Bloque de episodios: selector de temporada con carga perezosa + caché de sesión, fila completa (nº, título, sinopsis, still, «TMDB 7,9», visto, favorito, puntuación, comentario con indicador), marcado/desmarcado masivo de temporada en lote, filtros «Todos los capítulos»/«Solo favoritos»/«Con comentario», diálogo de comentario con spoilers y borrado; degradación manual (D-S14); AC-S17, AC-S18, AC-S20, AC-S21 verificables | todo |
| T-S10 | dev-frontend | `js/series/seriesView.js` | UI-S10, UI-S11, DB-S03, REQ-S02 | T-S09 | Mis colecciones: crear/renombrar/describir/eliminar, recuento «N series», clic para filtrar la biblioteca; alta manual completa con validación en español; AC-S08 y AC-S22 verificables | todo |
| T-S11 | dev-frontend | `js/app.js` | UI-S01, REQ-D2 (MOD), REQ-D3 (MOD) | T-S10 | `#nav-series` alterna `#series-section` de forma excluyente con `#movies-section`, mantiene `aria-expanded`, oculta/muestra `#app-empty` conservando su texto, importa `seriesView` sin errores de consola; AC-S23 | todo |
| T-S12 | devops | `firestore.rules` | SEC-S01, SEC-S02, SEC-S03, REQ-F2 (MOD) | — | `match /series/{document=**}` sustituye a `series/{itemId}` con el mismo owner-only (`isAllowedUser() && isOwner(userId)`) y **sin** funciones `isValid*`; `match /series_collections/{id}` con la misma regla limpia; el resto de matches y funciones previas intactos; AC-S27 y AC-S28 pasan con reglas desplegadas | todo |
| T-S13 | devops | `firestore.indexes.json` | DB-S05, REQ-S15, REQ-F2 (MOD) | T-S12 | Los 6 índices compuestos de DB-S05 añadidos con `collectionGroup:"series"` y estructura existente preservada; sin índices redundantes; `firebase deploy --only firestore:indexes --dry-run` sin errores | todo |
| T-S14 | code-reviewer | (solo lectura) `openspec/changes/series/*.md` + `git diff` | todos los `*-S*` | T-S11, T-S13 | Auditoría sin hallazgos abiertos de ambigüedad/testabilidad/cobertura AC; cero inconsistencias de IDs entre specs-delta y tasks | todo |

## Estado

- Delta redactado; **pendiente de aprobación humana** antes de implementar
  (flujo SDD: spec → revisión → gate → plan → build).
- Nota: tras aprobar el delta, el `orchestrator` lo reflejará en `tasks.md`
  raíz y en GitHub Issues (`gh`) siguiendo el flujo SDD; los commits usan
  mensajes ASCII en inglés (`feat(T-Sxx): …`), la UI siempre en español.
- `js/firebase.js` y `js/config.js` **no** requieren cambios (los helpers ya
  están reexportados: `writeBatch`, `Timestamp`, `collection`, …).
