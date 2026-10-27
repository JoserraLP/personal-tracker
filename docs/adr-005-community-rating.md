# ADR-005: Community rating (TMDB) next to the personal rating

## Status
Accepted

## Context
The application lets the user record movies, series and books,
assigning them a personal rating of 1 to 5 stars. However,
there was no external point of reference to help the user
contextualize their own rating or discover new content.

TMDB (The Movie Database) provides in its detail responses the
field `vote_average` (community vote average, 0-10 scale) and
`vote_count` (number of votes). This data was already being fetched
when adding movies and series (in `getMovieDetails()` and `getTvExtraDetails()`),
but it was not exposed to the user.

The community rating needed to be shown next to the personal
rating, in a clear and visually differentiated way, so that the user
could compare their own opinion with the community average.

## Decision
Implement visualization of the TMDB average rating
(`vote_average`) as the "community score" in the interface,
storing it in a new `communityRating` field in Firestore.

### Data retrieval
The `communityRating` field is extracted from TMDB responses using
the following logic:

```
communityRating = vote_count > 0 ? vote_average : null
```

This check avoids treating a `vote_average: 0` with `vote_count: 0`
as a real rating. Only when there is at least one vote is the
score considered meaningful.

### Data flow
```
TMDB API response → api-movies.js (communityRating)
  ├─ When adding item (search.js): Object.assign(draft, details) → Firestore
  └─ In daily check (daily-check.js): backfill for existing items
      └─ ui.js: renders the item's communityRating field
```

### Visualization

#### Grid cards
Both scores are shown inside a common container
`.item-card__ratings` at the end of the card:

- **Personal stars**: Color `--ochre-spine-dark` (gold/amber),
  format `★★★`.
- **Community score**: `TMDB` badge with `--teal-reel` background
  (teal) + numeric value with one decimal (e.g. `7.4`), using the
  variable `--teal-reel-dark` for the number.

When there is no TMDB rating, nothing is shown on the card
(to keep the grid compact).

#### Detail modals
A full line is inserted between the "upcoming release" badge
(`upcomingBadge`) and the extended TMDB info (`extraInfoHtml`):

- If `communityRating` exists: `TMDB` badge + value (e.g. `7.4`).
- If there is no data: italic text `No ratings` with color
  `--ink-soft`.

#### Read-only modal (friends)
Same community rating line as in the detail modals.

### Backfill for existing data
The `daily-check.js` module was modified to include `communityRating`
in its daily check. When an item lacks this field and the TMDB
API returns a value, it is updated automatically in
Firestore. This works for both movies and series.

### Technical implementation

- **`js/api-movies.js`**: `communityRating` was added to the object
  returned by `getMovieDetails()` and `getTvExtraDetails()`.
- **`js/ui.js`**: Two helper functions were added:
  - `communityRatingHtml(item)` — for cards: returns the HTML of the
    badge or an empty string if there is no data.
  - `communityRatingDisplay(item)` — for modals: returns the HTML of the
    badge or "No ratings" if there is no data.
  `renderGrid()`, `openMovieModal()`, `openTvModal()`
  and `openReadOnlyModal()` were modified.
- **`js/daily-check.js`**: The `needsCheck` and `needsBackfill`
  conditions were extended to include `communityRating == null`, and the
  assignment of the field was added when fresh data is available.
- **`ocio/ocio.css`**: Classes `.item-card__ratings`,
  `.community-rating`, `.community-rating--empty` and
  `.modal-detail__ratings` were added. `margin-top: auto` was removed from
  `.item-card__rating` (the parent container now applies it).

### Rejected alternatives

- **Always showing the line on cards**: It was decided not to show
  "No ratings" on the grid to avoid visual noise.
  In modals it is always shown.
- **Adding the data to the search modal (results)**: Search
  results follow the format of `mapMovieResult` /
  `mapTvResult` which do not include `vote_average`. This is kept as-is to
  avoid adding complexity to the search.
- **Showing the number of votes (`vote_count`)**: Considered
  but dropped for simplicity; `vote_average` already
  provides the necessary context.

## Consequences

### Positive
- The user can compare their personal rating with the TMDB community
  average, enriching the context of their own scores.
- The information is clear and visually differentiated (gold for
  personal, teal for community).
- Existing items receive the community rating progressively via the
  daily check, with no need for mass migrations.
- No changes to the existing data model, just a new
  optional field (`communityRating`).

### Negative
- Manually added items will never have `communityRating` (they
  have no TMDB match). The interface shows "No
  ratings" in these cases, which is correct but may be
  slightly confusing if the user expects to see data.
- The TMDB rating is static from the moment the item is added
  or updated in the daily check. If the rating
  changes significantly on TMDB, it will not be reflected until the next
  daily check (once a day).

### Neutral
- The field is stored as `number` in Firestore (e.g. `7.4`), with
  value `null` when there are no TMDB votes or the item is manual.
- No new API calls are required: the data was already being fetched
  in the existing TMDB detail functions.

## Files modified
- `js/api-movies.js` — Added `communityRating` to `getMovieDetails()`
  and `getTvExtraDetails()`.
- `js/ui.js` — New functions `communityRatingHtml()` and
  `communityRatingDisplay()`; modified `renderGrid()`,
  `openMovieModal()`, `openTvModal()`, `openReadOnlyModal()`.
- `js/daily-check.js` — Backfill of `communityRating` in the
  daily check for movies and series.
- `ocio/ocio.css` — New CSS classes for the community badge,
  ratings container on cards and modals.
