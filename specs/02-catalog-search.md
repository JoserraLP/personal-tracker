# 02 — Catálogo, búsqueda y seed (estilo IMDb)

## 1. Requisitos (REQ-*)

| ID | Requirement | Priority |
|---|---|---|
| REQ-101 | Listado paginado de `catalog` filtrado por un `mediaType` (7 tipos), orden `titleNormalized` asc, paginación por cursor (`startAfter`), página por defecto 24. | must |
| REQ-102 | Búsqueda por título: **prefijo sobre el título normalizado completo** (`normalizeTitle` de DB-121, sin acentos ni mayúsculas), opcionalmente acotada a un tipo; resultados ordenados por `avgRating` desc como opción. | must |
| REQ-103 | Filtros secundarios: género, año (rango), `avgRating` mínimo. | should |
| REQ-104 | Seed inicial con ≥1 ítem por cada uno de los 7 tipos (`seed: true`, ids deterministas) para poder añadir al perfil en 1 clic sin búsqueda previa. | must |
| REQ-105 | Alta manual de `MediaItem` cuando no exista en seed ni APIs (validador DB-120). | must |
| REQ-106 | `MediaCard` única y polimórfica reutilizada en Catálogo, Búsqueda, Colecciones y Recomendaciones. | must |
| REQ-107 | Acciones rápidas en tarjeta: añadir al perfil (status por defecto `PLANNED`), cambiar estado, asignar a colección — sin abrir ficha. | must |
| REQ-108 | Alta/importación desde APIs externas existentes (TMDB, Google Books, IGDB/Steam) normalizando a `MediaItem` (conserva API-001..005 de spec 002). | should |

## 2. Contratos repository (API-*)

```typescript
type Page<T> = { items: T[]; cursor: string | null }; // cursor opaque (snapshot serialize)

interface CatalogRepository {
  listByType(mediaType: MediaType, opts?: {
    pageSize?: number;              // default 24, max 48
    cursor?: string | null;
    genre?: string; yearFrom?: number; yearTo?: number; minAvgRating?: number;
    sort?: "title" | "avgRating" | "releaseYear";   // default "title"
  }): Promise<Result<Page<MediaItem>>>;

  searchByTitle(term: string, opts?: {
    mediaType?: MediaType; pageSize?: number; cursor?: string | null;
  }): Promise<Result<Page<MediaItem>>>;   // term normalizado con normalizeTitle()

  getById(mediaId: string): Promise<Result<MediaItem | null>>;
  listSeeded(): Promise<Result<MediaItem[]>>;                 // seed = una sola lectura batch
  createMediaItem(input: MediaItemInput): Promise<Result<MediaItem>>;  // solo alta manual/seed
}
```

| ID | Contrato |
|---|---|
| API-01 | Implementación Firestore `js/repositories/catalog-repository.js` (parte store, dynamic import de `firebase.js`; parte pura de queries testeable con fake repos). |
| API-02 | `Page.cursor` es opaco para la UI; `null` ⇒ fin de listado. Nunca exponer snapshots a la vista. |
| API-03 | Seed: `js/seed/seed-catalog.js` exporta `SEED_ITEMS: MediaItem[]` (≥7 ítems, uno por tipo). **Misma entidad que `DB-101`:** cada item sembrado lleva `seed: true` y doc id determinista `seed-<tipo>-<n>`; idempotencia por `setDoc` con ese id fijo (re-ejecutar ⇒ upsert, no duplica). |
| API-04 | Búsqueda sin resultados ⇒ `{ ok:true, value:{ items:[], cursor:null } }` (estado vacío, no error). |
| API-05 | Errores ⇒ `Result` con códigos de `00-overview` §4.1; `permission_denied` mantiene el login allowlist visible. |

## 3. UI (UI-*)

| ID | Componente | Detalle |
|---|---|---|
| UI-01 | `MediaCard` (única, polimórfica) | Póster 2:3 (`coverUrl`, fallback con iniciales), badge `mediaType`, `avgRating` global (★ IMDb-amarillo) y puntuación personal (si hay entry), `releaseYear`, `genres[]`: se muestran como máximo **2 etiquetas** y, si hay más, una tercera etiqueta literal `+N` con `N = genres.length - 2` (mismo cálculo en las 4 vistas), `creator`; acciones rápidas: `Añadir`/`Cambiar estado` (menú 4 estados) y `Asignar a colección` (selector). Accesible: `<article>` con `<button>`s, foco y `aria-label` en español. |
| UI-02 | Vista Catálogo | `CatalogTabs` (7 tipos) + `FilterBar` (REQ-103) + grid `MediaCard` + `LoadMore` (cursor) + estado vacío. |
| UI-03 | Vista Búsqueda | Input con debounce 300 ms → REQ-102; grid `MediaCard`; estado vacío "Sin resultados". |
| UI-04 | Alta manual | Formulario con `validateMediaItem`; guarda vía `CatalogRepository.createMediaItem`. |

## 4. Criterios de aceptación (BDD)

| ID | Given | When | Then |
|---|---|---|---|
| AC-110 (REQ-101) | Catálogo con >24 ítems de tipo `GAME` | Abre la pestaña Juegos | Ve 24 tarjetas; `LoadMore` añade el siguiente lote sin recargar. |
| AC-111 (REQ-101) | Filtro `mediaType=MOVIE` | Consulta `listByType` | Solo se leen docs `mediaType: "MOVIE"` (1 lectura por página). |
| AC-112 (REQ-102) | Ítem "El Último Signo" (`titleNormalized: "el ultimo signo"`) | Búsqueda `"el últ"` | Encuentra el ítem (prefijo tras normalizar: `"el ult"`); `"EL ÚLT"` también (mayúsculas/acento irrelevantes). Búsqueda `"ultimo sig"` (no prefijo) ⇒ sin resultados (fuera de alcance REQ-102). |
| AC-113 (REQ-102) | Búsqueda sin coincidencias | Se envía | `items: []` y estado vacío, sin error. |
| AC-114 (REQ-104) | Instalación limpia | Ejecuta seed | `catalog` contiene ≥1 ítem de cada 7 tipos; re-ejecutar no duplica (ids fijos). |
| AC-115 (REQ-107) | `MediaCard` sin entry | Clic en `Añadir` | Se crea entry `PLANNED` y la tarjeta muestra estado personal; 1 clic, sin buscar. |
| AC-116 (REQ-106) | Las 4 vistas | Renderizan tarjetas | Mismo componente `MediaCard` (mismo DOM/estilos) en Catálogo, Búsqueda, Colecciones y Recomendaciones. |
| AC-117 (REQ-107) | Tarjeta con entry `IN_PROGRESS` | Menú → `COMPLETED` | Entry persiste con `updatedAt` nuevo; puntuación personal visible en tarjeta. |
| AC-118 (REQ-105) | Ítem inexistente en APIs | Alta manual con título válido | `createMediaItem` guarda y aparece en listado con `seed: false`. |
