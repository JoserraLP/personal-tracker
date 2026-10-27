# ADR-006: Movie collections and sagas from TMDB

## Status
Accepted

## Context
TMDB provides in its movie detail responses the field `belongs_to_collection`, which indicates whether a movie belongs to a collection or saga (Marvel, Harry Potter, The Lord of the Rings, Indiana Jones, etc.). This field includes the collection's identifier, its name and a poster URL.

In addition, TMDB offers a dedicated endpoint `GET /3/collection/{collection_id}` that returns all the movies making up a collection, ordered chronologically.

Until now, the application fetched details from TMDB when adding a movie (runtime, synopsis, genre, cast, director) but completely ignored the `belongs_to_collection` field. As a result, the user had no way of knowing whether a movie belonged to a larger saga and could not easily add the remaining movies of that saga.

## Decision
Implement the full TMDB collections/sagas feature, which includes:

1. Capturing collection data when fetching a movie's details.
2. Showing a banner with the saga name in the detail modal.
3. Offering an "Add rest of the saga" button that queries the collections endpoint.
4. Presenting a checkbox picker so the user can choose which movies to add.

### Data retrieval
The `belongs_to_collection` field is already included in the response of TMDB's `GET /movie/{id}`. Three fields are extracted:

```javascript
collectionId: data.belongs_to_collection ? String(data.belongs_to_collection.id) : null,
collectionName: data.belongs_to_collection ? data.belongs_to_collection.name : null,
collectionPoster: data.belongs_to_collection?.poster_path
  ? "https://image.tmdb.org/t/p/w92..." : null,
```

To fetch the movies of a collection, the endpoint used is:

```javascript
GET /3/collection/{collectionId}?language=es-ES
```

Which returns a `parts` array with all the movies of the saga.

### Data flow
```
TMDB /movie/{id} → getMovieDetails()
  └─ Adds collectionId, collectionName, collectionPoster to the draft
  └─ Saved to Firestore (users/{uid}/movies/{id})

Detail modal → openMovieModal()
  └─ If collectionId exists → shows saga-banner with button
  └─ Button → openSagaSelector()
       ├─ getCollectionDetails(collectionId) → parts array
       ├─ Filters against existingIds (ctx.getItemsByGroup("movies"))
       ├─ openSagaSelectionModal() with checkboxes
       └─ For each selected → addSagaMovie() → getMovieDetails() + addItem()
```

### Visualization

#### Saga banner in the movie modal
A banner is inserted between the extended TMDB info (`extraInfoHtml`) and the watch log section. The banner shows:
- **Text**: "Saga: [collection name]"
- **Button**: "Add rest of the saga" styled with `btn--accent-media` (teal)

If the movie does not belong to any collection (`collectionId` is `null`), nothing is rendered.

#### Saga picker modal
When the user clicks "Add rest of the saga":
1. The detail modal closes.
2. A new modal opens with:
   - Title with the saga name.
   - List of unreleased-to-library movies, each with:
     - Checkbox (checked by default).
     - Cover thumbnail (36x54px).
     - Title and year.
   - Dynamic counter of selected movies.
   - "Cancel" and "Add selected" buttons.

### Filtering logic
When opening the picker, the `externalId` of the collection's movies is compared against the `externalId` of all the user's movies (`ctx.getItemsByGroup("movies")`). Only movies the user does not have recorded are shown.

Cases covered:
- **All added**: toast "You already have all the movies of this saga."
- **None selected**: toast "Select at least one movie."
- **Network error**: toast with an error message. The button remains available to retry.

### Technical implementation

- **`js/api-movies.js`**:
  - `getMovieDetails()`: `collectionId`, `collectionName`, `collectionPoster` added to the returned object.
  - New function `getCollectionDetails(collectionId)`: calls `/collection/{id}` and returns `{ id, name, posterPath, parts }` with the mapped movies.

- **`js/ui.js`**:
  - `openMovieModal()`: the `onAddSaga` parameter was added to the callbacks. A conditional `saga-banner` block is inserted when `item.collectionId` exists. An event listener was added for `#btn-add-saga`.
  - New function `openSagaSelectionModal(collectionName, movies, { onConfirm, onCancel })`: renders a modal with a checkbox list, selection counter and action buttons.

- **`js/modal-handlers.js`**:
  - Imported `getCollectionDetails`, `getMovieDetails` from `api-movies.js` and `addItem` from `db.js`.
  - `openMovieItem()`: `onAddSaga` was added to the callbacks passed to `ui.openMovieModal()`, connected to the new `openSagaSelector` function.
  - New function `addSagaMovie(movie, ctx)`: fetches the movie's TMDB details and adds it to Firestore.
  - New function `openSagaSelector(item, ctx)`: orchestrates the whole flow (query the collection, filter, open picker, process confirmation).

- **`ocio/ocio.css`**: CSS classes added:
  - `.saga-banner`, `.saga-banner__label` — for the banner in the detail modal.
  - `.saga-subtitle`, `.saga-list`, `.saga-row`, `.saga-row__cover`, `.saga-row__title`, `.saga-row__year`, `.saga-count` — for the picker modal.

### Rejected alternatives
- **Picker without checkboxes (add everything directly)**: Rejected because the user may not want to add certain movies (e.g. non-canonical spin-offs). Checkboxes give granular control.
- **Showing the saga in search results**: Rejected because search results do not include `belongs_to_collection` (they use the `/search/movie` endpoint, not `/movie/{id}`). It is only shown in the detail modal.
- **Persisting the list of the collection's movies**: Rejected because the information is always queried live from TMDB, guaranteeing it reflects changes (new movies added to the saga).

## Consequences

### Positive
- The user easily discovers which saga a movie belongs to and can add the rest with a few clicks.
- The feature is unobtrusive: it only appears when the movie has a `collectionId`.
- The filter against the existing library avoids duplicates.
- Movies added from the saga get all TMDB details (runtime, cast, synopsis, etc.) just as if they had been added via search.

### Negative
- Manually added movies (without a TMDB `externalId`) will never have collection data.
- When adding large sagas (e.g. Marvel: ~30 movies), requests to TMDB are made sequentially, which can be slow. Individual errors are handled so the whole batch is not blocked.
- Collection information is static from the moment the movie is added. If TMDB changes the collection (name, included movies), it will not be reflected until the movie is fetched again.

### Neutral
- The fields `collectionId`, `collectionName`, `collectionPoster` are stored in Firestore as part of the movie's document.
- No additional real-time subscription or callback is required.
- The feature only applies to movies; series and books are not affected.

## Files modified
- `js/api-movies.js` — Added `collectionId`, `collectionName`, `collectionPoster` to `getMovieDetails()`; new function `getCollectionDetails(collectionId)`.
- `js/ui.js` — Modified `openMovieModal()` with saga-banner and `onAddSaga` callback; new function `openSagaSelectionModal()`.
- `js/modal-handlers.js` — Modified `openMovieItem()` with `onAddSaga`; new functions `addSagaMovie()` and `openSagaSelector()`.
- `ocio/ocio.css` — New CSS classes for saga-banner, saga-list, saga-row and related.
