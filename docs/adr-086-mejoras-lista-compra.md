# ADR-086: Shopping list improvements — multi-week, packages and swipe deletion (issue #225)

## Status
Accepted

## Date
August 2026

## Context

Issue #225 asks for three
improvements to the Recipes section's
**«Lista de la compra»** tab (issue #64), built in ADR-076/ADR-080/
ADR-082 and given its pill
aesthetics in
ADR-084:

1. **Selecting several weeks**
   at once, summing the selected
   weeks' total
   ingredients
   (before it only computed the
   active
   menu's
   week).
2. **Package
   quantities**: if the
   catalog's
   ingredient (`users/{uid}/ingredients`)
   has a
   stored package's quantity and
   unit
   (issue #224's
   fields
   `paqueteCantidad`/`paqueteUnit` from PR
   #227, **still
   unmerged**), compare
   and
   show the
   quantity
   in packages rounded
   up — 550 g with a
   1 Kg package →
   1 package;
   2,5 Kg →
   3 —, and
   allow the
   user to
   **adjust that
   quantity** (e.g.
   saving a
   package or
   buying
   more
   than
   needed) with
   persistence.
3. **Deleting an
   item by
   swiping it
   left**, with
   undo.

Previous state: the
   list computed
   from the
   menu's
   active
   week (each
   ingredient scaled
   by din
  ers
   and
   applied the
   `excludedFromShoppingRecipes`
  exclusions), always showed the needed
  quantity
   in
   units, and
   items could not be
   deleted (only marked bought). Extra
   items already lived in the
   week's
   menu document (the
   `extraItems`).

Workflow: the work branch
 is created
 from
 `content/issue-64-seccion-recetas` and
 the PR goes
 **also to that branch, not to
 `dev`** — a
 one-off exception to AGENTS.md §1's
 PRs-against-`dev` rule, explicitly requested
 by the user, like in the
 section's previous
 issues.

Numbering: on the base branch
 the
 ADRs reach
 083; the 084 is
  used by
 the
 issue #221 PR (the
 shopping
 list's aesthetics) and
 the
 085 by
 issue
 #224's PR
 (the Ingredients
 tab's improvements, introducing the
 package
 fields),
 so this ADR is the
 **086**.

## Decision

### 1. Multi-week selection
 with
 chips

- A new `.shopping-week-chips`
  chips
  bar under
  the
  toolbar: each
  chip (`.shopping-week-chip`, the
  `recipe-form__chip`
  visual
  pattern)
  is a
  week with
  a
  hidden
  checkbox showing the
  abbreviated date. The
  visible
  window is
  of
  **5
  weeks** around
  an
  offset (`chipOffset −
  2 … chipOffset + 2`), navigable with the ←/→ arrows
  (`shopping-prev-week`/`shopping-next-week`).
- The
  selection is
  a
  Set
  of
  ISO
  `weekStart`s
  (`selectedWeeks`). While
  the
  user **does not touch the
  chips**
  (the
  `userTouchedChips`
  flag), the
  selection follows the
  menu's
  active
  week (`syncSelectionWithMenu`
  uses
  the
  `getActiveWeekOffset()` of
  `js/menu.js`);
  as soon as
  they
  touch
  a
  chip or
  an
  arrow, the
  selection becomes
  the
  user's and
  stops
  following
  the
  menu.
- The
  calculation
  (`computeLines`) sums
  the
  selected
  weeks' ingredients, aggregating
  by
  the
  normalized
  `«nombre|unidad»`
  key
  (name
  and
  unit
  normalized). Each
  week scales with
  **its own
  diners**
  and
  applies
  **its own
  exclusions**
  (`excludedFromShoppingRecipes`)
  and
  its
  deleted
  items (the
  `deletedItems`). Weeks without
  a
  saved
  document contribute
  0
  (an
  in-memory
  menu without
  an
  id). Unchecking the
  only
  selected
  week is not
  allowed
  (the
  toast
  "Select at least one
  week").
- The
  tab's title says «Lista de la semana del …» or
  «Lista
  de la
  compra · N
  semanas».

### 2. Package
  quantities
  (the automatic
  computation)

- `pkgInfo(line)` finds the
  ingredient in the
  catalog
  (`getIngredients()`
  of
  `js/recipes.js`, which becomes exported).
  If it has
  `paqueteCantidad` and
  `paqueteUnidad`, it compares
  units
  **by
  families** (`unitFamily`): mass
  (g base
  1 / Kg base
  1000), volume
  (mL base
  1 / L base
  1000)
  and
  units (base
  1).
- Only
  quantities of
  the
  **same
  family** are
  compared; otherwise
  —or if the
  ingredient has no
  package
  datum— it returns
  `null` and
  the
  line shows the
  **needed
  quantity** (the previous
  behavior).
- Rounding
  up with
  a
  floating-point tolerance (`Math.ceil(neededBase / pkgBase − 1e-9)`): 550 g with
  a
  1 Kg package →
  1
  package;
  2,5 Kg →
  3. The
  `Number()`'s null-safety and
  the
  `pkgCant > 0` / `pkgBase > 0` checks make
  the
  **defensive
  reading**
  of issue #224's fields: if
  PR
  #227 is not
  merged yet
  and
  the
  fields do not exist, the
  packages' calculation stays
  inactive
  without
  errors.

### 3. A −/+ stepper
 with
 local

 persistence

- Each
  line
  with
  a
  package
  shows the
  −/+ stepper (`.shopping-line__stepper`) with
  the
  "N
  packages"
  count
  and
  the
  needed
  quantity
  next to
  it («· 550 g»). The
  stepper measures
  a
  **1.5rem (24 px)**
  touch
  area
  (WCAG
  2.2 AA, the
  criterion 2.5.8 minimum
  target
  size).
- The
  manual
  adjustment persists in
  the
  **per-user localStorage**
  (the
  key
  `compraPaquetes:<uid>`, a
  JSON `{key: nº}`), only on
  the
  device — an
  accepted
  trade-off: it does not sync
  between
  devices, in exchange for
  zero data-schema changes.
- The
  **↺** button (`.shopping-line__pkgreset`) clears the
  adjustment and
  goes
  back to
  the
  automatic
  calculation.

### 4. Swiping left
 to
  delete

- The
  ADR-028's
  **axis lock
  pattern**: `touchstart`/`touchmove`/
  `touchend` with a
  10 px
  slop; on crossing the
  threshold the
  axis
  is decided
  (a
  tie →
  vertical, the
  scroll
  wins) and
  there is no going back.
- The
  left
  swipe **reveals** a
  "Delete"
  button (`.shopping-line__del` over the
  red
  .shopping-line__swipe-bg`
  background):
  **it does not delete
  on release**, one has
  to press the
  button (preventing accidental
  deletions). Swiping right closes the
  reveal. The
  position is
  applied
  by
  the
  CSS: an
  inline
  transform
  during
  the
  drag and
  the
  `.is-revealed`
  class
  → the
  `translateX(-88px)`
  on release.
- On
  desktop the
  reveal also happens
  on **hover** (inside
  `@media (hover: hover)`) and
  is
  keyboard-accessible: on
  focusing the
  button the
  `.is-revealed`
  is added and
  leaving
  focus closes it.
- **Suppressing the synthesized click**: after a
  horizontal
  gesture the
  browser
  synthesizes a
  `click`
  on the
  release
  that would
  land on the
  shifted
  row's
  checkbox/stepper; it is
  suppressed with
  a
  `preventDefault()` on the
  **non-passive `touchend`** (only when the
  lock was
  horizontal
  and
  the
  shift
  exceeded the
  threshold, to not
  affect
  deliberate
  taps).

### 5. The deletion's persistence and
 the
 undo

- **Recipe
  items**: they are
  marked in the
  menu
  document's
  `deletedItems` (an
  array of
  normalized
  "nombre|unidad"
  keys) of
  **each selected
  week actually
  containing the
  item**
  (checked before
  writing and
  omitted
  if already there). The writes
  use the
  `updateMenuWeek(weekStart, changes, { create: false })`:
  **no empty
  week documents are ever created**.
- **Extra
  items**: they are removed from the
  `extraItems` of the
  weeks where
  they
  are.
- **Serialized writes** with a
  promise
  queue (`enqueueMutation`) to avoid
  races between
  deletions, restorations and
  additions that are
  almost
  simultaneous (two
  prior
  reads could step
  on each other).
- **The undo** with
  `showUndoToast` (ADR-004's pattern): it restores the
  previous
  `deletedItems` of each
  touched
  week or re-adds the
  extra
  item.
- The
  **«Quitados de la
  lista»** note (`.shopping-deleted`) at the
  list's
  foot with
  the
  names of
  the
  selected
  weeks'
  deleted
  items; pressing
  one re-includes
  it (it removes
  it from the
  `deletedItems` in
  all the
  weeks having
  it).

### 6. The refactor
 of
 `js/menu.js` and

 new
 exports

- `activeMenu` generalizes into
  **`menuForWeek(weekStart)`** (a
  specific
  week's menu; without
  a
  document it returns an
  in-memory
  one without
  an
  id, with
  2 din
  ers and
  empty
  lists).
- The new
  export
  **`getMenuDataByWeek(weekStart)`**
  with
  the
  shape `{ weekStart, diners, days,
  weeklyRecipes, excludedFromShoppingRecipes, extraItems, deletedItems,
  hasDoc }`.
- The new
  export
  **`updateMenuWeek(weekStart, changes, { create = true })`**:
  it updates
  a
  specific
  week fire-and-forget with an
  optimistic local
  state; with
  `create: false` it only updates if the
  document already exists.
- The new
  export
  **`getActiveWeekOffset()`**: the
  menu's
  active
  week's
  offset, which the
  shopping
  list uses to
  start its
  selection.
- `menuDataOf` also persists the
  `deletedItems`.
- `js/recipes.js`: `getIngredients()` becomes
  exported.
- `js/app.js`: `resetShoppingListState()` (it resets
  chips, selection and
  in-memory
  package
  adjustments) is
  invoked
  on logout so the
  previous
  user's
  data are not
  shown to
  the
  next.

### 7. CSS and
 the four
 theme
 modes

- `.shopping-week-chips` /
  `.shopping-week-chip` (with
  the
  `.is-checked`
  state and
  a
  `:focus-within` with
  a
  visible
  outline, since the
  input is
  hidden), `.shopping-line-wrap`
  (the
  swipe's red
  background) /
  `__swipe-bg` / `__del` /
  `__content` (the shifting
  surface), `.shopping-line__stepper`
  (1.5rem), `__pkgcount`, `__detail`,
  `__pkgreset`, `.shopping-deleted` and
  the
  revealed
  state (`.is-revealed`
  +
  the
  hover in
  `@media (hover: hover)`).
- The 4
  theme
  families'
  **grouped**
  overrides
  (`[data-theme="light"/"white"]` and
  `[data-theme="black"]`) following
  AGENTS.md
  §4's grouped-selectors pattern: the
  swipe's background uses
  `--stamp` (and
  `--stamp-dark` in
  pure black), the
  checked
  chips use
  `--teal-reel` (with
  `--teal-reel-dark` in pure
  black), etc.
- The
  light red
  `#d16a59` of
  the
  ↺ button and
  of
  the
  «Quitados de la
  lista»
  note's
  buttons is
  **hardcoded with
  a
  comment**:
  `--stamp` (#a63b2e ≈
  2,6:1) does not
  reach
  AA
  4,5:1 over dark, while
  `#d16a59` ≈
  4,7:1 over
  `--ink-raised`; in
  the
  light
  family the
  `var(--stamp)` is
  used (≈
  6,4:1 over white).

### 8. The merge dependency
 with
 PR
 #227 (issue #224)

The ingredients
 catalog's
 `paqueteCantidad`/`paqueteUnit` fields are introduced by PR
 #227
 (issue
 #224), still unmerged. Until then, the
 packages' calculation stays
 **inactive** (the fields do
  not exist →
  defensive
  reading →
  the
  needed
  quantity shows); no
  other
  improvement of
  this
  issue is blocked.

## Rejected alternatives

- **Syncing the package adjustments between devices**
  (Firestore): rejected — it would require data-schema changes
  and conflict-resolution logic; a per-uid localStorage
  (only on
  the
  device) is enough
  for the
  use case, and the trade-off is documented
  in the manual.
- **Deleting
  the item on swipe release**: rejected — it causes
  accidental deletions; pressing "Delete"
  after revealing
  is
  required (and desktop's
  hover
  does not delete
  on
  pointing).
- **Persisting the deletion in the shopping list's own document**:
  rejected — the list computes from the menu and has no own document; the
  `deletedItems` in each
  week's
  menu
  document is coherent with
  the
  `extraItems` and with the
  "this week I don't need this ingredient"
  semantics.
- **Creating empty week documents on deletion**: rejected — the
  `updateMenuWeek` with
  `create: false` avoids dirtying Firestore with documents without
  a menu.
- **An infinite
  window or a full chip list**: rejected — the
  5-window with
  arrows keeps the
  toolbar compact on mobile and the
  responsiveness (without
  horizontal scroll).
- **Keeping the swipe's reveal in state**: rejected — the
  reveal is ephemeral per gesture/focus and
  closes on re-render, as in
  ADR-028.

## Consequences

- **Positive**: the shopping list covers several weeks at
  once (real
  purchases of a period);
  ingredients with a
  package
  datum show a supermarket-useful quantity (and
  adjustable to the pantry's reality, with the adjustment's undo via
  ↺); items can be removed with a natural
  mobile gesture, desktop's
  hover and keyboard, always
  with undo and a
  visible way to re-include them; `menuForWeek`
  /`getMenuDataByWeek`/
  `updateMenuWeek`/`getActiveWeekOffset` remain
  `js/menu.js`'s reusable API.
- **Neutral**: the package adjustments are not
  synced
  between devices (an accepted, documented trade-off); a recipe item's
  deletion is **per week** (removing rice from week A does not remove it
  from B — the manual explains it); the PWA's version bump
  (`20260912 → 20260913`)
  to propagate the new CSS/JS to
  cache-carrying clients; the packages' calculation stays
  dormant until PR
  #227 merges.
- **Negative**: none known. QA PASS: multi-week, packages with
  rounding up (the 550 g/1 Kg → 1 and 2,5 Kg → 3
  cases), the stepper with
  persistence
  and ↺,
  the swipe with
  axis lock without
  phantom clicks,

 undo,
  the "Quitados de la lista" note, four theme modes
  with WCAG AA contrast and responsiveness at
  360 / 768 / 1280 px with no page-level horizontal scroll.
  Security PASS: no findings (the per-uid
  localStorage stores no sensitive data and the mutations' queue does not
  change Firestore's attack surface). The user manual is updated
  (section 8.4).

## The iteration (2026-08-12): the packages'
 and the deletion's refinements

A new user comment on issue #225 with four requests:

> 1. Si aparece el número de paquetes, no debería aparecer el peso.
>    Tampoco la palabra «paquetes», simplemente el número.
> 2. Para eliminar un ítem, añadir a la derecha del todo una X roja
>    con la que eliminarlo (sobre todo desde PC).
> 3. Al presionar sobre un item se marca en rojo como para eliminar y
>    aparece «Eliminar» superponiéndose al peso. Esto no debería
>    pasar, solo cuando se desplaza, no al pulsar, en cuyo caso
>    estaría marcando el item, no eliminándolo.
> 4. Cuando se desplaza el item para eliminarlo, hacer un pequeño
>    desplazamiento extra para eliminarlo sin necesidad de pulsar
>    sobre eliminar que se mostraría ahora.

### The iteration's decisions

1. **Packages: only the number** — `qtyHtml` shows only
  the packages' figures (with the aria-label
  "N paquetes"
  for screen readers) and removes
  the `.shopping-line__detail` span («· 550 g»):
  the weight and the word "paquetes" are
  no longer seen. Its CSS is also
  removed (`.
  shopping-line__detail` and its overrides) and its reference in
  the `is-bought` state.
2. **A always-visible red ✕ on the right** — each row includes a
  `.shopping-line__remove` (✕) button at the end of the
  content, with a 1.75rem (≥ 24 px, WCAG
  2.2 AA 2.5.8) touch
  area and the light red `#d16a59` (AA over dark, the
  ↺'s pattern; in the
  light family it darkens to
  `--stamp`). It reuses the existing
  `data-del-key`
  delegate, so it deletes with the same flow
  and undo.
3. **The hover no longer reveals the deletion state** — the
  `@media (hover: hover)` block that
  shifted the content on pointer
  hover (the cause of the "red
  marking" and of
  the "Delete"
  overlapping the
  weight when pressing) is removed. Now
  the
  hover only marks the row (a soft `--paper-alpha-10`/`--ink-alpha-10`
  background), like before it marked on press. The
  keyboard is covered by
  the ✕ (a
  real
  button,
  focusable and activable).
4. **The swipe with an extra shift deletes directly** — the
  `SWIPE_DELETE = -112` constant is added
  (24 px past
  the reveal at -88): during
  the drag the content can reach
  -112 and the `.is-deleting` class darkens
  the red
  background
  (`filter: brightness(0.85)`)
  to communicate the threshold; on release with
  `offset <= SWIPE_DELETE` the item eliminates
  directly (with undo), with
  no button to
  press. The swipe's background's
  "Delete" button disappears (`.shopping-line__del`
  → a decorative `.shopping-line__swipe-icon`
  icon with `pointer-events: none`).
5. **The manual and the hint** — the manual's section 8.4
  and the list's foot hint update:
  the packages' number without
  the
  weight, the right's
  ✕ and the swipe with the extra shift.
6. **PWA**: the version bumps `20260914 → 20260915`.

### The iteration's consequences

- **Positive**: the package-equipped quantity becomes clean (only
  the number, without
  duplicating
  the weight); the red ✕
  gives an evident, desktop-accessible deletion
  path; the hover stops suggesting
  a deletion
  that does not happen; the swipe gains the standard
  "swipe to the end to delete" pattern with
  visual feedback of the threshold.
- **Neutral**: the swipe's deletion still
  requires a full
  gesture
  (the reveal
  + the extra shift), keeping
  the accidental-deletion protection
  of the
  original decision; the keyboard
  accessibility moves from the revealed
  button to the always-visible ✕
  button.
- **Negative**: none known. QA PASS: the package shows
  only
  the number
  and
  without the weight, the ✕ deletes with
  undo, the hover
  does not reveal
  the deletion (it only marks), the swipe with the
  extra shift deletes on
  release without pressing,
  the four theme modes with WCAG AA contrast
  and responsiveness at 360 / 768 / 1280 px without
  horizontal scroll. Security PASS: no
  findings (100 % presentational and of
  interaction
  changes; data
  untouched).

## Iteration 2 (2026-08-12): vertical scrolling does not mark in red and the swipe's ✕ only shows while swiping

A new user comment on issue #225 with two
final
 details:

> Cuando me voy desplazando (especialmente en el móvil) se va
> marcando en rojo (aunque no se seleccione) el ítem sobre el que he
> puesto el dedo para desplazarme. Corregir eso. Además, al
> seleccionarse, la x que se muestra al desplazar se ve y se
> superpone a la otra que hay. Esta x solo debe ser visible con el
> desplazamiento, no antes de desplazarse.

### Iteration 2's decisions

1. **Vertical scrolling never reveals the red background** — the axis
  lock
  (ADR-028) already distinguished the
  axis, but in `touchend` the
  final
  `offset` computation used the horizontal drift
  (`deltaX`) even when
  the
  lock had been
  `vertical`: with
  a
  drift of
  more
  than
  44
  px during
  a
  page
  scroll, the
  `snap(offset < SWIPE_OPEN/2)` left
  the
  item revealed
  (the
  red
  background) on finger release — exactly the "marked
  in
  red" the user saw when scrolling
  on the
  mobile. Now:
   - In `touchmove` the
      transform and the
      classes `is-revealed`/
      `is-deleting` only apply with
      `lock === "horizontal"`
      (previously they also applied while the
      lock was still
      undecided).
   - In `touchend`, with
      `lock === "vertical"` it does the
      `snap(false)` (it closes the
      row
      if revealed); with
      `lock === null`(a
      tap without
      shift) it touches
      not the
      state. Only the
      gesture decided
      as horizontal can reveal
      or delete.
2. **The red background's ✕ only shows during the drag** — the
   decorative
   white
   ✕ `.shopping-line__swipe-icon` went
   from
   a
   permanent
   `opacity: 0.9`
   to
   the
   `opacity: 0` with
   a
   transition, visible
   only while the
   row carries
   the
   `.is-dragging` class
   (active
   during the
   touch
   gesture). Thus, once the
   row is
   revealed only the red
   ✕ of
   deletion
   (always visible)
   is
   seen and two
   ✕s do not overlap; the
   white
   ✕ is the
   ongoing
   gesture's
   feedback, not a
   second
   button (it keeps
   its
   `pointer-events: none`, the
   deletion fires
   with
   the
   extra
   shift or
   with
   the
   red
   ✕).
3. **The manual and the hint** — the manual's
   section 8.4:
   it clarifies that the
   gesture must be horizontal
   (scrolling
   the list up/down marks
   no
   row) and that the
   red
   background's ✕ only shows while
   swiping.
4. **PWA**: the version bumps `20260915 → 20260916`.

### Iteration 2's consequences

- **Positive**: on mobile
  scroll no
  row stays
  marked in red nor accidentally revealed (the gesture only
  reacts to the horizontal drift the axis lock decided);
  the
  revealed
  row shows a single ✕ (the red
  deletion one),
  without
  the
  white
  decorative one overlapping.
- **Neutral**: the white
  ✕ no longer
  accompanies the
  revealed
  row at rest; the swipe and red ✕
  deletions keep their behavior.
- **Negative**: none known. QA PASS: a vertical
  scroll with
  a
  horizontal
  drift neither reveals nor deletes, the
  horizontal
  swipe keeps revealing and
  deleting with the extra shift, the
  white
  ✕ only appears during the drag and
  the
  revealed
  row shows a single ✕, the
  four theme modes with
  WCAG AA contrast and responsiveness at
  360 / 768 / 1280 px with no
  horizontal scroll. Security PASS: no
  findings (100 %
  presentational and interaction
  changes; data
  untouched).

## Iteration 3 (2026-08-13): no red halo on the items' corners and a hover marking without the red veil

A new user comment on issue #225 with one
last
 visual
 detail:

> Los items de la lista, se ve ligeramente en rojo las esquinas
> redondeadas de cada ítem.

**Root cause:** `.shopping-line-wrap`
 has
 the
 swipe's red background
 (`--stamp`, and
  `--stamp-dark` in pure black) with
 `border-radius: var(--radius)` (3 px) and
 `overflow: hidden`;
 the
 `.shopping-line__content` occupied the wrap 1:1 with
 the
 **same**
 `border-radius: var(--radius)`. Two identical
 radii stacked →
 the
 content's rounded corner's anti-aliasing melted
 with the red behind → a
 subpixel red halo
 on
 the
 rest
 state's rounded corners in all four theme modes.

### Iteration 3's decisions

1. **No duplicated radius on the content** — `.shopping-line__content`
   loses `border-radius: var(--radius)`: the wrap already
   clips the corners (`overflow: hidden` + the
   radius), so the visual rounding is kept and the
   red halo disappears in the four modes.
2. **A hover marking without the red veil** — the hover went to
   `background: var(--paper-alpha-10)` (translucent → it let
  the swipe's red behind show and
  tinted
   the row, being
   perceived as "as if for
   deletion", the effect the user already rejected
   in iteration 1) to `box-shadow: inset 0 0 0 999px <alpha>`, which paints
   ON TOP of the
   base `--ink-raised` background without
  replacing it: the same neutral marking,
  without
   without letting the red show through. Applied
   in the 3 rules: dark (`--paper-alpha-10`), the
   grouped light/white (`--ink-alpha-10`) and
   pure black (`--paper-alpha-10`).
3. **PWA**: the version bumps `20260916 → 20260917`.

### Iteration 3's consequences

- **Positive**: the resting items no longer show
  corners with a red halo and the hover marks the row with a neutral
  fade (never a "red deletion"
  look).
- **Neutral**: none — a 100 % presentational change, with no
  behavior changes; the manual 8.4 already correctly describes that
  only the horizontal gesture reveals the red.
- **Negative**: none known. QA PASS (qa-reviewer): the 4 theme modes
  with WCAG AA contrast (the
  alphas being the same as before),
  with no
  horizontal scroll, no regressions in swipe/✕/packages/
  multi-week; the inset shadow paints under
  the
  border, the
  `--hogar`'s ochre
  `border-left` and
  the children (stepper,
  ✕) stay intact. Security PASS
  (security-champion): no
  findings (0
  HIGH/MEDIUM/LOW).

Related issue: #225 (https://github.com/gonzalitojh/personal-tracker/issues/225)
