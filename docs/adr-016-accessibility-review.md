# ADR-016: Accessibility review and improvement — Keyboard navigation and screen readers

## Status
Accepted

## Date
July 2026

## Context

The application "Mi Registro" had grown significantly in functionality (global search, activity feed, settings, export, etc.) without a dedicated accessibility review. This created several barriers for users with visual disabilities or those who navigate exclusively by keyboard:

1. **Lack of skip link**: There was no link to jump directly to the main content, forcing keyboard users to tab through the entire header navigation on every page load.
2. **Missing focus management in modals**: When opening a modal, focus remained on the element that triggered it, and it was not restored when closing. There was no focus trapping (_focus trapping_), so Tab could move the focus behind the modal.
3. **Lack of ARIA roles and landmarks**: Dynamic content panels, profile sub-tabs and the notifications dropdown lacked ARIA roles (`tabpanel`, `tablist`, `dialog`, `alert`) that would allow screen readers to correctly interpret the structure.
4. **Insufficient visible focus**: Many interactive components did not show a visible outline when receiving focus, or used `outline: none` with no alternative.
5. **Lack of keyboard support on clickable elements**: Activity feed events and global search results only responded to mouse clicks, not to Enter/Space.
6. **Incorrect color contrast**: There was an override that worsened the contrast on the user's name in light mode.
7. **Unannounced dynamic regions**: Panels loaded dynamically (series, movies, books) did not notify screen readers about content changes.

The goal was to reach a **WCAG 2.1 AA** compliance level without introducing functional regressions.

## Decision

Carry out a comprehensive accessibility review covering the following axes:

### 1. New focus utilities module (`js/focus-utils.js`)
A reusable module was created with two functions:

- **`getFocusableElements(container)`**: Gets all visible focusable elements inside a container using `querySelectorAll` with the standard selectors (`a[href]`, `button:not([disabled])`, `input:not([disabled])`, etc.) and filters by visibility (`offsetParent !== null`).
- **`trapFocus(container)`**: Traps focus inside a modal/dropdown container. It listens to `keydown` events to intercept Tab and Shift+Tab, cycling between the first and last focusable element. It focuses the first element automatically after a `requestAnimationFrame`. It returns a `cleanup` function to restore the normal behavior.

### 2. Skip link (`index.html` + `css/styles.css`)
- A link `<a href="#main-content" class="skip-link">` was added as the first element of the `<body>`.
- The `<main>` now has `id="main-content"` and `tabindex="-1"` so it can receive focus.
- CSS styles: the skip link is hidden off-screen (`top: -100%`) and becomes visible when it receives focus (`top: 0`), with a thick outline in `--teal-reel`.

### 3. Focus management in all modals and dynamic panels

`trapFocus` and registration of `document.activeElement` were added to the following `js/ui.js` functions:
- `openEditModal`
- `openManualAddModal`
- `openMovieModal`
- `openSagaSelectionModal`
- `openBookModal`
- `openTvModal`
- `openBookConfirmModal`
- `openReadOnlyModal`

The `closeModal()` function was modified to:
- Restore focus to the `_previousActiveElement` registered before opening the modal.
- Run `_focusTrapCleanup()` to remove the focus trap listener.
- Clear the modal's auxiliary properties.

### 4. Global search (`js/global-search.js`)
- `trapFocus` was imported to trap focus inside the search panel when opening.
- `document.activeElement` is registered when opening (`_previousActiveElement`) and restored when closing.
- Results changed from `tabindex="-1"` to `tabindex="0"`.
- `keydown` handlers for Enter and Space were added to each result, triggering navigation.

### 5. Notifications dropdown (`js/notifications-setup.js`)
- `trapFocus` was imported to trap focus inside the dropdown when opening.
- An Escape handler is registered to close the dropdown.
- When closing (both via Escape and click outside), focus is restored to the notifications button.
- The closing logic was extracted into a `closeNotifDropdown()` function that also cleans up the focus trap.

### 6. Global Escape handler (`js/modal-handlers.js`)
The Escape handler was unified with a priority system:
1. **Active modal**: if `#item-modal` is not hidden, the modal is closed.
2. **Global search**: if `#global-search` is open, the keystroke is delegated to its internal handler (no interference).
3. **Notifications**: if `#notif-dropdown` is visible, it is closed and focus is restored to the button.

### 7. ARIA roles and landmarks (`index.html`)

| Element | Change |
|----------|--------|
| `<main>` | `id="main-content"` + `tabindex="-1"` |
| Dynamic panels (`#panel-tv`, `#panel-movies`, `#panel-books`) | `aria-live="polite"` + `aria-atomic="true"` |
| `#profile-view` | `role="main"` + `aria-label="Vista de perfil"` |
| `.profile-subtabs` | `role="tablist"` + `aria-label="Secciones del perfil"` |
| Each `.profile-subtab` | `role="tab"` + `aria-selected="true"/"false"` + `aria-controls="profile-section-{section}"` |
| Profile sections (`#profile-section-*`) | Changed from `<div>` to `<section>` with `role="tabpanel"` + `aria-labelledby` pointing to a visually hidden `<h2>` |
| Statistics period `<select>` | `aria-label="Periodo de estadísticas"` |
| Toast (`#toast`) | `role="alert"` + `aria-live="assertive"` |
| Notifications dropdown (`#notif-dropdown`) | `role="dialog"` + `aria-label="Notificaciones"` |
| Switch labels (`.switch`) | Changed from redundant `aria-label` to `aria-hidden="true"` (the textual `<label>` already exists) |
| Arrow between dates (`→`) | `aria-hidden="true"` |

### 8. Focus on tab change (`js/app.js`)
When switching tabs (Series/Movies/Books), focus moves to the `<h2>` of the active panel, which receives `tabindex="-1"` so it can receive focus via `focus()`.

### 9. ARIA synchronization in profile sub-tabs (`js/profile.js`)
When clicking a profile sub-tab, besides the `is-active` class, the `aria-selected` attributes are updated (`true` on the active one, `false` on the rest).

### 10. Activity feed — keyboard support (`js/ui.js`)
Activity feed events now have:
- `tabindex="0"` and `role="button"` so they are focusable.
- `keydown` handlers for Enter and Space that execute the same action as the click.

### 11. Episodes — ARIA labels (`js/ui.js`)
- Episode checkboxes now have a descriptive `aria-label` (e.g. "Marcar E1 — Nombre del episodio como visto").
- The `<span>` with the episode number has `aria-hidden="true"` (the information is already in the `aria-label`).

### 12. Friend avatars — alternative text (`js/ui.js`)
The `alt` of the friend avatar images changed from `alt=""` to `alt="Avatar de {nombre}"`.

### 13. Visible focus styles (`css/styles.css` and `ocio/ocio.css`)

**Global (`css/styles.css`):**
- The global `:focus-visible` was updated with color `--teal-reel`, `outline-offset: 2px` and `border-radius`.
- Specific `:focus-visible` styles were added for 13 components: `.friend-card`, `.profile-subtab`, `.modal__close`, `.global-search__close`, `.global-search__item`, `.global-search__friend`, `.notif-row__delete`, `.season-toggle`, `.list-row__action`, `.item-card__btn`, `.tab`, `.icon-btn`, `.btn-link`.
- `.global-search__input`: `outline: none` was removed and a `:focus-visible` with teal outline was added.
- An incorrect contrast override was removed (comment: "El `user-badge__name` en modo claro usa el `--ink-soft` ya definido que proporciona contraste suficiente contra fondos oscuros").

**Ocio (`ocio/ocio.css`):**
- The `.library-search-input:focus-visible` replaced `outline: none` with `outline: 2px solid var(--teal-reel)`.
- `:focus-visible` styles were added for 8 components: `.view-toggle__btn`, `.chip`, `.season-mark-all`, `.episode-rating__star`, `.cover-picker__item`, `.desc-picker__item`, `.saga-row` (with `:focus-within`), `.sort-select`.

## Alternatives considered

- **Using an external focus trapping library** (e.g. `focus-trap`): Rejected because the project has no build tool or npm dependency manager. The native implementation is simple (63 lines) and sufficient for the use cases.
- **Using `aria-activedescendant` in the global search**: Rejected due to the extra complexity; the current approach with `tabindex="0"` and arrow navigation works correctly with screen readers.
- **Keeping the redundant `aria-label`s on the switches**: Keeping them was considered for clarity, but the WCAG-recommended practice is not to duplicate information when a textual `<label>` already exists. `aria-hidden="true"` was chosen to avoid confusion for screen readers.

## Consequences

### Positive
- **WCAG 2.1 AA compliance**: The Perceivable (ARIA labels, landmarks), Operable (keyboard, skip link, visible focus) and Robust (correct roles, dynamic regions) principles are addressed.
- **Complete keyboard navigation**: All interactive elements are accessible via Tab, Enter, Space and Escape, with proper focus management in modals and dropdowns.
- **Consistent experience with screen readers**: The structure of landmarks, tabpanels and `aria-live` regions allows semantic navigation.
- **Reusable code**: `focus-utils.js` can be used in any new modal or dropdown without duplication.
- **No regressions**: All changes are additive or substitutive (no existing functionality was removed). Focus management is transparent for mouse users.
- **Documentation of the change**: This ADR serves as a reference for the applied improvements and the justification for each one.

### Negative
- **Increased complexity in `closeModal()`**: It must now manage `_previousActiveElement` and `_focusTrapCleanup`, which adds coupling with the modal's internal state. However, the pattern is consistent across all functions that open modals.
- **Dependence on expanded properties on DOM elements**: `_previousActiveElement` and `_focusTrapCleanup` are stored as direct properties of the DOM. This could collide with future changes or with other scripts, although it is a common practice in framework-less JS.
- **The skip link is not visible initially**: By design, it only appears when it receives focus (first Tab). This is standard in WCAG, but requires the user to know they must press Tab when the page loads.

### Neutral
- The `trapFocus` function always focuses the first focusable element of the modal. In some long modals (e.g. series with many seasons), the user might want to start with another element, but this is the expected behavior.
- Escape handling now delegates the global search to its own handler. If more modal panels are added in the future, the priority chain in `modal-handlers.js` will have to be updated.
- The `aria-live="polite"` attributes on the panels will fire every time HTML content is injected into them, which is correct. However, if only part of the panel is updated (e.g. filtering), it might not be announced; that is what `aria-atomic="true"` is for.

## Created/modified files

| File | Change |
|---------|--------|
| `js/focus-utils.js` | **New**: module with `getFocusableElements()` and `trapFocus()` (63 lines) |
| `index.html` | Skip link, `id="main-content"` + `tabindex="-1"` on `<main>`, ARIA roles in profile view, tablist/tab/tabpanel, `aria-live` on panels, `aria-label` on select, `role="alert"` on toast, `role="dialog"` on notifications, `aria-hidden` on switches and arrow |
| `css/styles.css` | `.skip-link` styles, improved global `:focus-visible`, focus styles for 13 components, removal of `outline:none` on search input, removal of contrast override |
| `ocio/ocio.css` | Visible focus for 8 ocio components, replacement of `outline:none` with a visible outline on `.library-search-input` |
| `js/ui.js` | Import of `trapFocus`, focus trap + registration in 8 open functions, focus restoration in `closeModal()`, keyboard support on activity, `aria-label` on episodes, `aria-hidden` on episode numbers, descriptive `alt` on avatars |
| `js/modal-handlers.js` | Unified Escape with priority: modal > search > notifications |
| `js/global-search.js` | Focus trap, focus restoration, `tabindex="0"` on results, Enter/Space handlers |
| `js/notifications-setup.js` | Focus trap on dropdown, Escape to close, focus restoration to the button |
| `js/app.js` | Focus to the `<h2>` of the active panel on tab change |
| `js/profile.js` | Synchronization of `aria-selected` on profile sub-tabs |
