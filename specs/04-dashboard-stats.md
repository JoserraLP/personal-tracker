# 04 — Dashboard y estadísticas

## 1. Requisitos (REQ-*)

| ID | Requirement | Priority |
|---|---|---|
| REQ-301 | KPIs globales a partir de `users/{uid}/entries` (1 sola query paginada agregada en cliente): total de ítems, en curso, completados, abandonados, planeados. | must |
| REQ-302 | Distribución por categoría: nº de entries agrupadas por `catalog.mediaType` (7 tipos), con % sobre el total. | must |
| REQ-303 | Media de notas: promedio de `score` (solo entries con score, 1 decimal) y nº de puntuaciones; media por tipo. | must |
| REQ-304 | Actividad reciente: últimas 10 entries ordenadas `updatedAt` desc (DB-114) con título, cambio y fecha. | must |
| REQ-305 | Cálculo en **parte pura** (`computeDashboard(entries, mediaById)`) para tests rápidos sin Firestore; el store solo aporta los datos. | must |
| REQ-306 | Estados vacíos: sin entries ⇒ KPIs en 0 y mensaje "Añade tu primer título". | must |

## 2. Contratos (API-* / tipos)

```typescript
type DashboardStats = {
  totals: { total: number; planned: number; inProgress: number; completed: number; dropped: number };
  byType: Record<MediaType, { count: number; pct: number }>;   // pct 0-100, 1 decimal, suma ≈100
  scores: { average: number | null; count: number; byType: Record<MediaType, { average: number | null; count: number }> };
  recent: Array<{ mediaId: string; title: string; status: EntryStatus; updatedAt: string /* ISO */ }>; // ≤10
};

interface DashboardService {
  getStats(uid: string): Promise<Result<DashboardStats>>;
}
// API-20: implementación en js/services/dashboard-service.js sobre TrackingRepository + CatalogRepository
//         (getById por lote con `getAll(...ids)` — máximo 1 lectura adicional por página de entries).
// API-21: computeDashboard(entries: Entry[], mediaById: Map<string, MediaItem>) — puro, sin I/O.
// API-22: Recálculo onSnapshot de entries (dashboard reactiva), sin polling.
```

## 3. UI (UI-*)

| ID | Componente | Detalle |
|---|---|---|
| UI-20 | `KpiRow` | 5 tarjetas KPI (total, en curso, completados, abandonados, planeados). |
| UI-21 | `TypeDistribution` | Barra/bloques por tipo con badge y % (estilo IMDb). |
| UI-22 | `ScoreSummary` | Nota media global + media por tipo, "—" si `count = 0`. |
| UI-23 | `RecentActivity` | Lista de últimas 10 actividades con fecha relativa en español. |

## 4. Criterios de aceptación (BDD)

| ID | Given | When | Then |
|---|---|---|---|
| AC-130 (REQ-301) | 10 entries: 4 `COMPLETED`, 3 `IN_PROGRESS`, 2 `PLANNED`, 1 `DROPPED` | `getStats` | `totals = {total:10, completed:4, inProgress:3, planned:2, dropped:1}`. |
| AC-131 (REQ-302) | Ítems: 3 GAME, 2 MOVIE, 1 BOOK (total 6) | Cálculo | `byType.GAME = {count:3, pct:50}`, `MOVIE = {count:2, pct:33.3}`; tipos sin entries ⇒ `{count:0, pct:0}`. |
| AC-132 (REQ-303) | Scores: 8, 9, 6 y 2 entries sin score | Cálculo | `scores.average = 7.7` ((8+9+6)/3), `count = 3`; las sin score no cuentan. |
| AC-133 (REQ-303) | 0 entries con score | Cálculo | `average = null`, UI muestra "—". |
| AC-134 (REQ-304) | 12 entries con distinto `updatedAt` | Cálculo | `recent.length = 10`, ordenado de más reciente a más antiguo. |
| AC-135 (REQ-305) | `computeDashboard` con arrays fixture | Ejecución en vitest | Sin red/Firebase, resultado determinista (<50 ms). |
| AC-136 (REQ-306) | Usuario sin entries | Abre dashboard | KPIs en 0, `scores.average = null`, estado vacío visible. |
| AC-137 (REQ-301) | Entry cambia de `PLANNED` a `COMPLETED` | El `DashboardService` recibe la actualización vía `FakeTrackingRepository` (evento de snapshot simulado, sin emulador Firestore) | KPIs y distribución se actualizan sin re-ejecutar `getStats` completo (recálculo puro con `computeDashboard`) — testeable en vitest |
