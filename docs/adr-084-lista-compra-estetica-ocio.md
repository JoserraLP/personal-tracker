# ADR-084: Ocio-like aesthetics on the Compra tab (formerly «Lista de la compra») — pill buttons, controls and checkboxes coherent (issue #221)

## Status
Accepted

## Date
2026-08-11

## Context

Issue
#221 (type: style) asks to
fit the Recipes section's **«Lista de la compra»**
tab's aesthetics
(issue #64) and
especially its
buttons into
the web's rest: the same
visual
language of
type
**Ocio** already applied
  to the
  Recipes,
  Ingredients (ADR-082, issue #218) and
  Menú (ADR-083, issue #220)
  tabs: **pill**
  buttons, `btn--primary` for the main
  action, uniformized
  form controls, a
  highlighted
  `:focus-visible` and the four
  theme
  modes.

Previous state (built in
 ADR-076, issue #64): the
   tab's toolbar used
   `btn--small` for
   «+ Ítem extra» (`#btn-add-extra-item`), with no
   visual
   hierarchy
  between
   actions; the
   extra
   item's form
   (`.shopping-extra-form__row`) had
   inputs and a
   **native
  unstyled
   select**
  (`background: var(--ink)`, border
  `--paper-alpha-20` and
   `border-radius: var(--radius)`
  with
   straight corners) and no
   `:focus-visible`; and the
   ✕
  button of removing
   an
   extra
   item (`.shopping-line__remove`)
   was a loose
   glyph (`background: none; border: none`)
   **without
   pill presence** nor
  a
  legible
   hover.

Flow note: the work's
 base is the
 `content/issue-64-seccion-recetas`
  branch; the work
  branch is
  created from there and the
  PR goes
  **also to that branch, not to
  `dev`** — a
  one-off exception to AGENTS.md §1's PRs-against-`dev`
  rule, explicitly requested
  by the user in the
  issue (the
  PR #222/#219/#214
  pattern). Moreover, issue #220's
  PR #222 is
  **open against the same base** and
  defines
  the
  `.btn--pill`
  class (and
  re-styles
  `.menu-*`/`.menu-week-label`): this
  ADR avoids reusing it to
  not
  create a merge
  conflict, and
  skips the
  number 083 in its
  name (already
  claimed
  by the
  ADR of that
  PR) to
  not
  collide when
  both merge.

The redesign's key decisions:

1. **The main action**: `#btn-add-extra-item` goes
   from
   `btn btn--small` to
   `btn btn--primary btn--small`, replicating issue
   #220's «+ Añadir
   receta
   a la
   semana» pattern.
2. **The form's secondary button**:
   "Cancelar"
   becomes
   `btn btn--small shopping-btn--ghost`; "Añadir"
   (primary) intact.
   No functional changes.
3. **The form's controls uniformized**: the
   extra
   item's form's inputs/select become
   pill
   (a
   `--ink-raised` background, a
   1px
   `--paper-alpha-30` border,
   radius
   999px, padding
   0.3rem 0.75rem, font-size
   0.85rem)
   + a
   `:focus-visible` with
   a
   2px `--teal-reel` outline.
4. **The ✕ of
   removing an
   extra
   item**: pill
   presence
   (a
   `--paper-alpha-30` border,
   radius
   999px, padding
   0.15rem 0.45rem, hover
   `--paper-alpha-10`); the
   `--stamp`
   color stays
   intact.
5. **Four themes**: the
   light
   family's
   **grouped**
   (light+white)
   overrides for
   ghost and
   the ✕
   hover, a
   pure
   black override
   only for
   the
   form's
   inputs/select (the
   `ingredient-modal__field`
   pattern) and
   CSS
   comments
   documenting why
   pure black does
   **not** need an
   override for
   ghost/✕
   (issue #220's
   comment
   pattern).

## Decision

1. **CSS** (`css/styles.css`, all in the
   shopping
   list's block and in
   own
   overrides, without touching
   `.btn--pill`/`.menu-*`/
   `.menu-week-label` which PR
   #222 defines or
   uses): the inputs/select of
   `.shopping-extra-form__row` become
   pill
   + `:focus-visible` (a
   2px `--teal-reel` outline); a
   new
   `.shopping-btn--ghost` class with
   ADR-083's pill metrics (a
   `--ink-raised` background, the
   `--paper` text, a
   1px
   `--paper-alpha-30` border,
   radius
   999px, padding
   0.3rem 0.75rem, font-size
   0.85rem; hover
   `--paper-alpha-10`) —
   **it does not reuse**
   `.btn--pill` because
   PR #222, still
   open, defines it, a
  decision
   documented in a CSS
   comment; `.shopping-line__remove` (the
  ✕) with
   a
   `--paper-alpha-30`
   border,
   radius
   999px, padding
   0.15rem 0.45rem and
   hover
   `--paper-alpha-10`; grouped
  overrides
   `[data-theme="light"]`+`[data-theme="white"]`
  in an
   own block
   (ghost
   → color
   `--ink` and
   hover
   `--ink-alpha-10`; the
   ✕
   hover →
   `--ink-alpha-10`), without
  touching
  #222's
  grouped
  block; a
   `[data-theme="black"]` override
   for
   the
   form's inputs/select
  (a
  `background: var(--ink)`, with
  a
  comment: the
  base
  pill's
  `--ink-raised` would blend into the form's
  `--ink-raised`; the
  `ingredient-modal__field`
  pattern) and
  comments
  documenting why
  pure
  black needs no
  override for
  ghost/✕ (the
  base is already correct over
  black).
2. **HTML** (`index.html`): `#btn-add-extra-item` goes
   from
   `btn btn--small` to
   `btn btn--primary btn--small`.
3. **JS** (`js/shopping-list.js`): the extra
   item's form's "Cancelar"
   button (`renderExtraForm`)
   becomes
   `btn btn--small
   shopping-btn--ghost`; "Añadir"
   (`btn--primary`)
   intact. No functional changes (the
   computation,
   marking
   bought,
   adding/removing
   an extra
   item and
   excluding
  recipes stay).
4. **PWA**: the version bumps
   `20260911 → 20260913` in `index.html`
   (the `?v=`), `js/config.js` (`APP_VERSION`) and
   `service-worker.js` (`STATIC_ASSETS`). `20260912` is
   avoided, already
   used by PR
   #222.
5. **User manual**: without
   changes in the
   first
  iteration — issue
   #220's precedent
   (ADR-083): section
   8.4 describes
   only
   functionality (the
   computation,
   marking
   bought, extra
   items,
   excluding
   recipes), not
   aesthetics; the
   change is a purely visual
  buttons and
  controls change and alters
   nothing at the behavior
   level. In the
   later
   iteration it does update (the
   tab's rename, see
   below).
6. **The PR against
   `content/issue-64-seccion-recetas`**: a
   one-off and
   explicit exception
   to AGENTS.md §1's rule (PRs always against
  `dev`), requested
   by the
   user in issue #221; the work
   branch
   `style/issue-221-pestana-lista-compra` was
   created from
   that base.

## Consequences

- **Positive**: the «Lista de la compra» tab reaches
   Ocio's and the Recipes/Ingredients/Menú tabs' visual
   level; the
   actions' hierarchy is
   readable (the
   primary
   for «+ Ítem extra», the
   ghost
   for
   "Cancelar", the
   ✕
   with
   pill
   presence
   and
   hover); the
   `.shopping-btn--ghost`
   class stays
   reusable for the section's future controls; no behavior changes (the
   computation,
   marking
   bought,
   adding/removing
   an
   extra
   item and
   excluding
   recipes stay).
- **Neutral**: the PWA's version bump
   (it invalidates the cache of
   `20260911`
   to propagate the new
   CSS); the
   `#shopping-week-label` label shares
   `.menu-week-label`'s
  class with
   the menu, so
  when
   PR
   #222 merges (which re-styles it)
   it improves automatically without
  touching
   this
   PR; the
   PR goes
   against
   `content/issue-64-seccion-recetas` as
   an explicit
  exception (not to
  `dev`); the
  ADR jumps to the
   number 084 because
   083 is
   taken
   by PR
   #222's
   ADR, still open against
   the same
   base.
- **Negative**: none known. The
   functionality stays intact. QA
  PASS: a coherent visual language, four theme modes
  with WCAG AA contrast and
  responsiveness at
  360 / 768 / 1280 px with no
   page-level
   horizontal scroll; documented
   non-blocking observations: the
   pills' 1px borders fall below the
   3:1 required for graphical components (mandated
   by
  ADR-083's pill spec, and an
   improvement over the base
  state) and
  the
  ✕
  glyph uses the
  dark
  family's
  pre-existing `--stamp`
  (not introduced in this change).
   Security PASS: 100 %
  presentational changes,
   `escapeHtml`
   intact and
   the service worker only with
  a version bump.

## The iteration (2026-08-11): checkboxes and the tab's rename

A new user comment on issue #221:
(1) the checkboxes must also
have the web's colors and
styles; (2)
the tab's name,
 «Lista de la compra», is
 too long and
 looks
 ugly in the
 tab bar — it asked for
 something simpler taking
 up a single
 row
 («Compra»,
 «Carrito»,
 «Cesta»…).

### The iteration's decisions

1. **Renamed to «Compra»**: the
   shortest and most neutral term is
   chosen (6
   letters vs
   «Ingredientes»' 12, which already fits
   in one
   row on
   mobile). "Carrito"
   sounds
   like e-commerce and
   "Cesta" is more
   regional; "Compra"
   preserves semantic continuity
   with the
   existing concept
   "the
  shopping
  list" (the manual's
  section 8.4 and
  the
  `#shopping-week-label` keep
   using
   that
  term). The
   tab's label updates in
   `index.html` (the
   button and
   the
   visually-hidden
   `h2`, keeping
   the
  `id` and
   the
   `aria-labelledby`) and
   the
   Settings
   →
   Sections
   and
   tabs label in
   `js/settings.js` (`SECTION_REGISTRY.recetas.compra.label`); the
   internal token
   `data-recipes-tab="compra"` and
   the
   `panelId` do not change.
2. **Checkboxes with native
   `accent-color`**: the same pattern as
   Ocio's
   `.saga-row input[type="checkbox"]`
   (ocio.css): `accent-color`
   + 18×18 px + `flex-shrink: 0`, with
   the
   tab's accent
   `--stamp`
   (red). The
   episodes' custom
   visual
   checkbox (`.episode-checkbox-wrap`/`-visual`,
   circle
   +
   check) is
   rejected because
   it would require touching
   `js/shopping-list.js`'s
  render to
   insert
  the
  visual
  span and
  redo
   the
   accessibility; the
   native
   `accent-color`
   keeps
   the
   existing
   `aria-label`
   and
   the
   browser's
   focus. It applies to
   the
   tab's two checkboxes:
   each
   line's «mark
   bought»
   (`.shopping-line__main input[type="checkbox"]`)
   and
   the
   extra
   item's form's «No es
   comestible»
   (`.shopping-extra-form__check
   input[type="checkbox"]`).
3. **Four themes**: the
   base with
   `--stamp` (#a63b2e) gives
   a
   white
   check ≈6.4:1 in Dark
   and
   in the
   light
   family (no
   override
   needed); in
   pure
  black `--stamp`
   over
   black sits right at
   ≈3.1:1 (the graphical
   limit), so the
   grouped
  `[data-theme="black"]`
  override moves
   the
   accent
   to
   `--stamp-dark`
   (#cf6655, ≈5.4:1 over
   black), following
  Ocio's
   episode-checkbox's
   pure-black-override pattern.
4. **User manual**: the tab's 5 mentions as a
   name update («Compra» in
   sections 3,
   8,
   8.4 and
   16); the lowercase concept
   "the shopping
    list", section
   8.4's
   title and
  the
   `#shopping-week-label` keep
   the full
   term.
5. **PWA**: a bump
   `20260913 → 20260914` (a
   new value, different from
   PR #222's
   `20260912`
   and the
   previous
   `20260913`).

### The iteration's consequences

- **Positive**: the «Compra» tab takes a
   single
   row on mobile
   (~360 px)
   with
   no wrap; the checkboxes match
  the
  web's rest
   (the same pattern as
  Ocio) with
   the
   tab's
   red
   accent
   and
   AA/graphical contrast in the
   four themes; the
  manual stays
   coherent with the
  interface (AGENTS.md
  §3's rule).
- **Neutral**: no functional changes —
   `js/shopping-list.js`
   is not
   touched (the
   delegation of
   `input[type=checkbox][data-bought]`
   and
   the
   `is-bought`
   toggle stay
   intact); the
   CSS
   comment
   "long
   tab
   labels" updates because
   its example
   («Lista de la compra») no longer exists as
   a
   label.
- **Negative**: none known. QA
  PASS (the iteration's 7 criteria:
   checkboxes with
   an
   accent,
   "Compra" in one
   row
   with no
   visible references to
   the old
   name, four
   themes with
   contrast,
   no functional changes,
   responsiveness 360/768/1280 px, a
   coherent
   manual and
   a bump different from
   20260912/20260913); findings
   only
   informative (a contrast rounding in a CSS
   comment, already
   fixed). Security
   PASS: 0
   HIGH; the iteration is 100 %
  presentational/textual (CSS, labels and a version
   bump).

Related issue: #221
