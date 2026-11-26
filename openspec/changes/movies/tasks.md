# tasks.md — Cambio «movies» (Películas)

Plan de implementación del delta `openspec/changes/movies/` (fuente de
especificación: `specs-delta.md`). Reglas: 1–2 ficheros por tarea, propiedad
disjoint (un solo escritor por fichero), dependencias explícitas, owner único.
Los ID de spec se citan tal cual (`rg "API-M0" openspec/changes/movies/`).
Estados: `todo` | `doing` | `review` | `fix` | `done` | `blocked`.

| Task | Owner | Files | Spec refs | Depends | Done when (BDD) | Status |
|---|---|---|---|---|---|---|
| T-M01 | dev-backend | `js/movies/tmdbClient.js` | API-M01..M08, ALG-M05, NFR-M04 | — | Cliente ESM exporta `searchMovies`, `fetchTrendingWeek/Popular/TopRated/Upcoming`, `getMovieDetail`, `isTmdbConfigured`, `posterUrl/backdropUrl/trailerUrl` con las firmas de specs-delta; `language=es-ES` e `api_key` en todas las llamadas; errores como `TmdbError` con `code`; sin clave ⇒ `NO_API_KEY` sin red; timeout 10 s; AC-M01, AC-M02, AC-M03, AC-M04, AC-M05, AC-M06 verificables | todo |
| T-M02 | dev-backend | `js/firebase.js` | REQ-F1, DB-M01, ALG-M03 | — | Reexporta `Timestamp` y `writeBatch` además de los helpers actuales; CDN solo aquí; sin cambios en comportamiento existente; UTF-8 sin BOM | todo |
| T-M03 | dev-backend | `js/movies/moviesRepository.js` | DB-M01..M03, SEC-M02, SEC-M03, ALG-M03, ALG-M06 | T-M01, T-M02 | CRUD de `users/{uid}/movies` y `movie_collections` sin parámetro `uid` (usa `auth.currentUser`); `addFromTmdb` upsert sin duplicados; `addManual` sin red; `watch/unwatch/setStatus` aplican ALG-M03; `deleteCollection` limpia `collectionIds` por lotes; `ensureDetailCached` respeta 30 días; lanza `SESSION_EXPIRED` sin sesión; AC-M07, AC-M08, AC-M10, AC-M11, AC-M21 | todo |
| T-M04 | tech-lead | `js/movies/moviesState.js` | ALG-M01, ALG-M02, ALG-M04, UI-M09, D-M08 | T-M03 | Exporta funciones puras `computeStats`, `filterMovies`, `sortMovies`, `parseUserRating`, mapas `STATUS_LABELS`, `SORT_OPTIONS`, `TMDB_GENRES_ES` y estado de pestañas/filtros; nulls al final y collación `es-ES`; AC-M09, AC-M12, AC-M18, AC-M19, AC-M20 pasan con datos de prueba | todo |
| T-M05 | dev-frontend | `index.html` | UI-M01..M08, REQ-C2, D-M05 | — | `#nav-movies` en `#app-nav` y esqueleto completo de `#movies-section` (stats, 3 pestañas con paneles, grids, filtros, formularios, `<dialog id="movie-detail">`) con todos los IDs estables de UI-M01..M08 y el `<link rel="stylesheet" href="./css/movies.css">`; `#app-empty` intacto; `<meta charset>` primera etiqueta; UTF-8 sin BOM; AC-M25 | todo |
| T-M06 | dev-frontend | `css/movies.css` | UI-M10, NFR-M02 | T-M05 | Estilos de sección, pestañas, barra de stats, tarjetas, grids responsivos, estados vacíos/error y diálogo con foco visible; reglas de `css/app.css` sin romper el shell | todo |
| T-M07 | dev-frontend | `js/movies/moviesView.js` | UI-M01, UI-M02, UI-M03, UI-M04, ALG-M01 | T-M04, T-M05 | `mountMovies()` monta la sección: conmutación de pestañas, barra de estadísticas con labels es (AC-M20), catálogo con 4 listas + búsqueda instantánea (debounce 300 ms, ≥2 chars), tarjetas con imagen `w500` y estados de error/vacío en español | todo |
| T-M08 | dev-frontend | `js/movies/moviesView.js` | UI-M05, ALG-M02 | T-M07 | Mi biblioteca: buscador, filtros combinables (estado/favoritos, género, colección, rango), «Limpiar filtros», selector de 7 ordenes, contador «N películas», estados vacíos; AC-M14 (favorito desde la tarjeta), AC-M18 y AC-M19 verificables en pantalla | todo |
| T-M09 | dev-frontend | `js/movies/moviesView.js` | UI-M06, UI-M08, ALG-M03, ALG-M04, ALG-M06, D-M09 | T-M08 | Diálogo de ficha completo: metadatos TMDB (AC-M04), voto TMDB separado de la nota personal (AC-M24), tráiler, «Dónde ver», controles de estado/favorito/±1/manual con fechas (AC-M10, AC-M11), nota 0–10 con medios puntos (AC-M12), reseña con spoiler (AC-M13), etiquetas, selector de colecciones (AC-M15), «Actualizar datos» con caché (AC-M21) y alta manual (AC-M08) con avisos en español (AC-M01, AC-M06), favorito persistente (AC-M14), aviso de cambios sin guardar (AC-M26) y borrado con confirmación (AC-M27) | todo |
| T-M10 | dev-frontend | `js/movies/moviesView.js` | UI-M07, DB-M02 | T-M09 | Mis colecciones: crear/renombrar/describir/eliminar, recuento «N películas», clic para filtrar la biblioteca por colección; AC-M15 y AC-M16 verificables | todo |
| T-M11 | dev-frontend | `js/app.js` | UI-M01, REQ-D2 (MOD), REQ-D3 (MOD) | T-M10 | `#nav-movies` alterna `#movies-section` con `aria-expanded`, oculta/muestra `#app-empty` conservando su texto, importa `moviesView` sin errores de consola; AC-M17 | todo |
| T-M12 | devops | `firestore.rules` | SEC-M01, SEC-M02, SEC-M03, REQ-F2 (MOD) | — | Añade `match /movie_collections/{id}` owner-only con `isValidMovieCollection()` y `isValidMovieDoc()` en el match `movies` existente; matches e `isAllowedUser()` previos intactos; AC-M22 y AC-M23 pasan con reglas desplegadas | todo |
| T-M13 | devops | `firestore.indexes.json` | DB-M04, REQ-F2 (MOD) | T-M12 | Los 6 índices compuestos de DB-M04 añadidos con `collectionGroup:"movies"` y estructura existente preservada; sin índices redundantes | todo |
| T-M14 | code-reviewer | (solo lectura) `openspec/changes/movies/*.md` + `git diff` | todos los `*-M*` | T-M11, T-M13 | Auditoría sin hallazgos abiertos de ambigüedad/testabilidad/cobertura AC; cero inconsistencias de IDs entre specs-delta y tasks | todo |

## Estado

- Todas las tareas en `todo`. Este cambio aún no está aprobado ni implementado.
- Nota: tras aprobar el delta, el `orchestrator` lo reflejará en `tasks.md`
  raíz y en GitHub Issues (`gh`) siguiendo el flujo SDD; los commits usan
  mensajes ASCII en inglés (`feat(T-Mxx): …`), la UI siempre en español.
