# ADR-013: Global search for quick navigation across the whole library

## Status
Implemented

## Context

The application "Personal Tracker" allows the user to manage movies, series,
books and friends, with all data available in memory through a context
object (`ctx`). However, navigating between content required switching
tabs (Series → Movies → Books) or going to the profile section to see
friends. There was no way to search simultaneously across all user data
from a single entry point.

As the personal library grows, finding a specific title means remembering
which tab it is in or manually scrolling. In addition, there was no global
keyboard shortcut to quickly access any content.

Command-palette style searchers (Cmd+K) have become a modern UX standard
(GitHub, Linear, Notion, etc.) and provide a fast and efficient way to
navigate without interrupting the workflow.

## Decision

Implement a **global modal search** (command-palette style) accessible via:

- Keyboard shortcut `Ctrl+K` / `Cmd+K`
- The `/` key (when no input is focused)
- Magnifying glass button 🔍 in the app header

### Architecture

#### New module: `js/global-search.js`

The module is fully encapsulated with a single exported function:

```js
export function setupGlobalSearch(ctx)
```

**Internal state** (module closures, not globals):
- `isOpen` — whether the modal is visible
- `highlightedIndex` — index of the item selected with the keyboard
- `flatResults` — flat array of results (for sequential navigation)
- `cachedProfiles` — cache of friend profiles (loaded on open)
- `searchCtx` — reference to the application context

**Search flow**:

```
User presses Ctrl+K
        │
        ▼
openGlobalSearch() → shows modal, focuses input
        │
        ▼
User types → input event → 200ms debounce
        │
        ▼
performSearch(query)
  ├─ ctx.getAllItems() → { movies, tv, books }
  │   └─ filterItems(items, query) by title (and author in books)
  │      └─ relevanceScore: exact > startsWith > includes > author
  │      └─ limit: 5 per group
  └─ cachedProfiles → filterFriends(profiles, query) by name/email
      └─ limit: 3
        │
        ▼
renderResults({ movies, tv, books, friends })
  → Grouped HTML with icons, covers, statuses and badges
  → Wires click event listeners on each result
```

**Navigation**:
- Click on a result → `openItem(item, ctx)` (opens detail modal)
- Friends → informational toast "Próximamente podrás ver el perfil..."
- Up/down arrows → progressive highlight with `scrollIntoView`
- Enter → opens the highlighted item (or the first one)
- Escape → closes the modal

#### HTML markup

The search modal is inserted in `index.html` as a fixed overlay with a
z-index above the detail modal (70 vs 50):

```html
<div id="global-search" class="global-search hidden">
  <div class="global-search__backdrop"></div>
  <div class="global-search__panel" role="dialog" aria-modal="true">
    <div class="global-search__header">
      <span class="global-search__icon">🔍</span>
      <input type="search" id="global-search-input"
             placeholder="Buscar películas, series, libros o amigos..." />
      <button type="button" id="global-search-close"><kbd>ESC</kbd></button>
    </div>
    <div class="global-search__results" id="global-search-results">
      <p class="global-search__hint">Escribe para buscar...</p>
    </div>
  </div>
</div>
```

#### Relevance scoring system

Results are sorted by relevance to show the most likely matches first:

| Condition | Points |
|-----------|--------|
| Title matches exactly | 100 |
| Title starts with the query | 50 |
| Title contains the query | 10 |
| Author contains the query | 5 |

### Rejected alternatives

| Alternative | Reason |
|-------------|--------|
| **Inline search in the header** | Takes up permanent space in the header, visually competes with other elements, less suitable for mobile. |
| **Keyboard-shortcut-only search** | Reduces discoverability; a 🔍 button was added in the header as a visual entry point. |
| **Firebase search (Firestore queries)** | Data is already in memory; a remote query would add unnecessary latency and cost. |
| **Integrating the search into the tab search input** | Each tab has its own local filter; mixing both features would create confusion. |
| **Using a Web Component or external library** | Without a build tool, npm dependencies cannot be added. Native JS is sufficient for this feature. |

## Consequences

### Positive

- **Unified navigation**: the user finds any content from a single entry
  point, without switching tabs.
- **Keyboard shortcuts**: `Ctrl+K` and `/` provide quick access for
  power users.
- **Real-time search**: the 200ms debounce offers a fluid experience
  without saturating rendering.
- **Full keyboard navigation**: arrows + Enter allow using the search
  without the mouse.
- **No external dependencies**: all code uses native browser APIs
  (ES modules, Fetch, DOM API).
- **Profile cache**: friend data is loaded only once when opening the
  search, and reused in subsequent searches.
- **Accessibility**: the modal uses `role="dialog"`, `aria-modal="true"`
  and `aria-label` on all interactive elements.

### Negative

- **Result limit**: 5 items per category and 3 friends. Users with very
  large libraries might not see all possible results.
- **No note search**: currently it only searches by title and author; it
  does not index the content of the user's notes.
- **Friends without direct navigation**: selecting a friend shows a toast
  instead of navigating to their profile (future functionality).
- **The 🔍 button adds one more element to the header**, which already
  contains notifications, theme, settings and profile.

### Neutral

- The `global-search.js` module is ~420 lines, similar in size to other
  project modules.
- The public interface of no existing module was modified.
- The search is purely local (client-side), with no calls to Firestore or
  external APIs.

## Created/modified files

| File | Change |
|---------|--------|
| `js/global-search.js` | **New**: full global search logic (~424 lines) |
| `index.html` | Added HTML block of the `#global-search` modal and 🔍 button in the header |
| `css/styles.css` | Added styles for the global search (~228 lines at the end) |
| `js/app.js` | Added `import` and call to `setupGlobalSearch(ctx)` in `init()` |
