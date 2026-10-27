# ADR-095: The Gym section (issue #62)

## Status
Accepted

## Date
2026-08-13

## Context

Issue #62 asks for a
**new
gym
section** with its own
`/gimnasio`
endpoint, included in the
navigation
sidebar
(like
the Ocio and Recetas), to
**log
workouts**, to
**log
each exercise's weights and reps** and to
**log
exercises**. It also asks to
**switch weights between
lbs and kg at any moment**, to research whether an
exercises'
API exists
to pull
information from, and to document
any extra useful idea in detail. The rest of the
sections'
conventions must be respected
(the
top
bar, the hideable
tabs in Settings, the
responsiveness and the
four theme
modes).

Precedents fixing
 this section's pattern:

- **Recetas**
  (issue #64, ADR-076/ADR-078/ADR-087):
  a
  top
  level
  **sister
  view
  of the
  profile-view and outside
  the
  `#app`**, with its own
  `nav.tabs--bar` (the same
  class as Ocio's) and with no back
  button nor title
  (issue #206, ADR-077):
  the navigation lives in the global
  header.
- **The sections and tabs'
  hiding**
  (issue #97, ADR-067):
  the
  `SECTION_REGISTRY` in the
  `js/settings.js` is the
  central
  registry
  feeding the
  visibility
  settings.
- **The hash
  router**
  (ADR-051) with
  per-section
  memories (the
  `lastOcioKey`, the
  lastRecipesTab) and of the
  last
  top-level
  section
  (the `lastSection`, issue
  #213),
  which the profile's
  back
  arrow uses
  .
- **The header/tabs'
  auto-hiding**
  (the
  ADR-060, ADR-094):
  a
  single source of truth
  in the
  `js/auto-hide-nav.js` with
  the
  generic
  selectors over the
  body
  and a
  resolution of
  the
  active panel per
  view
  .
- **The Recipes'
  dropdown
  unit of measure**
  (issue #251, ADR-092):
  a
  unit-selector
  precedent with the same
  conversion
  and
  presentation rules.

The implementation is validated
  (
  a
  QA PASS: 2
  rounds — the first detected a
  H1
  contrast in pure
  black,
  the name being
  a
  snapshot when edited and the
  constructor's refresh; all
  fixed in commit
  `67b2136`) and
  scanned
  (a
  security
  PASS,
  0
  HIGH
  findings); the user manual updates in this very
  task
  (the
  AGENTS.md's rule 3).
  This ADR
  documents
  the decision
  retrospectively,
  like the recent ones
  (the
  ADR-093, ADR-094).

Related issue: #62 — https://github.com/gonzalitojh/personal-tracker/issues/62

## Decision

### 1. The
  top-level
  "Gimnasio"
  section, the
  Recipes' sister

- **Its own
  `#gym-view`
  view**
  outside
  the
  `#app`
  (the
  `#recipes-view`'s same pattern):
  when visible,
  the
  `#app`
  stays hidden;
  there is no back
  button nor title;
  the navigation lives in the global
  header (issue #206).
- **Its own
  Ocio-styled tab
  bar**
  (a
  `nav.tabs--bar`
  with the
  common class of ADR-078):
  **«Entrenos»**
  (the
  default tab, a
  **teal**
  accent) and
  **«Ejercicios»**
  (an
  **ochre**
  accent). Both hideable from
  Settings via
  the
  `SECTION_REGISTRY`
  (issue #97).
- **The
  "Gimnasio" entry on the
  sidebar**
  (the
  `js/sidebar.js`) with
  its
  icons, which opens
  the
  section returning to
  the
  session's last tab
  (the
  `getLastGymTab()`).
- **The
  extended
  router**
  (the
  `js/router.js`):
  the
  `#/gimnasio`
  route
  (Workouts)
  and the
  `#/gimnasio/ejercicios`;
  the
  `GYM_TAB_TO_PANEL`, the
  `gymHashFor()`, the
  `lastGymTab`
  and the
  `lastSection = "gimnasio"`
  (the
  profile's back
  arrow also returns to
  the
  Gym). The tabs'
  wiring stays
  scoped to
  the
  `.tab[data-panel]` in
  the
  `app.js` and the
  Gym's use
  an
  exclusive
  `data-gym-tab`
  (avoiding
  the collision with
  Ocio
  and Recipes).

### 2. The
  Firestore
  data model

- **The
  `users/{uid}/gym-workouts/{id}`**
  (the
  workouts):
  a
  `fechaISO` (a
  `YYYY-MM-DD`
  string,
  desc
  sort),
  a
  `nombre?`, a
  `nota?`,
  the
  `exercises: [{ exerciseId|null, nombre
  (the
  snapshot), series: [{pesoKg, reps}] }]`,
  the
  `addedAt`/`updatedAt` (the
  serverTimestamp). The
  **name is a
  snapshot**: if an
  exercise gets deleted
  from the
  catalog,
  the workouts
  using it keep
  its
  name.
- **The
  `users/{uid}/gym-exercises/{id}`**
  (the
  exercises'
  catalog):
  a
  `nombre` (an
  asc
  sort), a
  `muscleGroup?` (the
  presets), the
  `notas?`,
  the
  `addedAt`/`updatedAt`.
- **The
  weight is canonically ALWAYS in kg**
  (the
  `pesoKg`):
  the presentation unit is never
  stored on the
  documents.
- **The
  `firestore.rules`**:
  the other collections' same standard pattern — a
  read for any
  authorized user
  (the
  `isAllowedUser()`, the
  friends'
  logs), the
  write only
  by the
  owner
  (the
  `isOwner`).

### 3. The
  weight unit
  (the
  kg/lbs)
  is presentation-only

- The
  **`settings.unidadPeso`**
  preference
  (a
  `"kg"` |
  `"lbs"`)
  in the
  localStorage, with
  a
  **sync
  to Firestore**
  (the profile's
  preferences, the same debounce as the
  rest of the
  settings) so it
  syncs
  between devices.
- The
  **1 kg = 2.20462 lbs**
  conversion (the
  `KG_PER_LB`);
  the display with
  **1
  decimal** and the
  entry → kg with
  **2**.
  The
  stored
  values **never change** when
  toggling: the conversion
  happens only on the renders
  (the
  lists, the workout's
  detail, the
  forms and
  the
  weights'
  inputs'
  placeholders).
- **The
  `#gym-unit-select` select** on
  the
  `.gym-units`,
  visible in the whole section
  (beneath the tab bar). On
  change: the active tab's and the open workout's
  modal's re-render
  (a
  reading or edition, from the
  in-memory draft,
  which is always
  in kg).

### 4. The
  exercises' APIs research
  and the
  v1
  catalog

The plan's research's
**real** findings:

- **The
  wger API v2** — free, with no
  read
  key, open
  CORS, ~845
  multilingual
  exercises
  (Spanish included), an
  open-source AGPL, self-hostable.
  **The
  nº1 candidate for a
  future
  iteration**.
- **ExerciseDB**
  (RapidAPI) — it requires a key and a
  CORS proxy: **discarded on
  v1**.
- **The
  API Ninjas' Exercises** — they
  require a key:
  **discarded**.
- The
  marcmayol.com's
  static exercise-api — a
  static bilingual
  ES/EN
  JSON, with no
  key, a
  `*`
  CORS, ~104
  exercises:
  **interesting for a
  future
  offline
  seed**.

**The v1
  decision**: an
  **own manual
  catalog**
  (offline-first, with no
  dependencies nor
  rate limits, coherent with the
  ingredients'
  catalog and Recipes'
  own
  tags), with the future
  integration **documented**:
  a
  wger
  search
  with the form's
  prefill and a
  fallback to the own
  catalog.

### 5. The v1 scope (out of scope, documented)

- **The Gym's global
  search**:
  out of scope; the
  `js/global-search.js`'s
  mandatory
  guard returns
  late
  on the
  section
  (it does not fall to the Ocio branch
  nor mix
  foreign
  collections) and the
  placeholder says "Search in your
  gym...".
- **The export/backup
  without the Gym**:
  coherent with the
  own-log
  family's rest
  (Recipes is not
  included either);
  documented as a
  future
  improvement (expanding
  the
  backup).
- **No new
  dependencies**
  (neither
  libraries
  nor
  APIs).

### 6. The autonomous decisions
  (the headless session)

- The
  accents (the
  labels/captions):
  **Workouts = teal**, **Exercises = ochre** (reusing the
  existing theme variables, with no hardcoded colors outside
  the documented stamps).
- The
  "Workouts" label for the
  workouts
  tab.
- The
  muscle
  groups:
  a
  **select with presets** (the
  Chest, Back,
  Shoulders, Biceps,
  Triceps, Forearms
  , the
  Legs, Glutes,
  Core, the
  Cardio, the whole body) + "**Other**"
  (a
  free
  text).
- A
  **native `confirm()`** for the
  workouts'
  and the
  exercises'
  delete
  confirms
  (coherent with the section's simplicity).
- **The unit's
  sync
  to
  the
  Firestore** (the
  profile's
  preferences).
- **The
  user manual
  renumbered**: the
  chapter
  9 inserted with the
  rest renumbered
  (the precedent: Recipes inserted as the
  chapter
  8
  too).

### 7. The
  documented future
  ideas

The total
  volume per workout, the personal
  records/
  1RMs, the per-exercise history with a chart, a weekly
  summary,
  the
  routine
  templates, a
  muscle-group search/filter, the
  wger
  integration
  (a
  search
  with the form's
  prefill and a
  fallback to the own
  catalog), expanding
  the backup to the whole
  own-log
  family, a
  rest
  timer
  and
  workout
  reminders
  .

## Rejected alternatives

- **Integrating an exercises'
  API on v1**:
  rejected — all the researched options (the ExerciseDB, the
  API Ninjas) require
  a
  key and/or a
  CORS proxy; the
  wger is the
  best candidate but would add a
  dependence and a network
  latency for a
  catalog the
  user will
  customize. The
  manual
  catalog is offline-first, with
  no
  rate limits and coherent with the
  ingredients/tags. The
  integration
  is documented as a
  future
  iteration (the
  ADR-065 and ADR-074 mark
  the
  "study → the decision's ADR"
  precedent).
- **Storing the
  weight in whichever
  unit is chosen at
  each
  moment**:
  rejected — it would
  break the history
  if the unit were
  toggled; the
  canonical
  kg
  with a presentation-only conversion
  is the standard.
- **A unit
  select only on the workout's
  form**:
  rejected — the issue asks to change
  it "at any moment"; the
  section's
  select (visible always) with a global re-render guarantees it.
- **A view inside the
  `#app`**
  (as just another
  Ocio tab):
  rejected — the issue asks for a top-level section
  sister of
  the
  Ocio/Recipes, with its own tab bar.
- **The Gym's global
  search on v1**:
  rejected — with no
  search scope defined; the
  `global-search.js`'s
  guard avoids falling to the Ocio
  branch (the wiring's key
  risk).

## Consequences

### Positive

- **Total section-pattern
  consistency**: the global
  header, the
  Ocio-styled tab bar (the
  ADR-078), hideable
  in Settings
  (the
  ADR-067), the scroll
  auto-hiding
  (the
  ADR-060/ADR-094 with the
  `.gym-toolbar` on the
  `CONTROLS_SELECTOR`), the hash
  router
  with memories
  (the
  ADR-051), the
  shareable direct
  routes (the
  `#/gym`,
  the `#/gym/exercises`).
- **Robust data**: the
  canonical
  weight
  in kg
  (the unit being presentation-only), the
  workouts'
  name
  snapshot (it
  survives the catalog's
  delete), the realtime
  sync
  with a
  backoff
  retry (issue #147's
  pattern).
- **Offline-first**: the manual
  catalog works
  with no
  network or external dependencies.
- **The manual up to date**
  (the
  AGENTS.md's rule 3): the
  chapter 9
  "Gym"
  inserted and the other
  chapters renumbered.

### Neutral

- **The header's search finds nothing in the Gym on v1** (the
  `global-search.js`'s
  guard; the
  "Search in your gym..." placeholder);
  the manual honestly indicates it.
- **The backup does not include the Gym** (nor
  Recipes):
  a documented future improvement.
- **The ADR-092 remains a complementary precedent**
  (a unit of measure in Recipes); this ADR extends the concept to the
  gym
  weights.

### Negative / Risks

- **None known.**
  Validated: a
  QA PASS
  (2 rounds;
  the
  AC1–AC9 met) and a
  security PASS
  (0
  HIGH
  findings; 3
  LOW
  informative
  of pre-existing patterns). The four theme
  modes verified
  (the
  ADR-009/ADR-064/ADR-066) and the
  responsiveness
  (the
  360/768/1280 px with no horizontal scroll). The
  wiring of the
  `.tab`
  stays scoped to
  the
  `.tab[data-panel]` avoiding the Ocio/Recipes
  collision; the
  `applyTabVisibility` only adds the
  `hidden`
  (never
  removing it) and the
  `gymApi` is created
  before
  the
  `initRouter`
  (with no
  TDZ).

## Created/modified files

| File | Change |
|---------|--------|
| `index.html` | **Modified**: the `#gym-view` view (the tabs' bar with the `data-gym-tab`, the `.gym-units #gym-unit-select` select, the Workouts/Exercises panels with their toolbars), the `#gym-workout-modal` and `#gym-exercise-modal` modals; the title/description updated |
| `js/gym.js` | **New**: the section's module (the Workouts/Exercises tabs, cards with the "N exercises · M series" summary, the workout's reading/create/edit modal with the exercises' and the series' constructor, the exercise modal, the kg/lbs conversion with a global re-render) |
| `js/router.js` | **Modified**: the `GYM_TAB_TO_PANEL`, the `GYM_DEFAULT_TAB`, the `GYM_PREFIX`, the `gymHashFor()`, the `getLastGymTab()`, the `lastSection = "gym"`, the `#/gimnasio` route on the `parseHash`/`canonicalHashFor` |
| `js/settings.js` | **Modified**: the weight unit on the default settings, the `SECTION_REGISTRY.gym` (the workouts/exercises tabs), the `getUnit()`/`setUnit()` with the Firestore sync |
| `js/sidebar.js` | **Modified**: the "Gym" entry with its icon and returning to the last tab |
| `js/app.js` | **Modified**: the `setupGym`/`subscribeGymData`/`resetGymData` wiring, the router's `route.section === "gym"` branch with a hidden-tab normalization, the `.tab[data-panel]` scoped to Ocio |
| `js/db.js` | **Modified**: the `subscribeToGymWorkouts`, the `addGymWorkout`, the `updateGymWorkout`, the `deleteGymWorkout`, the `subscribeToGymExercises`, the `addGymExercise`, the `updateGymExercise`, the `deleteGymExercise` |
| `js/ui.js` | **Modified**: the gym section's search'
  placeholder and aria-label ("Search in your gym...") |
| `js/global-search.js` | **Modified**: the gym section's guard
  (no v1 results) and its own search hint |
| `js/auto-hide-nav.js` | **Modified**: the `activePanel()` resolves
  the
  `#gym-view .gym-view__body section:not(.hidden)`; the `.gym-toolbar` is in the
  `CONTROLS_SELECTOR`; the `MutationObserver` watches
  the
  `#gym-view`
  and its
  panels |
| `service-worker.js` | **Modified**: `js/gym.js` added to the `STATIC_ASSETS`
  (the precache) |
| `css/styles.css` | **Modified**: the section's styles (the cards, the catalog, the constructor, the modals, the `.gym-units`) with grouped overrides for the four theme families (the light/white and black ones) |
| `firestore.rules` | **Modified**: the `match /gym-workouts/{itemId}` and the `match /gym-exercises/{itemId}` with the standard pattern
  (the read is `isAllowedUser`, the
  write is `isAllowedUser && isOwner`) |
| `docs/manual-de-usuario.md` | **Modified**: the chapter 9 "Gym" inserted and the chapters renumbered (the
  §3, §3.2,
  §§9-§20 → the
  §§10-§21, the
  §16 Settings with the new section) |
| `docs/adr-095-seccion-gimnasio.md` | **New**: this document |

Related issue: #62 — https://github.com/gonzalitojh/personal-tracker/issues/62
