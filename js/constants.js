// =============================================================
// Constants shared between modules. It centralizes the status
// labels, the type mappings and other values used in
// several places (app.js, ui.js, profile.js, etc.) to avoid
// duplication.
// =============================================================

// Status labels with context (to display in the UI).
// "media" covers movies and TV series; "book" is for books;
// "game" covers videogames.
export const STATUS_LABELS = {
  media: {
    pendiente: "Pendiente",
    en_curso: "Viendo",
    completado: "Vista",
    standby: "Standby",
    abandonado: "Abandonada",
  },
  book: {
    pendiente: "Pendiente",
    en_curso: "Leyendo",
    completado: "Leído",
    standby: "Standby",
    abandonado: "Abandonado",
  },
  game: {
    pendiente: "Pendiente",
    en_curso: "Jugando",
    completado: "Jugado",
    standby: "Standby",
    abandonado: "Abandonado",
  },
};

// Neutral status labels (without type context).
// They are used in the profile's statistics charts.
export const STATUS_LABELS_NEUTRAL = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  completado: "Completado",
  standby: "En pausa",
  abandonado: "Abandonado",
};

// Texts of the «mark as completed» action depending on the type (issue #177):
// the term varies by type — movies/series «visto», books «leído»,
// videogames «jugado». They are used in the catalog button (issue #115)
// and in its done/restore states.
export const SEEN_ACTION_LABELS = {
  media: { action: "Marcar visto", done: "Visto" },
  book: { action: "Marcar leído", done: "Leído" },
  game: { action: "Marcar jugado", done: "Jugado" },
};

// Texts of «mark as completed» for the given item type
// (same family of scopes as STATUS_LABELS, issue #177).
export function seenActionLabels(type) {
  const scope = type === "book" ? "book" : type === "game" ? "game" : "media";
  return SEEN_ACTION_LABELS[scope];
}

// Mapping of group name ("movies", "tv", "books", "games") to the item type
// ("movie", "tv", "book", "game") saved in Firestore.
export const TYPE_BY_GROUP = { movies: "movie", tv: "tv", books: "book", games: "game" };

// Detail fields served ON DEMAND (minimal storage A2,
// study of issue #183, section 8.2): with minimal
// storage they are not persisted in Firestore; they are requested from the
// API when opening the detail view (with a 24 h in-memory cache) and the
// migration cleanup (js/migration.js) removes them from existing documents.
// Exception: books keep `description` (section 8.1: the
// book card and detail view paint it instantly, and there is no
// detail call that retrieves it without cost).
export const ON_DEMAND_DETAIL_FIELDS = [
  "runtime",
  "episodeRuntime",
  "overview",
  "description",
  "genres",
  "cast",
  "director",
  "creators",
  "trailerUrl",
  "collectionId",
  "collectionName",
  "collectionPoster",
  "platforms",
  "developers",
  "publishers",
  "esrbName",
  "metacritic",
  "playtime",
];

// SVG icons of the media types: SAME markup as the tabs of
// index.html (tab--tv / tab--movies / tab--books, lines 155-177) —
// canonical source: if the tabs change, update here (issue #134).
export const MEDIA_ICONS = {
  tv: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
    <polyline points="17 2 12 7 7 2" />
  </svg>`,
  movies: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1-.3 2.1.3 2.4 1.3Z" />
    <path d="m6.2 5.3 3.1 3.9" />
    <path d="m12.4 3.4 3.1 4" />
    <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>`,
  books: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 7v14" />
    <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
  </svg>`,
  games: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="2" y="6" width="20" height="12" rx="6" />
    <path d="M6 11h4M8 9v4" />
    <path d="M15.5 11h.01M17.5 13h.01" />
  </svg>`,
};
