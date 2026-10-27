# ADR-081: The weekly menu's grid — header/row wrappers with `display: contents` (issue #215)

## Status
Accepted

## Date
2026-08-11

## Context

Issue #215 reports that the Recipes section's «Menú» tab (issue #64)
looks very bad: the elements overlap one other.

**Root cause**: `renderMenuGrid()` in `js/menu.js` generates inside
`#menu-grid` a div `.menu-grid__head` (with the 4
header cells:
Día, Desayuno, Comida, Cena) and 7 divs `.menu-grid__row` (each with
a day cell + 3 meal cells). The `.menu-grid`
container is a 4-column grid (`7.5rem repeat(3, minmax(170px, 1fr))`), but
the `.menu-grid__head` / `.menu-grid__row` wrappers **had no
placement rules**: being the grid's
direct items, the auto-placement distributed them one per cell
(header → column 1,
row 1 → column 2,
row 2 → column 3, …) and each
wrapper stacked its
4 cells inside a narrow 120–170 px column, crushing and
overlapping all the content.

The decision was taken following the task-architect's plan; QA approved
all the criteria and the security review came out clean. It is a
CSS-only change: HTML and JS untouched.

Related issue: #215 — https://github.com/gonzalitojh/Registro-personal/issues/215

## Decision

Add in `css/styles.css`, right after the `.menu-grid` block, the
rule:

```css
.menu-grid__head,
.menu-grid__row {
  display: contents;
}
```

With `display: contents` the wrappers generate no box: their children
`.menu-grid__cell` become `.menu-grid`'s
direct grid items, and the auto-placement places them naturally in 8
rows × 4 columns (the header in row 1, each
 day in its row), aligning with the defined columns (`7.5rem`
 + 3 ×
 `minmax(170px, 1fr)`). The `gap: 0.4rem`, the
 container's `overflow-x: auto`
 (horizontal scroll allowed only inside the grid, the
 AGENTS.md pattern) and the existing theme overrides (which
 point to the `--cell`, `--cell--head`, `--cell--day`
 cells, not at the wrappers)
 keep applying unchanged.

## Rejected alternatives

- **A1: `grid-column: 1 / -1` + `grid-template-columns: subgrid` on
  the wrappers**: rejected — more complex, it depends on
  `subgrid` and adds no advantage over
  `display: contents` (supported in all
  modern browsers).
- **A2: changing the DOM in `js/menu.js`** (removing the wrappers and
  rendering the cells as the grid's direct children): rejected — the
  current DOM is correct and the wrappers logically group the
  rows; touching the JS added risk
  without
  benefit.

## Consequences

### Positive
- **A correct view**: the header aligned with its columns and 7
  day rows aligned; no
  element overlaps another.
- **Zero regressions**: JS and HTML are untouched; the menu's
  listeners («+ Receta», the ✕ of
  remove, the inline
  picker, weeks
  navigation, din
  ers, recipes
  for the week, the shopping list's exclusion) do not depend on the
  wrappers' box.
- **Intact responsiveness**: on mobile
  the grid scrolls horizontally
  inside its container (never at page level), an already
  documented pattern allowed by AGENTS.md.

### Negative
- None known. `display: contents` introduces no
  new colors nor surfaces, so the four theme modes (Dark,
  Pure black,
  Light, Pure white) require no
  additional overrides.

Related issue: #215
