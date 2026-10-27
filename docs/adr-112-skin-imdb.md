# ADR-112: IMDb visual identity (flat, no Liquid Glass)

## Status
Accepted

## Date
2026-10-26

## Context
After the "IMDb + Apple Liquid Glass" iteration (ADR-109) the owner asks
to remove the Apple glass and reference imdb.com's website for the whole
UI.

IMDb reference (2026): black cover, brand gold accent (#F5C518) on
headings and ratings, flat surfaces with no blur, poster-forward cards
and catalog typography in small caps.

## Decision
The ADR-109 layer is replaced by a flat overrides layer (end of
`css/styles.css` and `ocio/ocio.css`):

1. **No Liquid Glass**: zero `backdrop-filter`/blur; solid surfaces per
   family (dark `--ink`/`--ink-raised`, light
   `--paper-dim`/`--white`).
2. **IMDb gold** (`--brand-gold` #f5c518 + `--brand-gold-ink`):
   - Heading text (`--heading`) ONLY in the dark family (on paper it
     would give ~1.7:1; in light the heading is `--ink`).
   - Primary button and rating shield auto-colored (gold with dark ink
     ≈ 10:1) in all 4 modes.
3. **Poster-forward cards**: solid, hairline, 10px radius
   (`--radius-card`), no ticket perforation, 210px cover, transparent
   status stamp with border, gold shield rating chip, ×N counter as a
   flat pill.
4. **Section headings** in sans small caps with tracking.
5. Bars (header/tabs), dropdowns, toast and modals flat with hairline.

Verified contrast (all 4 modes, with the family overrides re-asserted
over the base); card states preserved.

## Consequences
- The `@supports`/backdrop-filter fallback dependency is removed
  (better performance on mobile and old browsers).
- The manual does not change (re-styling without behavior).
