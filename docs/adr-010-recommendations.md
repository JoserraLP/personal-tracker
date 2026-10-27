# ADR-010: Similar content recommendations from TMDB

## Status
Accepted

## Context
The application allows the user to record movies, series and books, and
to see details of each title (synopsis, cast, rating, streaming,
platforms, etc.). However, once the user explores a title's
detail page, there was no way to discover related content without going back to
search.

TMDB provides similar-content endpoints (`/movie/{id}/similar` and
`/tv/{id}/similar`) that return a list of related titles according
to TMDB's recommendation algorithm. This data is already available
at no extra cost on TMDB's free plan.

A recommendations section was needed in the detail page to
let the user discover similar content and add it directly
to their personal record.

## Decision
Implement a recommendations section in the movie and series
detail modals, using TMDB's `/similar` endpoints. The section is
titled "If you liked this, you might like..." and shows a horizontal
scrollable list with the cover, title and year of each recommendation,
along with an "Add" button to incorporate it directly into the record.

### Data retrieval
Two new exported functions were added in `api-movies.js`:

```
getSimilarMovies(id) → GET /movie/{id}/similar?language=es-ES&page=1
getSimilarTv(id)    → GET /tv/{id}/similar?language=es-ES&page=1
```

Both functions:
- Reuse the existing mappers `mapMovieResult` / `mapTvResult`, so
  they return objects with the same shape as the search
  results: `{ externalId, type, title, year, coverUrl, overview }`.
- Always return an array (empty on error) and never throw
  exceptions, so they never block the opening of the modal.
- Are limited to the first page (up to 20 results), from which
  the first 10 are taken.

### Data flow
```
TMDB /similar → api-movies.js (getSimilarMovies / getSimilarTv)
  → modal-handlers.js (openMovieItem / openTvItem)
    → Filters already-recorded items (existingIds)
    → slice(0, 10) to limit quantity
    → ui.js (openMovieModal / openTvModal)
      → renderRecommendations() generates HTML
      → "Add" button → addFromRecommendation()
        → getMovieDetails / getTvExtraDetails (optional)
        → addItem() to Firestore
```

### Visualization
Recommendations are shown as a horizontally scrollable section
inside the detail modal:

- **Movies**: after the saga banner (if there is one) and before the
  watch log section.
- **Series**: after the extended TMDB info and before the
  progress banner.

Each recommendation card (`rec-card`) contains:
- Cover (with placeholder if there is no image).
- Title (truncated to 2 lines with `-webkit-line-clamp`).
- Year (monospace, secondary color).
- "Add" button (or disabled "Added" if already recorded).

The cards are 110px wide, with customized native horizontal scroll
(subtle scrollbar). On hover (desktop) the cards raise their shadow.

### "Add" button behavior
When clicking "Add":
1. The button is disabled and shows "Adding…"
2. A `draft` object is built with the title's basic data
3. It tries to fetch the extended TMDB details
   (`getMovieDetails` / `getTvExtraDetails`) to enrich the record
   (synopsis, cast, runtime, etc.). If it fails, it is still added
   with the basic data.
4. It is persisted in Firestore via `addItem()`
5. The button shows "Added" permanently (the modal is not re-rendered, but on its next opening it will appear as "Added" thanks
   to the filter by `existingIds`).

### Already-recorded items
Before opening the modal, a `Set` of `externalId` of all
items of the same type that the user already has is computed. Cards whose
`externalId` is in that set show a disabled "Added" button.

### Edge cases
- **No connection or TMDB error**: The section is simply not shown
  (there are no visible errors).
- **No recommendations**: TMDB may return an empty array for very
  niche titles. The section is not rendered.
- **Manual items**: They have no `externalId`, so they never appear
  in recommendations (no TMDB match). This is correct.
- **Read-only mode (friends)**: No recommendations are shown. The
  read-only modal opening functions do not receive this data.

## Consequences

### Positive
- The user discovers related content without leaving the detail page.
- Incorporation is immediate: one click adds the recommendation to
  the record with all TMDB metadata.
- Filtering of already-recorded items avoids duplicates.
- The section is unobtrusive: if there is no data, it takes no space.
- All calls to TMDB are fail-safe without blocking the interface.

### Negative
- Recommendations are static at the moment of opening the modal.
  If the user adds a recommendation, the other cards do not
  update (the added card's button stays on "Added", but another
  recommendation matching a newly added item will not be
  disabled until the next modal opening).
- Recommendations are not available in the read-only
  modal (friends), although technically they could be shown without an "Add" button.
- Dependence on TMDB's algorithm: we do not control what TMDB considers
  "similar". For some titles the recommendations may not be
  relevant.

### Neutral
- No new external dependencies are added.
- The Firestore rules and the data model are not modified.
- The API functions use the same caching pattern as the
  existing ones (no cache in this initial implementation, since
  recommendations are requested once per modal opening).

## Files modified
- `js/api-movies.js` — New functions `getSimilarMovies()` and
  `getSimilarTv()`.
- `js/modal-handlers.js` — New function `addFromRecommendation()`;
  modified `openMovieItem()` and `openTvItem()` to load and pass
  recommendations.
- `js/ui.js` — New function `renderRecommendations()`; modified
  `openMovieModal()` and `openTvModal()` to accept and render
  recommendations.
- `ocio/ocio.css` — New CSS classes for the recommendations
  section: `.recommendations`, `.recommendations__title`,
  `.recommendations__scroll`, `.rec-card`, `.rec-card__cover`,
  `.rec-card__body`, `.rec-card__title`, `.rec-card__year`,
  `.rec-card__add`.
