# ADR-002: Book search with Google Books API and smart grouping

## Status
Accepted

## Context
Book search used Open Library as the primary source and Google Books as a fallback. Although Open Library groups by work (one book = one result), its metadata quality is lower: limited synopses, fewer covers available, and sometimes incomplete results. Google Books has superior metadata (complete synopses, multiple covers per edition, page counts) but groups by edition, which flooded the list with the same novel in hardcover, paperback, English, French...

The user preferred the quality of Google Books results but wanted to avoid duplication by edition.

## Decision
Switch the primary book search source to the **Google Books API**, implementing **smart grouping by title+author** that consolidates multiple editions of the same work into a single result. When adding a book with multiple grouped editions, a **selection modal** is shown where the user can choose:

1. **Cover**: among all covers available from all grouped editions.
2. **Synopsis**: among the different synopses available (if they differ between editions).

Open Library is kept as the fallback source when Google Books finds no results or fails.

### Data flow (new)

```
User query
  │
  ▼
searchBooks() ─── Google Books first
  │
  ├─ Google Books returns raw items (multiple editions)
  │     │
  │     ▼
  │  groupBooksByWork()  ← groups by normalized title+author
  │     │                  merges covers[], descriptions[]
  │     │                  picks the best representative edition
  │     ▼
  │  Results enriched with allCovers[], allDescriptions[], editionsCount
  │
  ├─ If no results → Open Library fallback (unchanged)
  │
  ▼
renderSearchResults()  ← shows "X eds." badge for grouped books
  │
  ▼
User presses "Add"
  │
  ├─ If 1 cover + 1 synopsis → quick path (no modal)
  │
  ├─ If multiple covers OR synopses
  │     │
  │     ▼
  │  openBookConfirmModal()  ← cover + synopsis picker
  │     │
  │     ▼
  │  User chooses → addItem() with selected values
  │
  ▼
Book saved to Firestore (structure unchanged)
```

### Cross-detection of "already added"
A book added via Open Library (externalId "/works/...") is also detected in Google Books results (and vice versa) by matching normalized title+author, not only by externalId.

## Consequences

### Positive
- **Better results**: Google Books offers complete synopses, more covers, and richer metadata.
- **No duplication**: Grouping by title+author consolidates editions of the same work.
- **User control**: When adding, the user can pick the cover and synopsis from all options.
- **Cross-compatibility**: A book added via Open Library is recognized in Google Books searches.
- **Fallback available**: If Google Books fails, Open Library remains available.

### Negative
- **Added complexity**: The grouping and the selection modal add code.
- **Dependence on Google Books**: If its API changes or restricts access, the fallback to Open Library kicks in.
- **Possible over-grouping**: Title normalization may group different books with similar titles (low risk, mitigated by including the author in the key).

### Neutral
- **Firestore structure unchanged**: No migration of existing data is needed.
- **UX unchanged for movies/series**: Only affects the books tab.

## Files modified
- `js/api-books.js` — Rewritten: Google Books as primary source, `groupBooksByWork()`, `normalizeTitle()`, `pickBestEdition()`
- `js/search.js` — Modified: cross-detection of "already added", confirmation modal for books
- `js/ui.js` — Modified: `renderSearchResults()` with `customCheck` parameter, editions badge, `openBookConfirmModal()`
- `ocio/ocio.css` — Modified: styles for cover picker, description picker, editions badge
