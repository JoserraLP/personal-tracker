# ADR-009: Light mode (light/dark theme alternative)

**Date:** 2026-07-29
**Status:** Accepted
**Last updated:** 2026-08-03 (complete redefinition of the light mode palette and targeted overrides — see section "2026-08-03 update")

## Context

The application "Mi Registro" was originally designed with a single dark theme
(default), inspired by a "reading table" or "library notebook" with a dark
brown background (`--ink: #171512`) and parchment-toned text
(`--paper: #f1ead9`). All colors were hardcoded in CSS with no
abstraction layer, and the CSS in `ocio/ocio.css` contained literal
hexadecimal values scattered across the whole file.

There was no:

- Way to switch to a light theme.
- CSS variables system to define colors once and
  reuse them.
- Persistence of the user's preference between sessions.
- Adaptation of the Chart.js colors (profile) when switching theme.
- Update of `<meta name="theme-color">` for the browser's
  navigation bar.

### Problem found in the QA review (2026-08-03)

After the initial implementation of the theme system, the QA review revealed that
light mode was **barely distinguishable from dark mode**:

- The variable `--ink` (used by `html`/`body` as `background`) was still
  dark (`#1e1b16` versus `#171512` in dark mode), so the overall background of the application stayed practically the same. Elements that
  use `background: var(--ink)` (`.auth-screen`, `.profile-view`, etc.) remained
  dark.
- The root cause is a **semantic conflict** of the variables: `body` uses
  `--ink` as background and `--paper` as text, while cards use
  `--paper` as background and `--ink` as text. A single pair of variables cannot
  serve both modes correctly with a simple redeclaration of values:
  light mode requires an explicit per-element inversion.

## Decision

Implement a **light/dark theme system** based on **CSS Custom
Properties (CSS variables)** combined with a **`[data-theme]`
attribute on `<html>`**, controlled by JavaScript with `localStorage` persistence,
and **completely redefine the light mode palette** with targeted per-element
overrides (see "2026-08-03 update").

### Theme system architecture

1. **Variable definitions in `:root`** — All color variables
   are defined in `:root` with the dark theme values (default).
   This includes not only the base colors (`--ink`, `--paper`, `--teal-reel`,
   etc.), but also alpha variants (`--ink-alpha-06`,
   `--paper-alpha-20`, etc.) and state variables (`--bg-state-en_curso`,
   `--bg-state-completado`, etc.). **This block has not been modified** in the
   2026-08-03 update.

2. **Override with `[data-theme="light"]`** — A `[data-theme="light"]` block
   redeclares the same variables with values adapted to light mode (see
   updated palette below).

3. **Shared state variables** — The state colors
   (`--bg-state-en_curso`, `--bg-state-completado`, etc.) and the accents
   (`--teal-reel`, `--ochre-spine`, `--stamp`, with their dark variants)
   are the same in both themes because they are semantic colors that work
   over any background.

4. **Control JavaScript (`js/app.js`):**
   - `setTheme(theme)`: sets `data-theme` on `<html>`, persists to
     `localStorage`, updates the button icon (☀️/🌙), the ARIA
     label, and the `<meta name="theme-color">` (`#171512` dark /
     `#f5f0e8` light).
   - `getSavedTheme()`: reads from `localStorage` with the key
     `"mi-registro-theme"`, returns `"dark"` by default if there is no
     saved preference.
   - The preference is restored **before** painting any content
     (`setTheme(getSavedTheme())` at the start of `init()`).

5. **Toggle button in the interface (`index.html`):**
   - Button with `role="switch"`, `aria-checked`, dynamic `aria-label`.
   - The visual icon (`#theme-toggle-icon`) has `aria-hidden="true"`
     (semantic info goes in `aria-label`).
   - The click event in `app.js` toggles between `"dark"` and `"light"`.

6. **Adaptive Chart.js (`js/profile.js`):**
   - The chart colors (monthly activity and distribution by
     state) are read via
     `getComputedStyle(document.documentElement).getPropertyValue("--teal-reel")`,
     so they update automatically when the theme changes (after
     reloading or rebuilding the profile).

7. **Refactoring of `ocio/ocio.css`:**
   - All hardcoded color values were replaced with references to CSS
     variables (`var(--ink)`, `var(--paper)`, `var(--teal-reel)`, etc.), which makes `ocio/ocio.css`
     compatible with both themes without duplicating styles. In the
     2026-08-03 update a small block of `[data-theme="light"]` overrides was also added for the few components that do not inherit
     the variables correctly (see below).

### 2026-08-03 update: redefinition of the light mode palette

#### Redefined palette

The `[data-theme="light"]` block of `css/styles.css` was completely rewritten with
a genuinely light palette (cream background, dark text,
white cards):

| Variable | Old value (invalid) | New value | Use |
|----------|---------------------|-----------|-----|
| `--ink` | `#1e1b16` | `#2c2822` | Main text (dark ink) |
| `--ink-raised` | `#f2ede6` | `#ffffff` | Raised surfaces (pure white) |
| `--ink-soft` | `#6b6559` | `#6b6355` | Secondary / muted text |
| `--paper` | `#faf6f0` | `#ffffff` | Cards and surfaces (pure white) |
| `--paper-dim` | `#f0e8dc` | `#f5f0e8` | Overall app background (light cream) |
| `--paper-line` | `#d4c9b8` | `#d9cfc0` | Lines and borders on cream |
| `--backdrop` | `rgba(0,0,0,0.35)` | `rgba(0,0,0,0.25)` | Modal/overlay shadows |

#### Inverted alpha variables

- **`--ink-alpha-*`** (`06/08/10/15/20`): based on `rgba(44, 40, 34, X)`
  (the new ink), used as hover/focus tints over light surfaces.
- **`--paper-alpha-14/20/30/35/40`**: redefined as `rgba(44, 40, 34, X)`
  (translucent dark ink) because they are used as **borders on light background**.
- **`--paper-alpha-10`** and **`--paper-alpha-92`**: kept based on
  white (`rgba(255, 255, 255, X)`) — the 92% one is the translucent background of the
  card "stamps", which must remain light.

#### Softened shadows

- `--shadow-card`: `0 8px 20px rgba(0, 0, 0, 0.08)`
- `--shadow-pop`: `0 16px 40px rgba(0, 0, 0, 0.12)`

#### Targeted overrides section in `css/styles.css`

A new section of per-element `[data-theme="light"]` rules was added, with a comment documenting the rationale: elements that
use `--ink` as background or `--paper` as text color need explicit
inversion because in light mode the overall background is light and the ink is dark.

Elements covered:

- `html, body` — `background: var(--paper-dim)`; `color: var(--ink)`
- `.auth-screen` — background with soft radial gradients over `--paper-dim`
- `.profile-view` — `background: var(--paper-dim)`; `color: var(--ink)`
- `.icon-btn` — `color: var(--ink)`
- `.btn--ghost` / `.btn--ghost:hover` — dark ink, dark alpha border
- `.btn-link` — `color: var(--ink)`
- `.btn--outline-dark` / hover — dark ink, dark alpha border, hover with
  `--ink-alpha-10`
- `.app-footer` — `color: rgba(44, 40, 34, 0.55)`
- `.profile-view__header select` — `color: var(--ink)`
- `.settings-select` — white background, dark ink, `--paper-alpha-30` border
- `.stats-range-fields` and its `input[type="date"]` — white background, dark
  ink, `--paper-line` border
- `.friend-detail__section h3` — `color: var(--ink)`
- `.global-search__panel` (white background + border), `.global-search__input`,
  `.global-search__item-title`, `.global-search__friend-name`,
  `.global-search__close:hover`
- `.activity-event__text` — `color: var(--ink)`
- `.switch__input:focus-visible + .switch__slider` — ink-tinted outline

#### Overrides in `ocio/ocio.css`

A `[data-theme="light"]` block (22 lines) was added at the end of
`ocio/ocio.css`:

- `.sort-select` and `.library-search-input` — `color: var(--ink)` (they used
  `--paper` as text color).
- `.item-card__perforation` — the "movie ticket" perforation now
  holes the card letting `--paper-dim` (cream, the actual page background
  in light mode) show through instead of the dark ink.

#### Meta theme-color

`js/app.js`: the `<meta name="theme-color">` color for light mode was
updated from `#faf6f0` (old `--paper` color) to `#f5f0e8` (the new
`--paper-dim`, which is the actual background color in light mode). The dark
mode value remains `#171512`.

### Rejected alternatives

| Alternative | Reason for rejection |
|-------------|----------------------|
| **CSS preprocessor (Sass/LESS)** | Adds an unnecessary build dependency; the project is plain HTML+CSS+JS hosted on GitHub Pages with no build step. Native CSS variables solve the problem. |
| **`prefers-color-scheme` (media query)** | Gives the user no control to change the theme manually. Could be combined as a default, but the project prioritizes the user's explicit choice. |
| **Theming via JavaScript (style injection)** | More complex and less accessible; CSS variables are declarative, faster and work with the browser DevTools. |
| **Two separate stylesheets** | Massive CSS duplication; hard to maintain. With shared variables a single set of rules works for both themes. |
| **Fully inverting the `--ink`/`--paper` variables in light mode** (semantic role change) | Rejected in the 2026-08-03 update: it would break all components that assume `--paper` as the light card color and `--ink` as ink. The choice was to keep the variables' semantics and add explicit overrides only where roles are inverted (background vs. text). |

## Consequences

### Positive

- **Light mode is now genuinely light**: cream background `#f5f0e8`,
  dark text `#2c2822` and white cards `#ffffff`. The visual difference
  from dark mode is evident.
- **WCAG AA/AAA contrast**: main text `#2c2822` on `#f5f0e8` background
  ≈ 12.7:1 (comfortably exceeds WCAG AAA of 7:1); secondary text `--ink-soft`
  `#6b6355` ≈ 5:1 (exceeds WCAG AA of 4.5:1). On white cards the
  contrast is even higher (≈14.6:1 and ≈5.9:1 respectively).
- **Dark mode with no regressions**: the `:root` block was not modified; the
  added overrides are all scoped under `[data-theme="light"]`, so
  dark mode (default) behaves exactly as before.
- Borders, hovers and focus rings in light mode use translucent ink, readable
  against the cream background.
- The `<meta name="theme-color">` matches the actual background color in each
  mode (native on mobile browsers).
- The advantages of the original system remain: preference persistence
  in `localStorage`, adaptive Chart.js, accessible toggle button
  (`role="switch"`, `aria-checked`, dynamic `aria-label`) and `ocio/ocio.css`
  compatible with both themes.

### Negative

- Light mode adds ~100 lines of targeted override CSS
  (`[data-theme="light"]` + selectors) split between `css/styles.css` and
  `ocio/ocio.css`. Every new component using `--ink` as background or
  `--paper` as text will need an additional override.
- The semantic conflict of `--ink`/`--paper` (background vs. ink depending on the
  element) remains latent in the architecture: the overrides are the way to
  resolve it, but they must be maintained when adding components.
- The JS logic adds ~30 lines and one event listener.
- `localStorage` is synchronous and may be unavailable in third-party
  contexts (not applicable on GitHub Pages, but a known limitation).
- Chart.js charts are not repainted automatically when changing theme on
  the fly — they require reloading the profile view or
  rebuilding the charts.

### Neutral

- The total number of CSS variables is ~45 (shared between both themes,
  redefining only those that change).
- The project does not incorporate any new dependency.
- `--teal-reel`, `--ochre-spine`, `--stamp` and their dark and alpha
  variants are identical in both themes (shared semantic colors).

## Files modified

| File | Change |
|------|--------|
| `css/styles.css` | Added `:root` block with dark mode variables (unchanged since); `[data-theme="light"]` block **completely rewritten** (2026-08-03) with the new palette, inverted alphas and softened shadows; added per-element `[data-theme="light"]` overrides section (html/body, auth-screen, profile-view, buttons, selects, inputs, global search, activity feed, switch); variable `--date-picker-filter`; `.theme-toggle` styles. |
| `ocio/ocio.css` | Replaced hardcoded color values with CSS variables; added `[data-theme="light"]` block (2026-08-03) for `.sort-select`, `.library-search-input` and `.item-card__perforation`. |
| `index.html` | Added button `#btn-theme-toggle` with icon and ARIA attributes in the app header. |
| `js/app.js` | Added functions `setTheme()`, `getSavedTheme()`, constant `STORAGE_KEY_THEME`, and event listener for the toggle; light mode meta theme-color updated to `#f5f0e8` (2026-08-03). |
| `js/profile.js` | Modified Chart.js colors to read from `getComputedStyle` instead of fixed values. |

## Persisted data structure

```json
// localStorage key "mi-registro-theme"
"dark"    // default
"light"   // if the user enabled light mode
```
