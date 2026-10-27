# ADR-008: Adding trailer support from TMDB

## Status
Implemented

## Context
The application fetches extended movie and series data from TMDB (runtime, synopsis, cast, director, collections, etc.) and shows it in the detail modals. However, the user had no way to watch a title's official trailer from the application.

TMDB provides endpoints `/movie/{id}/videos` and `/tv/{id}/videos` that return the videos associated with a title (trailers, teasers, making-of, etc.), including YouTube links. This data is already available at no extra API cost if requested alongside the credits via the `append_to_response` parameter.

This information needed to be incorporated in order to:
- Let the user access the official trailer from the detail modal of any movie or series.
- Have trailers available both for new titles (when adding them) and for existing ones (via the daily refresh mechanism).
- Stay consistent with the existing "fetch once" pattern of getting data at the time the title is added.

## Decision
Implement the full TMDB trailers feature, which includes:

1. Adding `videos` to the `append_to_response` parameter in the detail calls.
2. Extracting the best YouTube trailer URL from the response.
3. Rendering a YouTube-style red button in the detail modals.
4. Backfilling `trailerUrl` for existing movies and series via `daily-check.js`.

### Data retrieval
The endpoints `/movie/{id}` and `/tv/{id}` already include the parameter `append_to_response=credits`. `videos` is added to this parameter to also receive the associated videos in the same request:

```javascript
// Before
const url = `${BASE_URL}/movie/${id}?api_key=...&language=es-ES&append_to_response=credits`;

// After
const url = `${BASE_URL}/movie/${id}?api_key=...&language=es-ES&append_to_response=credits,videos`;
```

### Trailer extraction
The internal function `_extractTrailerUrl(videos)` was created in `api-movies.js` with the following logic:

1. If there are no video results, returns `null`.
2. Filters only YouTube videos (`site === "YouTube"`) that are "Trailer" or "Teaser".
3. Prioritizes "Trailer" over "Teaser" (uses the first "Trailer" if there is one; otherwise the first "Teaser").
4. Builds the URL: `https://www.youtube.com/watch?v={key}`.

This function is used in both `getMovieDetails()` and `getTvExtraDetails()`.

### Visualization
The function `trailerButtonHtml(item)` was added in `ui.js`, generating an `<a>` link with:
- Class `.trailer-btn` with a YouTube-style red button look.
- Attributes `target="_blank"` and `rel="noopener noreferrer"`.
- Play icon (▶) and the text "Trailer".
- `aria-label` for accessibility.

The button is inserted into three modals in the same position: right after the community rating and before the extended info (`extraInfoHtml`):

- `openMovieModal()` — movie detail modal.
- `openTvModal()` — series detail modal.
- `openReadOnlyModal()` — read-only modal (friends).

### Backfill for existing items
The daily check system (`checkForUpdates` in `daily-check.js`) already backfills missing metadata for existing movies and series. Logic for `trailerUrl` backfill was added:

- **Movies**: if `movie.trailerUrl` does not exist and `fresh.trailerUrl` does, it is updated.
- **Series**: same logic, inside the `needsBackfill` block.

### CSS styles
The classes `.trailer-btn`, `.trailer-btn__icon` and `.trailer-btn__label` were added in `ocio/ocio.css` with:
- The typical YouTube red background color (`#ff0000`), with a darker hover (`#cc0000`).
- `inline-flex` to align icon and text.
- Rounded corners and typography consistent with the design system.

### Dependency import fix
In `app.js`, the import was fixed: `getMovieDetails` and `getTvExtraDetails` were missing from the `api-movies.js` `import` (only `getTvSeasonsMeta` and `getSeasonEpisodes` were imported), and both functions were added to the `ctx` object so they are available in `daily-check.js`.

### Data flow
```
TMDB /movie/{id}?append_to_response=credits,videos → getMovieDetails()
  └─ _extractTrailerUrl(data.videos) → trailerUrl
  └─ Saved to Firestore (users/{uid}/movies/{id})

TMDB /tv/{id}?append_to_response=credits,videos → getTvExtraDetails()
  └─ _extractTrailerUrl(data.videos) → trailerUrl
  └─ Saved to Firestore (users/{uid}/tv/{id})

Detail modal → openMovieModal() / openTvModal() / openReadOnlyModal()
  └─ If item.trailerUrl exists → shows .trailer-btn

Daily check → checkForUpdates()
  └─ For each movie/series without trailerUrl → getMovieDetails() / getTvExtraDetails()
     └─ If fresh.trailerUrl exists → updateItem() with trailerUrl
```

### Rejected alternatives

- **Separate call to the /videos endpoint**: Rejected because TMDB allows including `videos` in `append_to_response` at no extra request cost. A separate call would double the number of TMDB requests when adding a title, increasing latency and the risk of rate-limiting.

- **Playing the video embedded in a modal (iframe)**: Rejected because:
  - It would require loading the YouTube player (iframe + JS), increasing page weight.
  - YouTube may show ads before the video, which would be disruptive.
  - The embedded player has limitations on mobile (autoplay, fullscreen).
  - Opening in a new tab (`target="_blank"`) gives the user the full YouTube experience (quality, subtitles, playlists, etc.).

- **Lazy loading the trailer only when opening the modal**: Rejected because `trailerUrl` is already fetched when the title is added (along with the rest of the metadata) and stored in Firestore. There is no benefit in deferring the query. For existing items, the daily backfill already covers the update.

- **Showing the trailer on the library cards**: Rejected because card space is limited and the trailer is an informational complement, not a critical identification datum.

- **Support for Vimeo or other platforms**: Rejected because the overwhelming majority of official trailers on TMDB are hosted on YouTube. Filtering only by `site === "YouTube"` simplifies the code and covers 99% of cases.

- **Multiple trailers (picker)**: Rejected because the official "Trailer" is what the user is looking for in most cases. If there is no "Trailer", the "Teaser" is used. A multi-video picker would add unnecessary complexity to the UI.

## Consequences

### Positive
- Users can access the official trailer from the detail modal with a single click.
- The number of TMDB requests does not increase: `videos` is included in the same call as `credits`.
- The trailer button only appears when a URL is available, taking up no unnecessary space.
- Progressive backfill guarantees existing titles also get trailers over time.
- Works the same for movies and series.
- The link opens in a new tab, preserving the application state.

### Negative
- Manually added titles (without a TMDB `externalId`) will never have a trailer.
- If TMDB has no associated videos (very old, unknown titles or without media coverage), the button is not shown.
- Backfill only happens once a day and only if the title needs other updates (per the `needsCheck`/`needsBackfill` logic). A title that already has all metadata except `trailerUrl` will not be updated until another condition (e.g. `communityRating`) also requires a check.

### Neutral
- The `trailerUrl` field is stored in Firestore as part of the movie/series document.
- No additional subscription or change to the Firestore security rules is required.
- Trailer extraction is deterministic: the same video is always chosen for the same set of TMDB data.
- The feature only applies to movies and series; books are not affected.

## Files modified
- `js/api-movies.js` — New function `_extractTrailerUrl()`; modified `getMovieDetails()` and `getTvExtraDetails()` to include `videos` in `append_to_response` and return `trailerUrl`.
- `js/ui.js` — New function `trailerButtonHtml()`; integrated into `openMovieModal()`, `openTvModal()` and `openReadOnlyModal()`.
- `ocio/ocio.css` — New CSS classes `.trailer-btn`, `.trailer-btn__icon`, `.trailer-btn__label`.
- `js/daily-check.js` — Backfill of `trailerUrl` for movies (movies loop) and series (`needsBackfill` block).
- `js/app.js` — Fixed the import of `getMovieDetails` and `getTvExtraDetails` from `api-movies.js`; added both to the `ctx` object.
