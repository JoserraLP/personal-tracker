# Tasks — Spec 003: Dashboard estilo IMDB del catálogo

Fuente de verdad: `spec.md` (raíz del repo). Rama: `feat/003-imdb-dashboard` desde `dev`.
Estados: todo | doing | review | fix | done | blocked.

| Task | Owner | Files | Spec refs | Done when | Status |
|---|---|---|---|---|---|
| T-001 | devops | (git only) | §1 | Rama `feat/003-imdb-dashboard` creada desde `dev` actualizado; `spec.md` + `tasks.md` commiteados (`chore(003)`); sin tocar otros ficheros | done |
| T-002 | dev-backend | `js/api-tmdb.js`, `js/api-games.js`, `js/api-books.js` (+ `js/config.js` solo si falta constante) | API-001..API-004, §4.1 (`ItemMetadata` + casos de error), REQ-004/010, AC-004/009 | Funciones de detalle por proveedor → `ItemMetadata` normalizado con contrato `{ok:true,item}` / `{ok:true,item,partial:true}` / `{ok:false,provider,code,message}`; 404→`not_found`, 429→`rate_limited`, 401/403→`unauthorized`, timeout; fallo parcial de créditos TMDB → `partial:true`; sin secretos nuevos; 128 tests siguen en verde; informa firmas exactas de exports | done (fix r1 aplicado; 128 verde; config.js sin cambios) |
| T-003 | dev-backend | `js/catalog.js` | DB-002, REQ-004 (manual)/REQ-009, AC-004/005/008 | `validateMetadata` (restricciones DB-002), `normalizeMetadata` (ausente→null), `METADATA_CACHE_TTL_DAYS`=30, `isMetadataFresh` (null o ≥30 días → false), `updateItemMetadata(mediaType,itemId,metadata,source)` (valida y escribe campos + `metadataSource` + `metadataFetchedAt`), `computeDashboardStats(itemsByType)` puro (totales por tipo/estado, media SOLO de valorados, horas jugadas, completados, 2 listas de 5 recientes); importable en Node sin red; informa firmas | done (128 verde) |
| T-004 | dev-frontend | `index.html`, `css/app.css`, `js/app.js` | REQ-001/002/005/006, UI-001, UI-002, AC-001/002/005/006, §6 + F-001 (carry-over spec 002) | Pestaña «Dashboard» PRIMERA con StatCards (totales por tipo/estado, media rating, horas jugadas, completados) y 2 listas de 5 recientes (añadidos `createdAt` desc / completados `completedAt` desc); pestañas por tipo intactas; responsive ≤640px sin scroll horizontal; F-001: cursor de «Cargar más» no se resetea con páginas extra + dedupe por id; login spec 001 intacto | done (relanzamiento verificado con grep; F-001 corregido) |
| T-005 | dev-frontend | `index.html`, `css/app.css`, `js/app.js` (mismos ficheros, tras T-004) | REQ-003/004/008/010, UI-003, UI-004, AC-003/004/007/008/009, §6, DB-002 | Ficha modal estilo IMDB (backdrop, póster, título/año/géneros, rating, estado, sinopsis, progreso por tipo, sesiones) + `MetadataSection`/`CastList`; al abrir: caché fresca → sin llamada; si no → fetch con loading/error(+reintento)/`partial` con aviso/404 con alta manual; cachear tras fetch vía `updateItemMetadata` (fallo de caché no bloquea); `MetadataForm` manual con validación inline (`metadataSource:"manual"`); foco atrapado + Escape + clic backdrop + foco devuelto; escapado de todo lo dinámico; shell T-004 intacto | done (verificado con grep; 128 verde) |
| T-006 | qa-engineer | `tests/**` | AC-004/005/008/009 (automatizables) + regresión de los 128 previos | `npm test` en verde (128 previos + nuevos); ≥1 test por AC automatizable nombrado con el ID; AC-001/002/003/006/007 marcados como manuales; sin editar fuentes; sin dependencias nuevas | done (55 tests nuevos; 183 en verde; AC-001/002/003/006/007 manuales) |
| T-007 | devops | (git only) | §1 | Commits convencionales (`feat(003)`, `test(003)`, `chore(003)`) SIN push (para que T-008 audite un diff real) | doing |
| T-008 | code-reviewer | (read-only) | todos | Auditoría del diff `dev...HEAD` contra los IDs del spec 003; sin hallazgos HIGH abiertos → aprobar merge | todo |
| T-009 | devops | (git only) | §1 | Fixes commiteados (si los hay), push, PR a `dev` (o `merge --no-ff`), rama borrada tras fusionar | todo |

## Orden y paralelismo
1. T-001 (devops).
2. T-002 ∥ T-003 (ficheros disjuntos).
3. T-004 → T-005 (mismos ficheros, secuencial).
4. T-006 (qa) → T-007 (commits) → T-008 (review) → fixes (máx. 2 rondas) → T-009 (push/PR/merge).

## Notas de integración
- El spec vive en la RAÍZ (`spec.md`); grep por ID, no lectura completa.
- **Sin cambios en `firestore.rules`**: DB-002 son campos embebidos en colecciones ya owner-only del spec 002; las reglas existentes cubren la escritura sin modificación (no hay tarea de reglas).
- Carry-over **F-001** (LOW, hallazgo T-015 del spec 002, documentado entonces): `js/app.js` resetea `paginationLastDoc` al cursor de la 1ª página en re-fires con páginas extra y «Cargar más» no deduplica por id → fix incluido en T-004.
- `js/catalog.js` debe seguir importable en Node sin red (`js/firebase.js` solo vía dynamic import); los clientes API son importables (solo `config.js` + `fetch`).
- Fix rounds: máx. 2 por tarea; después, escalado al usuario.
