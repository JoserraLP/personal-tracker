# 05 — Motor de recomendaciones (Content-Based, determinista)

## 1. Requisitos (REQ-*)

| ID | Requirement | Priority |
|---|---|---|
| REQ-401 | Recomendaciones 100% cliente/servicio puro sobre `entries` + `catalog` (sin IA, sin red adicional más allá de los repositories ya usados). | must |
| REQ-402 | Base de afinidad: entries del usuario con `score >= 8` (afinidad plena, pesos ×1) o `status: COMPLETED` sin score (afinidad débil, **peso relativo 0.5** ⇒ genres +1, creator +1.5). | must |
| REQ-403 | Señales de afinidad: `genres` (peso 2 por coincidencia) y `creator` (peso 3 por coincidencia). | must |
| REQ-404 | Exclusión: nunca recomendar ítems con entry propia (cualquier status) ni el propio candidato. | must |
| REQ-405 | Determinismo: mismo input ⇒ mismo orden (empates rotos por `titleNormalized` asc, luego `mediaId` asc). | must |
| REQ-406 | Explicación por ítem: "Porque te gustó {title}" con el título del item afinado de mayor peso. | must |
| REQ-407 | Resultado limitado a 20 ítems, con `scoreMatch` (0–100) y `reason` para UI. | must |
| REQ-408 | Sin afinidad suficiente ⇒ fallback a seed con mejor `avgRating` (y `reason: "Destacados del catálogo"`). | should |

## 2. Algoritmo (ALG-*)

| ID | Paso | Definición |
|---|---|---|
| ALG-01 | Entrada | `entries: Entry[]`, `catalog: MediaItem[]` (los candidatos ya cargados), `affinityThreshold = 8`. |
| ALG-02 | Afinidad | `genreAffinity: Map<genre, number>` y `creatorAffinity: Map<creator, number>`: por cada entry con `score >= 8` → `+2` por cada genre y `+3` por `creator`; entries `COMPLETED` sin score → mitad (`+1` / `+1.5`). |
| ALG-03 | Candidatos | `catalog` cuyo `mediaId` **no** tenga entry propia. |
| ALG-04 | Scoring | `match = Σ genreAffinity[g] (g ∈ candidate.genres) + creatorAffinity[c] (c = candidate.creator)`; `scoreMatch = clamp(round(100 * match / maxPossible), 0, 100)` donde `maxPossible = Σ valores máximos de las señales presentes en el candidato` (si `maxPossible = 0` → candidato excluido; `match = 0` → candidato excluido por ALG-07). Límites: `scoreMatch` siempre entero en 0–100 (casos borde: `match = maxPossible` ⇒ 100; `match` pequeño ⇒ ≥0). |
| ALG-05 | Orden | `match` desc → `titleNormalized` asc → `mediaId` asc (estable). |
| ALG-06 | Explicación | Ganador de la señal: `creatorAffinity[c] > max(genreAffinity[g])` ⇒ `"Porque te gustó {titleAfinado}"` refiriéndose a la entry de origen con mayor aporte; si no hay entry de origen (fallback) ⇒ `"Destacados del catálogo"`. |
| ALG-07 | Límite | Cortar a 20. Si `match = 0` para todos ⇒ fallback REQ-408. |
| ALG-08 | Coste | 1 lectura de entries (`listByMinScore` + `COMPLETED`) + 1 query de candidatos (`catalog` por tipo o seed); sin N+1. |

```typescript
type Recommendation = {
  item: MediaItem;
  scoreMatch: number;          // 0-100 entero
  reason: string;              // "Porque te gustó X" | "Destacados del catálogo"
  reasonSourceId: string | null; // mediaId de la entry afinada (null en fallback)
};

interface RecommendationService {
  getRecommendations(uid: string, opts?: { limit?: number }): Promise<Result<Recommendation[]>>;
}
// Puro testeable: recommend(entries, catalog, limit): Recommendation[]  (sin I/O)
```

## 3. UI (UI-*)

| ID | Componente | Detalle |
|---|---|---|
| UI-30 | Vista Recomendaciones | Grid de `MediaCard` (UI-01) + `reason` bajo la tarjeta; badge `scoreMatch` opcional. |
| UI-31 | Estado vacío | "Sigue valorando títulos con 8+ para recibir recomendaciones" cuando no hay afinidad. |
| UI-32 | Acciones | Cada tarjeta mantiene `Añadir`/`Cambiar estado`/`Asignar a colección` (REQ-107); al añadir, el ítem sale de la lista en el siguiente recálculo. |

## 4. Matriz de criterios de aceptación BDD (AC-*)

| ID | Given | When | Then | Cubre |
|---|---|---|---|---|
| AC-140 | Entry "X" score 9, genres `[Sci-Fi, Drama]`; catálogo con "Y" genres `[Sci-Fi, Thriller]` | `recommend` | "Y" aparece con `scoreMatch > 0` y `reason: "Porque te gustó X"` | ALG-02/04/06, REQ-406 |
| AC-141 | Entry "X" score 9, creator "A. Director"; "Y" mismo creator, géneros distintos | `recommend` | "Y" puntúa (aporte 3 > 0) y la razón cita "X" | ALG-03/04 |
| AC-142 | Entry "X" score 7 (umbral 8) | `recommend` | "X" no genera afinidad; sus genres/creator no suman | REQ-402, ALG-01 |
| AC-143 | Entry "X" `COMPLETED` sin score | `recommend` | Genera afinidad con peso 0.5 (genres +1, creator +1.5) | REQ-402 |
| AC-144 | Candidato "Z" ya tiene entry propia (`PLANNED`) | `recommend` | "Z" **no** aparece en el resultado | REQ-404 |
| AC-145 | Dos candidatos con el mismo `match` | `recommend` | Orden determinista: `titleNormalized` asc; repetir la ejecución ⇒ misma lista exacta | REQ-405, ALG-05 |
| AC-146 | Candidatos "B" y "A" empatados | `recommend` | "A" antes que "B" (alfabético normalizado) | ALG-05 |
| AC-147 | Entry con score 10 en "X" | `recommend` | `reason` contiene literalmente "Porque te gustó X" (título original, no normalizado) | REQ-406, ALG-06 |
| AC-148 | Sin entries ni afinidad, catálogo con seed | `recommend` | Fallback: top por `avgRating` desc con `reason: "Destacados del catálogo"` | REQ-408, ALG-07 |
| AC-149 | Sin entries y catálogo vacío | `recommend` | `{ ok:true, value: [] }` y UI-31 (no error) | REQ-408 |
| AC-150 | Catálogo con 50 candidatos elegibles | `recommend({limit:20})` | `length = 20` | REQ-407 |
| AC-151 | Misma fixture `entries + catalog` | Ejecutar `recommend` 2 veces | Resultados idénticos byte a byte (determinismo) | REQ-405 |
| AC-152 | Cero candidatos con `match > 0` y ≥1 entry con score ≥8 | `recommend` | Fallback a `avgRating` (sin razón "Porque te gustó") | ALG-07 |
| AC-153 | Usuario con 30 entries y 500 ítems en catálogo | `getRecommendations(uid)` con un `FakeCatalogRepository`/`FakeTrackingRepository` instrumentados con contador de lecturas | `reads ≤ 2` (1 query entries + 1 query candidatos), sin N+1 por ítem | ALG-08 |
| AC-154 | Candidatos con `match = maxPossible` y `match` muy pequeño | Cálculo de `scoreMatch` | `scoreMatch = 100` en el primer caso; nunca <0 ni >100; siempre entero (casos borde de ALG-04) | ALG-04, REQ-407 |
| AC-155 | Usuario no autenticado | `getRecommendations` | `permission_denied` vía repository (SEC-01), mensaje en español | SEC-01, API-05 |
