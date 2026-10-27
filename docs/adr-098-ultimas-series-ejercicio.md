# ADR-098: The exercise's last sets on the catalog's detail view

## Status
Accepted

## Date
2026-08-13

## Context

Issue #270 asks
that
on the
**«Ejercicios»**
tab, the
**sets
got shown on the
exercise's
detail (read
mode) of
the
catalog** that were
done the
**last
time** that
exercise got
worked
. Until
now the detail only
showed a
name, a
muscle
group and
notes: the user that wanted to
resume
an exercise with the
same loads
had to
open the corresponding workout
looking
for the most recent
session.

The base already
solved half
the
problem: the workout
constructor's pre-fill
(#265, ADR-097) locates
the
last-time
sets through the
`ejercicioId` match with a
legacy
name-based
fallback; this issue **carries
that same information to the
catalog's detail**, so the
user sees it
without opening any
workout.

Branch
context: like ADR-096 and ADR-097, this task
is
born
from
`feat/issue-62-seccion-gimnasio` (the section and the
ADR-095 are not yet
in the
`dev`; the
PR
#262
pending integration). The #270's branch
merges into that intermediate branch, so this ADR arrives at
the
`dev` together with the whole section; that's why the
serial number continues after
the
ADR-097 (on the
repo there are historical ADR's
duplicates, e.g.
two
`adr-094`s and
two
`adr-093`s, that's why the next
number gets calculated as the
existing
maximum + 1).

The implementation is validated (a
QA PASS against the
task
file's acceptance criteria, the
360/768/1280 px responsiveness and the
four theme
modes per the
2 and 4 rules of the
AGENTS.md) and the user manual updates on this very
task (the
AGENTS.md's rule 3, the
§9.2). This ADR
documents the decision retrospectively, like the recent ones (the
ADR-093, the
ADR-094, the
ADR-095, the
ADR-096, the
ADR-097).

Related issue: #270 — https://github.com/gonzalitojh/personal-tracker/issues/270

## Decision

### 1. The «Última vez» (Last time) section on the exercise's detail

The exercise's read
mode (the
`exerciseDetailHtml(ex)`) incorporates a
**«Última vez»**
section that shows:

- the
  **date** of
  the most recent workout where the exercise got
  worked, formatted with the
  `ctx.formatDateEs` (with a
  fallback to the raw ISO if
  the formatting does not
  produce text);
- its **sets'
  table** (the weight × the reps) in
  the
  **active
  presentation unit** (the
  kg/lbs): each row is a
  pair of
  `spans` with
  the
  `kgToDisplay(series.pesoKg)` + the
  `unitLabel()` and the
  reps`, reusing
  the
  `.gym-series-table`/`.gym-series-row` classes already existing on
  the
  section (the
  ADR-095/097), with no new CSS nor new
  listeners (they
  are already covered in the four theme
  modes).

**It only renders if there is previous
data**: if the exercise never got
worked (the
`lastWorkoutForExercise`
returns a
`null`), the section does not
appear at all.

### 2. The match's refactor: the
  `lastWorkoutForExercise()`

The
`lastWorkoutSeriesForExercise()` function
(#265, the constructor's
pre-fill) gets refactored to a
**`lastWorkoutForExercise(exerciseId, nombre)`**, which now
returns
**`{ fechaISO, series } | null`** (with the
`series` as a
`{pesoKg, reps}`
copy), keeping exactly the
same match logic:

- it walks
  the
  `workouts`, which already
  arrive **sorted by the
  `fechaISO` desc** from
  the
  `db.js`'s
  `orderBy("fechaISO","desc")` subscription
  (the
  ADR-095);
- **the canonical
  `ejercicioId` match's
  strict priority**: the
  first
  entry with sets of
  that exercise wins
  and returns;
- **a legacy
  normalized snapshot-name fallback** (a
  trim +
  lowercase) only if no workout has a
  canonical
  entry of
  that exercise, for the
  old no-id data.

The pre-fill's call-site (#265) adapts to the new
contract (the
`prev.series` instead of the
direct
set); the detail uses
the
same function, so
**both views
share
a single source of truth** for
"the last
time".

### 3. With no extra Firestore queries

The
«Última vez»
section feeds from the
**already subscribed
in-memory state** (the
`workouts` sorted
desc), identical to the
pre-fill
(ADR-097): there are no extra
queries, latency nor new read
costs; the render is sync within the modal.

## Rejected alternatives

- **An empty "No previous
records" heading when there is no history**: rejected — it would add visual noise on new catalogs, where almost no exercise has got worked yet; the section's absence communicates the same thing without noise.
- **A sibling function for the
  detail that would duplicate the match loop**: rejected — it would create two sources of truth for "the
  last time" with a
  divergence risk; the existing function's refactor (#265) to also return the
  `fechaISO` solves
  both
  uses with a single
  implementation.
- **An extra Firestore query** (e.g. per
  exercise): rejected — the
  `workouts` is already subscribed and
  sorted desc by the
  `fechaISO`; an extra query would add latency, an async state and read costs without
  a benefit, the same argument already
  documented in
  the
  ADR-097.

## Consequences

### Positive

- **Seeing with
  which loads the last session ended without opening the
  workout**: the exercise detail answers the issue's question at a
  glance, with the date and the sets'
  table in the active unit.
- **A single match source of truth**: the
  constructor's pre-fill (#265) and the
  catalog's detail (#270) share
  the
  `lastWorkoutForExercise()`; the
  refactor adds the date to the contract without
  touching the already validated matching logic.
- **Offline-first and with no extra cost**: the section uses the already subscribed in-memory data; there are no new queries nor latency.
- **No new surface to maintain**: the
  existing read classes get reused, already covered in the four theme modes, with no extra CSS nor listeners.

### Neutral

- **An exercise's rename does not break the canonical match**: the
  strict `ejercicioId` priority always prevails; the name-based fallback only
  applies to the no-id legacy data (and may miss if the exercise got renamed after the workout got stored: a degraded behavior, not an erroneous one, already documented in ADR-097).
- **An exercise's detail with many previous sets grows**: the
  table shows all the last session's sets, but the modal is already a scroll container (the
  `.modal__card` with the
  `max-height: 88vh` and an
  `overflow-y: auto`), so the content never gets cut.
- **The section only appears with history**: on new catalogs or with never-worked exercises the detail stays identical to before.
- **The user manual updated** (the
  §9.2): the read
  mode's «Última vez»
  section documented (the
  AGENTS.md's rule 3).

### Negative / Risks

- **`fechaISO` ties between workouts**: the same risk already documented in ADR-097 for the pre-fill — if there are several workouts with the same date, the order between them is not guaranteed by the subscription (just the `fechaISO` desc criterion) and the section might
  show
  a workout
  different
  from the actually
  last one. A
  low impact: the same day, similar results and always reviewable, and the `ejercicioId` guard is stable for the
  rest of the
  cases.
- **No other known ones.**
  Validated: a QA PASS (the task file's criteria, the responsiveness and the four theme modes) and the code continues
  the
  section's rest's validation and security pattern (the ADR-095).

## Created/modified files

| File | Change |
|---------|--------|
| `js/gym.js` | **Modified**: the
  `lastWorkoutSeriesForExercise()`'s refactor (#265) into
  a
  `lastWorkoutForExercise(exerciseId, nombre)` returning
  `{ fechaISO, series } \| null` (a
  `{pesoKg, reps}`
  copy) with the same match logic (the
  canonical by
  the
  `ejercicioId`, the legacy name-based fallback); the
  pre-fill's call-site adapted to the
  `prev.series`; the
  `exerciseDetailHtml()` adds the
  «Última vez»
  section (a date with the
  `ctx.formatDateEs` and a
  `.gym-series-table`/`.gym-series-row`
  table with
  `spans` in the active unit; it only renders if there is history) |
| `docs/manual-de-usuario.md` | **Modified**: the
  §9.2 — the read
  mode's «Última vez»
  section (the date and the sets'
  table of the most recent workout, in the active weight unit; it does not
  appear on new exercises) |
| `docs/adr-098-ultimas-series-ejercicio.md` | **New**: this document |

Related issue: #270 — https://github.com/gonzalitojh/personal-tracker/issues/270
