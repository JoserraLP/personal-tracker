# ADR-096: The saga's other movies (issue #280)

## Status
Accepted

## Date
2026-08-13

## Context

Issue #280 (type
content) asks that, on a movie's
profile that belongs to a
saga, **the saga's rest of movies** get shown similarly
to how **the recommendations** look. The user's
textual request: "I want that, additionally, the saga's rest of movies get shown similarly to how they look on the recommendations
just below".

The code's state before the change:

- The movie modal's saga section (the
  `openMovieModal` in
  the
  `js/ui.js`) only showed the
  "Saga: …" banner with the
  **«Añadir resto de la saga»**
  button, which opens the
  checklist selector (the
  `openSagaSelector` → the
  addSagaMovie). There was no direct view of the collection's movies.
- The
  `getCollectionDetails` (the
  `js/api-movies.js`) fetched the
  TMDB's collection `parts` **with no cache** and only got used from that selector.
- The modal's internal re-render (the
  `rerender` in the
  `openMovieModal`) called
  the
  `openMovieModal(item, callbacks)` **with just the
  item and the
  callbacks**: after marking a watch, the recommendations (and any
  other
  section derived from the extra arguments) disappeared.
- When adding a recommendation (the
  `onAddRecommendation` → the
  addFromRecommendation), the
  existingIds `Set` shared with the
  render **did not update**: after a re-render the button went back to
  "Add" and allowed creating duplicates (a
  QA finding).

## Decision

Adding the
**«Otras películas de la saga»**
section on the movie's profile, right below the saga banner, with cards
reusing the recommendations' look and behavior:

1. **Cards with the recommendations' look**: the new
   `renderSagaMovies(sagaParts, existingIds, interactive)` function
   in the
   `js/ui.js` paints each collection movie as a
   `.rec-card.saga-card` card (a
   cover, a title and an
   year) inside a
   `.recommendations__scroll` container (a contained horizontal scroll, responsive), with the `.saga-movies__title` title that replicates the
   `.recommendations__title`'s style with theme variables (the
   `--ink-soft`).
2. **Adding per card with the existing selector flow**: each card's `.saga-card__add`
   button reuses the same
   `addSagaMovie(movie, ctx)` function the checklist
   selector uses (the same
   add, the same duplicates and toasts). While
   adding, the button goes to
   `disabled` with "Adding…"; at the end,
   "Added"
   (disabled); if it fails, it returns to
   "Add"
   and an error toast gets shown.
3. **A 24h in-memory cache for the collection**: the
   `getCollectionDetails` stores the result on the
   shared
   `providersCache` cache (the
   `getCached`/`setCache`, a
   24h TTL, the same one used by the
   `getMovieDetails` and the watch providers) with a
   `collection_<id>` key. Only the correct responses get cached: a
   transient network failure returns a
   `null` and does not
   hide the section for 24h.
4. **A shared
   `existingIds` Set to persist "Added"**: when adding a saga movie from its card, the
   `onAddSagaMovie` updates the
   `existingIds` Set it shares with the render, so the modal's later re-renders keep showing the "Added" state and do not allow duplicates.
5. **An own `.saga-card__add` class**: the saga cards' button has a different
   class from the
   `.rec-card__add` (though they share CSS rules grouped in the
   `ocio/ocio.css`) to not interfere with the recommendations' event wiring on the
   modals.
6. **A re-render with all the arguments**: the
   `openMovieModal(item, callbacks, recommendations, existingIds, sagaParts)` now propagates
   **all** the arguments on the re-render (the
   `rerender`), not just the
   `(item, callbacks)`. An
   intentional and
   positive behavior change: the re-renders no longer "swallow" sections, and the recommendations persist after marking as watched.
7. **A QA fix on the
   `onAddRecommendation`**: when adding a recommendation (a movie or a series), the callback updates the
   `existingIds` (thanks to the
   `addFromRecommendation`'s boolean return), preventing the button from going stale after a re-render ("Add" over something already added) and duplicates from getting created.

The data load with a
**graceful degradation**: the
`openMovieItem` loads
the
`sagaParts` (only if the
`item.collectionId`) in a
`try/catch`; if the query fails, the
`sagaParts` is a
`null`, the section hides and the
saga banner (and the profile's rest) stays
visible
.

Rejected alternatives:

- **Reusing the
  `.rec-card__add` directly on the saga cards**: it would have interfered with the recommendations' event wiring on the same modal; an own class with grouped CSS selectors gives the same style without coupling.
- **With no cache (asking TMDB on every profile opening)**: more repeated calls
  against TMDB for the same
  collection; the shared 24h cache is the policy already established for the
  `getMovieDetails` and the watch providers (the
  ADR-009).
- **Extending the checklist selector with the cards inside**: it would change an already documented and accepted-in-the-manual interaction; the card is a complementary direct-add avenue, not a substitutive one.

## Consequences

**Positive:**

- The user sees the saga's rest at a glance (a cover, a title, an year) and adds
  any
  of its movies with a
  click, without opening the selector.
- A maximum reuse: the card inherits styles, the `loading="lazy"`, the responsiveness (the
  `recommendations__scroll`) and the existing flow's add behavior; only the render and the
  wiring layer get added.
- Fewer TMDB calls: an already queried collection (by the selector or by the
  new section) does not get asked again for 24h.
- The "Added" state persists on the modal's re-renders (a shared
  Set), both on the saga cards and on the recommendations (a
  QA fix).
- The re-renders no longer lose the recommendations (a
  positive behavior change, documented in this ADR).
- A graceful degradation: if TMDB fails, the profile stays
  complete and the saga banner visible; only the section hides.

**Negative:**

- One more API call per saga profile opened for the
  first time (mitigated by the 24h cache, which it shares with the selector).

**Neutral:**

- No data model, exports (the ICS, the backup) nor the "Añadir resto de la saga"
  selector's flow changes (it stays as is, now with an additional direct-add avenue).
- The section also shows on the read-only
  profile, with no buttons (the
  `interactive` false) when adding is not appropriate.
- Responsiveness covered by the recommendations' existing pattern (a contained horizontal scroll); the four theme modes (the
  Dark, the Pure
  black, the Light and the Pure
  white) use theme variables (the
  `--ink-soft`, the existing `btn--accent-media` classes) and got verified, per the
  AGENTS.md's rules 2 and 4.

## The 2026-08-13 iteration: a preview when pressing a saga card

### Context

The user expanded the issue #280's scope with a comment: "On those saga other movies, in addition to the recommendations, you should be able to press the movies before adding them to see their information". The "Otras películas de la saga" section's cards had to stop being a direct-add shortcut and also become an entry point to the movie's information, with the search preview's same behavior (issue #22, ADR-030).

### Decision

Making the section's cards **pressable**:
pressing a card opens that
movie's **preview**, reusing the
`openSearchPreviewModal` (the issue #22's pattern) instead of
building a new modal:

1. **A pressable card** (the
   `renderSagaMovies` in the
   `js/ui.js`): when the new
   `onOpen` argument gets passed, the cover, the title and the year get wrapped in a
   `.saga-card__open` button (with the
   "Ver información de …"
   `aria-label`, because the body becomes
   *phrasing content*: the
   `.rec-card__body` gets emitted as a
   `span`), with the
   **«Ver información»**
   hint (the
   `.saga-card__hint`). The "Add"
   button (the `.saga-card__add`) stays as a
   sibling, anchored at the bottom by the open
   button's `flex: 1`.
2. **A preview with the
   `openSearchPreviewModal`** (the
   `openSagaMoviePreview` in the
   `js/modal-handlers.js`): it builds a lightweight item
   with the saga part's data (the
   `externalId`, the
   `title`, the
   `year`, the
   `posterUrl`, the
   `overview`) and opens the preview with the
   header (the cover, the title and the year) and the
   **enriched details** via the
   `onEnrich` → the
   `getMovieDetails` (the duration, the genre, the director, the cast, the synopsis, the community rating and the trailer if applicable). The
   **`onClose`** callback — new on the
   `openSearchPreviewModal` (issue #22), with no behavior change for the search — closes the preview and restores the original profile with the
   `reopen`. The
   **`onAdd`** reuses
   the
   `addSagaMovie` (the card's same add flow): "Adding…" → a toast → closing the preview → restoring the profile, with the
   `existingIds` Set updated so the card comes back as "Added".
3. **The restoring also via ✕, the backdrop and the Escape**: the
   `openSearchPreviewModal` stores the custom close on
   the
   `modal._onClose`; the new
   `closeActiveModal` of the
   `setupModalCloseListeners` (the
   `js/modal-handlers.js`) respects it and consumes it before closing, and the
   `closeModal` (the
   `js/ui.js`) clears it
   (the
   `modal._onClose = null`) so the preview's internal close does not re-trigger the restoration
   in a cascade (a
   QA fix).
4. **Already added movies**: the preview opens with an
   `added: true` based
   on the
   `existingIds` Set, showing
   **"Ya añadido"** with the
   button disabled (a state the
   `openSearchPreviewModal` already supported from the
   ADR-030; it gets reused as is).
5. **The styles** (the
   `ocio/ocio.css`): the
   `.saga-card__open` (a
   button
   reset, the
   `display: flex; flex-direction: column; flex: 1`, the
   `focus-visible` with the
   `--teal-reel`), the
   `.saga-card .rec-card__cover` with a
   `display: block` (it avoids the inline `img`'s baseline gap inside the
   `button`) and the
   `.saga-card__hint` with **AA contrast on the four themes**:
   the
   `#5f5849` hex (~5.1:1) by default on the dark family and a
   grouped override (the
   comma selectors `[data-theme="black"] .saga-card__hint, [data-theme="light"] .saga-card__hint, [data-theme="white"] .saga-card__hint`) that restores the
   `--ink-soft`, following the
   grouped-selectors pattern (the
   AGENTS.md's rule 4).

### Rejected alternatives

- **Opening the unregistered item's full profile**: the profile
  flow (the
  `openMovieItem`) operates over already registered
  items; a temporary draft would have to get fabricated and there is no
  "not added" route with that look. The issue #22's preview is already the project's pattern for "see before adding".
- **Doing nothing (leaving only the card's "Add" button)**: it does not respond to the user's comment; without the preview there is no way to see the movie's information before deciding to add it.

### Consequences

**Positive:**

- The user can **explore a saga movie's information** (the
  cover, the duration, the cast, the synopsis, the community rating, the
  trailer) before adding it, responding to the issue's comment.
- **A restorable flow**: closing the preview by any of the four ways ("Close", the ✕, the backdrop or the Escape) or adding the movie returns to the profile that was being viewed, without losing the context nor the state ("Added" persisted on the
  `existingIds`).
- **A total reuse**: the
  `openSearchPreviewModal` (issue #22), the
  `onEnrich`/`getMovieDetails` and the
  `addSagaMovie` get reused without
  duplicating the render or the add logic; the search preview does not change behavior (the
  `onClose` is optional and the
  `_onClose` gets cleared on the
  `closeModal`).
- Accessibility: the card is a real button with an `aria-label`, a visible hint, the
  `focus-visible` and an AA contrast on the four themes.

**Negative / neutral:**

- When restoring the profile a **light reQuery to TMDB** happens (the
  `getCollectionDetails` on the profile's re-render, covered by the shared 24h cache; the profile's details do not get re-asked, the
  `reopen` is a re-render with the
  `isRerender`).
- The preview shows the ADR-030 pattern's information (with no "Dónde verla", which is exclusive to a registered item's profile).
- On the read-only profile the cards are not pressable (the
  `onOpen` only gets passed when the interaction is appropriate).

## The 2026-08-14 iteration: the expanded preview when pressing a recommendation card

### Context

The user expanded the issue #280's
scope again with a comment from 2026-08-14: "The recommendations' movies should also be pressable to expand the information". After the previous iteration (the pressable saga cards), the movie

profile's and the series

profile's "Si te gustó esto, quizá te guste..." cards had to behave the same: when pressing them, opening the expanded preview with the information before adding the recommendation.

### Decision

Making the recommendations' cards **pressable** with the
**saga cards' same pattern** (and the issue #22's search preview), factorizing
the preview mechanics into a shared helper:

1. **A pressable card** (the
   `renderRecommendations` in the
   `js/ui.js`): a new optional
   `onOpen` parameter; when it is a function, each card renders as a
   `.rec-card.rec-card--openable` with a
   `.rec-card__open` button (with the
   "Ver información de …"
   `aria-label`) that wraps
   the
   `img.rec-card__cover` + the
   `span.rec-card__body` (the title, the year and the
   `.rec-card__hint` "Ver información"
   hint), and the
   `.rec-card__add` button stays as a sibling, anchored at the bottom by the open
   button's `flex: 1` (the
   `.saga-card__open`'s same mechanics).
2. **The shared
   `openExternalPreview` helper** (the
   `js/modal-handlers.js`): it centralizes the preview's common mechanics (closing the profile before opening, the
   `openSearchPreviewModal` with the
   `added` based on the
   `existingIds` Set, the
   `onClose` → the
   `closeModal` + restoring the profile, the
   `onAdd` → the
   add + the
   `existingIds.add` + the toast + the close + the restoration) and the
   `openSagaMoviePreview` (the saga, refactored) and the new
   `openRecommendationPreview` (the recommendations, the
   `movie`/`tv` type)
   share it.
3. **The enrichment per type** (the
   `enrichExternalPreview`): the movies get enriched with the
   `getMovieDetails`; the series with the
   `getTvExtraDetails` + the
   `getTvSeasonsMeta` (non-blocking). It never throws: if it fails it returns a
   `{}` and the preview keeps the card's data.
4. **The refactor of
   the
   `addFromRecommendation` → the
   `addRecommendationItem`**: the add core (with no button state) gets extracted to reuse it as the
   `performAdd` from the
   `openExternalPreview`; the wrapper keeps the card button's "Adding…"/"Added" state.
5. **The wiring**: the
   `onOpenRecommendation` gets added to the
   `openMovieItem` and the
   `openTvItem`' callbacks (it uses the
   `reopen` + the shared
   `existingIds` Set → the card comes back "Added" when restoring the profile, and the preview opens "Ya añadido" disabled if it is already registered).
6. **The styles** (the
   `ocio/ocio.css`): the saga iteration's selectors get
   comma-grouped (the
   `.saga-card__open, .rec-card__open`, the
   `.saga-card .rec-card__cover, .rec-card--openable .rec-card__cover` and the
   `.saga-card__hint, .rec-card__hint`, including the
   `:focus-visible` and the themes'
   override), a single source of truth per rule (the AGENTS.md's rule 4); the hint keeps
   the AA contrast (the `#5f5849` base on the dark family, the
   `--ink-soft` on pure black, light and pure white).

### Rejected alternatives

- **Duplicating the preview helper per section** (a copy for the saga and another for the recommendations): two almost identical flows that would have to stay
  synced; the
  `openExternalPreview` centralizes the issue #22's mechanics and each section only contributes the lightweight item, the enrichment and the add function.
- **Reusing the
  `.saga-card__open` also on the recommendations**: it would interfere with the event wiring, which on the recommendations uses the
  `data-rec-index` and on the saga the
  `data-saga-index` (different classes and indices avoid
  collisions on the same modal); that's why the recommendation card uses its own
  `.rec-card__open` class, sharing the CSS rules via grouped selectors.

### Consequences

**Positive:**

- The user can **explore any recommendation's expanded information** — movie or series — before adding it, with the saga cards' same restorable flow: closing by any of the ways or adding returns to the profile that was being viewed.
- The series also show their **seasons** on the preview (a
  per-type specific enrichment).
- **Reuse**: the refactor to the
  `addRecommendationItem` and the
  `openExternalPreview` removes the add and the preview logic's duplication without changing the card's original "Add" button's behavior.
- The movie modal **coexists with both pressable sections** (the saga and the recommendations) with no interference: distinct classes (the
  `.saga-card__open`/the `.rec-card__open`) and indices (the
  `data-saga-index`/the `data-rec-index`).

**Negative / neutral:**

- Each pressed card adds a TMDB **API call** for the enrichment (the
  `getMovieDetails`/the
  `getTvExtraDetails`), with a
  **graceful degradation**: if it fails, the preview keeps the card's data and does not block the add (the
  `addRecommendationItem` itself also does not block if the extra details' query fails).
- The **user manual** got updated on the same PR (the
  AGENTS.md's rule 3): the profile's "Recommendations" bullet explains the pressable cards, the window with "Add"/"Close", the return to the profile, the disabled "Ya añadido" and the seasons on the series.
- The PR is the **same #281** (the
  `feature/issue-280-otras-peliculas-saga` branch); no new PR gets opened for this iteration.

## Created/modified files

| File | Change |
|---------|--------|
| `js/api-movies.js` | **Modified**: the
  `getCollectionDetails` with a shared 24h in-memory cache (the
  `providersCache`, the
  `collection_<id>` key); only correct responses get cached |
| `js/modal-handlers.js` | **Modified**: the
  `openMovieItem` loads the
  `sagaParts` (a try/catch, a graceful degradation); a new
  `onAddSagaMovie` callback (it reuses the
  `addSagaMovie` + updates the
  `existingIds`); the
  `addFromRecommendation` returns a boolean; the
  `onAddRecommendation` updates the
  `existingIds` (a QA fix, also on the
  `openTvItem`). **The iteration**: the
  `openSagaMoviePreview` (a preview with the
  `openSearchPreviewModal`, the
  `onClose` restores the profile, the
  `onAdd` reuses the
  `addSagaMovie`), the
  `onOpenSagaMovie` on the
  `openMovieItem` and the
  `closeActiveModal` on the
  `setupModalCloseListeners` (the ✕, the backdrop and the Escape respect the
  `modal._onClose`). **The 2026-08-14 iteration**: the shared
  `openExternalPreview` helper (the issue #22's mechanics: the onClose restores the profile, the onAdd adds + the `existingIds.add` + the toast + the close + the restoration), the
  `openRecommendationPreview` (the movie/tv) and the
  `openSagaMoviePreview` refactored over the helper; the
  `enrichExternalPreview` per type (the movie → the
  `getMovieDetails`; the tv → the
  `getTvExtraDetails` + the non-blocking
  `getTvSeasonsMeta`; it never throws); the
  `addRecommendationItem` extraction from the
  `addFromRecommendation` (a core with no button state); the
  `onOpenRecommendation` on the
  `openMovieItem` and the
  `openTvItem` |
| `js/ui.js` | **Modified**: the new
  `renderSagaMovies` (the "Otras películas de la saga" section with the
  `.rec-card`/the `.recommendations__scroll` and the
  `.saga-card__add` button); the
  `openMovieModal` accepts a
  `sagaParts` and propagates all the arguments on the re-render; the
  `.saga-card__add`'s wiring. **The iteration**: the
  `renderSagaMovies` with a pressable
  `.saga-card__open` card + the "Ver información"
  hint; the `onClose` (new) on the
  `openSearchPreviewModal` stored on the
  `modal._onClose`; the
  `closeModal` consumes the
  `modal._onClose`. **The 2026-08-14 iteration**: the
  `renderRecommendations` with an optional
  `onOpen` parameter (a
  `.rec-card--openable` card with the
  `.rec-card__open` + the "Ver información"
  hint and the
  `.rec-card__add` as a sibling); the
  `onOpenRecommendation` on the
  `openMovieModal` and the
  `openTvModal` (a render with the fifth argument and the
  `.rec-card__open`'s wiring → the
  `recommendations[index]`) |
| `ocio/ocio.css` | **Modified**: the
  `.saga-movies`, the
  `.saga-movies__title` (the
  `.recommendations__title`'s style with theme variables) and the
  grouped rule of
  the
  `.rec-card .rec-card__add, .saga-card .saga-card__add`. **The iteration**: the
  `.saga-card__open` (a
  button reset, the `flex: 1`, the
  `focus-visible`), the
  `.saga-card .rec-card__cover` with a `display: block` and the
  `.saga-card__hint` with an AA contrast on the 4 themes (a per-themes grouped override). **The 2026-08-14 iteration**: the grouped selectors of
  the
  `.saga-card__open, .rec-card__open`, the
  `.saga-card .rec-card__cover, .rec-card--openable .rec-card__cover` and the
  `.saga-card__hint, .rec-card__hint` (a single source of truth per rule, the hint's AA contrast and the
  `:focus-visible`
  grouped) |
| `docs/manual-de-usuario.md` | **Modified**: the section 11, the "Sagas" bullet expanded with the "Otras películas de la saga"
  cards and their "Add"/"Added" buttons. **The iteration**: the bullet explains that the card can get pressed to see the information before adding it (the "Add"/"Close" buttons, the return to the profile, the disabled "Ya añadido"). **The 2026-08-14 iteration**: the "Recommendations" bullet explains the pressable cards with an expanded preview (the cover, the duration, the genre, the cast, the synopsis, the score and the trailer; the seasons on the series), the "Add"/"Close" buttons, the return to the profile and the disabled "Ya añadido" |
| `docs/adr-096-otras-peliculas-saga.md` | **New**: this document |
| `tasks/task-issue-280.json` | The task's
  task file |

Related issue: #280
