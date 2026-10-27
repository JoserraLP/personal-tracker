# ADR-097: Define the workouts' exercises

## Status
Accepted

## Date
2026-08-13

## Context

Issue #265 asks for
**four
improvements on the
Gym section** (issue
#62, ADR-095), all
focused on how the exercises are
defined inside the workouts'
constructor:

1. A
   **"Nuevo ejercicio" (New exercise)**
   button next to "+ Añadir ejercicio" that
   opens the
   Exercises tab's same
   exercise-creation
   window.
2. **Removing the
   «Otro (escribir nombre)…» option** from the
   constructor's exercises'
   dropdown.
3. A
   **"Duplicar serie" (Duplicate set)**
   button next to "+ Añadir serie" on
   each exercise block.
4. That when adding an
   **already previously worked**
   exercise, the
   sets get filled by default with the
   ones of the
   **last
   time** it got worked
   .

Branch
context: like ADR-096, this task
is
born
from
`feat/issue-62-seccion-gimnasio` (the section and the
ADR-095 are not yet in the
`dev`; the
PR
#262 pending integration). The
 #265's branch merges into that intermediate branch, so this ADR arrives at the
 `dev` together with the whole section; that's why the serial number continues after
 the
 ADR-096 (on the repo there are historical ADR's duplicates, e.g.
 two
 `adr-094`s, that's why the next
 number gets calculated as the
 existing
 maximum + 1).

The implementation is validated (a
QA PASS against the task
file's acceptance criteria: the buttons and the
pre-fill verified, the 360/768/1280 px responsiveness and the
four theme modes per the
2 and 4 rules of AGENTS.md) and the
user manual updates on this very
task (rule
3 of AGENTS.md, the
§9.1). This ADR
documents the decision retrospectively, like the recent ones
(the
ADR-093, ADR-094, ADR-095, ADR-096).

### A
 n iteration (a
  comment of 2026-08-13)

The issue received a
follow-up comment with two new
requests, incorporated on the same PR:

1. **Labels on the weight and reps'
  boxes**: the workout
  constructor's sets'
  table adds a
  **column-header** (the
  `.gym-series-row--head`, with the
  «Peso (kg/lbs)» and the
  «Repeticiones»)
  using the rows' same grid, so it is clear which box is each one. The
  weight's label reflects the active unit. The
  header is excluded from the
  form's readability with the
  `:not(.gym-series-row--head)` (an
  initial
  version without the
  `:not` broke the sets' sync: a
  TypeError when reading
  the
  `value` of
  the
  spans; a
  QA-detected error
  , fixed).
2. **A kg/lbs dropdown on the workout
  modal**: the workouts'
  create/edit
  form incorporates a "Unit of
  weight" selector (the
  `#gym-wk-unit`) **bidirectionally
  synchronized** with
  the
  section's global one (the
  `#gym-unit-select`): when changing either of them, it
  persists with the
  `setUnit` (the
  kg/lbs whitelist) and re-renders
  everything showing weights (the
  `renderAllWithUnit`), converting
  the
  sets
  from the
  kg-canonical
  draft. Before
  re-rendering, the
  draft syncs
  with the
  typed
  content, to not
  lose
  mid-writing values.

Related issue: #265 — https://github.com/gonzalitojh/Registro-personal/issues/265

## Decision

### 1. The "Nuevo ejercicio" button: it reuses the Exercises tab's modal

Next to
"+ Añadir ejercicio", the
**"Nuevo ejercicio"** is added on the
same row (the
`.gym-block-button-row`, with a
line break on narrow
screens). On
pressing, the
**`openExerciseModal()`, the SAME exercise-creation modal
as the Assess-exercises tab** opens
, without
closing the workout
modal: on saving
the new exercise, the catalog updates (a
live
`db.js` subscription) and the user
selects it on
the constructor's dropdown. The
empty
catalog's «Ver catálogo de ejercicios»
  hint's same pattern: a
single source of truth for the
exercises'
creation (the
ADR-095, the
`js/gym.js`).

### 2. The removal of «Otro (escribir nombre)…» with a legacy compatibility

The
**`value="__custom__"`** option is removed
from the constructor's exercises'
dropdown
(and with
it, the free-name
input and the
`customSelected`
branch
of
the
sync logic). The catalog becomes the
**only
way** to define a workout's
exercises, closing
the
  `null` + name's double
data
representation that ADR-095 had anticipated.

**The compatibility with old data** (workouts saved before with the
`exerciseId: null` and a
name
snapshot):

- The block shows
  the
  **name snapshot as the select's placeholder** (instead of
  «Elige un ejercicio…») to not
  lose
  the reference.
- The
  `syncWorkoutDraftFromDom` **keeps the
  draft's name
  fallback** (the
  `workoutDraft.exercises[idx]?.nombre`) when
  the select does not find the exercise in the
  catalog; on saving, the legacy
  workout keeps
  its name
  unaltered.

### 3. The "Duplicar serie" button

On each exercise block, next to "+ Añadir serie", the
**"Duplicar serie"** is added: it
clones the
**block's last set** (the weight in kg and the reps)
adding it
at the end and returns the focus to the
new row. If
the block has no
set at all, it shows an
alerting
**`showToast`** («No hay ninguna serie que duplicar.»)
without
creating empty rows. A
real
use case: the progressive sets,
where
the next set starts from the previous one with a
minimal
adjustment.

### 4. The last
  session's sets'
  pre-fill

When
**selecting on the constructor a catalog exercise that got
worked before**, its
sets get seeded with the
ones of the
**last
time** (the most recent workout
by the
`fechaISO`), so
only
they need
adjusting. The implementation's rules:

- **A no-extra-query data source**: the
  `workouts` already arrive sorted
  desc by the
  `fechaISO` of
  the
  `db.js`'s
  `orderBy("fechaISO","desc")` subscription
  (the
  ADR-095); the
  `lastWorkoutSeriesForExercise()`
  walks the
  in-memory array and returns a
  `{pesoKg, reps}`
  copy of
  the
  first
  occurrence
  with sets.
- **A canonical match by the
  `ejercicioId` with a
  strict priority**; for the
  no-id legacy data (the pre-«Otro…'
  removal
  workouts) there is
  a
  **normalized snapshot-name fallback** (trim + lowercase),
  used only if no workout has a
  canonical
  entry of
  that exercise (so a
  legacy entry of the same
  name on
  the
  most
  recent workout never beats the canonical
  one).
- **Only if the block has no sets yet** (the
  `entry.series.length === 0`):
  it does not
  step on anything already written nor on a
  workout's sets being
  edited; if there are no previous
  sets or no match, it does nothing
  .
- **The data stays kg-canonical**: the draft
  ALWAYS stores
  the
  `pesoKg`; the presentation unit
  (the kg/lbs) converts only on the render
  (the
  ADR-095), so the
  pre-fill is agnostic to the
  active
  unit.

## Rejected alternatives

- **An embedded/duplicated exercise modal inside the constructor**: rejected — it would duplicate
  the Exercises tab's modal's markup and
  logic, creating two
  creation
  sources of truth; reusing the
  `openExerciseModal()` (a
  pattern already used by the empty-catalog
  hint) is coherent and has no
  cost, and the workout
  modal stays open with the draft
  intact.
- **Keeping «Otro…» hidden (but in the code)** or
  **replacing it with a free-text field**:
  rejected — the
  issue asks to remove it; with the
  "New exercise" the
  use case stays
  covered and the model's duality ends (the
  `ejercicioId` vs the
  `null` + a name), simplifying the
  sync logic and the
  pre-fill.
- **A pre-fill with an extra Firestore query** (e.g.
  per exercise): rejected — the
  `workouts` is already subscribed and
  sorted
  desc by the
  `fechaISO`; an extra query would add
  latency, an
  async
  state and
  read
  costs
  without a
  benefit (the subscription already has the whole history in
  memory).
- **An unconditional pre-fill when selecting an exercise** (stepping on what's
  written): rejected — it would overwrite
  already entered
  sets and the
  in-edition
  workout's ones; the
  `entry.series.length === 0` guard
  only seeds the empty
  blocks, which is the
  case the issue asks to
  cover.
- **Duplicating by a fixed index or with a set selector**:
  rejected — the "immediately previous set" is the
  block's
  last one (the just-filled one), so no
  selection is needed; a selector
  would add
  valueless UI and the last one's duplicate covers the
  progressive sets.

## Consequences

### Positive

- **Creating an exercise without leaving the workout**: a
  single source of truth (the
  Exercises modal) and
  zero risk
  of losing the
  open workout's draft.
- **A simplified data model**: the catalog is the only
  way to define exercises; the
  legacy data (a
  `null` id + a
  name snapshot)
  survives and stays
  editable with no reference
  loss.
- **Less typing and fewer transcription errors**: the
  duplicated sets and the last
  session's pre-fill with the
  real
  stored
  weights (the canonical
  in kg, with no
  conversion roundings).
- **Offline-first and with no extra cost**: the pre-fill uses the
  already subscribed
  in-memory data; there are no new
  queries nor
  latency.

### Neutral

- **The pre-fill only applies when selecting an exercise for the first time on the block**: when editing
  an existing workout (the sets already present) or after
  manually typing, it does not
  interfere.
- **The legacy match by a
  normalized name may miss** if the
  exercise got
  renamed after
  the workout getting
  stored: in
  that case it
  simply does not pre-fill (a
  degraded behavior,
  not
  an
  erroneous one).
- **Revalidated on iteration** (the
  session's
  resume): a
  QA PASS and a
  security scan with no
  findings. An improvement got applied on
  the
  pre-fill's match — the
  canonical
  `ejercicioId`'s
  strict priority against the
  name-based
  fallback — and this ADR updated accordingly (before, the
  fallback could win inside the same workout if the
  legacy entry appeared earlier in the array; a
  minimal
  impact, fixed on revision).
- **The user manual updated** (the
  §9.1): the
  "New exercise" and the
  "Duplicate set"
  buttons, the pre-fill's
  behavior, the
  sets'
  table's labels and the
  modal's
  unit selector documented (the
  AGENTS.md's rule 3).

### Negative / Risks

- **`fechaISO` ties between workouts**: if there are several
  workouts with the same
  date, the
  order
  between them is not
  guaranteed by the
  subscription (just
  the
  `fechaISO` desc criterion); the
  pre-fill might take
  a workout
  different
  from
  the
  actually last one. A
  low impact: the same
  day, similar results and always
  reviewable, and the
  `ejercicioId` guard is stable for the
  rest of
  the cases.
- **The pre-filled weights are indicative**: if
  that day the
  user changed the load, they must adjust it; the
  pre-fill never steps on already written sets, so the
  data-loss risk is null.
- **No other known ones.**
  Validated: a
  QA PASS
  (the task file's AC1–AC4, the responsiveness and the four theme
  modes) and the code continues
  the
  section's rest's validation and security
  pattern (the
  ADR-095). The iteration re-validated the original
  criteria and the two
  new
  ones (the labels and the
  synchronized
  unit selector) after a
  QA fix (the sync's
  TypeError by the header, resolved with the
  `:not`), with a
  security scan with no
  findings.

## Created/modified files

| File | Change |
|---------|--------|
| `js/gym.js` | **Modified**: the
  "New exercise" button (it opens the
  `openExerciseModal()` without closing the
  workout modal), the removal of
  «Otro…» (the
  `__custom__`) with the legacy name's placeholder, the
  "Duplicate set" button (the last set, a
  `showToast` if there is none), the
  sets' pre-fill (the
  `lastWorkoutSeriesForExercise()` / the
  `maybePrefillSeriesFromLastWorkout()`) with a match by the
  `ejercicioId` and a name-based fallback; **the iteration**: the
  Weight/Reps labels' header (the
  `.gym-series-row--head`) is excluded from
  the
  sync with the
  `:not(...)`, the
  `#gym-wk-unit` selector on the modal
  synchronized with the
  `#gym-unit-select` (a before-sync
  of
  the
  draft to not lose the typed values) |
| `css/styles.css` | **Modified**: the
  `.gym-block-button-row` (the
  "add/new" and "add/duplicate" buttons' row with a
  break on narrow screens; with no
  theme overrides: it reuses the
  `.btn` and the
  `.gym-add-series-btn`, already covered in the four families); **the iteration**: the
  `.gym-series-row--head` (the labels' header, the rows' same grid, the
  `var(--ink-soft)`) covered in the four families) |
| `docs/manual-de-usuario.md` | **Modified**: the §9.1 — the
  "New exercise" and the
  "Duplicate set"
  buttons, the last session's sets'
  pre-fill and the
  sets'
  table's labels; the §9.3 — the
  modal's unit selector synchronized with the section's one |
| `docs/adr-097-ejercicios-entrenos.md` | **New**: this document |

Related issue: #265 — https://github.com/gonzalitojh/Registro-personal/issues/265
