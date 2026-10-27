# ADR-118: Skin TRAKT (app.trakt.tv) for the whole UI

## State
Accepted

## Date
2026-10-27

## Context
After the IMDb flat skin (ADR-112/113), the owner asks to remove the
previous skin completely — "including from the original project" — and
redesign the whole application so everything follows the structure and
interface of app.trakt.tv.

Trakt 2026 reference: near-black slate background, solid dark chrome
(header, left drawer), a single brand accent (Trakt red #ed1c40),
posters carry a colored STATUS indicator and cards are flat with
hairlines.

## Decision
- The ADR-112/113 CSS blocks were REMOVED from both stylesheets (they
  are not overridden later: they are gone), and a single new layer
  (ADR-118, at the end of `css/styles.css` + `ocio/ocio.css`)
  restyles everything.
- Tokens: `--brand-red` #ed1c40 (+ hover #c40f2f), `--brand-ink`
  (near-black ink for auto-colored badges), `--heading` (the Trakt red
  light variant #ff5a70 as TEXT in the dark family only; in the light
  family it falls to `--ink`, the red on paper does not reach 3:1).
- Like the old layers, chrome only: forms, modals and detail fields
  keep the paper library surface (their text assumes it).
- Cards (Ocio + Experiences): flat, hairline, `--radius-card`, poster
  cover 210px, colored 3px TOP STATUS BAR (Trakt-style indicator:
  teal = in progress, brand red = completed, soft = standby, red =
  abandoned) and the rating badge is a shield in brand red with dark
  ink (4.9:1, all four themes).
- Statistics, Recipes, Gym, Shopping and Settings surfaces keep the
  card chrome of ADR-113 (re-declared in this layer the same way), so
  the whole app speaks one visual language.
- Rating scale (ADR-116, 1-10 pills) is preserved with a small CSS
  wrap patch.

## Consequences
- One unique accent color (brand red) + status colors, same as Trakt.
- Contrast verified in the four themes; the dark/black families share
  the same overrides (the ADR-113-generated companion rules for
  webkit... note: those companion rules remain in the file mid-body).
- The user manual does not change (visual-only reskin).
