# ADR-043: User's photo and name as a single clickable area on the profile button (issue #94)

## Status
Accepted

## Date
2026-08-07

## Context

In the web's header, the profile button
`#btn-open-profile` (`.user-badge__avatar-btn`) contained **only the
photo** of the user (`<img id="user-avatar" class="user-badge__avatar">`).
The username (`<span id="user-name" class="user-badge__name">`) lived
**outside the button**: it was a sibling of `.profile-menu-wrap`, inside
`.user-badge`, so at widths ≥520 px (tablet and PC), where the CSS shows
the name next to the photo (`@media (min-width: 520px)`), the name was
**inert text**: pressing it did not open the profile menu.

Issue #94 asked that the name be part of the button: the clickable area
must cover the photo **and** the full name on the devices where the name
is shown, keeping the current behavior on mobile
(<520 px, photo only).

The menu's behavior (open/close on press, click-outside to close) is
managed from `js/profile.js`:

- `document.getElementById("btn-open-profile")` for the button and
  `document.querySelector(".profile-menu-wrap")` for the container — the
  id/class selectors are **independent of the `<span>`'s position** in
  the DOM.
- The click-outside uses
  `!profileMenuWrap.contains(e.target)`: moving the name **inside**
  the button (child of `.profile-menu-wrap`), pressing the name becomes
  considered "inside" the menu, which is exactly the goal (pressing the
  name toggles the menu).

Related issue: #94 — https://github.com/gonzalitojh/personal-tracker/issues/94

## Decision

Move `#user-name` **inside** `#btn-open-profile`, immediately
after the `<img>`, so photo and name constitute the profile button's
**single clickable area**. Adjust the button's and the name's CSS so the
button's flex does not break the layout or the name's ellipsis
truncation.

### 1. HTML: the name becomes a child of the button

`index.html`:

- The `<span id="user-name" class="user-badge__name">` that was a
  sibling of `.profile-menu-wrap` (at the end of `.user-badge`) is
  **removed**.
- The same `<span id="user-name" class="user-badge__name">` is
  **added** **inside** `#btn-open-profile`, right after the
  `<img id="user-avatar" class="user-badge__avatar">`.

The button's attributes do not change: `aria-label="Abrir menú de
perfil"`, `aria-haspopup="menu"`, `aria-expanded` and `aria-controls` are
kept (the button keeps its own accessible label; the name is the button's
visible text, not its label).

### 2. CSS: `.user-badge__avatar-btn` becomes inline flex

`css/styles.css`, in `.user-badge__avatar-btn`:

- `line-height: 0` is **removed** (style inherited from when the button
  only contained the image; with text inside it would collapse the
  name's line and cut it).
- **Added**:

  ```css
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  cursor: pointer;
  min-width: 0;
  max-width: 100%;
  ```

  `inline-flex` + `align-items: center` align photo and name in a
  vertically centered row; `gap: 0.6rem` separates the photo from the
  name; `cursor: pointer` keeps the button's explicit clickable
  indicator; `min-width: 0` and `max-width: 100%` are AGENTS.md's
  responsiveness rules: the button can shrink inside the header's flex and
  the name can truncate with ellipsis instead of overflowing.

### 3. CSS: `.user-badge__name` with `line-height: normal` and `min-width: 0`

`css/styles.css`, in `.user-badge__name`:

- **`line-height: normal`**: prevents the text from being cut vertically
  inside the button's flex (the inherited `0` value of the button's
  former `line-height` would truncate the line box).
- **`min-width: 0`**: requirement of the ellipsis inside a flex item:
  without it, the text cannot shrink below its content and the
  truncation (`white-space: nowrap; overflow: hidden; text-overflow:
  ellipsis` + `max-width: min(12rem, 30vw)` from the `@media
  (min-width: 520px)`) would not work.

The base `display: none` (mobile <520 px) is kept: at those widths the
name is not rendered, **does not generate a flex item**, and therefore
there is neither ghost space nor `gap` between the photo and an invisible
element.

### 4. No JS changes

`js/ui.js` and `js/profile.js` are **not touched**: they use
`getElementById` / `querySelector` (position independent of the
`<span>`), and the click-outside of `js/profile.js`
(`profileMenuWrap.contains(e.target)`) gains the desired semantics: with
the name inside the button (child of `.profile-menu-wrap`), pressing the
name does not fire the click-outside and the menu toggles like pressing
the photo.

### 5. User manual updated

`docs/manual-de-usuario.md` (AGENTS.md obligation: change visible
to the user):

- Section 2 (access): «Para salir, pulsa **tu foto o tu nombre** (arriba
  a la derecha)…».
- Section 3 (main screen): «**Tu foto (y tu nombre, si se
  muestra)**: pulsándolos se abre un menú…».
- Section 13 (your profile): «Pulsa **tu foto o tu nombre** (arriba a la
  derecha)…» + clarifying note: «En móvil solo se ve la foto; en tablet
  y ordenador también aparece tu nombre, y ambas cosas forman parte del
  mismo botón».

## Rejected alternatives

- **Not touching the HTML and adding the click to the name via JS** (its
  own listener on `#user-name`): rejected — it would duplicate the
  menu management (two listeners, two `aria-expanded` states to sync),
  break accessibility (a "fake" click outside the button is not
  keyboard-activable nor announces the control) and would not solve the
  click-outside; the correct markup of a single control is a single
  `<button>`.
- **Wrapping photo and name in a separate clickable container** (e.g.
  a `div` with a listener or a second button): rejected — it would create
  a duplicated clickable area, with the same state-syncing and
  accessibility problems as the previous option; it also added an
  element with no semantic role of its own.
- **Keeping the structure and enlarging only the photo** (bigger photo
  as an implicit clickable area): rejected — it does not meet issue
  #94's acceptance criterion (the area must cover the photo **and** the
  full name) and would distort the header's design (ADR-040).
- **Keeping `line-height: 0` on the button and compensating with an
  explicit `line-height` on the `<span>`**: rejected — the button's `0`
  value propagates to the span's line box and cuts it (the child's line
  box resolves against the container's `line-height`); removing the
  obsolete property from the button is cleaner and less fragile than
  compensating for it.

## Consequences

### Positive

- **Unified clickable area**: on tablet/PC the photo **and** the name are
  the profile button's single clickable area; pressing either opens/toggles
  the menu (issue #94's acceptance criterion 1).
- **Mobile intact**: at <520 px the name stays hidden (`display:
  none`) and the photo is clickable exactly as before
  (acceptance criterion 2); `display: none` does not generate a flex
  item, so there is no ghost gap between the photo and an invisible
  element.
- **Accessibility kept**: there is still a single `<button>` with
  `aria-label`, `aria-haspopup`, `aria-expanded` and `aria-controls`
  (acceptance criterion 3); explicit `cursor: pointer` and hover/focus
  states coherent with the rest of the UI.
- **Ellipsis preserved**: `min-width: 0` on the button and the name +
  `line-height: normal` keep the truncation of long names
  (`nowrap` + `overflow: hidden` + `max-width: min(12rem, 30vw)` of the
  ≥520 px media query) working inside the button's flex, without
  overflowing the fixed-height header (ADR-040).
- **No JS changes**: `js/ui.js` and `js/profile.js` intact; the
  click-outside (`profileMenuWrap.contains`) now covers the name by DOM
  construction, with no new logic.
- **Responsiveness verified** per AGENTS.md: 360/768/1280 px with no
  horizontal scroll; relative units, `min-width: 0` and `max-width:
  100%`, with no `overflow-x: hidden` as a patch.

### Negative / Risks

- **No functional negative identified**: the change is additive over the
  existing clickable area; the only nuance is that pressing the name now
  **toggles** the menu (before it did nothing), which is precisely the
  desired behavior.
- **The button's clickable area is wider at ≥520 px** (photo + name
  + gap): it narrows the header's free space, which has fixed height and
  widths; mitigated with `max-width: 100%` and the name's ellipsis,
  which prevents the button from growing indefinitely with long names.

### Neutral

- **No PWA version bump**: the change is in the working tree of the branch
  `fix/issue-94-boton-perfil` and will be versioned with the
  corresponding PR (previous ADRs' versioning policy: the bump
  accompanies the release/merge, not this document).
- **`docs/manual-de-usuario.md` updated** (AGENTS.md obligation: change
  visible to the user): sections 2, 3 and 13 reflect that «your photo or
  your name» is pressed.
- **ADR-040 remains in force**: the fixed header, the `--header-h` height
  and the name's ellipsis it defined do not change; this ADR only changes
  the name `<span>`'s **location** (from the `.user-badge` container
  into the button) and the associated flex styles.

## Created/modified files

| File | Change |
|---------|--------|
| `index.html` | **Modified**: `<span id="user-name" class="user-badge__name">` moved from sibling of `.profile-menu-wrap` to **child of `#btn-open-profile`** (after `<img id="user-avatar">`); button attributes unchanged |
| `css/styles.css` | **Modified**: `.user-badge__avatar-btn` — `line-height: 0` removed and `display: inline-flex; align-items: center; gap: 0.6rem; cursor: pointer; min-width: 0; max-width: 100%` added; `.user-badge__name` — `line-height: normal` and `min-width: 0` added (the `@media (min-width: 520px)` ellipsis stays intact) |
| `docs/manual-de-usuario.md` | **Modified**: sections 2, 3 and 13 — «your photo or your name» (with a note in section 13 that on mobile only the photo is seen and both are part of the same button) |
| `js/ui.js` | **Unchanged** (uses `getElementById`, position-independent) |
| `js/profile.js` | **Unchanged** (click-outside with `profileMenuWrap.contains`; the name inside the button is covered by construction) |
| `docs/adr-043-boton-perfil.md` | **New**: this document |

Related issue: #94 — https://github.com/gonzalitojh/personal-tracker/issues/94
