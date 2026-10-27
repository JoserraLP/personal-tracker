# ADR-096: The Gym section's icon: a classic horizontal dumbbell (issue #263)

## Status
Accepted

## Date
2026-08-13

## Context

Issue #263 asks for a
**new
icon for the Gym
section**:
the
current one does not convince the
user. It is a purely
cosmetic change of the
section's
issue (#62, ADR-095) and sticks to
the
**icon's appearance** on the
only two
places where it appears:
the
**«Gimnasio»** entry of the
sidebar (the
`js/sidebar.js`, the
`SECTIONS` array)
and the
**«Entrenos»** tab of
the
`gym-view`'s tab bar
(the
`index.html`).

The replaced icon was
the
**Feather
diagonal dumbbell** (7
a
`<path>`s: the
diagonal bar
`M6.5 6.5 17.5 17.5`, the two
hooks
`M21 17 17 21` /
`M3 7 7 3`, the discs' two
strokes
`m2.5 12.5 9-9` / the
`m12.5 2.5 9 9` and the
two
dots
`M6 21h.01` /
`M18 3h.01`). With
loose strokes and the
diagonal, it was hard to
read at a
small-icon
size and broke the coherence with the
other
sections.

Fit with the project's rules and conventions:

- **The icons' convention**
  (the
  ADR-009, ADR-064, ADR-066 and the existing sections' style
  manual):
  the
  `viewBox 0 0 24 24`, the
  `fill="none"`, the
  `stroke="currentColor"`, the
  `stroke-width="1.8"`, the
  `stroke-linecap/linejoin="round"` and the
  `aria-hidden="true"`. The icon inherits the container's
  color (the
  `.icon-btn` on the header, the
  `.tab` on the tab bar), so it
  **needs no per-theme-mode
  overrides** (the
  AGENTS.md's rule 4): correct
  in Dark,
  Pure
  black, Light
  and Pure
  white without touching
  the
  `css/styles.css`.
- **The AGENTS.md's rule 3**
  (the
  user manual): the
  manual does not describe the section's icon's
  shape; a
  cosmetic change like this needs no update.
- **The
  branch
  chain**: the
  task
  is
  born
  from the
  `feat/issue-62-seccion-gimnasio`
  (the ADR-095 and the section are not yet in the
  `dev`; the
  PR
  #262 pending integration). The
  #263's branch merges into that intermediate
  branch, so this ADR arrives at the
  `dev` together with the whole section. That's why the serial number continues after
  the
  ADR-095 even if the section is unpublished.

The implementation is validated
  (a
  QA PASS: the
  symmetry verified by
  rasterization — a
  0.00 % of
  different pixels between the halves, with
  no
  leftovers
  of the old
  path of
  the
  `M6.5 6.5 17.5 17.5`, the four theme modes checked and with no
  layout/responsiveness
  impact) and scanned
  (a
  security PASS, 0
  findings). This ADR documents the decision
  retrospectively, like the recent ones
  (the
  ADR-093, ADR-094, ADR-095).

Related issue: #263 — https://github.com/gonzalitojh/personal-tracker/issues/263

## Decision

### 1. A new shape: the classic horizontal dumbbell

Replacing
Feather's diagonal
SVG with a
**classic horizontal dumbbell** — a
bar + four symmetric discs — with a
single shape per element (a
`<line>` + 4
`<rect>`s, versus the previous 7 paths, three of them just decorative):

- **The bar**:
  the
  `<line x1="8" y1="12" x2="16" y2="12" />` — centered in
  the
  viewBox (the
  x=8→16, the
  y=12).
- **The outer discs** (the ones farthest from the center): the
  `<rect x="2.5" y="9" width="3" height="6" rx="1" />` and its
  mirror
  `<rect x="18.5" y="9" width="3" height="6" rx="1" />`
  (the
  18.5 = 24 − 2.5 − 3).
- **The inner discs** (glued to the center): the
  `<rect x="6.5" y="7.5" width="2" height="9" rx="0.7" />` and its
  mirror
  `<rect x="15.5" y="7.5" width="2" height="9" rx="0.7" />`
  (the
  15.5 = 24 − 6.5 − 2).

**The verified symmetry**:

- **Vertical (the
  x = 12 axis)**: each rect has its mirror at the same
  distance:
  the
  outer 2.5↔18.5 (the
  centers x=4 and x=20, at 8 px from the
  center), the inner 6.5↔15.5 (the centers x=7.5 and x=16.5, at 4.5 px from the
  center);
  the bar of
  the
  8→16 is centered at
  12.
- **Horizontal (the y = 12 axis)**: all the elements are centered at
  the
  y=12 — the bar
  at the
  y=12; the outer at the
  y=9
  with the
  h=6 (the
  center
  12); the inner at the y=7.5
  with the h=9 (the
  center
  12).

The
`rx`s round
the
discs' corners (1 px the outer, 0.7
px the inner)
to keep the
project's other icons' rounded style.

### 2. The replacement on the only two
  points of use

1. The
   `js/sidebar.js` — the
   `SECTIONS` array's "Gym" entry
   (the
   `icon`
   property): the
   `<svg>`'s content is replaced; the container and the
   `onClick` do not change.
2. The
   `index.html` — the
   `gym-view`'s bar's
   "Workouts" tab (the
   `nav.tabs--bar`, the
   `data-gym-tab="entrenos"`):
   the
   `<svg>`'s content is replaced;
   nothing else of the markup changes.

The
**«Ejercicios» tab is not touched**: it keeps its
check
icon (the
`<polyline points="9 11 12 14 22 4">` + the frame's
`<path>`), which already
meets the convention and was not the issue's target.

### 3. The deliberate out of scope

- **The css/styles.css**: unchanged — the
  `currentColor` already inherits the correct color in the
  four theme modes (no new
  overrides).
- **The docs/manual-de-usuario.md**: unchanged (the
  AGENTS.md's rule
  3;
  the manual does not describe the icon's shape).
- **The ADR-095**: remains in force; this ADR
  only documents the section's icon's
  appearance.

## Rejected alternatives

- **Keeping
  the
  current icon**:
  rejected — it is the issue #263's own
  request; the
  diagonal dumbbell with loose
  strokes reads poorly at a
  small size.
- **Using the diagonal dumbbell but redesigned (with more
  thick paths)**:
  rejected — the diagonal shape
  crosses the viewBox's bounds (the hooks come out by the corners) and
  would still need
  decorative
  elements; the classic horizontal is more legible and simpler (5 shapes versus 7 paths).
- **Adding theme overrides or the icon's own colors**: rejected — the icon uses the
  `currentColor` exactly like the other sections; any
  hardcoded color would have required
  per-theme-family
  overrides (the
  AGENTS.md's rule 4) with
  no
  visual
  benefit.
- **Adding the icon to the
  `css/styles.css` via a
  mask/font**:
  rejected — it would break
  the
  project's inline `currentColor`
  SVGs' convention and add
  unnecessary
  CSS without changing the result.

## Consequences

### Positive

- **A legible and coherent icon** with the
  other sections' style
  (the
  movies, the series, the books, the
  Ocio):
  the
  1.8 stroke,
  rounded
  corners, closed and
  symmetric shapes
  at a
  small size (~1.15–1.5 rem).
- **The guaranteed and verified symmetry**: a
  QA
  PASS
  by rasterization (a
  0.00 % of
  different pixels between the two halves), with no
  old-path
  leftovers on the two files.
- **Zero theme changes**: the
  `currentColor` + the
  inherited `stroke-width`
  → correct
  in
  Dark, Pure
  black, Light and Pure
  white (the
  ADR-009, the
  ADR-064, the
  ADR-066) without a
  single line of CSS.
- **Less DOM**: 5 shapes versus 7 paths on the two points of use.

### Neutral

- **The Gym
  section is not yet in the
  `dev`**: the icon
  (and this ADR)
  live in the branch
  chain of
  the
  `feat/issue-62-seccion-gimnasio` → the
  `style/issue-263-icono-seccion`; they will
  arrive at the
  `dev` when the
  PR
  #262 with the whole
  section is integrated. The ADR-096 number is already reserved on that line.
- **The
  «Ejercicios» tab keeps its
  check
  icon**:
  deliberate, the issue only affects the section's
  icon.
- **The user manual
  unchanged**: the manual does not describe the icon's shape (the
  AGENTS.md's rule 3).
- **No layout nor
  responsiveness impact**: the
  SVG occupies the same space as the
  old
  one (the
  `js/sidebar.js` and the
  `index.html` files only change the
  `<svg>`'s content).

### Negative / Risks

- **None known.**
  Validated: a
  QA PASS
  (the
  rasterization symmetry, the four theme modes, with
  no horizontal scroll at
  the
  360/768/1280 px — the icon does not alter the layout) and a
  security PASS
  (0
  HIGH/MEDIUM/LOW findings; a
  100 % static SVG, with no
  data interpolation nor handlers).

## Created/modified files

| File | Change |
|---------|--------|
| `js/sidebar.js` | **Modified**: the
  `SECTIONS`' "Gym" entry's icon — Feather's diagonal dumbbell (7 paths) → a
  classic horizontal dumbbell (line + 4 symmetric rects) |
| `index.html` | **Modified**: the
  `gym-view`'s "Workouts" tab's SVG — the
  same replacement; the
  "Exercises" tab (check)
  is not touched |
| `tasks/task-issue-263.json` | The task's task file
  (the
  title/description with the
  base of
  the
  `feat/issue-62-seccion-gimnasio`, the
  AC1–AC4
  acceptance criteria, the
  DoD and the
  `issue` block with the
  #263 — https://github.com/gonzalitojh/personal-tracker/issues/263) |
| `docs/adr-096-icono-seccion-gimnasio.md` | **New**: this document |

Related issue: #263 — https://github.com/gonzalitojh/personal-tracker/issues/263
