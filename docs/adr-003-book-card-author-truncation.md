# ADR-003: Author truncation on book cards

## Status
Accepted

## Context
When a book has many authors, the metadata line
("Author1, Author2, Author3 … · 2024") grows horizontally
and stretches the cards in the grid (`library-grid`), breaking
the grid alignment set by `grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))`.
This forces the user to scroll horizontally and visually
disorders the library.

Additionally, the book title could also overflow in cards
with very long titles.

## Decision
Apply the following CSS and HTML techniques to keep cards
of uniform size without losing information:

1. **CSS `text-overflow: ellipsis`** on `.item-card__meta` and
   `.list-row__meta` to visually truncate the author/year line
   when it is too long, showing an ellipsis (...).

2. **CSS `-webkit-line-clamp: 2`** on `.item-card__title` to
   limit the title to a maximum of 2 lines before truncating.

3. **`min-width: 0`** on `.item-card` (grid item) so the
   grid column can shrink below the size of the
   content. Without this, grid items default to `min-width: auto`
   and `text-overflow: ellipsis` never activates
   because the element is never forced to be narrower.

4. **`min-width: 0`** on `.item-card__body` to prevent the
   content from forcing the flex container (inside the grid item) to
   expand beyond the column width.

   > **Note**: Both `min-width: 0` declarations are needed: one at
   > grid item level (`.item-card`) and one at flex child level
   > (`.item-card__body`). The former allows the grid column to
   > shrink, and the latter allows the flex body to
   > shrink inside the card.

5. **Native HTML `title` attribute** on the title and
   metadata elements, in both grid and list views, so the
   full content is visible as a browser tooltip on
   hover.

6. **`title` on the `.item-card__btn` button** (absolute layer that
   covers the whole card) with the full title and author, to
   guarantee the tooltip is accessible in grid view
   where the overlay button intercepts mouse events.

### Rejected alternatives

- **Custom JavaScript tooltip**: unnecessary
  extra complexity; the native tooltip (`title`) covers the use case
  without adding dependencies or extra logic.
- **Additional modal for authors**: interaction overhead for
  secondary data; the full detail is already available in the
  book detail modal on click.
- **Shortening the author in JavaScript (showing only the first N
  authors)**: loss of information without clear benefit, and
  would require changes in the data logic.
- **Tooltip only, no truncation**: does not solve the layout problem;
  cards would still stretch.

### Note about the tooltip in grid view
In grid view, the `.item-card__btn` button has
`position: absolute; inset: 0` and covers the whole card. This
prevents the `title` of child elements from activating. As a
workaround, `title` was added directly to the button with the full
title and author.

## Consequences

### Positive
- Cards keep a uniform size regardless of the
  length of the `author` field.
- The full information is accessible on hover (native tooltip)
  and permanently in the detail modal.
- No changes to the data logic or the author
  storage format.
- Long titles are shown up to 2 lines before truncating.

### Negative
- The browser's native tooltip is not visually customizable
  (style, animation, appearance timing).
- In grid view, the button tooltip shows title and
  author together, not separately.

### Neutral
- Non-book items (movies, TV) are not affected because their
  "type · year" metadata is always short.
- The list view already had truncation on `.list-row__title`;
  only the `title` attribute was added, plus truncation on the meta.

## Files modified
- `ocio/ocio.css` — Added `min-width: 0` to `.item-card` (grid
  item, the missing key piece) and to `.item-card__body`,
  `-webkit-line-clamp` to `.item-card__title`, and `text-overflow:
  ellipsis` to `.item-card__meta` and `.list-row__meta`.
  On search result cards (`.result-card`):
  `min-width: 0` on `.result-card__body`, `text-overflow: ellipsis`
  on `.result-card__title` and `.result-card__meta`.
- `js/ui.js` — Added `title` attributes to the title and metadata
  elements in `renderGrid()` and `renderList()`, and to the
  `.item-card__btn` button in grid view. Also in
  `renderSearchResults()` for `.result-card__title` and
  `.result-card__meta`.
- `js/global-search.js` — Added `title` attributes to the
  `.global-search__item-title` and
  `.global-search__item-meta` elements.
