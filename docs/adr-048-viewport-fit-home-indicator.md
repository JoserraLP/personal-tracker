# ADR-048: Space under the tabs on iPhone (viewport-fit=cover) (issue #116)

## Status
Accepted

## Date
2026-08-07

## Context

Issue #116 reports that on iPhone the **system home bar**
(home indicator, the bar that allows switching applications) **overlaps
the bottom fixed tab bar** (`.tabs--bar`, created in
ADR-040 from issue #79): the tabs are partially covered by the home
indicator and the list's last row is also affected. The report requires
that the fix **not affect Android**
(the only OS where it does not happen).

**Root cause** (detected in the initial analysis): the meta viewport of
`index.html` was `content="width=device-width, initial-scale=1.0"` **WITHOUT
`viewport-fit=cover`**. Without that declaration, iOS Safari does not extend
the layout viewport to the **unsafe areas** (the margins taken up by the
home indicator and the notch) and, consequently, `env(safe-area-inset-
bottom)` returns **always 0**, even though the CSS already used it — with the
`0px` fallback — in the three places where the safe margin is needed:

1. `css/styles.css` line ~509: `.app`'s bottom `padding` (the content gap
   so the last row and the footer are not covered by the bottom bar).
2. `css/styles.css` line ~765: `.tabs--bar`'s `padding-bottom: env(safe-area-inset-
   bottom, 0px)` (the fixed shell `bottom: 0`).
3. `css/styles.css` line ~938: the `.toast`'s `bottom`.

These three uses were introduced in ADR-040 («iOS PWA contemplada»:
safe margin in the bar, the content gap and the toast), but they were
**inert**: without `viewport-fit=cover` iOS always reports 0. On Android
`env(safe-area-inset-bottom)` is 0 by definition, so enabling the
safe margin on iOS does not alter that OS.

Related issue: #116 — https://github.com/gonzalitojh/personal-tracker/issues/116

## Decision

**Root-cause fix in a single attribute**, without touching CSS or
JS logic:

### 1. `viewport-fit=cover` in the meta viewport

`index.html` line 5:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

With `viewport-fit=cover`, iOS Safari extends the layout viewport to the
unsafe areas and `env(safe-area-inset-bottom)` returns the **device's
real margin** (e.g. ~34px on an iPhone with home indicator).
The three `env()` uses already present in `css/styles.css` become active
**without any CSS change**:

- `.tabs--bar` (line ~765): the safe margin is added under the tabs
  → the home indicator stops overlapping the bar; the extra space
  inherits the bar's background (`var(--ink)` in the paper theme,
  `var(--paper-dim)` in the light one, integrated with the web since ADR-040
  iteration 4) → visually integrated.
- `.app` (line ~509): the content's bottom gap grows by the same
  margin → the list's last row and the footer are never covered by
  the bar nor by the home indicator.
- `.toast` (line ~938): the floating notice is repositioned above
  the bar + safe margin → not hidden behind the home indicator.

### 2. Android, desktop and iPad are not affected

In those environments `env(safe-area-inset-bottom)` is 0 and the
`0px` fallback of the three declarations covers any browser without
support: the layout is **identical to before**. At ≥768 px additionally
`.tabs--bar`'s `padding-bottom: 0` (ADR-040 iteration 4) cancels the
safe margin where there is no bottom bar, so the iPad gains no
extra space. Issue #116's explicit requirement of not affecting Android
is met.

### 3. PWA version bump `20260816` → `20260817`

Via `scripts/bump-version.sh`, in the three versioned files
(the project's standard pattern, see ADR-040/ADR-042):

- `index.html`: `?v=20260817` on `css/styles.css`, `ocio/ocio.css` and
  `js/app.js`.
- `js/config.js`: `APP_VERSION` from `20260816` to `20260817`.
- `service-worker.js`: `STATIC_ASSETS` with `?v=20260817` (6 entries:
  styles, ocio.css, app.js and the three `ocio/*.html`); invalidates
  the `20260816` and older caches and forces delivery of the `index.html`
  with the new meta viewport.

### 4. No CSS or JS logic changes; user manual intact

`css/styles.css`, `ocio/ocio.css` and `js/app.js` are not touched: the CSS already
contained the correct `env()` uses and they only needed to be enabled from
the viewport. `docs/manual-de-usuario.md` requires no changes either: section
3 already describes the bottom tab bar and the safe margin
is a device detail (same precedent as ADR-040 iteration 4,
which did not touch the manual for an equivalent change, and ADR-042).

## Rejected alternatives

- **Adding a fixed `padding-bottom` in px to the CSS**: rejected — a fixed
  value (e.g. 34px) would also add space on Android and on iPhones
  without home indicator, where the home indicator does not exist,
  failing the issue's requirement; it also does not scale across devices
  (the safe margin varies) and clashes with AGENTS.md's responsiveness
  rule to avoid fixed `px` in containers.
- **Detecting iOS via JS (`navigator.userAgent`) and applying a conditional
  class**: rejected — fragile (spoofable and changing userAgent,
  iPadOS, future devices), adds logic and state where the standard
  `env()` + `viewport-fit=cover` solves it declaratively and without
  maintenance; it would also be a workaround of a root cause that gets
  fixed in an attribute.
- **Touching the CSS to add more `env()` uses**: rejected — the
  three necessary uses (tabs, content gap and toast) **already
  existed** with their fallback; the problem was that iOS nullified them
  due to the missing `viewport-fit=cover`. Adding more declarations
  would not have changed anything without fixing the viewport.

## Consequences

### Positive

- **On an iPhone with home indicator the system bar stops overlapping
  the tabs**: there is a space under the bar equal to the device's real
  safe margin (~34px), with the same background as the web
  (`var(--ink)` / `var(--paper-dim)`) → visually integrated, with no
  stripes of another color.
- **Zero impact on Android, desktop and iPad**: `env()` = 0 (and the
  `0px` fallback) in those environments and the cancellation at ≥768 px → layout
  identical to before; issue #116's requirement is met.
- **The three areas are covered with a single change**: the same
  declaration enables the margin in the tab bar (`.tabs--bar`),
  in the content gap (`.app`) and in the toast.
- **Minimal root-cause fix**: one attribute in the meta viewport,
  with no CSS nor JS logic changes → almost null regression risk,
  coherent with ADR-042's precedent (root-cause fix without touching
  the wrong layer).
- **ADR-040's `env()` uses stop being inert**: the original
  design («iOS PWA contemplada») is truly fulfilled as of this
  version.

### Negative / Risks

- **Physical validation needed on an iPhone with home indicator**: the
  effect is not reproducible in a headless environment nor in DevTools
  emulation (the real `env()` depends on the device context), so the
  definitive check of the acceptance criterion must be done on a physical
  iPhone with home indicator.
- **Behavior differs between iPhones**: on models without home
  indicator (physical button) the margin is 0 and the look does not
  change — correct behavior, but the space only appears where the
  device needs it.

### Neutral

- **`docs/manual-de-usuario.md` unchanged**: section 3 already describes
  the bottom tab bar; the safe margin is a device detail
  (precedents: ADR-040 iteration 4 and ADR-042).
- **PWA versioned to `20260817`**: `APP_VERSION`, `?v=` in `index.html`
  and `STATIC_ASSETS` invalidate the `20260816` and older caches.
- **No JS contract changes**: no function of `js/app.js` nor
  of the modules is affected.

## Created/modified files

| File | Change |
|---------|--------|
| `index.html` | **Modified**: meta viewport (line 5) → `width=device-width, initial-scale=1.0, viewport-fit=cover`; `?v=20260816` → `?v=20260817` on `css/styles.css`, `ocio/ocio.css` and `js/app.js` |
| `js/config.js` | **Modified**: `APP_VERSION` from `20260816` to `20260817` |
| `service-worker.js` | **Modified**: `STATIC_ASSETS` with `?v=20260817` (6 entries: styles, ocio.css, app.js, series/peliculas/libros.html); invalidates the `20260816` and older caches |
| `css/styles.css` | **Unchanged**: it already contained `env(safe-area-inset-bottom, 0px)` in `.app` (line ~509), `.tabs--bar` (line ~765) and `.toast` (line ~938); they only needed to be enabled from the viewport |
| `docs/manual-de-usuario.md` | **Unchanged**: section 3 already describes the tab bar; the safe margin is a device detail |
| `docs/adr-048-viewport-fit-home-indicator.md` | **New**: this document |

Related issue: #116 — https://github.com/gonzalitojh/personal-tracker/issues/116
