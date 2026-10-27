# ADR-064: Pure black and pure white modes (issue #43)

## Status
Accepted

## Date
2026-08-09

## Context

Issue #43 asks to **expand the theme system** with two new display
modes **without removing the existing ones**: a **pure black** mode
(background `#000000`, meant for OLED screens: switched-off pixels
consume less and the look feels deeper) and its **pure white
counterpart** (background `#ffffff`).

Before this decision the application had **two themes** (ADR-009):
the default dark one (defined in `:root` of `css/styles.css`) and the
light one (`[data-theme="light"]`), with per-element overrides for
the components that invert the `--ink`/`--paper` semantics. The
selection lived only in **Settings → Apariencia → Tema** (the
header's toggle button was removed in issue #75); the
preference is persisted in `localStorage` (key `"mi-registro-theme"`)
and synced with `settings.theme` (`syncThemeToSettings`). The existing
modes now get called **«Oscuro»** (dark) and **«Claro»** (light),
which was already their current label in the selector.

The implementation is **validated (QA PASS)** and **security-scanned
(PASS)** on this branch
(`feature/task-issue-43-modos-negro-y-blanco-puro`),
with a later fix from the QA review: visible hover of the profile
dropdown in pure white (see point 3). The user manual was updated
in the same task (`docs/manual-de-usuario.md` §14, rule 3 of
AGENTS.md). This ADR documents the decision retrospectively, like the
recent ones (ADR-059, ADR-060, ADR-061, ADR-062, ADR-063).

Related issue: #43 — https://github.com/gonzalitojh/Registro-personal/issues/43

## Decision

Add two new CSS variable blocks, `[data-theme="black"]` and
`[data-theme="white"]`, over ADR-009's existing architecture
(variables in `:root` + a `[data-theme="light"]` block + per-element
overrides), extending the light family's overrides to pure white
with comma-grouped selectors. The decision is organized in nine
points: the two variable blocks, the overrides, the Settings
selector, the application JS, the defense in `settings.js`, the
persistence, the PWA versioning and Chart.js compatibility.

### 1. The `[data-theme="black"]` block (a delta over `:root`, `css/styles.css`)

A **delta** block: it only redeclares what changes from the dark mode:

- `--ink: #000000` (general background) and `--ink-raised: #0a0a0a`
  (elevated surfaces, almost black).
- The five `--ink-alpha-*` tints (`06/08/10/15/20`) become
  `rgba(0, 0, 0, X)` (hover/focus tints over paper surfaces).

**Everything else inherits from `:root`**: `--paper` (`#f1ead9`,
parchment), accents (`--teal-reel`, `--ochre-spine`, `--stamp`),
shadows, `--date-picker-filter: invert(1)` (the date picker stays
dark) and the paper alphas. Thus the dark mode stays visually
intact with a purely black background. **No per-element overrides
are needed**: the components painting `background: var(--ink)` (body,
header, tab bar, `auth-screen`, `profile-view`,
`settings-select`) become pure black automatically.

### 2. The `[data-theme="white"]` block (the light family taken to the extreme, `css/styles.css`)

- `--ink: #000000`, `--ink-raised: #ffffff`, `--ink-soft: #6b6355`
  (secondary text), `--paper: #ffffff`, `--paper-dim: #ffffff`
  (general pure white background, here it does differ from light),
  `--paper-line: #d9cfc0` (borders).
- `--ink-alpha-*`: `rgba(0, 0, 0, X)` (translucent pure black).
- `--paper-alpha-14/20/30/35/40`: `rgba(0, 0, 0, X)` (dark borders
  over a white background); **`--paper-alpha-10` and `--paper-alpha-92`
  stay white** (`rgba(255, 255, 255, X)`): the 92% is the cards'
  stamps' translucent background, which must stay light.
- `--backdrop: rgba(0, 0, 0, 0.25)` and
  `--date-picker-filter: none` (same as light).
- **Somewhat stronger shadows than light** (`--shadow-card:
  0 8px 24px rgba(0,0,0,0.12)` and `--shadow-pop: 0 16px 44px
  rgba(0,0,0,0.18)` vs light's `0.08`/`0.12`): in pure white the
  white cards only separate from the background by the shadow.

The semantic accents (`--teal-reel`, `--ochre-spine`, `--stamp` and
their variants) are not redeclared: they are identical in `:root`
and in light, and work over any background (ADR-009's same
philosophy).

### 3. Per-element overrides extended to the white mode

The light mode's 19 per-element overrides are extended to
`[data-theme="white"]` by adding the selector to the already-existing
comma groups: `html`/`body`, `.auth-screen`, `.profile-view`,
`.icon-btn`, `.btn-link`, `.btn--outline-dark` (+ `:hover`),
`.app-footer`, `.profile-view__header select`, `.settings-select`,
`.stats-range-fields` (+ its `input[type="date"]`),
`.global-search__input`, `.activity-event__text`, the `.switch`'s
focus, `.app-header` and `.tabs--bar`. Two particularities:

- **`.app-footer`**: pure white uses `rgba(0, 0, 0, 0.55)` while
  light keeps its `rgba(44, 40, 34, 0.55)` — that is why it is not
  grouped: it needs its own rule.
- **`[data-theme="white"] .profile-dropdown__item:hover`** (new): in
  pure white the dropdown is white and its hover used `--paper-dim`
  (`#ffffff`), which would make it invisible; `background:
  var(--ink-alpha-06)` is used. It was the QA review's fix.

In `ocio/ocio.css` the 2 existing light overrides
(`.sort-select` and `.item-card__perforation`) are extended to
pure white with the same grouped-selectors pattern.

### 4. Theme selector in Settings (`index.html`)

`#settings-theme-select` goes from 2 to 4 options:

| value | Label |
|-------|----------|
| `dark` | Oscuro |
| `black` | Negro puro |
| `light` | Claro |
| `white` | Blanco puro |

### 5. `setTheme()` and `getSavedTheme()` (`js/app.js`)

- **`THEME_META_COLORS`**: map `{ dark: "#171512", black: "#000000",
  light: "#f5f0e8", white: "#ffffff" }` that `setTheme()` uses to
  update the `<meta name="theme-color">` (each mode's real background
  color); with `|| THEME_META_COLORS.dark` as a guard against
  unknown values.
- **`getSavedTheme()`**: validates the `localStorage` value with
  `Object.prototype.hasOwnProperty.call(THEME_META_COLORS, saved)`;
  any legacy or invalid value falls to `"dark"`. Calling
  `hasOwnProperty` over `Object.prototype` makes the check resistant
  to _prototype pollution_.

### 6. Defense in `js/settings.js`

`VALID_THEMES = ["dark", "black", "light", "white"]` (whitelist):
`renderSettings()` only assigns the stored theme to the select if it is in
the list; if not, it falls to `"dark"`. It protects against old or
corrupt values in `settings.theme`.

### 7. Persistence (unchanged)

The preference keeps being stored in `localStorage` (key
`"mi-registro-theme"`) and synced with `settings.theme`
(`syncThemeToSettings`), as in ADR-009. There is no new field in
the data model.

### 8. PWA versioning

**Bump `20260836` → `20260837`**: the PR touches `css/styles.css`,
`ocio/ocio.css`, `index.html`, `js/app.js` and `js/settings.js`, all
precached by the service worker (ADR-019), so the one-bump-per-PR
practice is applied (ADR-049/059/061) via
`scripts/bump-version.sh`: `js/config.js` (`APP_VERSION =
'20260837'`),
`index.html` (`?v=` ×3: `styles.css`, `ocio.css`, `app.js`) and
`service-worker.js` (`?v=` ×6 in `STATIC_ASSETS`).

### 9. Chart.js (unchanged)

`js/profile.js` already reads the charts' colors with
`getComputedStyle(...).getPropertyValue(...)` (ADR-009), so they adapt to
the 4 modes without touching a line of JS.

### WCAG contrast (verified)

| Pair | Ratio | Level |
|-----|-------|-------|
| `#f1ead9` (parchment) over `#000` (pure black) | 17.5:1 | AAA |
| `#948a76` (pure black's `--ink-soft`) over `#000` | 6.16:1 | AA |
| `#000` over `#fff` (pure white) | 21:1 | AAA |
| `#6b6355` (pure white's `--ink-soft`) over `#fff` | 5.93:1 | AA |
| `rgba(0,0,0,0.55)` (pure white's footer) over `#fff` | 4.74:1 | AA |

The existing modes keep their ratio: dark 15.2:1 and light 12.9:1
(main text).

## Rejected alternatives

- **Duplicating all the override rules per mode** (a
  `[data-theme="white"]` block repeating the light ones' content):
  rejected — it would duplicate ~19 rules unnecessarily. The choice was
  **extending the existing selectors with comma groups**
  (`[data-theme="light"] X, [data-theme="white"] X`), a single
  source of truth per rule.
- **Using the functional pseudo-class `:is()`** to group the
  selectors (`:is([data-theme="light"], [data-theme="white"]) X`):
  rejected — it works in modern browsers, but an explicit selector
  group was preferred for a low-risk and maximum-compatibility review
  (GitHub Pages, no build step).
- **Reusing the light mode's values for pure white**
  (`--paper-dim: #f5f0e8` instead of `#ffffff`, light's shadows):
  rejected — pure white requires its own `--paper-dim` (absolute
  white) and stronger shadows; the white cards only separate
  from the background by the shadow.
- **Making `[data-theme="black"]` a complete duplicated block** of
  `:root` with the changes: rejected — a **delta block** (only
  `--ink`, `--ink-raised` and the `--ink-alpha-*`) minimizes the change
  surface and guarantees that pure black always inherits the rest of
  the dark mode's variables (paper, accents, shadows, the date picker's
  filter) even as `:root` evolves.
- **Adding new names/labels for the existing modes**:
  rejected — «Oscuro» and «Claro» were already the selector's labels;
  the issue asks to add modes without removing or renaming the current
  ones.

## Consequences

### Positive

- **Issue #43 solved**: four selectable modes in Settings → Apariencia →
  Tema (Oscuro, Negro puro, Claro, Blanco puro), without removing any
  of the existing ones (acceptance criterion 1).
- **Energy saving on OLED** with pure black: switched-off pixels
  consume less and the look feels deeper.
- **WCAG AA/AAA contrast in the two new modes** (17.5:1, 6.16:1,
  21:1, 5.93:1 and 4.74:1 — table above), keeping the existing modes'
  ratios.
- **No regressions**: the `:root` and `[data-theme="light"]` blocks are
  not modified (they remain byte-identical); everything new is scoped
  under `[data-theme="black"]` and `[data-theme="white"]`.
- **Zero layout impact**: the blocks only change colors; there are no
  new measures, positions nor units (AGENTS.md's responsiveness
  criterion / ADR-026), verified at 360/768/1280 px.
- **Defense in depth**: invalid or legacy `localStorage` and
  `settings.theme` values always fall to the dark mode
  (`getSavedTheme` with `hasOwnProperty` — resistant to prototype
  pollution — and the `VALID_THEMES` whitelist).
- **Persistence intact**: the preference is stored and restored as
  until now; Chart.js adapts by itself (getComputedStyle, ADR-009).
- **The pure black mode is maintenance-free**: being a delta,
  any evolution of `:root` (paper, accents, shadows) applies
  automatically.

### Negative / Risks

- **Separation only by shadow in pure white**: the white cards
  over a white background rely on the shadow (and some borders) to
  differentiate; if a future design softened the shadows, the mode
  would lose depth.
- **Invisible decorative perforation in pure white**: the cards'
  "cinema ticket" perforation (`item-card__perforation`) shows
  `--paper-dim`, which in pure white is white: the decorative effect is
  not appreciated (accepted, it is purely aesthetic).
- **~60 extra CSS lines** between the two delta blocks and the added
  selector groups; each new member of the light family will also need
  its extension to white.
- **Comments to keep in sync**: the blocks document their contrasts;
  if a color changes, the comment must be updated and the ratio
  verified.

### Neutral

- **No new dependencies**: ADR-009's same architecture (CSS
  Custom Properties + `[data-theme]` on `<html>`); GitHub Pages without
  a build step.
- **Dark and pure black share almost all variables**: the delta
  only touches ink and tints; light and pure white share most of the
  palette (they differ in `--paper-dim`, shadows and ink alphas).
- **Routine PWA bump** `20260836` → `20260837`, one bump per PR
  (ADR-049/059/061), for touching precached assets (ADR-019).
- **User manual up to date** (§14 Settings → Apariencia → Tema: the
  four modes and their descriptions, the choice is stored automatically)
  — AGENTS.md's rule 3.

## Created/modified files

| File | Change |
|---------|--------|
| `css/styles.css` | **Modified**: the delta block `[data-theme="black"]` (`--ink #000000`, `--ink-raised #0a0a0a`, tints `--ink-alpha-*` in `rgba(0,0,0,X)`; the rest inherits from `:root`); the `[data-theme="white"]` block (extreme light family: `--ink #000`, `--paper`/`--paper-dim`/`--ink-raised` `#fff`, `--ink-soft #6b6355`, dark paper alphas except 10%/92%, `--backdrop rgba(0,0,0,0.25)`, `--date-picker-filter none`, shadows 0.12/0.18); all of `[data-theme="light"]`'s per-element overrides extended to `[data-theme="white"]` with grouped selectors; the white `.app-footer` with `rgba(0,0,0,0.55)` (own rule, not grouped); new rule `[data-theme="white"] .profile-dropdown__item:hover` with `--ink-alpha-06` (QA fix) |
| `ocio/ocio.css` | **Modified**: the `.sort-select` and `.item-card__perforation` overrides extended to `[data-theme="white"]` with grouped selectors |
| `index.html` | **Modified**: `#settings-theme-select` with 4 options (`dark`/Oscuro, `black`/Negro puro, `light`/Claro, `white`/Blanco puro); bump `?v=20260836` → `?v=20260837` (×3: `styles.css`, `ocio.css`, `app.js`) |
| `js/app.js` | **Modified**: the `THEME_META_COLORS` map (`dark #171512`, `black #000000`, `light #f5f0e8`, `white #ffffff`) used by `setTheme()` for `meta[name=theme-color]` (fallback to dark); `getSavedTheme()` normalizes invalid/legacy values to `"dark"` with `hasOwnProperty` (resistant to prototype pollution) |
| `js/settings.js` | **Modified**: whitelist `VALID_THEMES = ["dark", "black", "light", "white"]`; `renderSettings()` falls to `"dark"` if the stored theme is invalid |
| `js/config.js` | **Modified**: `APP_VERSION` `20260836` → `20260837` |
| `service-worker.js` | **Modified**: bump `?v=20260836` → `?v=20260837` on the 6 versioned assets of `STATIC_ASSETS` (via `scripts/bump-version.sh`) |
| `docs/manual-de-usuario.md` | **Modified**: §14 Settings → Apariencia → Tema documents the 4 modes (Oscuro, Negro puro with OLED saving, Claro, Blanco puro) and that the choice is stored automatically — AGENTS.md's rule 3 |
| `tasks/task-issue-43.json` | **Modified**: the task's state (implemented → QA validated → security scanned) with the `pr` block and issue #43 |
| `docs/adr-064-modos-negro-puro-y-blanco-puro.md` | **New**: this document |

Related issue: #43 — https://github.com/gonzalitojh/Registro-personal/issues/43
