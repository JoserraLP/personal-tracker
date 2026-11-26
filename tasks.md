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
| T-M01 | dev-backend | `js/movies/tmdbClient.js` | API-M01..M08, ALG-M05, NFR-M04 | — | Cliente ESM con `searchMovies`, `fetchTrendingWeek/Popular/TopRated/Upcoming`, `getMovieDetail`, `isTmdbConfigured`, `posterUrl/backdropUrl/trailerUrl`; `language=es-ES` + `api_key`; errores como `TmdbError` con `code`; sin clave ⇒ `NO_API_KEY` sin red; timeout 10 s; AC-M01..AC-M06 | todo |
| T-M02 | dev-backend | `js/firebase.js` | REQ-F1, DB-M01, ALG-M03 | — | Reexporta `Timestamp` y `writeBatch` (CDN solo aquí); sin cambios de comportamiento; UTF-8 sin BOM | done |
| T-M03 | dev-backend | `js/movies/moviesRepository.js` | DB-M01..M03, SEC-M02, SEC-M03, ALG-M03, ALG-M06 | T-M01, T-M02 | CRUD `users/{uid}/movies` y `movie_collections` vía `auth.currentUser`; upsert sin duplicados; `watch/unwatch/setStatus` (ALG-M03); `deleteCollection` por lotes; caché 30 días; `SESSION_EXPIRED` sin sesión; AC-M07, AC-M08, AC-M10, AC-M11, AC-M21 | todo |
| T-M04 | tech-lead | `js/movies/moviesState.js` | ALG-M01, ALG-M02, ALG-M04, UI-M09, D-M08 | T-M03 | Funciones puras `computeStats`, `filterMovies`, `sortMovies`, `parseUserRating`, `STATUS_LABELS`, `SORT_OPTIONS`, `TMDB_GENRES_ES`; nulls al final, collación `es-ES`; AC-M09, AC-M12, AC-M18..AC-M20 | todo |
| T-M05 | dev-frontend | `index.html` | UI-M01..M08, REQ-C2, D-M05 | — | `#nav-movies` y `#movies-section` con todos los IDs estables (stats, 3 pestañas, grids, filtros, formularios, `<dialog id="movie-detail">`) + `css/movies.css`; `#app-empty` intacto; AC-M25 | todo |
| T-M06 | dev-frontend | `css/movies.css` | UI-M10, NFR-M02 | T-M05 | Estilos de sección, pestañas, stats, tarjetas, grids, estados vacío/error y diálogo; sin romper el shell | todo |
| T-M07 | dev-frontend | `js/movies/moviesView.js` | UI-M01..M04, ALG-M01 | T-M04, T-M05 | `mountMovies()`: pestañas, stats en español (AC-M20), 4 listas + búsqueda con debounce 300 ms, tarjetas `w500` con estados error/vacío | todo |
| T-M08 | dev-frontend | `js/movies/moviesView.js` | UI-M05, ALG-M02 | T-M07 | Mi biblioteca: filtros combinables, orden (7 claves), contador, estados vacíos; AC-M14, AC-M18, AC-M19 | todo |
| T-M09 | dev-frontend | `js/movies/moviesView.js` | UI-M06, UI-M08, ALG-M03, ALG-M04, ALG-M06, D-M09 | T-M08 | Ficha `<dialog>` completa: metadatos, tráiler, «Dónde ver», estado/favorito/±1, nota 0–10, reseña spoiler, colecciones, caché, alta manual, avisos es; AC-M01, AC-M04, AC-M06, AC-M08, AC-M10..AC-M15, AC-M21, AC-M24, AC-M26, AC-M27 | todo |
| T-M10 | dev-frontend | `js/movies/moviesView.js` | UI-M07, DB-M02 | T-M09 | Colecciones: crear/renombrar/describir/eliminar, recuento, filtrado; AC-M15, AC-M16 | todo |
| T-M11 | dev-frontend | `js/app.js` | UI-M01, REQ-D2 (MOD), REQ-D3 (MOD) | T-M10 | `#nav-movies` alterna `#movies-section` con `aria-expanded` y `#app-empty` conservado; AC-M17 | todo |
| T-M12 | devops | `firestore.rules` | SEC-M01..M03, REQ-F2 (MOD) | — | `match /movie_collections/{id}` owner-only + `isValidMovieDoc()` en `movies`; reglas previas intactas; AC-M22, AC-M23 | todo |
| T-M13 | devops | `firestore.indexes.json` | DB-M04, REQ-F2 (MOD) | T-M12 | 6 índices compuestos de DB-M04 (`collectionGroup:"movies"`), estructura preservada | todo |
| T-M14 | code-reviewer | (read-only) `openspec/changes/movies/*.md` + `git diff` | todos `*-M*` | T-M11, T-M13 | Auditoría sin hallazgos abiertos; cero inconsistencias de IDs entre specs-delta y tasks | todo |

## Estado

- BASE, P-1, P-2, P-3, P-3b y P-4 completados. Árbol podado y verificado.
- Delta `openspec/changes/movies/` auditado y aprobado (sin hallazgos
  residuales). T-M01..T-M14 sincronizadas en `tasks.md` raíz y en GitHub Issues
  (etiquetas `ready`/`blocked`); pendientes de implementación.
- Mapa de issues (cambio `movies`): T-M01=#81, T-M02=#80, T-M03=#84,
  T-M04=#88, T-M05=#85, T-M06=#87, T-M07=#90, T-M08=#91, T-M09=#92,
  T-M10=#93, T-M11=#94, T-M12=#86, T-M13=#89, T-M14=#95. Las issues bloqueadas
  llevan etiqueta `blocked` y se liberan cerrando su dependencia.
- Hallazgos de P-4 diferidos (no bloquean el núcleo): comentarios obsoletos en
  `js/config.js` (claves TMDB/Books/IGDB/Steam y refs a `cloudflare/` y
  `scripts/`), `js/firebase.js` (cita `db.js`) y `js/allowed-emails.js` (cita la
  spec 001 eliminada). `js/config.js` se conserva INTACTO por decisión del
  usuario; su limpieza se hará en la próxima fase de especificación.
- Árbol listo para prueba local en `http://localhost:5500` antes del reset de
  Git por el usuario.
