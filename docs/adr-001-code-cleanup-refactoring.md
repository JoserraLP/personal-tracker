# ADR-001: Code cleanup and refactoring of app.js

**Date:** 2026-07-28
**Status:** Accepted
**Deciders:** Gonza (project owner)

## Context

The project "Mi Registro" is a static web application (HTML + CSS + JS with native ES modules, no build tooling) for tracking movies, series and books. It uses Firebase as its database and external APIs (TMDB, Open Library, Google Books). It is hosted on GitHub Pages.

The main file `app.js` had grown to 1338 lines, with all the business logic concentrated in a single `init()` function of more than 1200 lines. `ui.js` had 1323 lines of DOM rendering. There was duplicated code across modules:

- `isNextEpisodeUnreleased` was defined in both `app.js` and `ui.js`
- `STATUS_LABELS` / `STATUS_LABELS_NEUTRAL` were defined in both files
- `localNormalizeEntry` in `ui.js` was a duplicate of `normalizeEntry` in `tv-progress.js`
- `TYPE_BY_GROUP` was in `app.js` with no reuse

## Decision

Refactor the codebase by extracting 8 new modules from `app.js`, following the Context (`ctx`) pattern to pass dependencies explicitly and avoid circular imports.

### Context pattern (ctx)

Each extracted module receives a `ctx` object with functions to access state and dependencies. Example:

```js
const ctx = {
  getCurrentUser: () => currentUser,
  getItemsByGroup: (group) => allItems[group] || [],
  updateItem,
  deleteItem,
  showToast: ui.showToast,
  // ...etc
};
setupSearch(ctx);
```

This pattern:
- Makes all dependencies explicit in the signature of each function
- Avoids circular imports (no module imports from app.js)
- Allows modules to be tested independently
- Keeps mutable state centralized in app.js

## Changes Made

### New Modules Created

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `js/constants.js` | 39 | Shared constants: STATUS_LABELS, TYPE_BY_GROUP |
| `js/sorting.js` | 99 | Sorting and comparison functions |
| `js/daily-check.js` | 161 | Daily check of releases and metadata |
| `js/quick-actions.js` | 98 | Quick actions (mark watched / next episode) |
| `js/modal-handlers.js` | 199 | Opening and managing modals by type |
| `js/notifications-setup.js` | 31 | Wiring of the notifications dropdown |
| `js/search.js` | 284 | All search and add-item functionality |
| `js/profile.js` | 237 | Profile, statistics and friends |

### Files Modified

- **js/app.js**: Reduced from 1338 to 330 lines (-75%), now serves as the orchestrator
- **js/ui.js**: Removed 3 duplicate functions, now imports from the new modules
- **ocio/ocio.css**: Merged duplicate definitions of `.seasons-list` and `.season-header`

### Deduplication Removed

| Duplicated code | Before | After |
|-----------------|--------|-------|
| `isNextEpisodeUnreleased` | app.js + ui.js | Only in sorting.js |
| `STATUS_LABELS` | app.js + ui.js | Only in constants.js |
| `STATUS_LABELS_NEUTRAL` | app.js | Only in constants.js |
| `localNormalizeEntry` | ui.js | Removed (uses normalizeEntry from tv-progress.js) |
| `TYPE_BY_GROUP` | app.js | Only in constants.js |
| CSS `.seasons-list` | 2 definitions | 1 definition |
| CSS `.season-header` | 2 definitions | 1 definition |

## Consequences

### Positive
- `app.js` is now a clean orchestrator (~330 lines)
- Each feature module is independently maintainable
- Dependencies flow in a single direction (no circular imports)
- The ctx pattern makes all dependencies explicit
- Total code: 3573 lines across 21 modules
- No behavior changes, no new dependencies

### Negative
- Additional HTTP requests (8 new modules) — acceptable on GitHub Pages with HTTP/2
- Slightly more wiring complexity (ctx objects) — offset by the clarity

### Risks Mitigated
- Circular imports: avoided by the ctx pattern
- Regressions: the extracted code keeps the same public interface
- Event listeners: all are registered inside `init()` after `loadOcioPartials()`

## Final Project Structure (JS only)

```
js/
├── app.js                 ← orchestrator (330 lines, previously 1338)
├── constants.js           ← shared constants (39)
├── sorting.js             ← sorting functions (99)
├── search.js              ← search and add-item (284)
├── modal-handlers.js      ← detail modals (199)
├── profile.js             ← profile and statistics (237)
├── daily-check.js         ← daily check (161)
├── quick-actions.js       ← quick actions (98)
├── notifications-setup.js ← notifications wiring (31)
├── ui.js                  ← DOM rendering (1289, previously 1323)
├── db.js                  ← Firestore access (148)
├── firebase.js            ← Firebase init (67)
├── api-movies.js          ← TMDB API (137)
├── api-books.js           ← book APIs (185)
├── tv-progress.js         ← TV progress logic (115)
├── watch-log.js           ← watch history (25)
├── reading-log.js         ← reading history (38)
├── dates.js               ← date utilities (15)
├── http.js                ← fetch with retry (25)
├── config.js              ← API keys (33)
└── allowed-emails.js      ← email list (18)
```
