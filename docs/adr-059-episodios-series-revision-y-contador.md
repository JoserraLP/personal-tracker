# ADR-059: Series episodes: 2-line layout, re-watch and watch counter (issue #133)

## Status
Accepted

## Date
2026-08-10

## Context

Issue #133 («Arreglo de los episodios de las series») reports two
problems in a series' profile, in each season's dropdown episode list:

1. **The episode's title shows "vertical"** at small widths:
   with `flex-wrap: wrap` active in `.episode-row__main` (which also
   contained the date input), the title —with `min-width: 0` and
   `overflow-wrap: anywhere`— got squashed and its text stacked
   line by line inside the row, drifting away from the rest of the line.
2. **There is no way to register a re-watch**: pressing the checkbox of
   an already-watched episode only allowed un-marking it; there was no
   per-episode watch counter nor a "I watched it again" action.

Previous state:

- Each row's layout was **one line** (`episode-row__main` with
  `flex-wrap: wrap`) with: checkbox, no., title, community badge and the
  date input; the star rating went on a separate second line
  (`.episode-rating` with `padding-left: 30px`).
- The per-episode data model was `{ date, rating }` (and older
  entries were only `"YYYY-MM-DD"` as a string); `normalizeEntry`
  normalized string → `{ date, rating: null }`.
- Pressing an already-watched episode's checkbox **unmarked it**
  directly, without asking.

The implementation is validated (QA PASS) and scanned (security PASS);
the user manual was updated in the same task (rule 3 of
AGENTS.md). This ADR documents the decision retrospectively.

Related issue: #133 — https://github.com/gonzalitojh/personal-tracker/issues/133

## Decision

### 1. UI: episode layout at 2 lines at all widths

Each episode row moves to **two fixed lines** at any screen width:

- **Line 1** (`episode-row__main`): checkbox + no. (`E1`) + vertically
  centered multiline title + community badge (TMDB).
- **Line 2** (`episode-row__meta`, new): rating stars +
  date input, with `padding-left: 30px` to align with the
  checkbox (the indent previously carried by `.episode-rating`, which
  loses its `padding-left`).

**Root cause corrected in CSS, with no patches**: `flex-wrap: wrap` is
removed from `.episode-row__main` —the title can no longer jump to
stacked lines of its own— and the multiline title is fitted with
`flex: 1; min-width: 0; overflow-wrap: anywhere` in
`.episode-row__name` and `align-items: center` on the container
(vertical centering). **`overflow-x: hidden` on `body`/`html` is not used** nor
any patch masking the overflow (AGENTS.md's rule 2): the root cause is
fixed. `overflow-wrap: anywhere` in `.episode-row__meta`
(`flex-wrap: wrap` allowed here, second line) prevents the date
from spilling at minimum widths.

### 2. Data model: `times` field (watch count)

The episode entry goes from `{ date, rating }` to
`{ date, rating, times }`, where `times` is the number of times the
episode has been watched:

```js
// temporada -> episodio -> { fecha de la última vez visto, valoración 1-5 o null, veces visto }
{ "1": { "1": { date: "2026-01-05", rating: 4, times: 2 } } }
```

- **`normalizeEntry()`** (on read, not write) normalizes legacy
  data without mutating the original: a string (`"2026-01-05"`) →
  `{ date, rating: null, times: 1 }`, and an object with `date` but
  without `times` → `{ ...entry, times: 1 }`. Objects already having
  `times` return as-is.
- **No data migration nor backup version bump**: the data in
  Firebase keeps whatever format it has; `export-backup` serializes
  `watched` as-is (entries without `times` export without it) and
  **importing old backups is covered by
  `normalizeEntry`** at the read point. Zero risk of data loss or
  rewriting.

### 3. Progress logic (`js/tv-progress.js`)

- **`markEpisodeSeenAgain(watched, season, ep, date)`** (new): marks an
  ALREADY-watched episode as watched again — sets the date to today
  (passed by the caller), **keeps the rating** (`existing.rating`) and
  **adds 1 to `times`** (`(existing.times || 1) + 1`).
- **`setEpisodeDate`** keeps `times` when changing the date
  (`existing.times || 1`); **`setEpisodeRating`** keeps `times` when
  re-rating; **`setSeasonWatched`** (marking the whole season) keeps
  `rating` and `times` of episodes already watched
  (and sets `times: 1` on new ones).
- **`computeProgress` does not change**: it counts episodes with dates, not
  watches. Deliberate consequence: a re-watch **does not trigger the
  series' "completado" status** (nor clears it) and
  **the per-season counters do not inflate** (they keep counting
  distinct watched episodes, not times).
- **`startRewatch()`** still resets `watched = {}` (and archives the
  cycle in `history`): **design decision — the `times` counters are per
  watch cycle**, they reset when a rewatch starts. Previous cycles'
  history stays in `item.history`/`timesCompleted`.

### 4. New actions dialog for already-watched episodes

In `index.html` the `#episode-actions-modal` frame is added
(`modal modal--top hidden`, with `#episode-actions-modal-backdrop`,
`#episode-actions-modal-close` and `#episode-actions-modal-content`), and the
module `js/episode-actions-modal.js` (the `rating-modal.js` pattern):

- `openEpisodeActionsModal({ title, subtitle, times })` returns a
  **promise resolving with `"seen_again"`, `"unmarked"` or `null`**
  (dismissed); never rejects. It is PURE: it persists nothing, the caller
  decides the repainting.
- It uses `trapFocus` on `.modal__card` (the same
  `focus-utils` as the rating modal) and stores `_previousActiveElement` to
  **restore focus to the episode's checkbox** on close.
- The ✕ and backdrop listeners register ONCE on module load
  (static frame) and delegate to `closeEpisodeActionsModal()`
  (idempotent: resolves with `null` and does nothing without an open modal).
- **Escape key priority** (global handler in
  `modal-handlers.js`): `episode-actions > rating > item > notifs`. The
  new modal is the first one checked, before the rating window.

### 5. Checkbox behavior (`js/ui.js`)

- **New visual state centralized in `applyEpisodeRowState(row,
  entry)`**: syncs checkbox, `is-watched` class, date, row 2
  (`hidden` if not watched), counter and stars from the real normalized
  entry of `item.watched` (issue #136 pattern: repainting
  ALWAYS derives from `item.watched`). It is used in three points: the
  checkbox change, «Desmarcar todo» (which now repaints each row to its real
  state instead of manually emptying it) and the checkbox's handler.
- **`wasWatched` branch in the checkbox's `change` handler**: if the
  episode was already watched, the check is restored instantly (no
  flicker, checkbox `disabled` while the dialog lasts), the
  `#episode-actions-modal` opens and depending on the choice: `"seen_again"`
  → `onSetEpisodeSeenAgain` (calls `markEpisodeSeenAgain` with
  today's date), `"unmarked"` → `onSetEpisodeDate(..., null)`,
  `null` → nothing (the row goes back to its real state). Focus is restored
  to the checkbox in `finally` (`document.activeElement` is stored before
  opening the dialog, because the browser moves focus to `body` when
  disabling the checkbox). If the episode was NOT watched, the current
  flow is kept (the "not released" confirmation and the subsequent rating
  window on the `modal-handlers` side).
- **Dynamic `aria-label`**: with `times > 1` the checkbox says
  «E3 — Título: visto N veces. Pulsa para verlo de nuevo o desmarcarlo».

### 6. Visual checkbox with counter

With `times > 1` the checkbox's circle shows the **number of times instead
of the tick ✓**: `renderEpisodeRows` adds `data-count="${times}"` to
`.episode-checkbox-visual` (and `applyEpisodeRowState` adds/removes it
when repainting), and the CSS rule
`.episode-checkbox:checked ~ .episode-checkbox-visual[data-count]::after`
replaces the tick with `content: attr(data-count)` (mono typography,
centered, no border). With `times === 1` the classic tick remains.

### 7. PWA and documentation

- **PWA bump** `20260831` → `20260901` (one bump per PR touching
  assets, cf. ADR-049): `js/config.js` (`APP_VERSION`), `index.html`
  (`?v=20260901` ×3) and `service-worker.js` (`?v=20260901` ×6), and
  the module **`js/episode-actions-modal.js` is added to
  `STATIC_ASSETS`** (it is a new module the SW must cache).
- **User manual** (`docs/manual-de-usuario.md`): new bullet
  «Volver a ver un episodio» in §4.3 «Ver y marcar episodios» explaining
  the dialog, the date update, the counter's +1 and that the
  checkbox shows the number of times instead of the ✓ mark
  (AGENTS.md's rule 3).

## Rejected alternatives

- **Chained `window.confirm`s** to ask «¿Lo has visto de
  nuevo o lo desmarcas?»: rejected — native `confirm`s are
  unstyled browser modals, break the app's visual pattern and
  do not allow `trapFocus` nor restoring focus to the checkbox; the
  own dialog reuses the existing modal frame and styles.
- **Marking the whole series automatically on re-watches**
  (e.g. re-watching the last episode goes back to «completado»):
  rejected — `computeProgress` counts distinct episodes, not
  watches; it would inflate the progress, trigger spurious
  «completado» states and pollute the per-season counters.
  The re-watch only updates the episode's `date` and `times`.
- **Counting re-watches in the progress** (summing `times` in
  `computeProgress`): rejected — a series' % is of distinct watched
  episodes; summing times would break the progress, «Siguiente:
  T2E5» and the list's state. The counter is informative for the
  episode, not a progress metric.
- **Data migration / backup version bump** to add
  `times` to all existing entries: rejected — unnecessary:
  `normalizeEntry` covers reading legacy data (string or
  object without `times` → `times: 1`) and
  `export-backup`/`import-backup` need no format change; migrating added
  data-loss risk with no functional benefit.

## Consequences

### Positive

- **Stable 2-line layout**: vertically centered multiline title,
  date and stars on their own line, at any width; the root cause is
  fixed with no overflow patches (AGENTS.md's rule 2).
- **Re-watches can be registered**: the user can indicate having
  watched an episode again without losing the rating nor having to
  un-mark it; the `times` counter becomes visible on the checkbox.
- **Legacy data protected**: `normalizeEntry` without mutation +
  as-is export = importing old backups compatible without
  migration nor data rewriting.
- **Progress intact**: `computeProgress` unchanged — neither spurious
  «completado» from re-watches nor inflated per-season counters.
- **Accessibility**: dialog with `trapFocus`, Escape with priority,
  informative `aria-label` («visto N veces…») and focus restored to the
  checkbox.
- **Manual up to date**: AGENTS.md's rule 3 met in the same task
  (the «Volver a ver un episodio» bullet in §4.3).
- **QA and security PASS** before documenting: the decision is
  validated in practice.

### Negative / Risks

- **Visible change for the user**: the episode row now takes
  two lines (more vertical space in long seasons) and the checkbox
  shows a number instead of the tick for re-watches; it may require an
  adaptation moment. Mitigated by the manual's update.
- **Two sources of truth for the row's visual state**: the
  initial render (`renderEpisodeRows`' template) and the repainting
  (`applyEpisodeRowState`) must stay in sync; changing one without the
  other would produce inconsistent visual states.
- **Checkbox handler complexity**: the `wasWatched` branch
  (restore check, open dialog, repaint and restore focus) is the
  wiring's most delicate path; any future edit must keep the
  "repainting always derived from `item.watched`" pattern.
- **`times` not visible for old manual series**: episodes
  without `times` in data read as `times: 1` (read-time
  normalization); the counter is only meaningful for episodes watched
  more than once after this version.

### Neutral

- **Counters per watch cycle**: `startRewatch()` resets
  `watched = {}` and thereby the `times`; the cycles' history stays in
  `item.history`/`timesCompleted` (previous behavior, unchanged in this
  task).
- **Routine PWA bump**: `20260831` → `20260901` following the
  one-bump-per-PR practice (ADR-049); browsers purge previous caches
  on the next `activate`. `js/episode-actions-modal.js` enters
  `STATIC_ASSETS` to be precached.
- **No changes in `export-backup.js` / `import-backup.js`**: the
  `watched` format stays the same with the added field; the
  compatibility comes from `normalizeEntry` at read.
- **Historical ADRs intact**: the ADRs describing the previous
  layout or model (e.g. ADR-022, rating modal) are historical
  records and are **not modified**.

## Created/modified files

| File | Change |
|---------|--------|
| `index.html` | **Modified**: the `#episode-actions-modal` dialog's frame added (`modal--top`, backdrop, ✕ button and content container); bump `?v=20260831` → `?v=20260901` (×3) |
| `js/episode-actions-modal.js` | **New**: `openEpisodeActionsModal()` (rating-modal pattern) — promise resolving `"seen_again"`\|`"unmarked"`\|`null`, `trapFocus`, focus restored to `_previousActiveElement`, idempotent `closeEpisodeActionsModal()` used by ✕, backdrop and Escape |
| `js/tv-progress.js` | **Modified**: `normalizeEntry` adds `times: 1` to legacy strings and objects without mutating (and returns as-is those already having `times`); new `markEpisodeSeenAgain` (+1 to `times`, date today, keeps `rating`); `setEpisodeDate`, `setEpisodeRating` and `setSeasonWatched` keep `times`; module header comment updated. `computeProgress` and `startRewatch` unchanged |
| `js/ui.js` | **Modified**: `renderEpisodeRows` — 2-line layout (stars + date in `.episode-row__meta`), `data-count` and dynamic `aria-label` («visto N veces…») on the checkbox, `data-episode-name` on the row; new `applyEpisodeRowState(row, entry)` (single repainting derived from `item.watched`, issue #136 pattern) also used in «Desmarcar todo»; `wasWatched` branch in the checkbox's `change` handler (actions dialog, focus restored in `finally`) |
| `js/modal-handlers.js` | **Modified**: import and `onSetEpisodeSeenAgain` callback (calls `markEpisodeSeenAgain` with `todayISO()`); Escape priority updated: `episode-actions > rating > item > notifs` |
| `ocio/ocio.css` | **Modified**: `flex-wrap: wrap` removed from `.episode-row__main` (the vertical title's root cause); new `.episode-row__meta` (flex, `gap`, `flex-wrap: wrap` allowed, `padding-left: 30px`, `.episode-date { flex-shrink: 0 }`); `.episode-rating` loses its `padding-left`; the rule `.episode-checkbox:checked ~ .episode-checkbox-visual[data-count]::after` with `content: attr(data-count)` (counter instead of the tick); `.eam-body` for the dialog's body (`overflow-wrap: anywhere`) |
| `js/config.js` | **Modified**: `APP_VERSION` `20260831` → `20260901` |
| `service-worker.js` | **Modified**: bump `?v=20260831` → `?v=20260901` on the 6 versioned assets of `STATIC_ASSETS`; `./js/episode-actions-modal.js` added to `STATIC_ASSETS` |
| `docs/manual-de-usuario.md` | **Modified**: new bullet «Volver a ver un episodio» in §4.3 «Ver y marcar episodios» (dialog, date to today, +1 to the counter, checkbox with the times' number instead of ✓) — AGENTS.md's rule 3 |
| `tasks/task-issue-133.json` | Task file of the task (title/description, change plan, acceptance criteria and the `issue` block with issue #133) |
| `docs/adr-059-episodios-series-revision-y-contador.md` | **New**: this document |

Related issue: #133 — https://github.com/gonzalitojh/personal-tracker/issues/133
