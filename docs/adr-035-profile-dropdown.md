# ADR-035: Profile dropdown menu and logout (issue #76)

## Status
Accepted

## Date
2026-08-05

## Context

The header had two profile elements:

- The **avatar** (`#btn-open-profile`) which, when pressed, opened the
  profile view directly on the **Estadísticas** section (active `stats`
  subtab). To reach the other four sections (Amigos, Actividad, Datos,
  Ajustes) one had to navigate with the subtabs inside the view.
- A **«Salir» button** (`#btn-logout`) next to the username, always
  visible in the header.

Issue #76 asked: when pressing the avatar, a menu (dropdown/popover)
**anchored to that position** must unfold (not mid-screen) with access to
the five profile sections (**Estadísticas, Amigos, Actividad, Datos y
Ajustes**) and to **logging out**; in addition, the «Salir» button must be
removed from the main screen.

Two underlying problems motivated the change:

1. **Duplicated opening logic**: the avatar's handler (in `profile.js`)
   and the ⚙️ gear's `#btn-settings` (in `app.js`) repeated the same block
   (hide `#app`, show `#profile-view`, activate the subtab,
   show/hide each section). Any change to the profile's structure had to
   be applied in two places.
2. **Discoverability**: with the avatar jumping directly to Estadísticas,
   access to the other profile sections and to logout was less evident;
   the «Salir» button took up permanent space in the header.

As a reference there was the already-proven pattern of the notifications
dropdown (`.notif-wrap` > `.notif-dropdown`): panel anchored to its
button, closing with Escape, click outside and focus trap (`trapFocus`
from `focus-utils.js`), implemented in `notifications-setup.js`.

**Historical note**: this ADR documents the replacement of the previous
behavior, where the avatar opened Estadísticas directly and logout was a
fixed button in the header.

Related issue: #76 — https://github.com/gonzalitojh/Registro-personal/issues/76

## Decision

Replace the profile's direct opening with a **dropdown menu anchored to
the avatar** that groups the five profile sections and logout, removing
the «Salir» button from the header:

### 1. Dropdown anchored to the avatar button (notifications dropdown pattern)

- In `index.html`, the avatar button is wrapped in a `.profile-menu-wrap`
  container with `position: relative`.
- The `#profile-dropdown` panel uses `position: absolute; right: 0;
  top: calc(100% + 10px)`, so it anchors to the avatar's right edge and
  appears right below it — not centered on screen, as the issue asked.
- Menu content: five buttons with `data-section` (`stats`, `friends`,
  `activity`, `data`, `settings`) labeled **Estadísticas, Amigos,
  Actividad, Datos, Ajustes**, a separator and the **«Cerrar sesión»**
  option (`#btn-profile-logout`).
- The panel is a static DOM element (not injected by JS) and is
  shown/hidden with the `hidden` class; `z-index: 40` and width
  `min(240px, calc(100vw - 2rem))`.

### 2. Mobile (≤600px): viewport anchoring to avoid overflow

In `@media (max-width: 600px)` the panel becomes `position: fixed;
left: 1rem; right: 1rem; top: 4.5rem; width: auto`. If the header wraps
into two rows (compact mode), the `absolute` anchor would be shifted to
the left of the screen and the panel would overflow to the right. The
fixed anchoring with lateral margins guarantees the menu **never leaves
the visible width** (AGENTS.md's responsiveness requirement: no
horizontal scroll), same as the notifications dropdown.

### 3. Accessibility and focus management

- The avatar button carries `aria-haspopup="menu"`, `aria-expanded`
  (updated to `true`/`false` on open/close) and `aria-controls="profile-dropdown"`.
- The panel carries `role="menu"` with an `aria-label`; each option is
  `role="menuitem"` and the separator `role="separator"`.
- **Focus trap**: on open, `trapFocus(profileDropdown)` from
  `focus-utils.js` is activated (the same helper used by notifications,
  global search, modals and ratings); on close its cleanup runs.
- **Close with Escape**: an `escHandler` (keydown) is registered on open.
  Closing is centralized in `closeProfileDropdown()`, which
  **de-registers the handler on ALL closing paths**
  (`document.removeEventListener("keydown", escHandler)`): Escape, click
  outside, selecting an option, pressing «Cerrar sesión» and pressing the
  avatar again to close it.
  (Commit `068873f`: the handler was moved out of the click listener into
  `closeProfileDropdown()` precisely to guarantee that cleanup on every
  path and not leave hanging listeners.)
- **Focus restored to the avatar**: `closeProfileDropdown()` ends with
  `btnOpenProfile.focus()`, returning focus to the element that opened the
  menu.
- Close with **click outside**: a `document` click listener that closes if
  the click lands outside `.profile-menu-wrap` and the panel is open.

### 4. Single function `openProfileSection(section, ctx)` in `js/profile.js`

The opening logic is extracted into a single function that: hides `#app`,
shows `#profile-view`, activates the corresponding subtab (`aria-selected`
+ `is-active` class), shows/hides the sections (`stats`, `friends`,
`activity`, `data`, `settings`) and triggers each section's specific load
(`renderStats`, `loadFriendsList`, `loadActivityFeed`, `renderSettings`).
Three entry points use it:

1. The profile's **subtabs** (`profile-subtab`).
2. The header's **⚙️ gear** button: `app.js` no longer repeats the
   opening block, it just calls `profileApi.openProfileSection("settings", ctx)`.
3. The **options of the avatar's new menu**.

`setupProfile(ctx)` returns `{ openProfileSection }`; `app.js` receives it
as `const profileApi = setupProfile(ctx)`.

### 5. Total removal of `#btn-logout`

- `index.html`: the **«Salir»** button disappears from the header.
- `css/styles.css`: the button's specific styles in the mobile header
  (`.user-badge .btn--ghost`) are removed and the compact header's comment
  is updated (logout now lives in the avatar's menu).
- `js/app.js`: the `#btn-logout` → `logout()` listener is removed.

### 6. Logout from the menu

The `#btn-profile-logout` option first closes the menu
(`closeProfileDropdown()`) and then calls `logout()` from `firebase.js`
(the same function the previous button used; `app.js` keeps it only for
the non-invited email case).

## Rejected alternatives

- **Keeping the «Salir» button in the header**: rejected — the issue
  explicitly asked to remove it from the main screen and centralize
  logout in the avatar's menu.
- **Keeping the avatar opening Estadísticas directly**: rejected — it did
  not allow direct access to the five sections from the header and left
  the profile as a «page» with a single entry.
- **Screen-centered dropdown (modal style)**: rejected — the issue asked
  for the menu to appear unfolded from the avatar's position, not in the
  middle of the screen.
- **Duplicating the opening logic (previous pattern, one block per entry
  point)**: rejected — the duplication in `app.js` and `profile.js` was
  the maintainability problem this ADR fixes; it is unified in
  `openProfileSection`.
- **Injecting the menu dynamically with JS**: rejected — a static DOM
  element is simpler to style, audit and make accessible (same criterion
  as the notifications dropdown).

## Consequences

### Positive
- **Unified account access from a single point**: the avatar groups the
  five profile sections and logout; the «Salir» button stops taking up
  permanent space in the header.
- **Centralized opening logic**: `openProfileSection` removes the
  duplication; `app.js` shrinks and no longer repeats the profile opening
  block (a single call site for the ⚙️).
- **Full accessibility**: ARIA roles (`menu`/`menuitem`),
  `aria-expanded`/`aria-controls` states, focus trap, Escape closing and
  focus restored to the avatar on all closing paths.
- **No overflow risk on mobile**: the `fixed` anchoring ≤600px guarantees
  the menu fits any width, meeting the project's responsiveness rules.
- **Reuse of the proven pattern** of the notifications dropdown
  (`trapFocus` from `focus-utils.js`), coherent with the rest of the app.

### Negative
- **Logout takes one more step**: there used to be an always-visible
  button; now the avatar's menu must be opened and «Cerrar sesión»
  chosen. The risk is mitigated because on page reload the session is
  kept (Firebase Auth persistence), so logout is not a frequent action.

### Neutral
- **The menu only exists in the header's DOM**: it does not affect other
  views; the `hidden` class manages its visibility.
- **PWA versioned to `20260807`**: `APP_VERSION` in `js/config.js`, the
  service worker (`service-worker.js`) and the `?v=` refs of `index.html`
  are updated to invalidate caches with the new CSS/JS.
- **The user manual was updated in the same task** (obligation from
  AGENTS.md): sections 2, 3, 13 and 14 (the «Salir» button replaced by the
  avatar's menu).
- **`logout()` in `app.js` is kept** for the non-invited email case
  (guest list), independent of the menu.

## Created/modified files

| File | Change |
|---------|--------|
| `index.html` | `.profile-menu-wrap` wraps the avatar; new `#profile-dropdown` with 5 items (`data-section`), separator and `#btn-profile-logout`; ARIA attributes on button and menu; **`#btn-logout` removed**; versioned `?v=20260807` |
| `css/styles.css` | New classes `.profile-menu-wrap`, `.profile-dropdown` (+ `__item`, `__separator`, `__item--logout`) with anchoring `absolute right:0 top:calc(100%+10px)`; media query ≤600px with `fixed` anchoring to the viewport; `focus-visible` styles; **the Salir button's mobile styles removed** and its comment updated |
| `js/profile.js` | New single function `openProfileSection(section, ctx)` (subtabs, ⚙️ and menu); dropdown logic (open/close, Escape centralized in `closeProfileDropdown`, click outside, focus trap, focus to avatar); `#btn-profile-logout` → `closeProfileDropdown()` + `logout()`; returns `{ openProfileSection }` |
| `js/app.js` | **`#btn-logout` listener removed**; `const profileApi = setupProfile(ctx)`; `#btn-settings` now calls `profileApi.openProfileSection("settings", ctx)` (it no longer repeats the opening) |
| `js/config.js` | `APP_VERSION` from `20260806` to `20260807` |
| `service-worker.js` | `STATIC_ASSETS` with `?v=20260807` |
| `docs/manual-de-usuario.md` | «Salir» button replaced by the avatar's menu (sections 2, 3, 13 and 14) |
| `docs/adr-035-profile-dropdown.md` | **New**: this document |

Related issue: #76 — https://github.com/gonzalitojh/Registro-personal/issues/76
