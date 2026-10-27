# ADR-040: Per-device fixed tab bar and fixed header (Series/Movies/Books) (issue #79)

## Status
Accepted

## Date
2026-08-06

## Context

**Note on iterations 2, 3 and 4**: this ADR was revised three times after
the user's feedback in issue #79 (iteration 2, 2026-08-06; iteration
3, 2026-08-06 12:21; iteration 4, 2026-08-06 14:27). The initial design it
documented —fixed tab bar **at the bottom on all devices** (version
`20260812`)— was discarded for PC and tablet: the user asked that on those
widths the tabs sit **under the top search bar**, taking the same width as
it, and that the **top bar (side menu, search, bell, profile) also be
fixed**, always visible while scrolling, on all devices. The final decision
is the one this ADR documents (version `20260815`); the bottom bar is
kept only on mobile.

**Iteration 3** (2026-08-06 12:21): the user asked for two adjustments to
the `20260813` decision:

1. **The header's color must equal the tab bar's**: `.app-header` goes
   from `background: var(--paper)` to `background: var(--ink-raised)`
   —the same elevated surface as `.tabs--bar`— with
   `border-bottom: 1px solid var(--paper-alpha-20)` (the same border the
   bar uses). The override `.app-header .icon-btn { color: var(--ink) }`
   is **removed**: icons go back to the base `.icon-btn { color:
   var(--paper) }` (cream on black in the paper theme, contrast ~13.9:1)
   + the existing `[data-theme="light"] .icon-btn { color: var(--ink) }`
   (black on white, ~14.6:1), both well above AA. The search field was
   already `--ink-raised` (integrates unchanged) and the username and
   placeholder (`--ink-soft`) improve their contrast on the new surface
   (≈4.9:1 dark / 5.9:1 light, AA).
2. **Exact tab height at ≥768 px**: `--tabs-bar-h` goes from 3rem to 2rem
   (only as a reference for the content gap: `.app`'s top padding and
   `scroll-margin-top` = header-h + tabs-bar-h + 1rem = 6.5rem). The bar
   adopts `height: auto` in `.tabs`, with the rule declared **after** the
   base `.tabs { height: var(--tabs-bar-h) }` so the cascade applies it
   (same specificity, the last one wins) — cascade fix requested by the
   QA, which had already detected a failure from the same ordering in the
   first version of the fix. Also, `.app-header { border-bottom: none; }`
   at ≥768 px: the separator line is drawn by the bar's `border-top`
   (both from the same color `--ink-raised`).

**Iteration 4** (2026-08-06 14:27): the user asked to integrate header and
tab bar with the web's background and remove the separator lines, on top
of the `20260814` decision:

1. **Background integrated with the web**: `.app-header` and `.tabs--bar`
   go from `background: var(--ink-raised)` to `background: var(--ink)`
   —the same as `html, body` in the paper theme— with the override
   `[data-theme="light"] { background: var(--paper-dim) }` (the same as
   the body's light override). The header's icons use the base scheme
   (`.icon-btn { color: var(--paper) }` on `--ink` in dark, ~15.2:1;
   `[data-theme="light"] .icon-btn { color: var(--ink) }` on
   `--paper-dim`, ~12.9:1). The search input keeps its `--ink-raised`
   pill with a `paper-alpha-20` border.
2. **No separator lines**: `.app-header`'s `border-bottom` and
   `.tabs--bar`'s `border-top` removed (on all devices). The active tab's
   3px strip (`inset 0 3px 0 var(--tab-accent)`) keeps marking the active
   section.
3. **Tab height = header height at ≥768 px**: `--tabs-bar-h: 3.5rem`
   (= `--header-h`) in the ≥768 px media query; iteration 3's `.tabs {
   height: auto }` rule is removed (the base `.tabs { height:
   var(--tabs-bar-h) }` applies 3.5rem). Gaps: top padding and desktop
   `scroll-margin-top` = 3.5 + 3.5 + 1 = **8rem**.
4. **iPad space removed**: `padding-bottom: 0` on `.tabs--bar`
   at ≥768 px (cancels `env(safe-area-inset-bottom)`, which produced a
   space under the tabs on the real iPad; on mobile it is kept for the
   iPhone).
5. **Version bump**: `20260814` → `20260815`.

Process note: PR #93 (iterations 1-3) was merged into `dev` on 2026-08-06;
iteration 4 is published as a PR follow-up against `dev`.

The tabs **Series / Movies / Books** lived in the **header**, under the
search bar, as a `nav.tabs` styled like **file tabs**: tabs with a rounded
top border, `translateY(4px)` and the active one "raised" with a colored
top strip. They had two problems regarding issue #79's request:

1. **They were not fixed**: on scroll they disappeared with the header;
   changing section (Series ↔ Movies ↔ Books) required going back up.
2. **Duplicated colors**: Series and Movies shared the same green accent
   (`--teal-reel`, common class `tab--media`) and only Books used ochre
   (`--ochre-spine`); the issue asks for **three different colors**.

Issue #79 asks for the tabs to live in a **fixed bar**: at the
**bottom** on mobiles (≤768 px) and **under the top search bar** on PC
and tablet (≥768 px), taking the same width as it, with **simple icons in
addition to the name**. Scrolling must affect only the list of series,
movies and books: the tab bar and the **top bar (side menu, search, bell,
profile) remain fixed and always visible on all devices**, and **each tab
has a different color** on all device types and in both themes.

Related issue: #79 — https://github.com/gonzalitojh/Registro-personal/issues/79

**Historical note**: this ADR documents the tabs' move out of the header
(documented as part of the main screen in ADR-032 and ADR-038) to a fixed
bar —bottom on mobile, under the header on PC/tablet—, the header being
fixed on all devices and the differentiation of Movies' color (it used to
share Series' green; now uses `--stamp`).

## Decision

The Series/Movies/Books tabs move to a **fixed bar**
(`position: fixed`): at the **bottom** on mobile (≤768 px) and **glued
under the fixed header** on PC/tablet (≥768 px), with an inline SVG icon
+ name and a **own accent color** per tab, reusing the existing palette.
The **header is also fixed on all devices**, so the global search and the
menu are always visible. Scrolling only moves `.app`'s content, which
reserves gaps with `calc()`.

### 1. Fixed header on all devices

- `index.html`: the header's `nav.tabs` (inside `<header>`) is
  **removed** (iteration 1); the rest of the header —side menu, search,
  bell, profile— keeps its markup.
- `css/styles.css`: `.app-header` becomes `position: fixed; top: 0; left:
  0; right: 0; z-index: 46; background: var(--ink)` — the **same
  background as the web** (`html, body` in the paper theme), with the
  override `[data-theme="light"] .app-header { background:
  var(--paper-dim) }` (the same as the body's light override); **no
  `border-bottom` at any width** (iteration 4): the user asked that
  header and tab bar integrate with the page, without separator lines.
  The opaque background works in both themes and covers the content
  passing underneath on scroll.
- `.app-header__top`: `height: var(--header-h)` (3.5rem), `flex-wrap:
  nowrap` (a single row at all widths), `max-width: 980px` centered
  and `padding: 0 1.25rem` (aligned with `#app`); the `margin-bottom`
  that separated the header from the content is removed (now the gap
  comes from `.app`'s padding, point 4).
- **Header icons with the base `.icon-btn` colors** (no override):
  iteration 2 had added `.app-header .icon-btn { color: var(--ink) }`;
  iteration 3 **removed** it when unifying the header's surface into
  `--ink-raised`, and iteration 4 **keeps** the base scheme over the new
  integrated background: `.icon-btn { color: var(--paper) }` (cream on
  `--ink` in the paper theme, ~15.2:1) and
  `[data-theme="light"] .icon-btn { color: var(--ink) }` (ink on
  `--paper-dim`, ~12.9:1); both pairs exceed AA with ample margin, with
  no duplicated header styles. The search field **keeps its
  `--ink-raised` pill** with the `paper-alpha-20` border (the only
  elevated surface kept); the username and the search placeholder
  (`--ink-soft`) keep their contrast (≈4.9:1 dark / 5.9:1 light, AA).
- **Username with ellipsis** (≥520 px): `white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; max-width: min(12rem, 30vw)`
  — safeguard for long names: the header has fixed height and must not
  wrap.
- New variable `--header-h: 3.5rem` in `:root`: a single adjustment point
  for the header's height, `.app`'s gaps (point 4) and the
  `scroll-margin-top` (point 6).

### 2. Per-device fixed tab bar

- `index.html`: **new `nav.tabs--bar`** at body level (after `</main>`,
  before the footer) with the structure `nav.tabs--bar > div.tabs[role=
  "tablist"] > button.tab` and `aria-label="Secciones"` (no markup
  changes from iteration 1).
- `css/styles.css`: `.tabs--bar` with `position: fixed; left: 0; right: 0;
  bottom: 0; z-index: 45; background: var(--ink)` —the same background as
  the web— with the override `[data-theme="light"] .tabs--bar {
  background: var(--paper-dim) }`; **no `border-top`** (iteration 4: no
  separator lines) and `padding-bottom: env(safe-area-inset-bottom, 0px)`
  only on mobile (at ≥768 px it is cancelled with `padding-bottom: 0`,
  next point).
- **Mobile (≤768 px)**: fixed bar at the viewport's bottom edge (as in
  iteration 1), with the iPhone's safe margin.
- **PC/tablet (≥768 px)**: `top: var(--header-h); bottom: auto;
  padding-bottom: 0` — the bar is glued **under the fixed header** with no
  separator between them (iteration 4: header and tabs integrate with the
  web); `padding-bottom: 0` cancels `env(safe-area-inset-bottom)`, which
  on the real iPad produced a space under the tabs (on mobile it is kept
  for the iPhone). The bar's height is **the same as the header's**
  (`--tabs-bar-h: 3.5rem` = `--header-h`).
- **Width alignment**: the inner `.tabs` container aligns with `#app` and
  the header — `width: 100%; max-width: 980px; margin: 0 auto;
  padding: 0 1.25rem` — so the tabs take exactly the same width as the
  search bar (on all devices).
- **`--tabs-bar-h`**: `3.75rem` on mobile (icon over name) and `3.5rem`
  on PC/tablet (iteration 4), in `@media (min-width: 768px)` — the same
  height as the header (`--header-h`): the user asked that the tab bar
  measure exactly the same as the search bar. Iteration 3's `.tabs {
  height: auto }` rule is **removed**: the base `.tabs { height:
  var(--tabs-bar-h) }` applies 3.5rem at all widths. The variable is once
  again **the bar's real height** and, at the same time, the single
  reference for the gaps (points 4 and 6).
- **Icon + name**: each tab has an **inline SVG** (stroke
  `currentColor`, `stroke-width: 1.8`, `aria-hidden="true"`) and a
  `<span>` with the name; at ≤768 px the icon goes **above** the name
  (column, `font-size: 0.72rem`) and at ≥768 px **next to** the name
  (row, `font-size: 0.85rem`, icons of 1.15rem vs 1.35rem on mobile).
- `.tab` stops being a "file" tab: no border nor `translateY`,
  transparent background, `flex: 1; min-width: 0` (AGENTS.md's
  responsiveness rules) and centered via flex column/row.

### 3. Three accent colors with the existing palette (no new tokens)

- Each tab class defines its own accent via a **local `--tab-accent`**
  variable reusing the project's base palette (defined in
  `:root` for both themes, light and dark):

  - `.tab--tv` → `--tab-accent: var(--teal-reel)` (green, Series).
  - `.tab--movies` → `--tab-accent: var(--stamp)` (red, Movies) —
    **key change**: it used to share the green with Series; `--stamp` is
    the red accent the app already uses in statuses and errors, so no new
    token is introduced.
  - `.tab--books` → `--tab-accent: var(--ochre-spine)` (ochre, Books).

- **Active tab**: background `var(--paper)` + `box-shadow: inset 0 3px 0
  var(--tab-accent)` (3px top strip of the tab's color, inheritance of
  the previous style but without the "lifting" effect).
- **Icons**: the SVG uses `color: var(--tab-accent)`; on the active tab
  it changes to `var(--ink)` (coherent with the active text).

### 4. Scroll only over the content: gaps with `calc()`

- `.app` **mobile top padding**: `calc(var(--header-h) + 1rem)` — gap for
  the fixed header (3.5rem) + 1rem of air.
- `.app` **PC/tablet top padding** (≥768 px): `calc(var(--header-h) +
  var(--tabs-bar-h) + 1rem)` — header (3.5rem) + tab bar (3.5rem) +
  1rem of air = **8rem** (iteration 4: the bar measures the same as the
  header).
- `.app` **mobile bottom padding**: `calc(var(--tabs-bar-h) +
  env(safe-area-inset-bottom, 0px) + 1.5rem)` — the list's last row and
  the footer are never covered by the bottom bar (same as iteration 1).
- `.app` **PC/tablet bottom padding** (≥768 px): back to `4rem` — there is
  no bottom bar anymore at those widths.
- **`env(safe-area-inset-bottom)`** for the iOS PWA (iPhone with home
  indicator) only takes effect where there is a bottom bar (mobile): in
  the `.tabs--bar` bar's own padding (at ≥768 px cancelled with
  `padding-bottom: 0` — the iPad's space), in `.app`'s gap and in the
  toast (point 7).

### 5. Single breakpoint at 768 px

The desktop layout (tabs under the header with the same height as it,
`--tabs-bar-h: 3.5rem` = `--header-h`, accumulated gaps, toast at the
bottom margin) applies from `min-width: 768px` — not `769px` as in
iteration 1 — so that **portrait tablets (iPad, 768 px)** see the tabs
under the header and not the bottom bar.

### 6. `scroll-margin-top` for focus and the skip-link

`#main-content` (the "Skip to content" link's target) and `.panel h2`
(receives focus on tab change, `js/app.js`) get `scroll-margin-top:
calc(var(--header-h) + 1rem)` on mobile (4.5rem) and `calc(var(--header-
h) + var(--tabs-bar-h) + 1rem)` at ≥768 px (**8rem**, iteration 4):
focus and anchor are not hidden under the fixed header nor under the tab
bar.

### 7. Toast repositioned per device

- **Mobile**: `bottom: calc(var(--tabs-bar-h) + env(safe-area-inset-bottom,
  0px) + 1rem)` — the alerts (save toast, undo, «Próximamente…») appear
  **above the bottom bar** and are not hidden behind it.
- **PC/tablet (≥768 px)**: `bottom: 1.4rem` — back to the original bottom
  margin, since the tab bar is at the top.

### 8. z-index hierarchy: header 46, bar 45

The header and the bar are placed in two new steps between the existing
ones:

| Layer | z-index |
|------|---------|
| `.skip-link` | 100 |
| `.toast` | 80 |
| `.modal--top` | 70 |
| `.app-sidebar` (drawer) | 60 |
| `.app-sidebar-backdrop` | 55 |
| `.modal` | 50 |
| **`.app-header` (fixed)** | **46** |
| **`.tabs--bar`** | **45** |
| `.notif-dropdown` / `.profile-dropdown` / `.global-search__results` | 40 |

The header sits one point above the tab bar (46 > 45) so the **dropdowns
anchored to it** (its children, z-index 40) always paint completely;
both sit below the item/rating modals (50/70), the drawer's backdrop (55)
and ADR-038's drawer (60), which are never covered.

### 9. `js/app.js` unchanged (selectors preserved)

The tabs JS was **not touched** in any of the four iterations: the
existing click delegation keeps using the `.tab` class, `data-panel` and
`.is-active` (and the ids `tab-tv`/`tab-movies`/`tab-books`), which are
preserved **identically** in the new markup; only the `nav`'s location and
the styles changed. The change is purely structural (HTML) + CSS, with no
new logic nor refactors.

### 10. PWA and user manual

- `js/config.js`: `APP_VERSION` from `20260811` to **`20260812`**
  (iteration 1), to **`20260813`** (iteration 2, user feedback), to
  **`20260814`** (iteration 3, final adjustments) and to **`20260815`**
  (iteration 4, integrated background).
- `index.html`: `?v=20260815` on `css/styles.css`, `ocio/ocio.css` and
  `js/app.js`.
- `service-worker.js`: `STATIC_ASSETS` updated to `?v=20260815`
  (styles, app.js and `ocio/*.html`). Invalidates previous caches
  (`20260814` and older).
- `docs/manual-de-usuario.md`: section **3** (main screen): the header
  **remains always visible** when scrolling, on no device; the tabs are in
  a **fixed bottom bar on mobile** and a **fixed bar right under the top
  search bar on computer and tablet**, with an icon and its own color
  (Series green, Movies red, Books ochre); the active one with a strip of
  its color and light background; scrolling only moves the list's
  content.
- The `ocio/*.html` partials were **not touched**: tab styles live in
  `css/styles.css` and behavior in `js/app.js`, so the three sections keep
  working unchanged.

## Rejected alternatives

- **Fixed bottom bar on all devices** (this ADR's initial design, version
  `20260812`): discarded after the user's feedback — for PC and tablet the
  tabs must be **under the top search bar**, taking the same width as it;
  the bottom bar is kept only on mobile (≤768 px).
- **Non-fixed header** (only the tab bar fixed): discarded — the feedback
  explicitly asks that the top bar (side menu, search, bell, profile) be
  fixed and always visible on scroll on all devices; with a scrolling
  header, the global search and the menu would disappear when scrolling
  the list.
- **Breakpoint at 769 px** (keeping iteration 1's): discarded — a portrait
  tablet of 768 px (iPad) would see the bottom bar instead of the tabs
  layout under the header; the desktop layout applies from
  `min-width: 768px`.
- **`position: sticky` for header or bar**: discarded — with `fixed` +
  explicit gaps (`padding` of `.app` and `scroll-margin-top`) the reserved
  space is independent of the document flow; with `sticky` the gap would
  be coupled to the DOM order and the content's length.
- **New color tokens** (e.g. `--tab-tv-color`, `--tab-movies-color` with
  new hexes): discarded — the existing palette already has the three
  accents (green `--teal-reel`, red `--stamp`, ochre `--ochre-spine`)
  defined for both themes; `--stamp` solves Movies' differentiation
  without adding variables or duplicating values in light/dark.
- **High z-index (60/70) for the header or the bar**: discarded — it would
  cover ADR-038's drawer and its modals; 46/45 sit below the modal (50),
  backdrop (55) and drawer (60) and above the dropdowns (40).
- **Keeping the "file tab" metaphor** (active tab "raised" with
  `translateY`): discarded — the vertical movement makes no sense in a
  fixed bar; replaced by a `--paper` background + a 3px top strip with
  the tab's accent.
- **Fixed px gap for the content**: discarded — a fixed value would
  duplicate the header/bar height elsewhere and break on iOS;
  `calc(var(--header-h) + var(--tabs-bar-h) + …)` keeps a single
  adjustment point.
- **Ink override for header icons** (`.app-header .icon-btn { color:
  var(--ink) }`, iteration 2): discarded in iteration 3 — upon unifying
  the header's surface with the bar's (`--ink-raised`), `.icon-btn`'s
  base colors (`--paper` in the paper theme, `--ink` in the light theme
  via `[data-theme="light"]`) already meet AA with ample margin (~13.9:1
  and ~14.6:1); the override was redundant and duplicated styles.
- **`--tabs-bar-h` as the bar's real height on PC/tablet** (`3rem`,
  iteration 2): discarded in iteration 3 — the user asked for the tabs'
  exact height; with `height: auto` in `.tabs` the bar adjusts to its
  content and `--tabs-bar-h: 2rem` remains only as the gap's reference
  (`.app`'s padding and `scroll-margin-top`).
- **`--ink-raised` background (elevated surface) on header and bar**
  (iterations 1-3): discarded in iteration 4 — the user asked that header
  and tabs **integrate with the web**: the same background as
  `html, body` (`--ink` in the paper theme, `--paper-dim` in light). The
  elevated surface is only kept on the search input's pill, which stays
  `--ink-raised` with the `paper-alpha-20` border.
- **Keeping the separator lines** (`.app-header`'s `border-bottom` and
  `.tabs--bar`'s `border-top`, both `--paper-alpha-20`): discarded in
  iteration 4 — no lines between the web and the header nor between the
  header and the tabs; the active section is still marked by the active
  tab's 3px strip (`inset 0 3px 0 var(--tab-accent)`).
- **`height: auto` in `.tabs` at ≥768 px** (iteration 3): discarded in
  iteration 4 — the user asked that the tab bar have the **same height as
  the search bar**; `--tabs-bar-h` returns to being the real height
  (3.5rem = `--header-h`) and the `height: auto` rule is removed (the
  base `.tabs { height: var(--tabs-bar-h) }` applies).
- **Bottom safe margin on PC/tablet** (`env(safe-area-inset-bottom)`
  at ≥768 px, present since iteration 1): discarded in iteration 4 — it
  produced a space under the tabs on the real iPad;
  `padding-bottom: 0` at ≥768 px (on mobile it is kept for the iPhone).

## Consequences

### Positive

- **Header and tabs always visible**: the global search, the side menu and
  the navigation between Series/Movies/Books do not require going back to
  the top, on any device; on mobile the bottom bar is additionally the
  usual navigation pattern of native apps.
- **Tabs where the user expects them per device**: at the bottom on
  mobile, under the search bar on PC/tablet, with exactly the same width
  as it (alignment with `#app`, max-width 980 px + padding 1.25rem).
- **Three distinct colors** (green/red/ochre) on all devices, without new
  tokens: Movies goes from sharing Series' green to the existing `--stamp`
  red accent in the palette.
- **Gaps computed with the same variables** (`--header-h` and
  `--tabs-bar-h`): changing the header's or the bar's height automatically
  recomputes `.app`'s paddings, the `scroll-margin-top` and the toast; a
  single adjustment point per variable.
- **Header and tab bar integrated with the web** (iteration 4): both use
  the **same background as the page** (`--ink` in the paper theme,
  `--paper-dim` in light) and there are **no separator lines** — the
  active tab's 3px strip marks the active section, as the user asked; the
  search input's pill keeps its `--ink-raised` surface with the
  `paper-alpha-20` border.
- **AA contrast in the header without overrides** (iterations 3-4): icons
  use `.icon-btn`'s base colors (cream `--paper` on `--ink`, ~15.2:1,
  paper theme; ink `--ink` on `--paper-dim`, ~12.9:1, light theme) and the
  username and placeholder (`--ink-soft`) keep their contrast over the
  integrated background (≈4.9:1 dark / 5.9:1 light); no header overrides
  since iteration 3.
- **Tab bar with the same height as the header on PC/tablet** (iteration
  4): `--tabs-bar-h: 3.5rem` = `--header-h` — the tab bar measures exactly
  the same as the search bar; the variable is both the real height and the
  single reference for the gaps (`calc()` in `.app` and
  `scroll-margin-top`), without iteration 3's `height: auto` rule.
- **iPad's ghost space removed** (iteration 4): `padding-bottom: 0` on
  `.tabs--bar` at ≥768 px cancels `env(safe-area-inset-bottom)`, which
  produced a space under the tabs on the iPad; on mobile the safe margin
  is kept for the iPhone.
- **No JS changes**: `js/app.js` intact (`.tab`, `data-panel`,
  `.is-active` selectors preserved), practically null regression risk in
  the tabs logic.
- **iOS PWA considered**: `env(safe-area-inset-bottom)` in the bar, the
  content gap and the toast avoids overlapping the iPhone's home
  indicator on mobile; on PC/tablet there is no bottom bar.
- **Improved accessibility**: `aria-controls` added to each tab (new),
  keeping `role="tablist"`/`role="tab"`/`aria-selected`; the SVG icons are
  `aria-hidden` and the name sits in a text `<span>`;
  `scroll-margin-top` on `#main-content` and `.panel h2` so the
  skip-link and the focus on tab change are not covered by the fixed
  header.
- **Responsiveness verified** per AGENTS.md (360/768/1280 px with no
  horizontal scroll): `flex: 1; min-width: 0` on the tabs, `nowrap` +
  ellipsis in the header and relative units (`rem`, `calc()`), with no
  `overflow-x: hidden` as a patch.

### Negative / Risks

- **Less vertical reading area**: fixed header (3.5rem) + tab bar
  (3.75rem on mobile, at the bottom; on PC/tablet 3.5rem, the same as the
  header) consume viewport; the content gap at ≥768 px becomes
  **8rem** (iteration 4); mitigated with compact heights and reduced
  typography (0.72rem mobile / 0.85rem PC/tablet).
- **Two new steps in the z-index hierarchy** (46 header, 45 bar) between
  40 and 50: any future layer in that range will have to coexist with
  them; the dropdowns (40) are the header's children, so they paint
  completely within their stacking context.
- **Habit change**: the tabs are no longer in the header (mobile: at the
  bottom; PC/tablet: under the search) and the header no longer moves with
  the scroll; mitigated with the updated user manual (section 3).

### Neutral

- **PWA versioned to `20260815`**: `APP_VERSION`, `?v=` in `index.html` and
  the service worker's `STATIC_ASSETS` invalidate previous caches
  (including the intermediate `20260812`-`20260814` of iterations 1-3).
- **`docs/manual-de-usuario.md` updated** (AGENTS.md obligation: changes
  visible to the user): section **3** (iterations 1-3; iteration 4
  required no changes: the manual does not describe the color surfaces nor
  the separator lines).
- **Process**: PR #93 (iterations 1-3) was merged into `dev` on 2026-08-06
  and iteration 4 is published as a PR follow-up against `dev` (AGENTS.md
  rule: PRs always against `dev`).
- **Previous ADRs not superseded**: ADR-032 and ADR-038 described the tabs
  on the main screen; their content remains valid except for the tabs'
  location (now a fixed per-device bar) and the header's (now fixed).
  ADR-038's drawer (z-index 60) remains above the header (46).
- **`ocio/*.html` partial untouched**: tab styles live in `css/styles.css`
  and the logic in `js/app.js`; there is no duplication to maintain per
  section.

## Created/modified files

| File | Change |
|---------|--------|
| `index.html` | Header's `nav.tabs` (file-tab style) **removed**; **new** `nav.tabs--bar` at body level (after `</main>`): `div.tabs[role="tablist"]` with 3 `.tab--tv`/`.tab--movies`/`.tab--books` buttons (inline SVG `aria-hidden` + `<span>` name, `aria-controls` added, `data-panel`/`.is-active`/ids kept); versioned `?v=20260815` |
| `css/styles.css` | `.app-header` fixed (`position: fixed; top:0; left:0; right:0; z-index: 46; background: var(--ink)` + light override `[data-theme="light"]` `var(--paper-dim)`, **no `border-bottom` at any width**), **no** override `.app-header .icon-btn` (icons with the base colors: `--paper` in dark / `--ink` in light); `.app-header__top` with `height: var(--header-h)` (3.5rem), nowrap, `max-width: 980px` and `padding: 0 1.25rem`; username with ellipsis ≥520 px; `--header-h: 3.5rem` in `:root` and `--tabs-bar-h: 3.5rem` at ≥768 px (= `--header-h`; iteration 3's `.tabs { height: auto }` rule **removed** — the base `.tabs { height: var(--tabs-bar-h) }` applies); `.tabs--bar` fixed (mobile `bottom: 0` / ≥768 px `top: var(--header-h); bottom: auto; padding-bottom: 0`, `z-index: 45`, `background: var(--ink)` + light override `var(--paper-dim)`, **no `border-top`**); `.tabs` with `padding: 0 1.25rem` (aligned with header and `#app`); desktop breakpoint unified to `min-width: 768px` (also in `.tab` in row); `.app` with top padding `calc(var(--header-h) + 1rem)` mobile / `calc(var(--header-h) + var(--tabs-bar-h) + 1rem)` (**8rem**) ≥768 px, mobile bottom padding `calc(var(--tabs-bar-h) + safe-area + 1.5rem)` and `4rem` ≥768 px; `scroll-margin-top` on `#main-content` and `.panel h2` (4.5rem mobile / **8rem** ≥768 px); toast `bottom: 1.4rem` at ≥768 px; iterations 1-3's rest kept (`--tab-accent` colors, mobile safe-area, active with strip) |
| `docs/manual-de-usuario.md` | Section 3 (main screen): header always visible on all devices; fixed tabs per device (bottom bar on mobile, bar under the search on computer/tablet) with icon and own color (Series green, Movies red, Books ochre), colored strip on the active one and scroll only of the content — no additional changes in iteration 4 (the manual does not describe color surfaces nor separator lines) |
| `js/config.js` | `APP_VERSION` from `20260811` to `20260812` (iteration 1), to `20260813` (iteration 2), to `20260814` (iteration 3) and finally to **`20260815`** (iteration 4) |
| `service-worker.js` | `STATIC_ASSETS` with `?v=20260815` (styles, ocio.css, app.js, `ocio/*.html`); invalidates `20260814` and older caches |
| `docs/adr-040-pestanas-barra-inferior.md` | **Updated**: this document (final decision after the user's feedback in the issue, iterations 2, 3 and 4) |

Related issue: #79 — https://github.com/gonzalitojh/Registro-personal/issues/79
