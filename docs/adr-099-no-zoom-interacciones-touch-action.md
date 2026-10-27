# ADR-099: Never zoom on any interaction: the touch-action: manipulation and a font-size >= 16px on all the inputs (issue #275)

## Status
Accepted

## Date
2026-08-13

## Context

Issue #275 reported
an
**automatic zoom on mobile** when pressing on
text
fields, detected on the
**gym's exercises'
edition** (when entering the
exercise's name), with the
requirement that the
solution be a
**rule for the WHOLE web**: never
zoom on any
interaction.

The ADR-042
(issue #92) already
established
the
`font-size >= 16px` policy on
all the fields and the
`input, textarea, select { font-size: 16px; }` global rule in
the
`css/styles.css` and the
`ocio/ocio.css`. **BUT the
global rule is a
low-specificity safety net**: 7
specific
selector groups overwrote it with a
`font-size` of
0.85–0.9rem (the 13.6–14.4px), added on
developments after
the
ADR-042 (the
recipes, the
shopping, the
ingredients and the
issue-62 branch's gym
section), reintroducing the
zoom on their fields. The
groups:

- The `.ingredient-modal__field input/select` (the
  0.9rem);
- The `.shopping-extra-form__row input/select` + the
  `.ing-combo .ing-nombre` (the 0.85rem);
- The `.recipe-form__import-row input` (the
  0.85rem);
- The `.recipe-form__field input/textarea` + the
  `.recipe-form__newtag`, the
  `.recipe-form__paso` and the
  `.recipe-form__ingrediente input/select` (the 0.88rem);
- The `.gym-form__field input/select/textarea` (the
  0.9rem);
- The `.gym-exercise-block select/input[type="text"]` (the
  0.9rem);
- The `.gym-series-row input` (the
  0.9rem).

Also, the zoom can also get triggered by a
**double
tap** on any
interactive element (the
buttons, the
links, the
fields), regardless of the
`font-size`, an
avenue the
ADR-042 did not cover.

Branch
context: the decision gets implemented on the
`fix/issue-275-evitar-zoom`
branch and documented retrospectively, like the recent ADRs (the
ADR-093, the
ADR-094, the
ADR-095, the
ADR-096, the
ADR-097, the
ADR-098).

Related issue: #275 — https://github.com/gonzalitojh/personal-tracker/issues/275

## Decision

### 1. The 7 specific selector groups rise to 1rem

The 7 groups listed in the context rise to a
`font-size: 1rem` (the
16px), **without
touching the colors, the paddings nor the selectors**, adding
the
`/* ADR-042: nunca < 16px en inputs */` comment on
each one, following the
precedent of the same comment already present on the stylesheet since the
ADR-042 (the
3498/3683 lines
before the fix; this issue's `touch-action` block
shifts
them to ~3503 and ~3688 on the final state).

### 2. The new `touch-action: manipulation` global rule on both stylesheets

It gets added on **both**
stylesheets
:

```css
button, a, input, select, textarea { touch-action: manipulation; }
```

- on the
  `css/styles.css`, right
  **after the
  ADR-042's global inputs
  rule** (~line 517);
- on the
  `ocio/ocio.css`, on the
  **same
  position** at
  the
  file's start (~line 17);

both with a comment referencing the issue
#275. The
rule removes the
**double-tap
zoom** on any interaction (the
buttons, the links, the
fields) while **keeping the
panning and the pinch zoom**: it does not disable the
manual zoom, in
line with the
ADR-042 and the
ADR-016 (with no
`user-scalable=no` nor
`maximum-scale=1` on
the
meta viewport).

### 3. A sustainable audit: the
  `scripts/audit-input-font-sizes.py`

A new script that closes
the
gap the
ADR-042's safety net left
(insufficient against the specific
selectors):

- it detects selectors declaring a
  `font-size < 16px` on
  the
  `input`/`select`/`textarea` on both stylesheets (the
  `css/styles.css` and the
  `ocio/ocio.css`), and
- it verifies the
  **two global rules' presence** (the
  ADR-042's inputs'
  one and this issue's
  `touch-action` one).

It returns an exit
0/1, so it is usable on CI and pre-commit as an anti-regression guard: any new field below the
minimum or the
removal of a
global rule fails the audit automatically.

### 4. The PWA's version bump
  to the
  `20260929`

The
`20260928` version →
the
`20260929` (via the
`scripts/bump-version.sh`) on:

- The
  `index.html`: the
  `?v=20260929` on the
  `css/styles.css`, the
  `ocio/ocio.css` and the
  `js/app.js` (with no
  `user-scalable=no` / the
  `maximum-scale=1` on the meta viewport);
- The
  `js/config.js`: the
  `APP_VERSION`;
- The
  `service-worker.js`: the
  `STATIC_ASSETS`.

To invalidate the service worker's cache and force the new CSSs' delivery.

## Rejected alternatives

- **Disabling the zoom on the meta viewport** (the
  `user-scalable=no` /
  the
  `maximum-scale=1`): rejected — it breaks the accessibility (the
  WCAG 1.4.4: the
  text resizing without a
  content loss), the same
  reasoning already documented in
  the
  ADR-042 and the
  ADR-016.
- **Only raising the gym's fields**: rejected — the
  report came from there, but the
  rule must hold for the **whole web**: the
  7 groups got audited and fixed, including the
  recipes, the shopping and the ingredients, which had the same latent defect.
- **A JS-based fix** (capturing the focus, the
  `scrollIntoView`, etc.): rejected — the
  double-tap
  and focus-triggered zoom is the
  browser's native behavior, not reliably cancelable from the
  JS; the CSS solution is the standard and maintenance-free way.

## Consequences

### Positive

- **No zoom on the whole web**: neither when
  focusing the
  fields (the 7 groups already meet the 16px minimum) nor by a
  double tap on any interaction (the
  buttons, the links, the fields), thanks to the
  `touch-action: manipulation`.
- **The manual pinch zoom kept**: the low-vision users can keep
  enlarging the page; the
  ADR-042/ADR-016's accessibility compromise stays.
- **An automated anti-regression audit**: the new
  `scripts/audit-input-font-sizes.py` detects on CI/pre-commit any selector dropping below
  16px again or a
  global rule's
  loss; the ADR-042's passive
  safety net gets
  reinforced with an
  active guard.

### Neutral

- **The user manual unchanged**: a purely ergonomic fix, with no
  new features, states nor settings; the ADR-042's same precedent (the
  AGENTS.md's rule 3 does not apply).
- **No JS contract changes**: no function of the
  `js/*.js` gets affected; only the CSS, the
  versioning and the new
  audit script change.

### Negative / Risks

- **The gym/recipes/shopping/ingredients' fields slightly bigger
  on desktop**: those forms' inputs/selects go
  from the
  0.85–0.9rem to the
  1rem; it is the assumed cost of the 16px minimum, the same one the
  ADR-042 already documented. Verify their
  containers' flexible widths absorb the
  increase (they
  already have the
  `min-width: 0` /
  the relative units, per
  the
  AGENTS.md's responsiveness rule).
- **No other known ones.**

## Created/modified files

| File | Change |
|---------|--------|
| `css/styles.css` | **Modified**: the 7 specific selector groups (the ingredient-modal, the shopping-extra-form, the recipe-form import/field/newtag/paso/ingrediente, the gym-form, the gym-exercise-block, the gym-series-row) rise from the 0.85–0.9rem to a `font-size: 1rem` with the `/* ADR-042: nunca < 16px en inputs */` comment; the new global `button, a, input, select, textarea { touch-action: manipulation; }` rule after the inputs' one (~line 517) with the issue #275's comment |
| `ocio/ocio.css` | **Modified**: the new global `button, a, input, select, textarea { touch-action: manipulation; }` rule at the start (~line 17) with the issue #275's comment |
| `index.html` | **Modified**: the `?v=20260928` → the `?v=20260929` on the `css/styles.css`, the `ocio/ocio.css` and the `js/app.js` (with no `user-scalable=no` / the `maximum-scale=1` on the meta viewport) |
| `js/config.js` | **Modified**: the `APP_VERSION` from the `20260928` to the `20260929` |
| `service-worker.js` | **Modified**: the `STATIC_ASSETS` with the `?v=20260929` (it invalidates the `20260928` and earlier caches) |
| `scripts/audit-input-font-sizes.py` | **New**: an audit that detects `input`/`select`/`textarea` selectors with a `font-size < 16px` on both stylesheets and verifies the two global rules' presence (the ADR-042's inputs and the #275's `touch-action`); an exit 0/1 for CI/pre-commit |
| `docs/adr-099-no-zoom-interacciones-touch-action.md` | **New**: this document |

Related issue: #275 — https://github.com/gonzalitojh/personal-tracker/issues/275
