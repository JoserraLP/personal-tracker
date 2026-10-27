# ADR-083: Ocio-like aesthetics on the Menú tab — pill buttons and coherent controls (issue #220)

## Status
Accepted

## Date
2026-08-11

## Context

Issue #220 asks to improve the
Recipes section's **«Menú»** tab's aesthetics
(issue #64): its buttons had an aesthetics
**completely different** from the web's rest
(the Ocio section and the Recipes/Ingredients tabs). The goal is for
them to follow the same visual language: `.sort-select` /
`.ingredients-filter__btn`-style **pill** buttons of
Ocio, `.btn--primary` for primary actions, a
`danger` coherent look for destructive ones and
consistent selects.

Previous state (built in ADR-076/ADR-081, issues #214/#215): the
menu's toolbar used `btn--small` for the weeks'
navigation (`menu-prev-week`/`menu-next-week`), "Borrar
semana" (`menu-delete-week`) and
«+ Añadir receta a la semana» (`btn-add-weekly-recipe`); the
selects of `.menu-meal__picker` and
`.menu-weekly__addrow` were unstyled
 natives and
 the diners'
input followed
 no pattern of
 the web.

Flow note: the work's base
 is the
 `content/issue-64-seccion-recetas` branch; the work
 branch is
 created from there and the
 PR goes
 **also to that branch, not to
 `dev`** — a
 one-off
 exception to
 AGENTS.md §1's PRs-against-`dev` rule, explicitly requested
 by the
 user in the
 issue.

The redesign's key decisions:

1. **A new pill
   class `.btn--pill`**: it reuses
   Ocio's `.sort-select` /
   `.ingredients-filter__btn` exact metrics
   (a
   `--ink-raised` background, the
   `--paper` text, a
   1px `--paper-alpha-30` border,
   radius
   999px, padding
   0.3rem 0.75rem, font-size
   1rem, hover
   `--paper-alpha-10`). It is declared
   **before** `.btn--danger` so
   the `.btn--pill.btn--danger` combination
   keeps
   the
   danger
   color (`--stamp`) and
   hover: the
   pill
   contributes
   radius/padding and
   the
   danger background/border/color.
2. **The actions' hierarchy**: the weeks'
   navigation (←/→)
   and «Borrar
   semana» become
   pills;
   the destructive one combines with
   `.btn--danger`; «+ Añadir
   receta a la semana» becomes
   `.btn--primary btn--small` for
   being
   the
   main
   action.
3. **The tab's controls uniformized**: `.menu-week-label`
   (font-size
   0.95rem + color
   `--ink-soft`), `.menu-comensales input`
   (a pill: radius
   999px, a
   `--paper-alpha-30` border, padding,
   font-size
   1rem, text-align
   center, + a
   `:focus-visible` with
   an
   outline
   `--teal-reel`), `.menu-meal__add`
   (radius
   999px, a
   `--paper-alpha-30`
   border, hover
   `--paper-alpha-10`) and the
   selects of
   `.menu-meal__picker` and
   `.menu-weekly__addrow` (a
   `--ink-raised` background,
   pill,
   + `:focus-visible`).
4. **Four themes**: the
   light family's
   **grouped**
   overrides
   (`[data-theme="light"/"white"] .btn--pill:not(.btn--danger)`)
   → color
   `--ink` and
   hover
   `--ink-alpha-10`;
   `.menu-meal__add:hover`
   →
   `--ink-alpha-10`,
   following
   AGENTS.md
   §4's grouped-selectors pattern. **Pure
   black needs no
   override**: it is documented
   with a
   comment in the CSS (—`--ink-raised` is
   #0a0a0a, an
   almost-black
   background, with
   a
   light
   `--paper` text, border
   `--paper-alpha-30` and
   hover
   `--paper-alpha-10`—, and
   the
   delete
   pill uses
   `--stamp-dark`).
5. **A coherent dynamic
   button**: the button recreated in
   JS (`js/menu.js`'s
   `renderWeeklyRecipes`) becomes
   `btn--primary
   btn--small`, the same as its static homolog, so the
  "«+ Añadir receta a la semana»" flow is
   never visually different.

## Decision

1. **CSS** (`css/styles.css`): a new
   `.btn--pill` class
   (with its
   hover), declared
   **before** `.btn--danger`
   and with a
   comment explaining the
   cascade order for
   `.btn--pill.btn--danger`.
   `.menu-week-label`,
   `.menu-comensales input`
   (+`:focus-visible`),
   `.menu-meal__add`
   (+hover), `.menu-meal__picker select`
   and
   `.menu-weekly__addrow select`
   (+`:focus-visible`) are updated, and the
   light family's
   grouped overrides are added
   (`[data-theme="light"]`+`[data-theme="white"]`)
   for
   `.btn--pill` and
   `.menu-meal__add`, along with the
   comment
   documenting why pure black needs no
   override.
2. **HTML** (`index.html`): `menu-prev-week` and
   `menu-next-week` go
   from
   `btn--small` to
   `btn--pill`; `menu-delete-week` becomes
   `btn--pill btn--danger`; `btn-add-weekly-recipe`
   becomes
   `btn--primary btn--small`.
3. **JS** (`js/menu.js`): the
   dynamic button that
   `renderWeeklyRecipes`
   rebuilds (when the
   picker consumed the static one) becomes
   `btn--primary btn--small`, coherent with the
   static
   one.
4. **PWA**: the version bumps
   `20260911 → 20260912` in `index.html`
   (the `?v=`), `js/config.js` (`APP_VERSION`) and
   `service-worker.js` (`STATIC_ASSETS`).
5. **User manual**: without
   changes — section
   8.3 describes only
   functionality (navigating weeks,
   diners,
   deleting, adding recipes), not
   aesthetics; the
   change is a purely visual
   buttons change and
   alters nothing visible at the behavior
   level.
6. **The PR against
   `content/issue-64-seccion-recetas`**: a
   one-off and
   explicit
   exception to
   AGENTS.md §1's rule (PRs always against
   `dev`), requested by
   the
   user in issue #220; the work
   branch
   `wip/issue-220` was
   created from
   that base.

## Consequences

- **Positive**: the «Menú» tab reaches
  Ocio's and the Recipes/Ingredients tabs' visual level; the
  actions' hierarchy is
  readable (pills for navigation, the
  danger for the destructive one, the
  primary for the main
  action); the
  `.btn--pill` class stays
  reusable for future controls; the
  dynamic and the static
  button never diverge visually.
- **Neutral**: the PWA's version bump
  (invalidates the cache of `20260911`
  to propagate the new CSS); the
  dynamic button goes back to
  `btn--primary btn--small` when
  `renderWeeklyRecipes` reconstructs it, but the
  user perceives no
  behavior
  change; pure black gets no
  own override because
  the pill's base values are already correct
  over a black background (a
  decision
  documented in the CSS).
- **Negative**: none known. The
   functionality stays intact (navigating
   weeks, diners,
   deleting the week, «+ Receta» per
   meal, recipes
   for the week, removing). QA
   PASS: a coherent visual language, four theme modes
   with WCAG AA contrast (computed per
   theme) and responsiveness at
   360 / 768 / 1280 px with no page-level
   horizontal scroll (the menu grid's internal
   scroll stays
   allowed). Security
   PASS: no findings
   (the Firebase/TMDB/GB keys are pre-existing and
   public by design).

## The update (iteration, the 2026-08-11 comment)

The first pass left each meal's «+ Receta»
buttons with
the pill's radius
and
border but **without own background nor
color** (they
inherited the text's), so they looked with
a different aesthetic from the rest of
the tab's buttons. The user asked:
*«the add-per-day recipe buttons
should have the same colors as the other
buttons»*.

This iteration's decision: `.menu-meal__add`
adopts `.btn--pill`'s
exact colors — a
`--ink-raised` background, the
`--paper` text, a
1px `--paper-alpha-30` border,
hover
`--paper-alpha-10` — and in the
light
family the text becomes
`--ink` (with
hover
`--ink-alpha-10`) through the
same grouped
override pattern
`[data-theme="light"/"white"]`
already used for `.btn--pill`
(in pure
black no
override is needed: the
base values are already
correct). The size stays
`btn--small`
because
the other metrics (radius
999px, etc.) were already
pill's. The PWA bumps
`20260912 → 20260913` to
propagate the new
CSS to
cache-carrying clients.

Related issue: #220
