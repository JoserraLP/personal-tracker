# ADR-098: The Gym section's «Resumen» (Summary) tab (issue #269)

## Status
Accepted

## Date
2026-08-13

## Context

Issue #269 asks for a
**«Resumen» (Summary)
tab** as the **FIRST tab of the Gym section** (issue
#62, ADR-095): a summary of the
exercises done on a chosen period, with three options — the
**current week** (from Monday to today), the
**current month** (from the month's 1st to today) and a
**free range** (from/to dates).

Branch
context: like
the
ADR-096 and the
ADR-097, this task
is born
from
`feat/issue-62-seccion-gimnasio` (the section and the
ADR-095 are not yet in the
`dev`; the
PR #262 pending integration). The #269's branch merges into that intermediate branch, so this ADR arrives at the
`dev` together with the whole section; that's why the
serial number continues after the
ADR-097 (on the repo there are historical ADR duplicates, so the next
number gets calculated as the existing maximum
+ 1).

The implementation is validated (a
**QA PASS**: a logic sandbox
20/20 and an
11/11 router; a
static
review of the AGENTS.md's rules 2 and 4) with a QA iteration that detected two defects, fixed on commit `7d2982b`:

1. **Invisible date inputs on the selector in Pure black**: the
   theme pattern left the
   free range's `input[type="date"]`s with no contrast against the black background; a
   fix with the
   `[data-theme="black"] .gym-summary-selector input[type="date"]`
   grouped override.
2. **A no-exercise sets guard**: a workout entry with neither
   an
   `ejercicioId` nor a name (an extreme corrupt/legacy data) counted its sets on
   the total with no exercise to attribute them to; a fix with the
   grouping guard (the entry gets ignored).

A security scan with no findings. The user manual updates in this very task (the
AGENTS.md's rule 3, the
§9.1). This ADR documents the decision retrospectively, like the recent ones (the
ADR-093, the
ADR-094, the
ADR-095, the
ADR-096, the
ADR-097).

### An iteration (a second comment from 2026-08-13)

The user left a second comment on the issue with three new requests, incorporated on the same PR:

1. **The date selectors must be hidden unless the "Range" option is active**: on the first version the two
   `input[type="date"]`s (the from/to) were always visible next to the chips. Now they live inside a **single box** (a
   `<details id="gym-summary-range">`) that only shows when activating the
   "Range" chip (the
   `hidden` attribute controlled by the
   `syncSummaryPeriodUI()`); with the
   "Current week" or the
   "Current month" the box stays hidden to not get in the way.
2. **Merging the two dates into a single box**: the `<details>` is born **open** when pressing "Range" and shows both dates inside; its header (with no native marker, the
   `list-style: none`) summarizes the already chosen range ("from – to", or
   "no bound" on the empty ends) via the
   `updateSummaryRangeSummary()`, which also repaints when changing any date.
3. **Changing the totals: no set, rep or volume sums**: the cards become the period's **workouts count** and the
   **different exercises count**; a
   **"By muscle groups"** breakdown gets added (the different exercises and workouts per group) and the per-exercise table simplifies to
   **exercise + times** (the workouts it appears on). The aggregation (the
   `summarizeWorkouts()`) no longer accumulates reps/volume nor the max weight (the iteration 3 will later add the per-exercise weight extremes, the min/max, on the table); the groups resolve like before (the entry's group, the catalog's by id or by normalized name). The entries with no muscle group keep counting on the totals but not on the groups' breakdown.

Revalidated on this iteration: a logic sandbox 42/42 (the per-exercise and per-groups aggregation, the ranges with open bounds and the
`from > to` swap, the selector changes with the box hidden/visible and its dates' summary) and a static review of the AGENTS.md's rules 2 and 4 (the
360/768/1280 px with no horizontal scroll and the four theme modes); a security scan with no findings.

### The iteration 3 (a third comment from 2026-08-13)

The user left a third comment with two requests, incorporated on the same PR:

1. **The range on a single box to choose from and to at the same time**: "the choosing range is still split in two boxes instead of just one". The two
   `input[type="date"]`s (the from/to) inside the `<details>` get replaced by a **single box** with its **own calendar** (a
   `div#gym-summary-range` + a popover with a 42-day grid, Monday first): the **first click fixes the "from"** and the **second the "to"** (swapping the ends if the second is earlier than the first); with the full range, a click starts another range. The calendar navigates months (‹ ›), offers
   **Clear** (it returns to the open bounds) and
   **Done**, and closes with the **Escape** or when clicking outside; the trigger carries the
   `aria-expanded`/`aria-controls`, the popover a
   `role="dialog"` and the focus returns to the trigger when closing. On ≤767 px screens the popover becomes normal flow: with the absolute positioning the 540–680 px band overflowed the page's right edge (measured with a headless Chromium).
2. **The per-exercise weight increase**: "add to each exercise's summary the weight increase there's been. The lowest registered on the period and the highest". The "By exercise" table adds
   **Min weight**, **Max weight** and **Increase** (the max − the min) in the active presentation unit. The
   `summarizeWorkouts()` aggregates the extremes in **canonical kg** (a single conversion when painting, with no rounding drift); the **sets with no registered weight (null or ≤ 0, e.g. bodyweight) cannot be extremes**, and an exercise with no weight at all on the period shows
   "—".

Revalidated on this iteration: a logic sandbox **46/46** (the 42-cell grid and the leap years, the month navigation across years, the range's state machine, the open bounds, the aggregation with weight extremes, the no-weight sets' exclusion, the single painting conversion, the corrupt entries and 500 workouts in < 200 ms); a **QA PASS** with a real headless-Chromium measurement of the
`scrollWidth <= innerWidth` at the
360/500/560/600/620/680/720/768/1280 px and a calculated WCAG contrast of the new elements on the four modes (the post-fixes revalidation found and fixed: the weekday and the borders below AA on
Dark, the selected day's hover covering the extreme, and the cited
popover's overflow); a security scan with no HIGH findings.

### The iteration 4 (a fourth comment from 2026-08-13)

The user left a fourth comment with two requests, incorporated on the same PR (which gets updated, no new one gets created):

1. **The range calendar must not close when choosing the first date**: "when selecting a date range, the calendar closes by itself when choosing the first date and does not let you choose the second". A root cause found with a headless Chromium: the first click on a day **closed** the popover because the
   `onSummaryRangeDayClick()` re-renders the grid and **detaches the pressed button** before the
   document's click-outside handler (the bubble
   phase) ran; the
   `e.target.closest("#gym-summary-range")`
   failed over the detached node and closed the calendar with just the
   "from" chosen. A fix: a
   listener on the **capture
   phase** over the
   `#gym-summary-range`
   marks
   the
   `e.__summaryRangeInside = true`, and the click-outside handler requires
   a
   `!e.__summaryRangeInside`
   (besides
   not
   being born on the
   `.gym-summary-chip`) to close
   . The calendar stays open **until both dates are chosen**; the closing when completing the range is still
   done by the
   `onSummaryRangeDayClick()`, and **the Escape / the "Done" / a real
   outside click** keep closing the same (revalidated on the sandbox).
2. **The per-exercise table only with the weight difference**: "don't
   show
   the min nor the max weight, but the
   difference: the oldest weight and the newest. I.e., it appears
   negative or positive depending on whether it increased or decreased". The
   iteration 3's **Min weight** and
   **Max weight** columns get **removed**; the column gets renamed to
   **"Difference"** and shows the
   `newWeight − oldWeight` with an **explicit sign** (a
   `+` if it went up, a
   `−` if it went down, a
   `0` with no sign, a "—" with no weight at all on the period).
   The
   `summarizeWorkouts()` now aggregates **chronological extremes**, not value extremes: as the list arrives **desc by the
   `fechaISO`** (the `db.js`'s subscription, the
   ADR-095), the **first time** an exercise gets seen fixes its **newest weight** (the most recent period workout's last weighed set) and each later workout overwrites the
   **oldest weight** until keeping
   the most remote workout's first weighed set; inside a workout, the **first weighed set** is the old one and the **last** the new one. The canonical kg with the single painting conversion and the no-weight sets' exclusion (the
   null or the ≤ 0) stay
   .

Revalidated on this iteration: a **QA PASS** with the
headless-Chromium sandbox updated (the calendar stays open after the first day, it closes when completing the range, and the
Escape/the "Done"/the outside click keep closing; the per-exercise table shows just
"Difference" with
the sign — the
`+5`, the
`−2.5`, the
`0` and the
"—" — over data with an increase, a decrease, a
single piece of data and no weights); a security scan with no HIGH findings.

### The iteration 5 (a fifth comment from 2026-08-13)

The user left a fifth comment with one request, incorporated on the same PR:

1. **A semantic color on the weight difference**: "the Resumen tab's exercise table's weight difference, if negative it must be red, if zero white as it is now and if positive green". The per-exercise table's "Difference" cell paints with a **per-sign class** (the
   `gym-summary-table__diff--up` / the
   `--down`); the zero (and the "—") carry no class and inherit the cell's
   normal color. The hues follow the
   **`.shopping-line__pkgreset` documented pattern (issue #225)**: on the
   dark family the base accents don't reach an AA 4.5:1 against the
   `--ink` (the `--stamp`
   being
   #a63b2e ≈ 2.85:1 and the
   `--teal-reel`
   being
   #2b6459 ≈ 2.66:1), so light variants get hardcoded with the
   contrast annotated on the CSS itself — a
   green
   `#4f9c8e` (≈ 5.6:1 against the
   `--ink`, ≈ 6.5:1 against the
   #000) and a
   red
   `#d16a59` (≈ 5.1:1 against the
   `--ink`, ≈ 5.9:1 against the
   #000), both AA on
   Dark and Pure
   black —; the
   light
   family uses the base accents (the
   `--teal-reel` ≈ 6.0:1 and the
   `--stamp` ≈ 5.6:1 against the
   `--paper-dim`), both AA on
   Light
   and Pure
   white. The iteration 4's `+`/`−` sign is not altered: the color is a visual reinforcement, not the only
   information channel (the text carries the explicit sign).

Revalidated on this iteration: a **QA PASS** — a calculated WCAG contrast verification of the
two hues on
the
four theme modes (listed above, all an AA 4.5:1), a
confirmation that the zero and the "—" inherit the
cell's color with no class, and a
static review of the grouped-selectors pattern (a single source of truth per rule, the
AGENTS.md's rule 4); a security scan with no HIGH findings.

Related issue: #269 — https://github.com/gonzalitojh/personal-tracker/issues/269

## Decision

### 1. The «Resumen» as the section's first tab and default

- The
  **`resumen`** route token, the
  **`#panel-gym-summary-tab`**
  panel (the `#gym-view`'s first panel, with its hidden `h2`, the period selector and the
  `aria-live`-carrying
  `#gym-summary-data` container).
- Being the **first tab** it becomes the section's **default**:
  the
  `GYM_DEFAULT_TAB = "resumen"`, coherent with the repo's convention (**the first tab = the default**): the
  `#/gimnasio` canonicalizes with no segment and **the
  `#/gimnasio/resumen` is not canonical** — the router normalizes it to
  the
  `#/gimnasio` (the
  `invalid: true`), the same pattern it already applied with the first tab on
  Ocio and Recipes.
- The
  `lastGymTab` and the
  `openGym()` start on the
  `"resumen"`; the per-tab renders'
  dispatch adds the
  `resumen: renderSummary` (the
  `entrenos`/the
  `ejercicios`' same pattern).

### 2. The `SECTION_REGISTRY` registration and the hiding from Settings

- The
  `resumen` registers as the **first key** of the
  `SECTION_REGISTRY.gym.tabs` and the
  `visibleTabs.resumen: true` gets added to the
  `DEFAULT_SETTINGS`: the tab can get **hidden from Settings like the others** (the
  issues #97/#208, the
  ADR-067, the
  ADR-095).
- **The
  `sanitizeVisibility()` covers the users with old settings**: the keys not in the registry get ignored and the valid ones get filled with the
  `true`, so the settings saved before the
  #269 (with no
  `summary`) show the tab visible with no user intervention.

### 3. The existing palette's violet accent

- The tab uses the
  **`--games`** accent (a violet, already existing on the palette — it's the
  Video games'
  color — and which the Gym
  hadn't used until now), with the
  **`--games-dark`** for the active tab's stamp on Pure black (the
  `[data-theme="black"] .tab--gym-summary.is-active`), following the grouped-selectors pattern with a single source of truth per rule (the
  AGENTS.md's rule 4).

### 4. The client-side calculation, with no new Firestore queries

The summary gets calculated **entirely on the client** with the already subscribed data (the ADR-097's pre-fill pattern: with no read cost nor latency):

- **The sources**: the
  `workouts` (already sorted desc by the
  `db.js`'s subscription `fechaISO`, the
  ADR-095) and the
  `exercises` (the catalog, to resolve the name and the muscle group when painting).
- **The range filter**: the
  `fechaISO`'s (**YYYY-MM-DD**)
  lexicographic comparison; the
  null `from`/`to` = an open bound.
- **The per-exercise aggregation**: the key is the
  **`ejercicioId` if it still is in the catalog**; if not — an exercise deleted from the catalog or the legacy no-id data — it groups by the
  **normalized snapshot name** (the trim + the lowercase). The catalog's deleted exercises thus keep their name in the summary.
- **The weights ALWAYS in canonical kg** (the
  `pesoKg`), converted with the
  `kgToDisplay` **only when painting** (1 decimal, the section's rest's same helper): the per-exercise difference (the newest weight − the oldest) gets calculated in kg and converted **once** when painting, so toggling the kg/lbs introduces no rounding drift nor changes anything aggregated.
- **The sets with no registered weight (null or ≤ 0) don't participate in the chronological extremes** (they can't be neither the oldest nor the newest); an entry with no id nor name groups or counts nothing (the QA fix's guard).
- **The output**: there are no set, rep nor volume sums anymore. The cards are the period's **workouts count** and the
  **different exercises count**; the **"By muscle groups"** breakdown gives the per-group different exercises and workouts; the **"By exercise"** table shows the
  **times** (the different workouts it appears on), sorted by a desc frequency (an alphabetical tie-break) and, since the
  **iteration 4**, the per-exercise **period's weight difference** — the **newest weight − the oldest**, with a sign (the
  `+` meaning an increase, the
  `−` a decrease) — in the active presentation unit (a "—" if there is no weight at all on the period). The groups resolve the same way as before (the entry → the catalog by id → by the normalized name); with no muscle group, the entry only counts on the totals.

### 5. The period selector: the DOM chips and the unique-calendar range

- Three chips (**«Semana en curso»**, **«Mes en curso»**, **«Rango»**) with an
  `aria-pressed`; the **active chip is the period's source of truth** on each render (the
  `summaryPeriodRange()`: the week/month
  get recalculated with the
  `ctx.todayISO()`'s UTC pattern on each read).
- The **free range** gets chosen on a **single box** (the
  iteration 3): the
  `div#gym-summary-range`, hidden unless the "Range" option (the `hidden` controlled by the
  `syncSummaryPeriodUI()`, which when activating it
  opens the calendar and when exiting to week/month closes it). The trigger summarizes the already chosen range ("from – to", or "no bound" on the empty ends) and opens the **unique calendar's** popover: a click fixes the "from", the second the "to" (an automatic swap if it's earlier), the in-between days get marked, it navigates months and the "Clear"/"Done" manage the state. The range (the
  `summaryRange {from, to}`, the null = an open bound) is a **module state** (the calendar is its editing interface; there are no native inputs to read) and the
  `resetGymData()` clears it on
  logout.
- The range is **inclusive**, **swaps the `from > to`** (a defensive move; the calendar already avoids the inverse order when choosing) and treats the **empty ends as an open bound**.
- Clicking a chip syncs the UI (the
  `is-active`/the
  `aria-pressed`, the visibility and the box's opening) and re-renders only if the period changed; the calendar's days re-render the summary live (also when fixing just the "from", with the "to" open).

### 6. The realtime re-render and the output security

- **The
  `subscribeGymData` repaints the summary** when the
  `workouts` and the
  `exercises` snapshots arrive (the catalog affects the table's names and muscle groups), whenever the active tab is the
  `summary`.
- **The
  `renderAllWithUnit` repaints the summary when changing the kg/lbs**: after the second comment's iteration the summary stopped showing volumes, but since the
  **iteration 4** it shows weights again (the per-exercise difference); the repaint refreshes the columns to the new unit (the difference gets calculated in kg, the conversion happens when painting).
- **All the painted values go through the
  `escapeHtml`** (the names, the dates, the units and the figures), the section's rest's pattern; the summary's container uses a
  `aria-live="polite"`.

## Rejected alternatives

- **A new Firestore query per date range**: rejected — the
  `workouts` is already subscribed and sorted desc by the
  `fechaISO`; filtering and aggregating in memory is instant and adds no reads nor async state (the ADR-097's pre-fill's same criterion).
- **Persisting the chosen period** (a module state or the
  localStorage): rejected — the summary is a query view; the active chip lives on the DOM and the iteration 3's free range (a volatile module state, with no persistence) gets discarded on reload or logout, with no state to sync between devices.
- **Adding the "Summary" as a third tab keeping the Workouts as the default**: rejected — the issue asks for the Summary as the FIRST tab; the repo's convention (the first tab = the default) automatically makes it the entry view, which is also the section's most informative one.
- **Keeping the sets, reps and volume sums on the summary**: rejected — the issue's second comment explicitly asks them out ("they're of no use to me") in favor of the workouts count, the total exercises and the muscle-groups breakdown; removing them also simplifies the aggregation (a single pass with no per-set accumulations).
- **Keeping the two native `input[type="date"]`s (the from/to) on the box**: rejected — the third comment explicitly asks about it ("it's still split in two boxes instead of just one to choose the start and end date at once"); the unique calendar also shows the range at a glance (the ends and the in-betweens marked) and avoids opening the native picker twice.
- **A native or external-library range picker**: rejected — the browser offers no native range control and the section uses no libraries; the own calendar (a 42-cell grid, Monday first, with no dependencies) keeps the project autonomous and offline-first with the section's visual pattern.
- **Treating the `from > to` range as invalid (an error)**: rejected — asking the user to correct the order adds friction with no benefit; swapping the bounds returns exactly the same range (inclusive), like any spreadsheet does.

## Consequences

### Positive

- **The section gains a synthesis view**: "what did I train this week/month/range?" gets answered without opening workout after workout, with the same data quality (the canonical kg weights).
- **A default coherent with the repo's convention**: the
  `#/gimnasio` lands on the Summary and the shared routes (the
  `#/gimnasio/entrenos`, the
  `#/gimnasio/ejercicios`) keep working; the
  `#/gimnasio/resumen` gets normalized, with no duplicate routes nor ambiguity.
- **Zero data cost and offline-first**: with no new queries; the summary lives from the existing subscriptions and updates realtime when adding, editing or deleting workouts or exercises.
- **A summary focused on what the user asks** (the second comment's iteration): the workouts and total exercises' cards and the muscle-groups breakdown answer "how much and what did I train?" with no noise from the sums that bring the user nothing; the period selector gets cleaner when hiding the range box except when in use.
- **The range gets chosen on a single box** (the iteration 3): the own calendar removes the two separate native pickers' friction and shows the range at a glance (the ends and the in-betweens marked); since the **iteration 4** it also doesn't close when choosing just the first date (it stays open until completing the range, with the
  Escape/the "Done"/a real outside click to close), and the **per-exercise weight difference** (the newest weight − the oldest, with a
  `+`/`−` sign in the active unit) answers "how much weight did I gain or lose on the period?" directly from the summary.

### Neutral

- **The catalog's deleted exercises group by the snapshot name**: if an exercise got renamed after workouts got stored, the summary may show two rows (the canonical + the legacy) for what's really the same exercise; a degraded behavior, not an erroneous one — the catalog is the reference (the ADR-095).
- **The period is not remembered between visits**: each section's opening starts on "Current week"; the user chooses again if they want another period (the free range doesn't persist either: it's a volatile module state since the iteration 3).
- **The free range gets lost when leaving the section**: being a module state (the iteration 3), navigating to another section and coming back resets the box to "no bound – no bound"; coherent with the period's non-persistence policy.
- **Revalidated on iteration** (the third comment from 2026-08-13): a QA PASS — a 46/46 sandbox (the calendar's grid and navigation, the range's state machine, the aggregation with weight extremes and the single painting conversion, the no-weight sets' exclusion, the corrupt entries, the performance), the `scrollWidth <= innerWidth` measured with a headless Chromium at the 360–1280 px (including the 540–680 px band that overflowed with the absolute popover and got fixed with a static flow at ≤767 px) and the WCAG contrast on the four modes (the Dark fixes: the weekday and the --today/the-open-trigger borders go to the
  `--games` or the
  `--ink`; the selected day's hover keeps the extreme); a security scan with no findings.
- **Revalidated on iteration** (the fourth comment from 2026-08-13): a QA PASS — a headless-Chromium sandbox (the calendar stays open after the first day and closes when completing the range; the Escape/the "Done"/a real outside click keep closing; the per-exercise table just with the signed Difference — the `+5`/the `−2.5`/the `0`/the "—" — calculated from the chronological desc weights), a scroll with no overflows on the previous iteration's widths and the new elements' contrast on the four modes; a security scan with no findings.
- **The user manual updated** (the §9.1 "Your summary", the
  AGENTS.md's rule 3): the period selector with the range box hidden except on "Range" (a unique calendar: the first click = the from, the second = the to, it stays open until choosing both dates, the month navigation, the Clear/Done, the Escape/the outside click), the workouts/exercises' cards, the muscle-groups and per-exercise breakdowns with the signed weight difference, and the empty-period notice documented in non-technical language.

### Negative / Risks

- **The aggregation walks all the workouts in memory on each summary render**: with the real usage volumes it is instant (the section's other views' same loads; measured: 500 workouts × 6 exercises in < 200 ms); if the history grew a lot caching per period could make sense, but it's not needed on v1.
- **The range calendar is an own component with no library**: it assumes the es-ES conventions (a week starting on Monday, the months in Spanish, the DD/MM/YYYY format), like the summary's rest; a future language change would have to touch the
  `summaryWeekdayLabelsFn` and the
  `summaryRangeMonthLabel`.
- **No other known ones.** Validated on the third and the fourth comment's iterations: a QA PASS (a 46/46 logic sandbox; a headless-Chromium sandbox of the calendar open until both dates and of the signed-difference table; a real Chromium headless scroll measurement and the four modes' contrast) and a security scan with no HIGH findings; all the painted values go through the
  `escapeHtml`, continuing the section's rest's validation and security pattern (the
  ADR-095, the
  ADR-097).

## Created/modified files

| File | Change |
|---------|--------|
| `index.html` | **Modified**: the
  `#panel-gym-summary-tab` panel as the
  `#gym-view`'s first panel (the
  `tab--gym-summary` tab as the first, the period selector with the chips and the range box, the totals' cards and the breakdowns); **the iteration 2**: the two dates inside the
  `<details id="gym-summary-range">` (a single box, the `hidden` except with "Range"); **the iteration 3**: the
  `<details>` gets replaced by the unique-calendar box (the
  `#gym-summary-range-trigger` with the
  `aria-expanded`/the
  `aria-controls` + a
  `role="dialog"` popover with the month navigation, the
  `#gym-summary-range-days` grid and the Clear/Done footer) |
| `js/gym.js` | **Modified**: the
  `renderSummary()` / the
  `summarizeWorkouts()` / the
  `summaryPeriodRange()` / the
  `summaryExerciseKey()` / the
  `summaryGroupFor()` (a client-side aggregation, a lexicographic `fechaISO` filter, a key by the
  `ejercicioId` or the snapshot name, a table sorted by a desc frequency), the period selector with the DOM chip, the per-tab renders' dispatch with the
  `resumen`, the re-render from the
  `subscribeGymData` and the
  `renderAllWithUnit`, the
  `escapeHtml` on all the painted values; **the iteration 1**: the no-exercise sets' guard (an entry with no id nor name being excluded); **the iteration 2**: the
  `summarizeWorkouts()` with no sums (the totals of the workouts/the different exercises + the
  `perGroup` by muscle groups), new cards and breakdowns, the
  `syncSummaryPeriodUI()` hiding/showing the range box; **the iteration 3**: the
  `summaryRange`/the
  `summaryRangeMonth` state on the module, the own calendar (the
  42-cell Monday-first `summaryRangeDayGrid`, the
  `summaryWeekdayLabelsFn`, the
  `summaryRangeMonthLabel`, the
  `shiftSummaryRangeMonth`, the
  `onSummaryRangeDayClick`, the
  `renderSummaryRangeCalendar`, the
  `open/closeSummaryRangePopover` with a focus return), the
  `summarizeWorkouts()` aggregating the `pesoMin`/the `pesoMax` (the canonical kg, it excludes null/≤0 sets), a table with the Min weight/the Max weight/the Increase columns (a single painting conversion), the
  `resetGymData()` clearing the range's state; **the iteration 4**: a capture-phase listener marking the
  `__summaryRangeInside` (the outside click does not close the calendar after the first day — the re-render detached the pressed button and the
  `closest()` failed —, only the Escape/the "Done"/a real outside click or both dates), the
  `summarizeWorkouts()` aggregating the chronological `oldWeight`/the `newWeight` (a desc list: the first workout fixes the new, the later ones the old; inside the workout the first/the last weighed set), a table just with the signed (`+`/`−`) "Difference" column and a single painting conversion; **the iteration 5**: the
  `diffClass()` assigns the
  `gym-summary-table__diff--up`/the
  `--down` to the difference's cell per its sign (the zero and the "—" classless) |
| `js/router.js` | **Modified**: the
  `GYM_TAB_TO_PANEL` with the
  `resumen` as the first key, the
  `GYM_DEFAULT_TAB = "resumen"`, the `#/gimnasio`'s canonicalization (it normalizes the
  `#/gimnasio/resumen` with the
  `invalid: true`), the
  `lastGymTab` starting on the
  `"resumen"` |
| `js/settings.js` | **Modified**: the
  `visibleTabs.resumen: true` on the
  `DEFAULT_SETTINGS` and the
  `resumen` as the first key of the
  `SECTION_REGISTRY.gym.tabs` (hideable from Settings; the
  `sanitizeVisibility` covers the users with old settings) |
| `css/styles.css` | **Modified**: the summary's styles (the
  `.gym-summary-selector`, the
  `.gym-summary-chip` chips, the
  `.gym-summary-grid`/the
  `.gym-summary-card`, the
  `overflow-x: auto`-carrying
  `.gym-summary-table`, the
  `.gym-summary-section-title`), the
  `--games`-accented
  `.tab--gym-summary` and the four families' grouped overrides; **the iteration 1**: the date inputs' override on Pure black; **the iteration 2**: the unique
  `.gym-summary-range`
  box's styles (a marker-less summary, the fields on a row) and the box's and its texts' Pure-black overrides; **the iteration 3**: the
  trigger's and the calendar's styles (the
  `.gym-summary-range__trigger/__popover/__cal-*/__day` with the
  `--today`/the
  `--selected`/the
  `--in-range` states), the popover's static flow at ≤767 px, the grouped Pure-black overrides (the inverted surfaces, the
  `--games-dark` selection, the extreme-keeping hover) and the AA contrast fixes on Dark (the weekday with the
  `--ink`, the borders with the
  `--games`); **the iteration 5**: the difference's semantic color classes (the
  `.gym-summary-table__diff--up`/the
  `--down` with commented light hexes for the dark family and the
  `--teal-reel`/the
  `--stamp`-based grouped overrides for the light one, the
  `.shopping-line__pkgreset`'s pattern) |
| `tasks/task-issue-269.json` | **New**: the issue #269's task file |
| `docs/manual-de-usuario.md` | **Modified**: the §3 and §9 with the Gym's third tab; a new subsection **§9.1 "Your summary"** (the 9.2, the 9.3 and the 9.4 renumbered); the §17 Settings with the three tabs; **the iteration 2**: the §9.1 with the range box (hidden except on "Range"), the workouts/exercises' cards and the muscle-groups and per-exercise breakdowns; **the iteration 3**: the §9.1 with the unique calendar (the first click = the from, the second = the to, the month arrows, the Clear/Done, the Escape/the outside click) and the Min weight/Max weight/Increase columns with the "—" when weightless; **the iteration 4**: the §9.1 with the calendar staying open until choosing both dates, and the per-exercise table just with the signed (+/−) weight difference between the oldest and the newest |
| `docs/adr-098-pestana-resumen-gimnasio.md` | **New**: this document (the iterations 2, 3 and 4 documented) |

Related issue: #269 — https://github.com/gonzalitojh/personal-tracker/issues/269
