# Tasks — Spec 004: Favoritos y colecciones personalizadas

Fuente de verdad: `spec.md` (raíz del repo). Rama: `feat/004-favorites-collections` desde `dev`.
Estados: todo | doing | review | fix | done | blocked.

| Task | Owner | Files | Spec refs | Done when | Status |
|---|---|---|---|---|---|
| T-001 | devops | (git only) | §1 | Rama `feat/004-favorites-collections` desde `dev` actualizado; `spec.md` + `tasks.md` commiteados (`chore(004)`); sin tocar otros ficheros | done |
| T-002 | tech-lead | `firestore.rules` | §4.1 («Reglas»), §6 | `users/{uid}/chapters/{id}` y `users/{uid}/collections/{id}` owner-only read+write (mismo patrón que el resto); resto de secciones intacto; sintaxis válida | done |
| T-003 | dev-backend | `js/catalog.js` (+ `js/firebase.js` SOLO para re-exports si falta alguno) | DB-001..DB-003, REQ-001/002/003/006/007/012, AC-001/002/005/006/007/009 | `validateItem` extendido (`isFavorite` bool, `collectionIds` ≤20); `setItemFavorite`/toggle; `validateFavoriteChapter`/`normalizeFavoriteChapter` + CRUD de chapters (subscribe/list/create/update/delete; `parentMediaType` ∈ series/anime/book — ver nota residuo 1); `validateCollection`/`normalizeCollection` + CRUD de collections (create/update/delete con **unlink best-effort** en ítems de las 5 colecciones + chapters, reportando fallos para reintento — AC-009); `addToCollection`/`removeFromCollection` (ítem o capítulo, dedupe y límite 20); `computeFavoritesStats(favoriteItems, favoriteChapters)` puro (count total + 5 recientes por `updatedAt` desc, empate `createdAt` desc, cada entrada con kind/mediaType/title); importable en Node sin red; 183 tests siguen en verde; informa firmas exactas | done (fix r1+r2: unlink read-modify-write verificado 3/3 con mock destructivo; test temporal borrado; 183 verde) |
| T-004 | dev-frontend | `index.html`, `css/app.css`, `js/app.js` | REQ-003/004/006/007/008/010, UI-001/002/003/005, AC-001/003/004/006/007/008/010 | Pestañas globales «Favoritos» y «Colecciones» ANTES de las de tipo (D-005); FavoritesView (ítems favoritos filtrados + capítulos favoritos, con corazón y acceso a ficha — AC-003); CollectionsView + CollectionDetail + CollectionForm (nombre 1-60, color `#RRGGBB`, validación inline — AC-006/008); corazón en tarjetas con `aria-pressed` (AC-001/004); CollectionPicker para añadir/quitar de colecciones (AC-007); responsive ≤640px; dashboard/shell/login intactos | done (verificado con grep: paneles, tabs, corazón, picker y form en los 3 ficheros) |
| T-005 | dev-frontend | `index.html`, `css/app.css`, `js/app.js` (mismos ficheros, tras T-004) | REQ-001/002/005, UI-003/004, AC-002/005/014 | Corazón en la ficha modal (AC-004); sección «Capítulos favoritos» en la ficha de series/anime/libros: alta/edición/borrado con título/notas/valoración/visionados, vinculados al padre (AC-002/014); bloque «Favoritos» en el dashboard: contador + 5 atajos recientes (AC-005); sin regresiones de T-004 | done (verificado con grep: corazón en ficha, sección capítulos y bloque dashboard; 183 verde) |
| T-006 | qa-engineer | `tests/**` | AC-001/002/005/006/007/009/014 (automatizables) + regresión de los 183 previos | `npm test` en verde (183 previos + nuevos); ≥1 test por AC automatizable nombrado con el ID; AC-003/004/008/010/011/012/013 marcados como manuales; sin editar fuentes; sin dependencias nuevas | done (fix r1 aplicado; 243/243 en verde: 183 + 60 nuevos) |
| T-007 | devops | (git only) | §1 | Commits convencionales (`feat(004)`, `test(004)`, `chore(004)`) SIN push (diff real para T-008) | doing |
| T-008 | code-reviewer | (read-only) | todos | Auditoría del diff `dev...HEAD` contra los IDs del spec 004; sin hallazgos HIGH abiertos → aprobar merge | todo |
| T-009 | devops | (git only) | §1 | Fixes commiteados (si los hay), push, PR a `dev` (o `merge --no-ff`), rama borrada tras fusionar | todo |

## Orden y paralelismo
1. T-001 (devops).
2. T-002 ∥ T-003 (ficheros disjuntos).
3. T-004 → T-005 (mismos ficheros, secuencial).
4. T-006 (qa) → T-007 (commits) → T-008 (review) → fixes (máx. 2 rondas) → T-009 (push/PR/merge).

## Notas de integración
- El spec vive en la RAÍZ (`spec.md`); grep por ID, no lectura completa.
- **Residuo 1:** DB-002 lista `podcast` en `parentMediaType`, pero el catálogo no tiene podcasts (el spec 002 los eliminó) → `parentMediaType` válido: `series`, `anime`, `book`.
- **Residuo 2:** la línea AC-013 (fallo de escritura → mensaje inline con reintento) quedó absorbida por §4.1 «Reglas» al editar; tratarla como AC-013 **manual** en QA. Su contrato ya vive en §4.1.
- **Publicar `firestore.rules` es manual** (Firebase console → Firestore → Reglas): sin publicar, el servidor DENEGARÁ lecturas/escrituras de `chapters` y `collections` aunque el código esté correcto.
- Los capítulos favoritos NO tienen sesiones propias (D-006: reutilizan las del padre); borrar un capítulo elimina el favorito (DB-002).
- Fix rounds: máx. 2 por tarea; después, escalado al usuario.
