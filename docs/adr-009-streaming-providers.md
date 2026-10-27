# ADR-009: Showing available streaming providers from TMDB

## Status
Implemented

## Context
The application fetches extended movie and series data from TMDB (synopsis, cast, director, trailer, collections, community rating, etc.) and shows it in the detail modals. However, users had no way to know on which streaming platforms (Netflix, HBO Max, Disney+, Prime Video, etc.) a title was available without leaving the application.

TMDB provides the endpoints `/movie/{id}/watch/providers` and `/tv/{id}/watch/providers` that return the streaming, rental and purchase providers available for each title, organized by country. This data makes it possible to show the user "where to watch" each movie or series in an up-to-date way at no extra API cost.

This information needed to be incorporated in order to:
- Let the user know on which streaming platforms each title is available, from the detail modal.
- Distinguish between streaming (included in the subscription), rental and purchase.
- Have the information show both for the user's own titles and for friends' (read-only modal).
- Stay consistent with the existing pattern of fetching data at the moment the modal is opened.

## Decision
Implement the full TMDB watch providers feature, which includes:

1. New function `getWatchProviders()` in `api-movies.js` to query the providers endpoint.
2. In-memory cache system with a 24-hour TTL to avoid redundant calls.
3. Rendering of a visual section with logos and names of the platforms in the detail modals.
4. Integration into the three modals: movie, series and read-only (friends).
5. Optional link "See options on TMDB" for more details.
6. Automatic detection of the user's country (with fallback to Spain) and the possibility of changing it manually in the future via `localStorage`.

### Data retrieval
The function `getWatchProviders(id, type, countryCode)` was created in `api-movies.js` and:

1. Checks the in-memory cache: if there is a valid entry (under 24h), it returns it without making the call.
2. If there is no cache, builds the URL of the corresponding endpoint depending on the type (`/movie/{id}/watch/providers` or `/tv/{id}/watch/providers`).
3. Makes the request with `fetchJson` (1 retry) and silent error handling.
4. If the requested country is not available in the response, stores `null` in cache and returns `null`.
5. Normalizes the providers into three categories: `flatrate` (streaming), `rent` (rental), `buy` (purchase).
6. Stores the result in cache and returns it.

```javascript
export async function getWatchProviders(id, type, countryCode = "ES") {
  const cacheKey = `wp_${type}_${id}_${countryCode}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const endpoint = type === "tv" ? "tv" : "movie";
  const url = `${BASE_URL}/${endpoint}/${id}/watch/providers?api_key=${TMDB_API_KEY}`;
  const data = await fetchJson(url, { retries: 1 }).catch(() => null);
  if (!data || !data.results || !data.results[countryCode]) {
    setCache(cacheKey, null);
    return null;
  }

  const country = data.results[countryCode];
  const result = {
    flatrate: (country.flatrate || []).map(normalizeProvider),
    rent: (country.rent || []).map(normalizeProvider),
    buy: (country.buy || []).map(normalizeProvider),
    link: country.link || null,
  };

  setCache(cacheKey, result);
  return result;
}
```

### Country detection
The helper `getUserCountry()` was created in `modal-handlers.js` and determines the user's country following this order of precedence:

1. `localStorage.getItem("watch-provider-country")` — preference saved by the user (for a future country picker).
2. `navigator.language.split("-")[1]` — browser region code (e.g. "ES" from "es-ES").
3. `"ES"` — fallback to Spain.

### Visualization
Three functions were added in `ui.js`:

- **`providersGroupHtml(providers, label)`**: Renders a group of providers (Streaming, Rental or Purchase) with their logos and names.
- **`watchProvidersHtml(item)`**: Renders the full watch providers section, including:
  - Title "Available on:" if there is at least one provider.
  - Separate groups for streaming, rental and purchase.
  - Link "See options on TMDB" if TMDB provides a URL.
  - Message "No streaming info for this country" if there is no data.
  - Empty string if `item.watchProviders` is `null` (no data or error).

The section is inserted into three modals, at the same position (after the trailer and before the extended info):

- `openMovieModal()` — movie detail modal.
- `openTvModal()` — series detail modal.
- `openReadOnlyModal()` — read-only modal (friends).

### Integration into modal-handlers.js
Both `openMovieItem()` and `openTvItem()` now fetch the watch providers before opening the modal:

1. If the item has an `externalId`, `getWatchProviders(externalId, type, countryCode)` is called with `await`.
2. If the call fails (network error, TMDB not responding, etc.), `null` is silently assigned.
3. The result is assigned to `item.watchProviders` so the modal shows it.

This approach is consistent with the existing pattern of `openTvItem()`, which already waits to fetch the seasons before opening the modal.

### Cache
The in-memory cache system (`providersCache`) stores the results of `getWatchProviders()` with a 24-hour TTL. This avoids redundant calls to the TMDB API during the same browser session.

### CSS styles
The following classes were added in `ocio/ocio.css`:

- `.watch-providers` — main container, with `--paper-dim` background and rounded corners.
- `.watch-providers__title` — title of the section "Available on:".
- `.watch-providers--empty` — variant for the "No information" case.
- `.watch-providers__group` — each group (Streaming, Rental, Purchase).
- `.watch-providers__type-label` — group label.
- `.watch-providers__logos` — flex container with the logos.
- `.watch-provider` — each individual provider (flex with logo + name).
- `.watch-provider__logo` — logo image (22×22px).
- `.watch-provider__name` — provider name.
- `.watch-providers__link` — link to TMDB.

The logos are loaded from `https://image.tmdb.org/t/p/w92` with lazy loading. The styles are consistent with the existing design system (same radii, typography, color palette).

### Data flow
```
User opens movie/series modal
  │
  ├─ modal-handlers.js: openMovieItem() / openTvItem()
  │   └─ getUserCountry() → "ES" | "US" | "MX" | ...
  │   └─ getWatchProviders(externalId, type, countryCode)
  │       ├─ In cache? → yes → returns cached data
  │       └─ no → fetch TMDB /watch/providers
  │           ├─ Error? → null (section not shown)
  │           └─ OK → stores in cache and returns { flatrate, rent, buy, link }
  │   └─ item.watchProviders = result
  │
  └─ ui.js: openMovieModal() / openTvModal() / openReadOnlyModal()
      └─ watchProvidersHtml(item)
          ├─ null? → empty string (nothing rendered)
          ├─ empty? → "No streaming info for this country"
          └─ with data → Streaming, Rental, Purchase groups + logos
```

### Rejected alternatives

- **Async loading with a "Loading…" placeholder**: Rejected because the call to TMDB is fast (<500ms) and adding a placeholder and then re-rendering the section adds complexity with no significant UX benefit. Waiting for the data (sync) was chosen, as `openTvItem()` does with the seasons.

- **Interactive country picker in the modal**: Postponed to a future iteration. For now the country is detected automatically. The `localStorage` persistence mechanism is already in place for when the picker is implemented.

- **Storing providers in Firestore**: Rejected because streaming providers change frequently (licensing agreements, catalog rotation). It is better to fetch them live from TMDB each time (with an in-memory cache for the session). This also avoids bloating Firestore documents with data that can become stale.

- **Showing providers on the library cards**: Rejected because card space is limited and streaming information is a useful complement when opening the detail, not critical data that must be visible in the grid.

- **Cache persistence in localStorage**: Considered but rejected for now. The in-memory cache (24h TTL) is enough for the same browser session. If the application is closed and reopened, the data is fetched from TMDB again, which guarantees it is always up to date.

- **Filtering by "free" or "ads" type**: TMDB also supports free ad-supported providers. They were not included in this first iteration to keep the UI simple, but TMDB's `flatrate` field already covers these cases if support is added in the future.

## Consequences

### Positive
- Users can quickly see where each title is available without leaving the application.
- The information distinguishes between streaming, rental and purchase, helping decide which platform to use.
- The platform logos make visual identification easier.
- The link to TMDB allows exploring more options if needed.
- Works the same for movies and series.
- The in-memory cache avoids redundant calls to TMDB.
- Automatic country detection avoids user friction.
- No additional data is stored in Firestore.

### Negative
- Titles without a TMDB `externalId` (added manually) will never have streaming information.
- If TMDB has no providers for a specific title, an informative message is shown instead of nothing.
- The information depends on TMDB's coverage, which can be incomplete for very old titles or specific regions.
- When opening the modal, there is a (minimal) extra wait while the providers are fetched from TMDB.

### Neutral
- Provider information is fetched live when opening the modal; it is not persisted in Firestore.
- The in-memory cache is invalidated on page reload, guaranteeing fresh data in each session.
- The `watchProviders` field only exists on the in-memory `item` object, not in Firestore.
- The feature only applies to movies and series; books are not affected.

## Files modified
- `js/api-movies.js` — New function `getWatchProviders()`, cache system (`providersCache`), function `normalizeProvider()`.
- `js/ui.js` — New functions `providersGroupHtml()` and `watchProvidersHtml()`; integrated into `openMovieModal()`, `openTvModal()` and `openReadOnlyModal()`.
- `js/modal-handlers.js` — New function `getUserCountry()`; modified `openMovieItem()` and `openTvItem()` to fetch watch providers before opening the modal; updated import from `api-movies.js`.
- `css/ocio.css` — New CSS classes for the `.watch-providers` section and its inner elements.
