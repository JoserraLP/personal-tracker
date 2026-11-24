# 03 — Tracking (entries) y colecciones propias

## 1. Requisitos (REQ-*)

| ID | Requirement | Priority |
|---|---|---|
| REQ-201 | CRUD de entry por `mediaId`: crear (status por defecto `PLANNED`), leer, actualizar (`status`, `score`, `review`, `progress`), borrar. Doc id = `mediaId` (upsert, sin duplicados). | must |
| REQ-202 | Cambiar estado entre los 4 valores (`PLANNED \| IN_PROGRESS \| COMPLETED \| DROPPED`) desde la `MediaCard` o la ficha. | must |
| REQ-203 | Puntuación personal `score` entero 1–10 (opcional) y `review` ≤500 caracteres. | must |
| REQ-204 | `progress` coherente con `metadata.kind`: episodios (SERIES/ANIME), capítulos/páginas (MANGA/BOOK), duración consumida (AUDIOBOOK/MOVIE), horas (GAME); `current ≤ total`. | must |
| REQ-205 | Listado de entries del usuario con filtro por `status` y orden `updatedAt` desc (DB-114/115). | must |
| REQ-206 | Colecciones: crear, editar `name`/`description`, borrar; añadir/quitar `mediaId` (≤50, sin duplicados); ≤20 colecciones por usuario. | must |
| REQ-207 | Las vistas de colección muestran sus ítems con `MediaCard` y permiten quitar ítem sin borrar la entry de tracking. | must |
| REQ-208 | Borrado de una entry no toca `catalog` ni las colecciones que contengan el `mediaId` (coherencia DB-103/104). | must |

## 2. Contratos repository (API-*)

```typescript
interface TrackingRepository {
  getEntry(uid: string, mediaId: string): Promise<Result<Entry | null>>;
  upsertEntry(uid: string, mediaId: string, input: EntryInput): Promise<Result<Entry>>; // valida DB-122
  setStatus(uid: string, mediaId: string, status: EntryStatus): Promise<Result<Entry>>;   // parcial, solo cambia status+updatedAt
  setScore(uid: string, mediaId: string, score: number | null): Promise<Result<Entry>>;
  setReview(uid: string, mediaId: string, review: string | null): Promise<Result<Entry>>;
  setProgress(uid: string, mediaId: string, progress: Progress | null): Promise<Result<Entry>>;
  deleteEntry(uid: string, mediaId: string): Promise<Result<true>>;
  listEntries(uid: string, opts?: {
    status?: EntryStatus; sort?: "updatedAt"; pageSize?: number; cursor?: string | null;
  }): Promise<Result<Page<Entry>>>;
  listByMinScore(uid: string, minScore: number): Promise<Result<Entry[]>>; // score >= 8, DB-116
}

interface CollectionRepository {
  list(uid: string): Promise<Result<Collection[]>>;                       // orderBy updatedAt desc, DB-117
  create(uid: string, input: { name: string; description?: string }): Promise<Result<Collection>>;
  update(uid: string, collectionId: string, patch: { name?: string; description?: string }): Promise<Result<Collection>>;
  delete(uid: string, collectionId: string): Promise<Result<true>>;
  addItem(uid: string, collectionId: string, mediaId: string): Promise<Result<Collection>>;    // arrayUnion, ≤50
  removeItem(uid: string, collectionId: string, mediaId: string): Promise<Result<Collection>>;
}
```

| ID | Contrato |
|---|---|
| API-10 | `TrackingRepository` y `CollectionRepository` en `js/repositories/` con impl. Firestore; la lógica de negocio (dashboard, recomendaciones) depende solo de estas interfaces. |
| API-11 | `setStatus`/`setScore`/… son escrituras parciales (`updateDoc` con `serverTimestamp` en `updatedAt`), no reescriben la entry completa. |
| API-12 | Crear entry con `status`/`score` inválidos ⇒ `{ ok:false, code:"validation" }` y ninguna escritura en red. |
| API-13 | `addItem` idempotente: añadir el mismo `mediaId` dos veces no duplica (arrayUnion) y no excede 50. |
| API-14 | Tests unitarios con `FakeTrackingRepository`/`FakeCollectionRepository` (en memoria) — sin red. |

## 3. UI (UI-*)

| ID | Componente | Detalle |
|---|---|---|
| UI-10 | `EntryStatusMenu` | Menú en `MediaCard` con los 4 estados + "Sin entry"; optimista con rollback en `Result` fallido. |
| UI-11 | `ScorePicker` | Escala 1–10 (enteros), valor vacío permitido; mostrado como badge personal en `MediaCard`. |
| UI-12 | `ReviewField` | Textarea ≤500 con contador; guardar/borrar. |
| UI-13 | `ProgressBar` | `current/total` según `metadata.kind`; editables en ficha. |
| UI-14 | `CollectionsPanel` | Lista de colecciones (`name`, nº ítems, `updatedAt`), formulario crear/editar/borrar y selector "Asignar a colección" desde `MediaCard`. |

## 4. Criterios de aceptación (BDD)

| ID | Given | When | Then |
|---|---|---|---|
| AC-120 (REQ-201) | Ítem `seed-*` sin entry | Clic `Añadir` | Existe `users/{uid}/entries/{mediaId}` con `status: "PLANNED"`; segundo clic no crea otro doc. |
| AC-121 (REQ-202) | Entry `PLANNED` | Cambio a `COMPLETED` | Persiste; filtro por estado la lista/sacude correctamente. |
| AC-122 (REQ-203) | Entry abierta | `score: 7`, review "Muy buena" | Ambos persisten; `score: 11` o `10.5` ⇒ validación, sin escritura. |
| AC-123 (REQ-204) | `metadata.kind: "episodes"` con `totalEpisodes: 12` | `progress: {current:13,total:12}` | Rechazado; `{current:12,total:12}` aceptado. |
| AC-124 (REQ-205) | 3 entries con distinto `updatedAt` | `listEntries({})` | Orden `updatedAt` desc; con `status:"COMPLETED"` solo esas. |
| AC-125 (REQ-206) | Usuario con 0 colecciones | Crear "Favoritos" y añadir 2 ítems | Colección con `itemIds: [id1,id2]`; añadir `id1` otra vez ⇒ sigue con 2. |
| AC-126 (REQ-206) | Usuario con 20 colecciones | Crear la 21.ª | Validación "Máximo 20 colecciones", sin escritura. |
| AC-127 (REQ-207) | Colección con 2 ítems | Se abre | Renderiza 2 `MediaCard`; "Quitar" solo actualiza `itemIds`. |
| AC-128 (REQ-208) | Entry de un ítem dentro de una colección | Borro la entry | La colección sigue con el `mediaId`; `catalog` intacto. |
| AC-129 (SEC-01) | Usuario A | Intenta `upsertEntry` en `users/{B}/entries/x` | `permission_denied`, sin datos modificados. |
