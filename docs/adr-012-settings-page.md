# ADR-012: Settings page with theme selector and notification preferences

## Status
Accepted

## Context
The application had grown significantly in functionality (movies, series,
books, profile, statistics, friends, data export) but lacked a centralized
place where the user could configure their preferences. Until now:

- The **theme selector** (dark/light) existed as a button in the header,
  with persistence in `localStorage` (key `mi-registro-theme`), but there
  was no settings interface where the user could comfortably discover this
  option.
- **Notifications** were generated automatically during the daily check
  (`daily-check.js`) without the user being able to choose which type of
  notifications to receive.
- There was no single entry point to configure application preferences.

A settings page or section accessible from the interface was needed, one
that would consolidate these options and allow adding more in the future.

## Decision
Create a **Settings** section as a fourth tab inside the profile view
(`#profile-view`), alongside the existing Statistics, Friends and Data
tabs. A gear icon button (⚙️) is added in the header for direct access.

### Architecture

The settings section is implemented as:

1. **New module `js/settings.js`**: Encapsulates all settings management
   logic: loading/saving in `localStorage`, synchronization with Firestore,
   UI rendering and event wiring.

2. **Two-layer persistence**:
   - **localStorage** (immediate): Changes are saved instantly via
     `saveSettings()`, with a deep merge against default values.
   - **Firestore** (deferred): Notification preferences are synchronized
     with the user's profile (`users/{uid}/preferences`) with a 2-second
     debounce to avoid excessive writes.
   - The theme is considered a device preference (a user may want dark on
     mobile and light on desktop), so it is **not** synchronized with
     Firestore, only with localStorage.

3. **Data flow**:
   ```
   User changes a setting in the UI
       │
       ▼
   settings.js: loadSettings() → modify → saveSettings()
       │
       ├──▶ localStorage (immediate)
       └──▶ Firestore via upsertUserProfile (2s debounce, notifications only)
       
   daily-check.js: getNotificationPrefs() → reads from localStorage
       │
       └──▶ Before each addNotification(), checks that the type is enabled
   ```

4. **Bidirectional theme synchronization**: When the user changes the theme
   from the settings selector or from the header button, both sources stay
   in sync via `syncThemeToSettings()` and `syncThemeSelect()`.

### Included settings

#### Appearance
- **Theme**: Dropdown selector with "Dark" and "Light" options. Reuses the
  existing CSS variables system (`:root` / `[data-theme="light"]`) and the
  `setTheme()` function from `app.js`.

#### Notifications
- **Movie releases** (`movie_release`): Notifies when a movie marked as
  `awaitingRelease` is released.
- **New episodes of series** (`new_episode`): Notifies when a new episode
  becomes available for an on-air series.
- **Series premieres** (`series_premiere`): Notifies when a series marked
  as `awaitingRelease` premieres.
- **Friend activity** (`friend_activity`): Prepared for future use (when
  the friend activity feed is implemented). Currently it is a no-op that
  does not affect any functionality.

### Technical implementation

#### `js/settings.js` (new)
- `loadSettings()` / `saveSettings()`: localStorage persistence with deep
  merge against defaults, with try/catch for error handling.
- `renderSettings(ctx)`: Paints the current state of the settings in the UI
  (theme select, notification checkboxes).
- `setupSettings(ctx)`: Wires the event listeners of the settings controls.
  Each handler reads fresh data from localStorage instead of using closures
  to avoid stale data.
- `getNotificationPrefs()`: Exported so that `daily-check.js` can read the
  notification preferences synchronously.
- `syncThemeSelect(theme)` / `syncThemeToSettings(theme)`: Keep the settings
  theme selector and the localStorage theme key synchronized when the theme
  is changed from the header button.
- `cleanupSettings()`: Clears the debounce timer on logout, avoiding late
  writes to Firestore.
- `scheduleFirestoreSync(ctx)`: 2-second debounce, reads fresh settings
  from localStorage and persists only `preferences.notifications` in
  Firestore.

#### `js/app.js` (modified)
- `setTheme` was added to the context object (`createCtx()`) so that
  `settings.js` can change the theme via `ctx.setTheme()`.
- The `#btn-settings` button opens the profile view with the settings tab
  active.
- The theme toggle handler (`#btn-theme-toggle`) now also calls
  `syncThemeSelect(next)` and `syncThemeToSettings(next)`.
- In `init()`, after restoring the theme, `syncThemeToSettings(getSavedTheme())`
  is called to guarantee consistency.
- `cleanupSettings()` is called when the user logs out.

#### `js/profile.js` (modified)
- Handling of the `#profile-section-settings` section was added to the tab
  handler, importing `renderSettings` to paint the settings when the tab is
  activated.

#### `js/daily-check.js` (modified)
- `getNotificationPrefs()` is imported from `settings.js`.
- Each `addNotification()` call is guarded with a check of the corresponding
  preference (`prefs.movie_release !== false`,
  `prefs.series_premiere !== false`, `prefs.new_episode !== false`).

#### `index.html` (modified)
- `#btn-settings` button with ⚙️ icon in the header, next to the theme
  toggle.
- "Settings" tab in the profile (`data-section="settings"`).
- `#profile-section-settings` section with:
  - Theme selector (`#settings-theme-select`)
  - Four notification switches with a toggle switch design.

#### `css/styles.css` (modified)
- Classes `.settings-card`, `.settings-row`, `.settings-desc`,
  `.settings-select` for the settings card layout.
- Classes `.switch`, `.switch__input`, `.switch__slider` for toggle-type
  switches.
- Style for `#btn-settings` in the header.

### Rejected alternatives

- **Separate page (new view)**: A standalone view such as `#settings-view`
  was considered, but the decision was to integrate it into the existing
  profile to keep navigation simple and reuse the tab pattern already
  familiar to the user.
- **Settings modal**: Rejected because modals have limited space and are
  not ideal for settings the user wants to consult while browsing.
- **Synchronize theme to Firestore**: Decided against it because the theme
  is a device preference. A user may want a dark theme on mobile and a light
  theme on desktop.
- **Use only Firestore without localStorage**: Rejected because Firestore
  requires an internet connection and loading is asynchronous. localStorage
  makes settings available instantly.

## Consequences

### Positive
- The user has a centralized place to configure their preferences,
  discoverable from an icon in the header.
- Notifications respect the user's preferences, reducing informational
  noise.
- Changes apply immediately without reloading the page.
- The architecture is extensible: adding a new setting only requires adding
  the HTML control, the key in `DEFAULT_SETTINGS`, and consuming it where
  appropriate.
- The two-layer persistence system (localStorage + Firestore) provides local
  speed and cloud backup for notification preferences.
- The 2-second debounce avoids excessive writes to Firestore when the user
  adjusts multiple controls quickly.

### Negative
- Notification settings are only synchronized from localStorage to Firestore
  (not the other way around). If a user logs in on a new device, preferences
  are initialized with default values until they modify them. This is an
  acceptable trade-off for simplicity.
- The `mi-registro-settings` key in localStorage duplicates part of the
  information already stored in `mi-registro-theme`, although they stay
  synchronized via `syncThemeToSettings()`.

### Neutral
- The `friend_activity` preference has no effect until the friend activity
  feed is implemented. It is included so the UI will not require changes in
  the future.
- Notification preferences are automatically included in backup exports
  (being part of the user profile in Firestore).

## Files created
- `js/settings.js` — Settings management module (179 lines).

## Files modified
- `index.html` — Settings button, tab and settings HTML section.
- `css/styles.css` — Settings card styles, toggle switch.
- `js/app.js` — Import of settings.js, `setTheme` in ctx, settings button,
  theme sync in toggle, cleanup on logout.
- `js/profile.js` — Settings tab handling, import of `renderSettings`.
- `js/daily-check.js` — Import of `getNotificationPrefs`, guards on
  notifications.
