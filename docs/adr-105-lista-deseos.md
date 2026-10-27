# ADR-105: Wishlist («Compras» [Purchases]) in Leisure

## Status
Accepted

## Date
2026-10-24

## Context

Besides the leisure tracker and the **recipe shopping list**
(js/shopping-list.js, generated from the weekly menu), a free-use
shopping list was needed: products (physical or online) with their
price, description, link and photo, and the purchased/not purchased
state. It is not one of the four media types (movie/tv/book/game): it is
its own personal list.

Considerations:

- **Firestore**: the security model gives leisure read access to all
  authorized users. The shopping list is personal; a private collection
  is decided.
- **Identity**: no external catalog or ids; the user enters whatever
  they want, with optional URL/photo by URL (no file uploads: the app
  has no file storage).
- **PWA/cache**: the Leisure partials live in ocio/*.html and the
  service worker precaches them with `?v=APP_VERSION`.

## Decision

New **«Compras» tab in the Leisure section** (ADR-104 → continuity):
`#/ocio/compras`, with panel `panel-wishlist` and partial
`ocio/compras.html`.

1. **Data** — collection `users/{uid}/wishlist` with:
   `title` (required), `price` (number|null, €), `description`
   (optional text), `url` (product URL or null), `photoUrl`
   (image URL or null), `purchased` (bool), `purchasedAt`
   (ISO the first time it is marked; null when unmarked), `addedAt` and
   `updatedAt` (serverTimestamp).
2. **Rules** — `match /wishlist/{itemId}: allow read, write: if
   isAllowedUser() && isOwner(userId)`: private list of the owner; NOT
   shared like leisure.
3. **db.js** — functions following the repo pattern:
   `subscribeToWishlist` (snapshot with orderBy addedAt desc),
   `addWishlistItem`, `updateWishlistItem`, `deleteWishlistItem`.
4. **js/wishlist.js** — card rendering in the partial (photo, title,
   formatted price "12,50 €", description clamped to 3 lines, URL),
   filter chips (Todas [All] / Por comprar [To buy] / Compradas
   [Purchased]), add/edit form in the generic `#item-modal` window with
   **client-side validation** (title required; numeric price ≥ 0 with
   decimal comma accepted; URLs validated and normalized by prepending
   `https://` to schema-less domains) and confirmation before deleting.
5. **app.js** — the tab enters the lazy panel flow
   (PANEL_TO_GROUP/GROUP_CONFIG with `custom: true`): its subscription
   uses `subscribeToWishlist` wrapped with `subscribeWithRetry`
   (ADR-057): painting goes through its own `setWishlistItems` API, not
   through `renderLibraryFor`; the «Añadir» [Add] button and chips
   wiring is done when injecting the partial.
6. **Visibility** — section/tab registry (issue #97): the tab can be
   hidden/shown in Settings, visible by default.
7. **Themes and responsiveness** — same conventions as the Leisure
   cards (`--paper` surface, `--ink` text, `-dark` variants for pure
   black); auto-fill grid with `min()` and `overflow-wrap` so there is
   never horizontal scroll or cut text.

## Consequences

- The list lives in the sidebar under Leisure and respects the
  configured visibility; exportable data (backup) does NOT include it
  yet (the backup covers movies/series/books/games): its inclusion in
  backup/ICS is left for a later iteration.
- Title/photo/URL are free text, careful with XSS: everything is
  escaped with `escapeHtml` in the render.
- Prices carry no stored symbol: the UI is what adds €.
