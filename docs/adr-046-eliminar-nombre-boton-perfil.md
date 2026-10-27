# ADR-046: Remove the username from the profile button at all screen widths (issue #107)

## Status
Accepted

## Date
2026-08-07

## Context

Since ADR-043 (issue #94), the profile button
`#btn-open-profile` (`.user-badge__avatar-btn`) contained the user's
photo (`<img id="user-avatar" class="user-badge__avatar">`) **and** the
name (`<span id="user-name" class="user-badge__name">`) as a single
clickable area. On mobile (<520 px) the name was hidden with
`display: none` (photo only); on tablet and PC (≥520 px, `@media
(min-width: 520px)`) it was shown next to the photo, inside the button.

Issue #107 asks to remove the name from the profile access button at
**all** screen widths: the user wants the button to show
**only the photo**, without the name, both on mobile and on tablet and
computer.

The menu's behavior (open/close on press, click-outside to close) is
managed from `js/profile.js`, which uses
`document.getElementById("btn-open-profile")` and
`document.querySelector(".profile-menu-wrap")`: id/class selectors
**independent of the button's internal content**, so removing the
`<span>` does not affect that logic.

Related issue: #107 — https://github.com/gonzalitojh/Registro-personal/issues/107

## Decision

Remove the username from the profile button entirely at all widths:
remove the `<span id="user-name">` from the HTML, remove all
its JS references, clean up the CSS rules that no longer make sense and
update the user manual. The button is reduced to the photo, as it
already was on mobile.

### 1. HTML: the `<span id="user-name">` is removed from the button

`index.html`, inside `#btn-open-profile`:

- The `<span id="user-name" class="user-badge__name">` that sat after the
  `<img id="user-avatar" class="user-badge__avatar">` is **removed**.
- The button keeps **only** the `<img>` (as before ADR-043).

The button's attributes do not change: `aria-label="Abrir menú de
perfil"`, `aria-haspopup="menu"`, `aria-expanded` and `aria-controls` are
kept (the button keeps its own accessible label; the name is no longer
the button's visible text).

### 2. JS: the line that filled the name is removed

`js/ui.js`, in `showApp(user)`:

- The line
  `document.getElementById("user-name").textContent = ...` is
  **removed** (the element to assign the name to no longer exists).

The rest of `showApp` does not change: it keeps assigning the photo with
`document.getElementById("user-avatar").src = user.photoURL || PLACEHOLDER_COVER`.

### 3. CSS: the name's rules are removed and the button simplified

`css/styles.css`:

- The base `.user-badge__name` rule is **removed** (mobile, with the
  `display: none` and the `min-width: 0`/`line-height: normal` added in
  ADR-043).
- The `.user-badge__name` rule inside `@media (min-width: 520px)` is
  **removed** (the one that showed the name with ellipsis
  next to the photo on tablet/PC).
- The obsolete comment mentioning the `.user-badge__name` is
  **removed**.
- `.user-badge__avatar-btn` is **simplified**: `gap: 0.6rem`,
  `min-width: 0` and `max-width: 100%` are removed, properties that only
  served to accommodate the name's text inside the button's flex. The
  rest is kept (`display: inline-flex; align-items: center; cursor:
  pointer`, plus `background: transparent; border: none; padding: 0`),
  which with a single `<img>` child behaves the same as before.

### 4. User manual updated

`docs/manual-de-usuario.md` (AGENTS.md obligation: change visible
to the user):

- Section 2 (access): «Para salir, pulsa **tu foto** (arriba a la
  derecha)…» (the name mention is removed).
- Section 3 (main screen): «**Tu foto**: pulsándola se abre un
  menú…» (the «(y tu nombre, si se muestra)» is removed).
- Section 13 (your profile): «Pulsa **tu foto** (arriba a la derecha)…» +
  note: «El botón muestra únicamente tu foto, sin tu nombre, en
  cualquier dispositivo (móvil, tablet u ordenador)» (replacing the
  previous note explaining that on tablet/PC the name also appeared).

## Rejected alternatives

- **Hiding the name with `display: none` at all widths, keeping the
  `<span>` and the JS line**: rejected — it leaves dead code: the
  `<span>` and its assignment in `showApp(user)` would stay in the
  DOM/code never rendered, and the name's text would be loaded
  into the DOM uselessly on every login.
- **Keeping an empty `<span>` just in case (without JS)**: rejected — for
  the same reason: an unused element contributes nothing and forces
  maintaining CSS (or removed rules) and pointless markup; if the name
  should be shown again in the future, recovering it from git
  is trivial.

## Consequences

### Positive

- **Compact button**: the profile button is reduced to the photo (32px)
  on all devices; the text and the `gap` separating it from the image
  disappear.
- **Less space taken in the header**: with no name, the button cannot
  grow with long names and frees width on tablet/PC (the header has
  fixed widths/heights, ADR-040); the need for ellipsis and the
  `min-width: 0` / `max-width: 100%` safeguards that made it possible
  also disappear.
- **Symmetry with mobile**: the button looks identical at the three
  widths (360/768/1280 px), removing the visual behavior difference
  between mobile and tablet/PC that motivated the manual's notes.
- **Cleaner code**: the `<span>`, its JS assignment and
  two CSS blocks (base + media query) are removed along with their
  comments; no dead code nor references to nonexistent elements remain.
- **Menu JS intact**: `js/profile.js` is not touched; the id/class
  selectors and the click-outside (`profileMenuWrap.contains`) do not
  depend on the button's internal content.
- **Accessibility kept**: there is still a single `<button>` with
  `aria-label`, `aria-haspopup`, `aria-expanded` and `aria-controls`;
  explicit `cursor: pointer` and hover/focus states coherent with the
  rest of the UI.

### Negative / Risks

- **The name is no longer visible in the header** on tablet/PC: the user
  loses that direct visual reference at those widths. It is the behavior
  explicitly requested in issue #107; the name remains available inside
  the profile menu («Datos» section).
- **ADR-043 partially superseded**: its **name** part
  (moving it inside the button, flex styles and ellipsis) no longer
  applies; its **button/click** part (single clickable area, ARIA
  attributes, menu management) remains fully in force.

### Neutral

- **No PWA version bump**: the change will be versioned with the
  corresponding PR (previous ADRs' versioning policy: the bump
  accompanies the release/merge, not this document).
- **`docs/manual-de-usuario.md` updated** (AGENTS.md obligation: change
  visible to the user): sections 2, 3 and 13 reflect that the button
  shows only the photo on any device.
- **Responsiveness preserved**: removing the text introduces no new
  overflows; the button only contains the image, which already had
  fixed size and was verified at 360/768/1280 px.

## Created/modified files

| File | Change |
|---------|--------|
| `index.html` | **Modified**: `<span id="user-name" class="user-badge__name">` removed from `#btn-open-profile`; the button keeps only `<img id="user-avatar" class="user-badge__avatar">`; ARIA attributes unchanged |
| `js/ui.js` | **Modified**: the line `document.getElementById("user-name").textContent = ...` removed in `showApp(user)`; the rest of the function intact |
| `css/styles.css` | **Modified**: the `.user-badge__name` rules (base + `@media (min-width: 520px)`) and the obsolete comment removed; `.user-badge__avatar-btn` simplified (`gap: 0.6rem`, `min-width: 0`, `max-width: 100%` removed) |
| `docs/manual-de-usuario.md` | **Modified**: sections 2, 3 and 13 — «press your photo» (no name mention) + note in section 13: the button shows only the photo on any device |
| `js/profile.js` | **Unchanged** (id/class selectors and click-outside independent of the button's content) |
| `docs/adr-046-eliminar-nombre-boton-perfil.md` | **New**: this document |

Related issue: #107 — https://github.com/gonzalitojh/Registro-personal/issues/107
