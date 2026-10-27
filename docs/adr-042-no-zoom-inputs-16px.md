# ADR-042: No automatic zoom on input fields: font-size >= 16px on all inputs (issue #92)

## Status
Accepted

## Date
2026-08-07

## Context

Issue #92 reported that the web did **automatic zoom on mobile** when
tapping the writable fields: the top search bar, the manual item-adding
form and other inputs/selects/textareas of the application (history dates,
per-episode dates, sorting selects, etc.) magnified the page when focused,
forcing the user to zoom out to recover the view.

**Root cause**: iOS Safari and Android Chrome apply an automatic page
zoom when focusing an `input`, `textarea` or `select` whose computed
`font-size` is **less than 16px**. The project used small fonts
(0.72rem–0.95rem) in most fields to compact the search bars, forms and
date rows, which triggered the behavior in practically all the site's
fields.

**Accessibility constraint**: disabling manual zoom with `user-scalable=no`
/ `maximum-scale=1` in the meta viewport was not considered, because it
breaks accessibility (users with low vision who need to magnify the page).
The solution had to eliminate the **automatic** zoom while keeping the
**manual** zoom intact.

Related issue: #92 — https://github.com/gonzalitojh/personal-tracker/issues/92

## Decision

**Permanent policy: no input field (input, textarea, select) may have a
computed `font-size` below 16px (1rem) at any screen width. Disabling
manual zoom (`user-scalable=no` / `maximum-scale=1`) is forbidden.**

The implementation was done with a double layer in CSS:

### 1. Global safety-net rule (both sheets)

- `css/styles.css`: `input, textarea, select { font-size: 16px; }` added
  right **after the reset** (`* { box-sizing: border-box }`), with a
  comment referencing issue #92 and explaining the root cause.
- `ocio/ocio.css`: the **same global rule** at the top of the file,
  also with the issue #92 comment.

The global rule guarantees that **any** new field or specific rule added
in the future can never fall below the minimum: even if a specific
selector defines a smaller size, the safety-net rule is not invalidated in
the reported cases, and any field **without** a specific rule is born already
at 16px.

### 2. Raising to 1rem the specific selectors with font-size < 16px

The ~12 specific selectors declaring smaller sizes (0.72rem–0.95rem) were
raised to `font-size: 1rem` (16px), covering the following groups:

- Top search bar (`#global-search-input`, `.search-bar-wrap`)
  and catalog/list searches (`search-slip input`,
  `.library-search-input`).
- Manual creation form (`manual-form input`, `.field-group
  input/select/textarea`).
- Statistics and settings.
- History dates (`log-row input[type="date"]`,
  `log-add-row input[type="date"]`) and per-episode dates
  (`.episode-row input.episode-date`).
- Sorting selects (`.sort-select`) and the remaining fields.

### 3. Width adjustments to accommodate the larger font

- `.episode-row input.episode-date`: `width: min(150px, 100%)` — compact
  on desktop and no overflow on mobile.
- `.library-search-input`: `width: clamp(150px, 30vw, 200px)` with
  `max-width: 100%` — scales with the viewport without breaking the
  search bar.

### 4. Partial media query removed

The previous **partial** `@media (max-width: 768px)` of `css/styles.css`
that only forced 16px on the statistics fields was removed: the global
rule makes it unnecessary and it left the rest of the fields uncovered on
mobile. In `ocio/ocio.css` an equivalent media query is kept that
reinforces the 16px in the ocio's own fields on screens ≤768px.

### 5. PWA version bump

`20260815` → `20260816` in `index.html` (`?v=` of `css/styles.css`,
`ocio/ocio.css` and `js/app.js`), `js/config.js` (`APP_VERSION`) and
`service-worker.js` (`STATIC_ASSETS`), to invalidate the service worker's
cache and force the delivery of the new CSS.

### 6. Do not disable manual zoom

No `user-scalable=no` nor `maximum-scale=1` was added to the meta
viewport: the user's manual zoom is kept intact (verified: no occurrences
in `index.html`).

## Rejected alternatives

- **Disabling zoom in the meta viewport** (`user-scalable=no`,
  `maximum-scale=1`): rejected — it is the simplest solution but breaks
  accessibility (WCAG 1.4.4: text resizing without loss of content);
  besides, ADR-016 (accessibility review) already fixed the commitment
  not to limit the user's zoom.
- **Only raising the specific selectors, without a global rule**:
  rejected — any new field with font-size < 16px would silently
  reintroduce the bug; the global rule is the safety net making the
  policy sustainable going forward.
- **Capturing focus and doing `scrollIntoView`/adjustments in JS**:
  rejected — the automatic zoom is native browser behavior, not reliably
  cancelable from JS; the CSS solution is the standard path with zero
  maintenance cost.
- **Only the mobile media query (≤768px) with 16px**: rejected — it was
  the previous partial approach; it left fields uncovered and duplicated
  logic instead of fixing the policy in a single base rule.

## Consequences

### Positive

- **No automatic zoom on mobile**: focusing any field of the web
  (search, forms, dates, selects) no longer magnifies the page on iOS
  Safari nor Android Chrome; correct mobile UX in the whole writing flow.
- **Manual zoom intact**: users with low vision can keep magnifying the
  page; ADR-016's accessibility commitment is respected.
- **Future-proof policy**: the global rule `input, textarea, select {
  font-size: 16px }` on both sheets guarantees that no new field can fall
  below the minimum without an explicit review (any future reduction
  requires deliberately beating the base rule).
- **A single root cause, one CSS solution**: no HTML or JS changes; the
  version bump ensures the service worker's cache does not serve the old
  CSS.

### Negative / Considerations

- **Slightly larger fields on desktop**: inputs/selects go from ~0.72–0.95rem
  to 1rem, so they take some more vertical space in compact bars
  (searches, date rows, sorting selects). It is the accepted cost of the
  16px minimum.
- **Watch fixed widths in future development**: as the font grows, any
  fixed pixel width of a field (or its container) can overflow on mobile;
  future development must use relative units or
  `min()/clamp()`/`max-width: 100%` as in this ADR's adjustments (see
  AGENTS.md's responsiveness rule).
- **The global rule may surprise whoever declares font-size < 16px on a
  new field**: the result will be what the policy expects (16px), but
  whoever writes it must know the safety-net rule neutralizes it by
  design.

### Neutral

- **`docs/manual-de-usuario.md` unchanged**: the change is purely
  visual/ergonomic (the fields' text is now 16px and there is no automatic
  zoom); it does not alter any function, status, setting nor visible
  behavior the manual must describe.
- **No JS contract changes**: no function of `js/ui.js` nor `js/app.js` is
  affected; only CSS and versioning change.

## Created/modified files

| File | Change |
|---------|--------|
| `css/styles.css` | **Modified**: global rule `input, textarea, select { font-size: 16px; }` after the reset with the issue #92 comment; the partial `@media (max-width: 768px)` covering only the statistics fields removed; specific selectors raised to 1rem |
| `ocio/ocio.css` | **Modified**: global rule `input, textarea, select { font-size: 16px; }` at the top with the issue #92 comment; specific selectors raised to 1rem; `.episode-row input.episode-date` → `width: min(150px, 100%)`; `.library-search-input` → `width: clamp(150px, 30vw, 200px)` (+ `max-width: 100%`); ≤768px reinforcing media query on ocio fields |
| `index.html` | **Modified**: `?v=20260815` → `?v=20260816` on `css/styles.css`, `ocio/ocio.css` and `js/app.js` (no `user-scalable=no` / `maximum-scale=1` in the meta viewport) |
| `js/config.js` | **Modified**: `APP_VERSION` from `20260815` to `20260816` |
| `service-worker.js` | **Modified**: `STATIC_ASSETS` with `?v=20260816` (invalidates `20260815` and older caches) |
| `docs/adr-042-no-zoom-inputs-16px.md` | **New**: this document |

Related issue: #92 — https://github.com/gonzalitojh/personal-tracker/issues/92
