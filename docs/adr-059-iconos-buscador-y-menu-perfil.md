# ADR-059: Icons in the global search and in the profile menu (issue #134)

## Status
Accepted

## Date
2026-08-09

## Context

Issue #134 (type: style) asks for two icon-related visual improvements:

1. **Profile dropdown menu**: the dropdown (`#profile-dropdown`,
   `index.html`) had 4 section entries (Estadísticas, Amigos,
   Actividad, Ajustes) + Cerrar sesión, **all without icons**.
2. **Global search**: the top bar (`#global-search-results`,
   `js/global-search.js`) used **emojis** 📺/🎬/📚 for the media
   types in the group titles («Catálogo · X» and collection results), and
   the type buttons (Series/Movie/Book) had no icon. In contrast, the
   **tabs** (`index.html`,
   `.tab--tv`/`.tab--movies`/`.tab--books`) already used **inline SVGs**
   with their accent color (`--teal-reel` series, `--stamp` movies,
   `--ochre-spine` books).

The issue asks: (a) a simple icon on each section of the profile's
dropdown; (b) the search's series/movies/books icons to be
**the same as the tabs'** and also use **their color**.

The implementation is validated (QA PASS, 6/6 criteria) and scanned
(security PASS, 0 findings); the user manual was updated in the
same task (AGENTS.md's rule 3). This ADR documents the decision
retrospectively.

Related issue: #134 — https://github.com/gonzalitojh/Registro-personal/issues/134

## Decision

Add icons to the profile menu and unify the global search's iconography
with the tabs' (same SVGs, same accent colors).

### 1. `js/constants.js`: canonical source `MEDIA_ICONS`

New export:

```js
export const MEDIA_ICONS = { tv, movies, books }
```

- The SVGs are copied **verbatim** from `index.html`'s tabs
  (`.tab--tv` / `.tab--movies` / `.tab--books`).
- The canonical source is **commented in the file itself**: if
  the tabs change, `MEDIA_ICONS` must be updated (issue #134).

### 2. `js/global-search.js`: the emojis are replaced by the SVGs

- `import { MEDIA_ICONS } from "./constants.js"`.
- `GROUPS[].icon` and `groupIcons` use `MEDIA_ICONS`' SVGs; the
  **friends group keeps the 👤** (there is no homologous tab).
- `renderTypeButtons()` adds
  `<span class="global-search__type-icon" aria-hidden="true">` with the
  SVG + the `global-search__type-btn--<key>` modifier class per type.
- Group titles carry the `global-search__group-title--<key>` class
  (media only; `friends` without modifier) in `renderResults`,
  `renderExternalSection` and `externalSectionLoadingHtml`.

### 3. `index.html`: icons in the profile's dropdown menu

Each of the dropdown's (`#profile-dropdown`) 5 items incorporates an
**inline feather SVG**, inside a `span aria-hidden="true"`:

| Item | Feather icon |
|------|---------------|
| Estadísticas | `bar-chart-2` |
| Amigos | `users` |
| Actividad | `activity` (pulse) |
| Ajustes | the same gear used by `js/sidebar.js` |
| Cerrar sesión | `log-out` |

`role="menuitem"`, `data-section` and the existing ids
(`#btn-profile-logout`) are kept: `js/profile.js`'s wiring does not
change.

### 4. `css/styles.css`: flex on the dropdown and per-type accent

- `.profile-dropdown__item`: `display:flex` + `gap: 0.6rem`; `svg`
  `1.05rem` with `color: currentColor` (the logout item inherits
  `--stamp-dark`).
- `.global-search__type-btn`: `inline-flex` + `gap: 6px` + a
  `--type-accent` variable per type (`--tv` → `--teal-reel`, `--movies`
  → `--stamp`, `--books` → `--ochre-spine`); the icon is colored
  with the accent.
- `hover` and `is-active` use `var(--type-accent)`; in `is-active` the
  `svg` goes to `color: inherit` (avoids accent-on-accent) and there is an
  **exception** `.global-search__type-btn--books.is-active { color:
  var(--ink) }` for text contrast over the ochre background.
- `.global-search__group-title svg`: `1rem`, colored with the
  per-type accent.

### 5. Documentation, user manual and PWA

- **Manual** (`docs/manual-de-usuario.md`): §7.2 (the search's results
  are grouped with the same icons as the tabs, each in its color — series
  green, movies red, books ochre — and the 👤 icon for friends) and §13
  (each option of the profile menu carries its icon).
- **PWA bump** `20260831` → `20260832` (one bump per PR touching
  assets, cf. ADR-049): `js/config.js` (`APP_VERSION`), `index.html`
  (`?v=20260832` ×3) and `service-worker.js` (`?v=20260832` ×6), via
  `scripts/bump-version.sh`.

### 6. Delivery

Branch `style/issue-134-iconos-desplegable-perfil` with 4 micro-commits:

- `1d668e5` feat: type icons in the global search with the tabs'
  colors (issue #134)
- `d3a68e1` feat: icons in the profile's dropdown menu (issue #134)
- `7aac898` style: per-type accent in the search and flex in the profile
  menu's items (issue #134)
- `065e87a` chore: PWA version bump 20260832 and manual with the
  search's and menu's icons (issue #134)

## Rejected alternatives

- **Keeping the 📺/🎬/📚 emojis in the search**: rejected — the issue
  explicitly asks for the same icons as the tabs with their color; emojis
  cannot inherit the per-type accent and break the visual coherence
  with the rest of the interface.
- **Generating the tabs via JS** (rendering their markup from
  `MEDIA_ICONS` to avoid duplicating the SVG): rejected — scope
  creep: the repo's pattern is static markup with inline SVG in
  `index.html`; the change is limited to documenting the canonical source in
  a `constants.js` comment.
- **Fixed teal color on the active type buttons**: rejected — it would
  break the coherence with the per-type accent (each medium has its tab
  color); only the `books.is-active` exception with `var(--ink)` is
  accepted for contrast on the ochre.
- **Icons in `js/ui.js`'s activity feed**: declared NO-GOAL — the emojis
  of `eventIcon()` (`js/ui.js`, lines 2085-2090: 🎬/📺/🏁/
  📖/📚/📌) belong to another feature (activity feed, ADR-015) and are
  not touched; issue #134 covers only the search and the profile menu.

## Consequences

### Positive

- **More recognizable profile menu**: each section (and Cerrar sesión)
  has its feather icon; reading the menu is faster.
- **Search coherent with the tabs**: same SVGs and same accents
  (`--teal-reel`/`--stamp`/`--ochre-spine`) on group titles and
  type buttons; the emoji/SVG mix is removed.
- **Accessibility**: the icons go in `span aria-hidden="true"` and the
  SVGs keep their `aria-hidden` — they do not duplicate the readable
  text; the friends group stays identified with 👤.
- **Wiring intact**: the dropdown's `role`/`data-section`/ids do
  not change; `js/profile.js` is not touched.
- **Manual up to date**: AGENTS.md's rule 3 met in the same task
  (§7.2 and §13).
- **QA and security PASS before documenting**: the decision is
  validated in practice (6/6 criteria, 0 findings).

### Negative / Risks

- **Duplicated SVG markup**: the tabs in `index.html` and
  `MEDIA_ICONS` in `js/constants.js` are two copies of the same SVG.
  Desync risk if the tabs change; mitigated by the canonical-source
  comment in `constants.js`.
- **Ad-hoc contrast exception**: `books.is-active` with `var(--ink)`
  is a one-off rule to be revisited if the ochre accent changes.
- **Visual change in the search**: whoever recognized the groups'
  emojis now sees icons; mitigated by the manual's update
  (§7.2).

### Neutral

- **Routine PWA bump**: `20260831` → `20260832` following the
  one-bump-per-PR practice (ADR-049), applied with
  `scripts/bump-version.sh`.
- **Historical ADRs intact**: the ones mentioning the 📺🎬📚 emojis (e.g.
  `adr-038-barralateral-navegacion.md`) are historical records of the
  previous state and are **not modified**.
- **Activity feed's emojis unchanged**: `js/ui.js`'s `eventIcon()` stays
  as it was (a separate feature, this issue's NO-GOAL).

## Created/modified files

| File | Change |
|---------|--------|
| `js/constants.js` | **Modified**: new export `MEDIA_ICONS = { tv, movies, books }` with the tabs' SVGs copied verbatim from `index.html` (canonical source commented in the file itself, issue #134) |
| `js/global-search.js` | **Modified**: import of `MEDIA_ICONS`; `GROUPS[].icon` and `groupIcons` use the SVGs (friends keeps 👤); `renderTypeButtons()` adds `<span class="global-search__type-icon" aria-hidden="true">` + class `global-search__type-btn--<key>`; group titles with `global-search__group-title--<key>` (media only; friends without modifier) in `renderResults`, `renderExternalSection` and `externalSectionLoadingHtml` |
| `index.html` | **Modified**: the profile dropdown's 5 items with inline feather SVGs (Estadísticas=`bar-chart-2`, Amigos=`users`, Actividad=`activity`, Ajustes=`js/sidebar.js`'s gear, Cerrar sesión=`log-out`), each in an `aria-hidden` span; `role`/`data-section`/ids kept; bump `?v=20260831` → `?v=20260832` (×3) |
| `css/styles.css` | **Modified**: `.profile-dropdown__item` flex + `gap: 0.6rem` + `svg` `1.05rem` `color: currentColor` (logout inherits `--stamp-dark`); `.global-search__type-btn` inline-flex + `gap: 6px` + per-type `--type-accent` (`--tv`→`--teal-reel`, `--movies`→`--stamp`, `--books`→`--ochre-spine`); icon colored with the accent; hover and is-active with `var(--type-accent)`; in is-active the svg uses `color: inherit` and the `--books.is-active { color: var(--ink) }` exception; `.global-search__group-title svg` `1rem` with per-type accent |
| `js/config.js` | **Modified**: `APP_VERSION` `20260831` → `20260832` |
| `service-worker.js` | **Modified**: bump `?v=20260831` → `?v=20260832` on the 6 versioned assets of `STATIC_ASSETS` (via `scripts/bump-version.sh`) |
| `docs/manual-de-usuario.md` | **Modified**: §7.2 (the search's results group with the same icons as the tabs, each in its color, and 👤 for friends) and §13 (each option of the profile menu carries its icon) — AGENTS.md's rule 3 |
| `docs/adr-059-iconos-buscador-y-menu-perfil.md` | **New**: this document |

Related issue: #134 — https://github.com/gonzalitojh/Registro-personal/issues/134
