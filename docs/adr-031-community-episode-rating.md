# ADR-031: Community rating per episode — compact TMDB badge in the series detail modal's season list (issue #45)

## Status
Accepted

## Date
August 2026

## Context

Issue #45 asks that, in series, the community rating be shown for **each episode**. Before this decision, the TMDB community score was shown on item cards (ADR-005, persisted field `communityRating`), in the detail modal (ADR-005) and in the per-episode rating window (ADR-022, `communityLabel` "TMDB · episodio"), but the **episode list of each season** inside the series detail modal (`renderEpisodeRows` in `js/ui.js`) exposed no community data per episode: only number, name, date and watch status.

The data already existed at the API layer: `getSeasonEpisodes()` in `js/api-movies.js` returned `episodeRating` (`e.vote_count > 0 ? e.vote_average : null` — same truthy-only policy as ADR-005 and ADR-022, so that a `0` with no votes is not treated as a real rating), but it was not used in the render. Episodes are **not persisted in Firestore**: they are served from TMDB with `getSeasonEpisodes`' shared 24 h in-memory cache, so exposing the data did not require touching the data layer or adding persistence.

The community badge already had a consolidated visual language (`.community-rating` with `__label` label and `__value` value in `ocio/ocio.css`), but its base size was meant for cards, not for dense episode rows: a **compact variant** was needed without duplicating the badge's HTML.

Related issue: #45 — https://github.com/gonzalitojh/personal-tracker/issues/45

## Decision

Show a **compact badge `.community-rating--sm`** with the TMDB community score (`x.x`, one decimal) next to each episode's name in the series detail modal's season list, reusing the existing community badge's visual language (ADR-005) and the data semantics already defined in ADR-005/ADR-022. The decision is organized in four layers: reusable render helper, insertion in `renderEpisodeRows`, compact CSS variant and unchanged data source.

### 1. New helper `communityRatingValueHtml(value, label = "TMDB")` (`js/ui.js`)

Generates the compact badge's HTML:

```html
<span class="community-rating community-rating--sm">
  <span class="community-rating__label">TMDB</span>
  <span class="community-rating__value">7.8</span>
</span>
```

- The value is formatted with `Number(value).toFixed(1)` (one decimal, like the base badge).
- The `label` parameter allows labels other than "TMDB" without duplicating HTML.

**`communityRatingHtml(item)` is refactored to delegate to it**: it calls `communityRatingValueHtml(item.communityRating)` and replaces `"community-rating community-rating--sm"` → `"community-rating"`. The resulting HTML for cards is **identical to the previous one** (only the base class changes, without `--sm`), and the existing guard is kept: it returns an empty string if `item.communityRating == null`, to not take up space in the grid.

### 2. Insertion in `renderEpisodeRows` (`js/ui.js`)

```js
const communityBadge =
  !manual && e.episodeRating != null
    ? communityRatingValueHtml(e.episodeRating)
    : "";
```

The badge is inserted **after the episode's name** (after `.episode-row__name`, including the `em` of "sin estrenar" when applicable). It shows **only** when:

- The series **is not manual** (`!manual`): manual series have no real TMDB data (same historical exclusion as ADR-020/ADR-023/ADR-024).
- The episode **has votes** (`e.episodeRating != null`): `vote_count === 0` ⇒ `episodeRating === null` ⇒ no badge (truthy-only semantics of ADR-005).

### 3. Compact CSS variant (`ocio/ocio.css`)

`.community-rating--sm` reuses the base badge's tokens (label with `--teal-reel`/`--paper`, value with `--teal-reel-dark`, mono fonts) and only adjusts sizes:

- `.community-rating--sm`: `gap: 0.25rem`, `flex-shrink: 0`, `font-size: 0.68rem`, `line-height: 1.2`.
- `.community-rating--sm .community-rating__label`: `font-size: 0.5rem`, `padding: 0.05rem 0.25rem`.
- `.community-rating--sm .community-rating__value`: `font-size: 0.7rem`.

All measurements in `rem` (relative units, responsiveness criterion of AGENTS.md / ADR-026) and `flex-shrink: 0` so the badge never compresses nor overflows the row on mobile: no horizontal scroll at any width.

### 4. Data source: no changes in the data layer

`getSeasonEpisodes()` (`js/api-movies.js`) already returned `episodeRating: e.vote_count > 0 ? e.vote_average : null` per episode — this decision **only exposes it in the UI**. Episodes continue to not be persisted in Firestore: they are served from TMDB with the 24 h in-memory cache (same shared cache `season_<tvId>_<seasonNumber>` as the watch providers, see ADR-022). There are no additional API calls nor contract changes.

## Rejected alternatives

- **Showing the base badge `.community-rating` without a compact variant**: rejected — the 0.55rem label and the base padding are meant for cards; in dense episode rows (checkbox + `E<n>` + name + date + stars) the full badge would overflow the row on mobile, violating the responsiveness criterion.
- **Reusing `communityRatingHtml` directly with the episodes**: rejected — it is coupled to the `item.communityRating` field and fixes the base class without `--sm`; the new helper with a `label` parameter and the `--sm` variant covers both cases without duplicating HTML or changing the cards' output.
- **Persisting `episodeRating` in Firestore** (e.g. next to `nextEpisodeAirDate`): rejected — the data is "live" from TMDB and episodes are already cached in memory for 24 h; persisting it would add per-episode reads/writes without observable benefit (consistent with ADR-022, which also does not persist episode ratings).
- **Doing nothing**: the issue explicitly asked for the per-episode rating; the data already existed and not showing it left the request unresolved.

## Consequences

### Positive
- **Issue #45 solved**: every episode of an automatic series shows its community score in the proper context (series detail modal → season → episode), with a style consistent with the rest of the application (ADR-005/ADR-022).
- **Zero render duplication**: `communityRatingHtml` delegates to the new helper and the cards' HTML is identical to the previous one — no visual regression risk in grid/list.
- **No additional API cost nor persistence**: `episodeRating` already existed in `getSeasonEpisodes`; only render is added, without changes to the data layer or the function's contract.
- **Responsive verified**: badge with `rem` units and `flex-shrink: 0`; the web looks correct on mobile (~360 px), tablet (~768 px) and computer (~1280 px) without horizontal scroll (issue acceptance criterion 4 and AGENTS.md rule).

### Negative
- **Episodes without votes and manual series without badge**: `vote_count === 0` and `manual === true` do not show the score; it is the truthy-only semantics inherited from ADR-005/ADR-022 — a 0 with no votes is not a real rating, and manual series have no TMDB data.
- **The badge can be stale up to 24 h**: it depends on `getSeasonEpisodes`' in-memory cache; if TMDB updates an episode's score, the new data will not be seen until the cache expires.

### Neutral
- **`communityRatingValueHtml` is reusable**: the `label` parameter allows other contexts (e.g. a source other than TMDB) without touching the badge.
- **No contract changes**: `communityRatingHtml(item)` keeps signature and output; `renderEpisodeRows` keeps its API (`{ manual }`); `getSeasonEpisodes` does not change.
- **PWA propagation through the usual flow**: the touched files (`js/ui.js`, `ocio/ocio.css`) are already precached (ADR-019); the version bump follows the standard publishing process, with nothing specific in this decision.

## Created/modified files

| File | Change |
|---------|--------|
| `js/ui.js` | New helper `communityRatingValueHtml(value, label = "TMDB")` generating the `.community-rating community-rating--sm` badge (value with `toFixed(1)`); `communityRatingHtml(item)` refactored to delegate to it (identical HTML for cards, `null` guard kept); in `renderEpisodeRows`, badge after `.episode-row__name` when `!manual && e.episodeRating != null` |
| `ocio/ocio.css` | Compact variant `.community-rating--sm` (gap 0.25rem, `flex-shrink: 0`, sizes in rem: label 0.5rem / value 0.7rem) reusing the tokens of the base `.community-rating` |
| `docs/adr-031-community-episode-rating.md` | **New**: this document |

Related issue: #45 — https://github.com/gonzalitojh/personal-tracker/issues/45
