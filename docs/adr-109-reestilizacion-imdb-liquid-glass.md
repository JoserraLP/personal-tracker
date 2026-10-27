# ADR-109: Visual re-styling — IMDb look with an Apple "Liquid Glass" finish

## Status
Accepted

## Date
2026-10-26

## Context

The owner asks for the interface to look like IMDb but with the Apple
"Liquid Glass" theme wherever possible. The app had a "library notebook
/ cinema ticket" identity (solid paper surfaces, perforated ticket, 3px
radii) coexisting with a navigation that "blends into" the page
(feedback iteration ADR: header and tabs with no separation).

## Decision

A **re-styling layer** is applied (overrides at the end of
`css/styles.css` and `ocio/ocio.css`) without touching existing rules,
on two axes:

### 1. Liquid Glass (tokens, not loose components)

New tokens in `:root` + three family blocks:

- `--glass-bg` / `--glass-bg-strong`: translucent surface per family
  (dark with an ink tint in dark/black, white in light/white).
- `--glass-border[-strong]`: hairline (translucent paper in dark,
  translucent ink in light).
- `--glass-blur` / `--glass-saturate`: shared backdrop-filter.
- `--glass-radius`: 14px (iOS's obsession with rounded radii).
- `--glass-spec`: top specular sheen (gradient).
- `--page-glow`: subtle cinema focus light on the top edge of the body.
- `@supports not (backdrop-filter…)`: fallback with nearly opaque
  surfaces for browsers without glass.

Only the **chrome** is given the glass treatment (app-header,
tabs--bar, app-sidebar, dropdowns, toast, access card, back-to-top,
pills). Forms, modals and item cards keep the paper/white surface
because their text assumes those backgrounds (avoids re-introducing
the massive overrides of issue #165 into the content).

### 2. IMDb look

- Fixed translucent header in cinema-navbar style (content passes
  behind it and gets blurred).
- Section headings `h2` in small caps with tracking, sans (IBM Plex
  Sans), lighter weight than the serif display.
- **Poster-forward** cards: no ticket perforation (hidden), taller
  cover (210px), glass radius, translucent body with the corresponding
  family's text color.
- Rating chip in "IMDb shield" style: gold auto-colored
  (`--imdb-gold` #f5c518, ALWAYS with its dark ink on top,
  `--imdb-gold-ink`), legible in the 4 modes by its own contrast.
- Chips/pills (status, ×N counter, filters, sort, view) unified in a
  pill glass language with hairline.

## Verified contrast (all 4 modes)

- dark/black: `--paper` #f1ead9 text on dark glass ≥ 13:1;
  meta `--ink-soft` ~6:1 (AA); gold chip ~10:1.
- light/white: `--ink` #171512 text on white glass ≥ 13:1;
  gold chip with dark ink ~10:1.
- The card states (--en_curso/completado/standby/abandonado) are
  re-asserted AFTER the base glass to preserve their semantic tints
  already adapted per family (with --ink text in light and --paper in
  pure black).

## Consequences

- The "notebook" identity survives in forms/modals (only the chrome is
  glass): a compromise that preserves legibility without duplicating
  the example overrides of the dark family.
- No behavior or content changes: the user manual requires no update.
- The fallback without backdrop-filter maintains AA/AAA legibility.
