# Tasks — Spec 002: Catálogo unificado de ocio

Fuente de verdad: `spec.md` (raíz del repo). Rama: `feat/002-unified-catalog` desde `dev`.
Estados: todo | doing | review | fix | done | blocked.

| Task | Owner | Files | Spec refs | Done when | Status |
|---|---|---|---|---|---|
| T-001 | devops | (git only) | §1 | Rama `feat/002-unified-catalog` creada desde `dev` actualizado; `spec.md` + `tasks.md` commiteados (`chore(002)`); sin tocar otros ficheros | done |
| T-002 | tech-lead | `firestore.rules` | REQ-004, §4.2, AC-009, D-002, D-006, §6 | `users/{uid}/{movies,series,games,books,anime}` owner-only (read+write); `anime` añadida; las 4 legacy pasan de lectura-amigos a owner-only; resto de secciones intactas; sintaxis válida | done |
| T-003 | dev-backend | `js/catalog.js`, `js/firebase.js` (solo añadir re-exports) | REQ-002/003/008..014, DB-001..DB-007, AC-002/005/006/007/008/010/016/017, D-003, D-004, Q-003 | Lógica pura (constantes, validación, nextEpisode, sesiones, filtro/orden) importable en Node sin red (`js/firebase.js` solo vía dynamic import dentro de funciones de store); CRUD + sesiones embebidas; orderBy `updatedAt` desc, limit 100, cursor; informa firmas exactas de exports | done (fix r1 aplicado y verificado: 123 tests) |
| T-004 | dev-backend | `js/api-tmdb.js`, `js/api-games.js`, `js/api-books.js`, `js/config.js` (solo si falta constante) | REQ-005/006, API-001..API-005, §4.1 (contrato de error), AC-003/011/012/013/014/015, D-005 | Búsqueda normalizada a `SearchResult` por proveedor (TMDB movie+tv+anime vía /search/tv, juegos vía IGDB_PROXY_URL — leer `cloudflare/igdb-proxy/worker.js` para el contrato del proxy, Google Books); fallo → contrato de error §4.1; vacío → `{ok:true, items:[]}`; autofill parcial (ausente → null); sin secretos nuevos; informa firmas de exports | done |
| T-005 | dev-frontend | `index.html`, `css/app.css`, `js/app.js` | REQ-001/002/003/012/013, UI-001, UI-005, AC-001/002/016/017 | Puerta de login del spec 001 intacta (loading/login/allowed/denied); 5 pestañas; lista + tarjetas; cambio de estado; borrado; filtro/orden; cableado a exports de `js/catalog.js` | done |
| T-006 | dev-frontend | `index.html`, `css/app.css`, `js/app.js` (mismos ficheros, tras T-005) | REQ-005..011, UI-002, UI-003, UI-004, AC-003..008/011..015/017 | Modal de búsqueda con clientes API + estado vacío + error con alta manual; formulario manual; ficha/edición por tipo (progreso, «siguiente episodio», rating 1-10, reseña, fechas); sesiones alta/edición/borrado | done |
| T-007 | qa-engineer | `tests/**` | AC-002..008, AC-010..017 (automatizables) | `npm test` en verde; ≥1 test por AC automatizable nombrado con el ID del AC; sin editar fuentes; sin dependencias nuevas; AC-001/AC-009 marcados como manuales | done |
| T-008 | code-reviewer | (read-only) | todos | Auditoría del diff contra IDs del spec; sin hallazgos HIGH abiertos | todo |
| T-009 | devops | (git only) | §1 | Commits convencionales (`feat(002)`, `test(002)`), push, PR a `dev` (o `merge --no-ff` si no hay `gh`), rama borrada tras fusionar | todo |

## Orden y paralelismo
1. T-001 (devops).
2. T-002 ∥ T-003 ∥ T-004 (ficheros disjuntos).
3. T-005 → T-006 (mismos ficheros, secuencial).
4. T-007 (qa) → T-008 (review) → T-009 (devops).

## Notas de integración
- El spec vive en la RAÍZ (`spec.md`), no en `specs/`. Grep por ID, no lectura completa.
- Residuos del spec ya interpretados: «6 colecciones» (§6) y «API-001..006» (UI-003) se leen como 5 colecciones y API-001..005 (sin podcasts).
- Publicar `firestore.rules` es manual (Firebase console) — fuera del alcance del repo.
- Fix rounds: máx. 2 por tarea; después, escalado al usuario.
- T-009 en dos fases: **9a** commits convencionales (ANTES de T-008, para que el reviewer audite un diff real) y **9b** push + PR + merge a `dev` + borrado de rama (DESPUÉS de T-008).
- Fix r1 T-003 (DB-003/AC-006): `nextEpisodeLabel` con totales parciales → `null`; regresión cubierta en `tests/catalog-next-episode.test.js` (123 tests en verde).
