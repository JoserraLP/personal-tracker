# ADR-068: Video games tab in the friend detail (issue #172)

## Status
Accepted

## Date
2026-08-10

## Context

The **Friends** section's friend detail shows another user's log in
read-only mode, organized **by tabs** since
issue #49: Movies, Series and Books (ADR-048), with per-status
filter chips and a data-driven pattern (the data loads once per opened friend
with `Promise.all` of `getItemsOnce(uid, type)` and on changing tab or
filter only the active grid re-renders).

**Video games** have existed as a product category of their own
since issue #47 (the `games` collection in Firestore, a tab in Ocio
with `ocio/videojuegos.html`, statuses Todos / Pendiente / Jugando /
Jugado / Standby / Abandonado), but the friend detail did not show them
yet: the manual (section 14.2) explicitly documented that «the Video
games tab is not yet available here».

Issue #172 asks to include the video games tab in the friends
view, with its per-status filter chips coherent with
`ocio/videojuegos.html`.

Related issue: #172 — https://github.com/gonzalitojh/Registro-personal/issues/172

## Decision

Add a fourth **«Videojuegos»** sub-tab to the friend detail,
replicating ADR-048's data-driven pattern without introducing new logic:

### 1. Tab and panel

- A new pill button `.friend-subtab` with `data-friend-tab="games"`,
  `role="tab"`, `aria-selected` and `aria-controls="friend-panel-games"`,
  next to Movies/Series/Books.
- A new `.friend-tabpanel` panel with `role="tabpanel"` and
  `aria-labelledby="friend-tab-games"`, with its chip group
  (`role="group"`, `aria-label`) and the `#friend-games` grid.

### 2. Per-status filter chips

The product's video game statuses (issue #47) are
`todos`/`pendiente`/`en_curso`/`completado`/`standby`/`abandonado` with the
labels **Todos / Pendiente / Jugando / Jugado / Standby / Abandonado**,
identical to `ocio/videojuegos.html`. The games panel's chip group
replicates exactly those values and labels.

### 3. In-memory state and data loading

- `setupProfile`'s (profile.js) closure's `friendData` and `friendFilters`
  gain the `games` key (the same treatment as movies/tv/books).
- `openFriend` loads the 4 types with `Promise.all`, including
  `ctx.getItemsOnce(profile.uid, "game")` (the existing read-only
  pattern, a one-off `getDocs` without a subscription; reading other
  users' `games` is already allowed by `firestore.rules`).
- Changing tab or filter does not re-query Firestore: only the
  active grid re-renders from memory (the generic `setFriendTab` /
  `setFriendFilter` / `renderFriendTab`).
- Opening any friend resets the tab to `movies` and all the
  filters (including `games`) to `todos`, and the DOM's chips go back
  to the initial state (aria-pressed included).

### 4. No structural changes

The render is data-driven: `renderFriendTab` (ui.js) is generic per
`tabKey`, `renderGrid` and `openReadOnlyModal` already support items of
type `game` (the `game` scope in `STATUS_LABELS`, `scopeFor(type)`,
`metaLineFor`, `progressLine`, `communityRatingHtml` with the IGDB label).
`.friend-subtabs`' (flex-wrap) and `.friend-chip`'s CSS is shared and
already covers the fourth tab on mobile.

## Rejected alternatives

- **Doing nothing (waiting for another issue)**: the manual already
  promised the video games category in the friends view; leaving it out
  was a functional debt versus the product's own category.
- **A specific view with its own logic**: unnecessary — ADR-048's
  data-driven pattern absorbs a fourth type with no new branches.
- **Reusing `.filter-chips`/`.chip`**: already rejected in ADR-048 due
  to collision with the libraries' global filter logic
  (app.js); `.friend-filters`/`.friend-chip` are kept.

## Consequences

### Positive

- The friend detail is complete: Movies, Series, Books and
  Video games, with filters coherent with the Ocio personal view.
- Zero extra Firestore queries when switching to Video games or
  filtering.
- No changes in `ui.js`, `css/styles.css` nor `db.js`: only HTML, the
  state in `profile.js` and the manual.

### Negative / Risks

- The friend detail's initial load now makes 4 parallel reads
  instead of 3 (the same one-off read cost as the existing
  ones).
- The games' chips must stay aligned with `ocio/videojuegos.html`
  if the category's statuses change in the future.

### Neutral

- `docs/manual-de-usuario.md` updated (section 14.2 Amigos): it no longer
  says the Video games tab is unavailable and describes its
  filters (AGENTS.md's rule 3).

## Created/modified files

| File | Change |
|---------|--------|
| `index.html` | **Modified**: `#friend-tab-games` button (`.friend-subtab`) and `#friend-panel-games` panel with chips (Todos/Pendiente/Jugando/Jugado/Standby/Abandonado) and the `#friend-games` grid |
| `js/profile.js` | **Modified**: `friendData.games`/`friendFilters.games`, `getItemsOnce(profile.uid, "game")` in `openFriend`'s `Promise.all`, games reset when opening a friend, the panels' loop with `games` in `setFriendTab` |
| `docs/manual-de-usuario.md` | **Modified**: section 14.2 — the Video games tab available with its filters |
| `docs/adr-068-pestana-videojuegos-amigos.md` | **New**: this document |

## Verification

- QA review (acceptance criteria 1-8 and DoD): PASS — issue #172's 8
  criteria verified one by one (tab, chips, load, the data-driven
  pattern, reset, ARIA, responsiveness 360/768/1280 with flex-wrap,
  updated manual).
- Security scan: PASS with no findings (a pre-existing read-only
  pattern, no secrets nor PII).
- Static responsiveness analysis: `.friend-subtabs` with `flex-wrap:
  wrap` and ≤480px compaction already existed; the fourth tab wraps on
  mobile without overflowing.

Related issue: #172 — https://github.com/gonzalitojh/Registro-personal/issues/172
