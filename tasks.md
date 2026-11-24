# Tasks — Serie OpenSpec 00-05 (personal-tracker)

Fuente de verdad: `specs/00-overview.md`, `specs/01-data-model.md`, `specs/02-catalog-search.md`, `specs/03-tracking-collections.md`, `specs/04-dashboard-stats.md`, `specs/05-recommendations.md`.
Estado de descomposición: planificado (1 issue de GitHub por tarea, label `ready` sin dependencias / `blocked` con ellas).
Convenciones: REQ-C1..C6, REQ-E1..E4, IDs por rangos (REQ-1xx..4xx, AC-1xx, DB-1xx/2xx, SEC-*, API-*, UI-*, ALG-*).
Fix rounds: **máx. 2 por issue**; después se para y se escala al usuario.

Reglas de descomposición: 1-2 ficheros por tarea, un solo owner, ficheros disjuntos entre tareas paralelas, ordenadas por dependencia.

| Task | Owner | Files | Spec refs | Depends | Done when (resumen BDD) | Status | Issue |
|---|---|---|---|---|---|---|---|
| T-101 | devops | `firebase.json`, `firestore.indexes.json` (nuevo) | 01 §2 DB-110..DB-117 | — | Los 8 índices compuestos declarados y validables con `firebase deploy --only firestore:indexes`; JSON válido; `npm test` en verde; solo esos 2 ficheros | done | #47 |
| T-102 | tech-lead | `firestore.rules` | 01 §3 SEC-01..04; AC-100, AC-101 | — | `catalog/**` read allowlist + write false (AC-101); `users/{uid}/**` AND-combinado owner-only (AC-100); SEC-03 condicional (no rompe docs serie 004); resto de secciones intactas | done | #48 |
| T-103 | dev-backend | `js/catalog.js` | 01 §4 DB-120..DB-123; AC-102..104; 00 REQ-C1/C2/C6, REQ-E3 | — | AC-102 normalización idéntica y determinista; AC-103 score 11 ⇒ validation sin escritura; AC-104 coherencia `kind`/`mediaType`; importable en Node sin red; 243 tests previos en verde | todo | #49 |
| T-104 | qa-engineer | `tests/data-model-validators.test.js` (nuevo) | AC-102, AC-103, AC-104; DB-120..123; REQ-C4 | T-103 | ≥1 `it()` por ID citado; `npm test` verde; sin editar fuentes ni añadir dependencias | todo | #50 |
| T-105 | dev-backend | `js/repositories/catalog-repository.js` (nuevo) | 02 API-01..05, REQ-101..103; 01 DB-110..113; 00 REQ-E1/E2 | T-101, T-103 | AC-111 1 lectura/página, pageSize 24 (max 48), cursor opaco; AC-112 prefijo tras `normalizeTitle` (acento/mayúsculas irrelevantes) y no-prefijo ⇒ 0 resultados; AC-113 `ok:true` + `items:[]`; errores ⇒ `Result` | todo | #51 |
| T-106 | dev-backend | `js/seed/seed-catalog.js` (nuevo) | 02 API-03, REQ-104; AC-114; 01 DB-101/102 | T-103 | `SEED_ITEMS` ≥7 (1 por tipo), `seed:true`, doc id `seed-<tipo>-<n>`, `metadata.kind` coherente; todos pasan `validateMediaItem`; importable sin red; re-ejecutar = upsert (AC-114) | todo | #52 |
| T-107 | dev-backend | `js/api-normalize.js` (nuevo) | 02 REQ-108 (API-001..005 spec 002); 01 DB-120; 00 REQ-E4 | T-103 | Normalizadores puros TMDB/Books/IGDB-Steam ⇒ `MediaItemInput` validado; fallo de API no bloquea el alta manual (REQ-E4); importable sin red; cabecera de IDs | todo | #53 |
| T-108 | dev-backend | `js/repositories/tracking-repository.js` (nuevo) | 03 API-10..12, REQ-201..205; 01 DB-103, DB-114..116, SEC-01; AC-120..124, AC-129 | T-101, T-102, T-103 | AC-120 upsert 1 doc por mediaId; AC-122 score 7/review persisten, 11 ó 10.5 ⇒ validation sin escritura; AC-123 progress rechazado/aceptado según total; AC-124 orden+filtros; escrituras parciales con `serverTimestamp` | todo | #54 |
| T-109 | dev-backend | `js/repositories/collection-repository.js` (nuevo) | 03 API-10, API-13, REQ-206/208; 01 DB-104, DB-117, DB-123; AC-125..128 | T-102, T-103 | AC-125 `arrayUnion` sin duplicados; AC-126 21ª colección ⇒ validation sin escritura; AC-127 quitar ítem solo toca `itemIds`; AC-128 borrar entry no toca colecciones ni `catalog`; `list` orderBy `updatedAt` desc | todo | #55 |
| T-110 | dev-backend | `js/services/dashboard-service.js` (nuevo) | 04 API-20..22, REQ-301..306; AC-130..137 | T-105, T-108 | AC-130/131/132/133/134 totales, %, medias y recent ≤10 exactos; AC-135 puro <50 ms sin red; AC-136 estado vacío; AC-137 recálculo por snapshot simulado sin re-ejecutar `getStats`; ≤1 lectura adicional por página | todo | #56 |
| T-111 | dev-backend | `js/services/recommendation-service.js` (nuevo) | 05 REQ-401..408, ALG-01..08; AC-140..155 | T-105, T-108 | AC-140..144 afinidad, pesos y exclusión; AC-145/146/151 orden determinista byte a byte; AC-147 razón con título original; AC-148/152 fallback `avgRating`; AC-149 `ok:true []`; AC-150 limit 20; AC-153 ≤2 lecturas; AC-154 `scoreMatch` entero 0-100; AC-155 `permission_denied` en español | todo | #57 |
| T-112 | dev-frontend | `index.html`, `js/app.js` | 00 §2; 02 UI-02/03; 04 UI-20; 05 UI-30; REQ-C5 | — | Nav con las 6 vistas (Catálogo, Búsqueda, Perfil, Colecciones, Dashboard, Recomendaciones) + contenedores + `show()` sin romper vistas actuales; pestañas sin vista propia quedan `aria-disabled`; textos en español; `npm test` verde | todo | #58 |
| T-113 | dev-frontend | `js/ui/media-card.js` (nuevo), `css/app.css` | 02 UI-01, REQ-106/107; AC-115..117; 03 UI-10/11; 05 UI-32 | T-105, T-108, T-109 | AC-116 componente único exportado y reutilizable; póster 2:3 con fallback, badge tipo, ★ `avgRating`, score personal, año, ≤2 géneros + `+N`; `<article>` + `<button>` con `aria-label` español; callbacks `Añadir`/`Cambiar estado`/`Asignar a colección` | todo | #59 |
| T-114 | dev-frontend | `js/app.js`, `css/app.css` | 02 UI-02, REQ-101/103; AC-110, AC-111, AC-116 | T-112, T-113, T-105 | AC-110 24 tarjetas + `LoadMore` sin recarga; pestañas de 7 tipos + `FilterBar` (género/año/min `avgRating`); estado vacío; grid con `MediaCard`; solo docs del tipo filtrado | todo | #60 |
| T-115 | dev-frontend | `js/app.js`, `index.html` | 02 UI-03, REQ-102; AC-112, AC-113 | T-114, T-105 | Debounce 300 ms; `el últ` y `EL ÚLT` encuentran; `ultimo sig` y sin coincidencias ⇒ "Sin resultados" sin error; grid con `MediaCard` | todo | #61 |
| T-116 | dev-frontend | `js/app.js`, `css/app.css` | 02 UI-04, REQ-105/108; AC-118; 00 REQ-E4 | T-115, T-105, T-107 | AC-118 alta manual válida ⇒ `seed:false` y aparece en listado; alta desde API vía `api-normalize`; errores de API no bloquean el alta manual; validación inline en español | todo | #62 |
| T-117 | dev-frontend | `js/app.js`, `css/app.css` | 03 UI-10..13, REQ-201..204; AC-115, AC-117, AC-120..124 | T-114, T-113, T-108 | AC-115 `Añadir` crea `PLANNED` en 1 clic y la tarjeta muestra estado; AC-117 cambio a `COMPLETED` persiste con `updatedAt` nuevo; menú 4 estados con rollback optimista; `ScorePicker` 1-10, `ReviewField` ≤500 con contador, `ProgressBar` según `metadata.kind` | todo | #63 |
| T-118 | dev-frontend | `js/app.js`, `js/ui/collections-panel.js` (nuevo) | 03 UI-14, REQ-206/207; AC-125..129 | T-117, T-109 | AC-125/126 formularios con validación "Máximo 20 colecciones"; AC-127 detalle renderiza `MediaCard` y "Quitar" solo actualiza `itemIds`; AC-128 la colección sobrevive al borrar la entry; selector "Asignar a colección" desde la tarjeta | todo | #64 |
| T-119 | dev-frontend | `js/app.js`, `css/app.css` | 04 UI-20..23, REQ-301..306; AC-130..137 (parte UI) | T-118, T-110 | AC-136 KPIs en 0 + "Añade tu primer título"; `KpiRow` 5 tarjetas, `TypeDistribution` %, `ScoreSummary` "—" si count 0, `RecentActivity` 10 con fecha relativa en español; reactiva vía snapshot | todo | #65 |
| T-120 | dev-frontend | `js/app.js`, `css/app.css` | 05 UI-30..32, REQ-407/408; AC-149 (UI-31), AC-150 (UI) | T-119, T-111 | Grid `MediaCard` + `reason` bajo la tarjeta + badge `scoreMatch`; estado vacío "Sigue valorando títulos con 8+…"; al añadir, el ítem sale en el siguiente recálculo; acciones REQ-107 activas | todo | #66 |
| T-121 | qa-engineer | `tests/fakes.js` (nuevo) | 03 API-14; 05 AC-153; 04 AC-137 | T-105, T-108, T-109 | `FakeCatalogRepository`/`FakeTrackingRepository`/`FakeCollectionRepository` en memoria con contador de lecturas; sin red/Firebase; exportables desde tests | todo | #67 |
| T-122 | qa-engineer | `tests/catalog-repository.test.js`, `tests/seed-catalog.test.js` (nuevos) | AC-110..AC-114, AC-118; REQ-C4 | T-105, T-106 | ≥1 `it()` por AC con su ID; AC-114 comprueba ids fijos no duplicables; `npm test` verde; sin editar fuentes | todo | #68 |
| T-123 | qa-engineer | `tests/tracking-repository.test.js` (nuevo) | AC-120..AC-124, AC-129; API-12 | T-108, T-121 | Cobertura de upsert, escrituras parciales, validación sin red, orden/filtro, `permission_denied`; `npm test` verde | todo | #69 |
| T-124 | qa-engineer | `tests/collections-repository.test.js` (nuevo) | AC-125..AC-128; API-13 | T-109, T-121 | Idempotencia `arrayUnion`, límite 20, quitar ítem, borrado de entry sin efecto colateral; `npm test` verde | todo | #70 |
| T-125 | qa-engineer | `tests/dashboard-stats.test.js` (nuevo) | AC-130..AC-137 | T-110, T-121 | Totales, %, medias, recent, vacío, determinismo puro y recálculo por snapshot; `npm test` verde | todo | #71 |
| T-126 | qa-engineer | `tests/recommendations.test.js` (nuevo) | AC-140..AC-155 | T-111, T-121 | Afinidad, exclusión, orden determinista, fallback, límite 20, clamp 0-100, ≤2 lecturas, `permission_denied`; `npm test` verde | todo | #72 |
| T-127 | qa-engineer | `tests/api-normalize.test.js` (nuevo) | REQ-108, DB-120, REQ-E4 | T-107 | Normalizadores de TMDB/Books/IGDB-Steam producen `MediaItemInput` válido; fallo ⇒ resultado que no bloquea alta manual; `npm test` verde | todo | #73 |
| T-128 | qa-engineer | `tests/manual-ac.test.js` (nuevo) | ACs no automatizables (AC-100, AC-101, AC-116 UI, AC-117 UI, AC-127 UI, AC-129 manual…); REQ-C4 | T-101, T-102, T-120, T-127 | Cada AC manual listado como `it.todo`/skip citando su ID; suite completa en verde; regresión de los 243+ tests previos | todo | #74 |
| T-129 | code-reviewer | (read-only, sin ficheros) | specs 00-05 íntegras | T-128 | Auditoría del diff `dev...HEAD` contra todos los IDs (REQ/DB/AC/API/UI/ALG/SEC); sin hallazgos HIGH abiertos ⇒ APROBAR MERGE; máx. 2 rondas de fix y después escalado | todo | #75 |
| T-130 | devops | (git + consola, sin ficheros de app) | 00 §5 S1/S2, 01 §3 (publicación manual) | T-129 | Commits convencionales + PR a `dev`; publicación de `firestore.rules` e índices en consola; seed ejecutado (≥1 ítem por tipo, re-ejecución sin duplicar); GitHub Pages desplegado desde `dev` | todo | #76 |

## Orden y paralelismo

1. **Sin dependencias (label `ready`):** T-101 ∥ T-102 ∥ T-103 ∥ T-112 (ficheros disjuntos).
2. **Núcleo de datos:** T-104 (tras T-103); T-105, T-106, T-107 ∥ entre sí (tras T-103, T-101); T-108 ∥ T-109 (tras T-102/T-103).
3. **Servicios:** T-110 ∥ T-111 (tras T-105, T-108).
4. **Frontend (cadena secuencial por `js/app.js` y `css/app.css`):** T-113 → T-114 → T-115 → T-116 → T-117 → T-118 → T-119 → T-120.
5. **QA (paralelo al frontend, ficheros `tests/` disjuntos):** T-121 → T-123/T-124/T-125/T-126; T-122 y T-127 cuando su origen esté listo; T-128 al final.
6. **Cierre:** T-129 (review) → fixes (máx. 2 rondas) → T-130 (push/PR/deploy).

## Notas de integración

- **No hay `src/` ni bundler:** repositories/services/seed son ESM nuevos bajo `js/`; la parte pura se importa en Node y la store hace `await import("./firebase.js")` dentro de cada función (REQ-C1).
- **`catalog` y `entries` son rutas nuevas**; el modelo `users/{uid}/movies|series|…` de las specs 001-004 queda obsoleto (S1, migración fuera de alcance). Las reglas nuevas se **añaden** sin borrar secciones existentes (chapters, recipes, gym, wishlist…).
- **`users/{uid}/collections/{id}` es compartido** con la serie 004 (mismo path, schema distinto: `description`/`itemIds` ≤50 frente a `color`/≤20). Por eso SEC-03 valida `itemIds`/`name` **solo si el campo existe**.
- **Publicación manual:** `firestore.rules` y `firestore.indexes.json` se publican en Firebase console/CLI (T-130); sin ello el código es correcto pero el servidor denegará.
- **Tests:** convención `tests/<área>-<tema>.test.js`, cada `it()` cita su ID (REQ-C4); sin red ni Firebase (fakes de T-121).
- **Fix rounds:** máx. 2 por issue; después, se para y se pregunta al usuario.

## Archivo — Serie 004 (completada, histórico)

La tabla de la serie 004 (`spec.md` raíz, rama `feat/004-favorites-collections`, T-001..T-009, 243 tests en verde) queda archivada en el historial de git de este fichero.
