// =============================================================
// `MediaCard` — tarjeta ÚNICA y polimórfica de medios.
//
// Specs cubiertas:
//   spec 02 — UI-01 (componente único y reutilizable), REQ-106
//     (la misma `MediaCard` en Catálogo, Búsqueda, Colecciones y
//     Recomendaciones), REQ-107 (acciones rápidas sin abrir la
//     ficha), AC-115 (clic en `Añadir` ⇒ entry `PLANNED`, 1 clic),
//     AC-116 (mismo DOM/estilos en las 4 vistas), AC-117 (menú ⇒
//     `COMPLETED`, entry persistida con `updatedAt` nuevo).
//   spec 03 — UI-10 (`EntryStatusMenu`: 4 estados + "Sin entry",
//     optimista con rollback en `Result` fallido), UI-11
//     (`ScorePicker`: escala 1–10 mostrada como badge personal),
//     DB-101 (`MediaItem`), DB-103 (`Entry`), DB-104 (`Collection`).
//   spec 05 — UI-32 (las recomendaciones mantienen las mismas
//     acciones; `reason`/`scoreMatch` son opcionales).
//
// Convenciones (spec 00):
//   REQ-C1 — parte PURA (sin DOM, importable en Node/vitest) y
//            parte DOM (única que construye nodos).
//   REQ-C2 — cabecera con los IDs de spec.
//   REQ-C5 — textos de UI en español; enums en inglés mayúsculas.
//   REQ-C6 — tipos documentados con JSDoc (`@typedef`).
//
// Estructura del DOM (idéntica en las 4 vistas, AC-116):
//
//   <article class="media-card" data-media-id data-media-type>
//     <div class="media-card__poster">
//       <img class="media-card__poster-image">        (2:3, CSS)
//       <span class="media-card__poster-fallback">   (iniciales)
//       <span class="media-card__type-badge">         (badge mediaType)
//       <span class="media-card__entry-badge">        (estado personal)
//     </div>
//     <div class="media-card__body">
//       <h3 class="media-card__title">
//       <p class="media-card__meta">                  (año · ★ media · nota)
//       <ul class="media-card__genres">                (≤2 + "+N")
//       <p class="media-card__creator">
//       <p class="media-card__reason">                (opcional, UI-30)
//     </div>
//     <div class="media-card__actions" role="group">
//       <button class="media-card__btn--add" data-action="add">
//       <select class="media-card__status" data-action="status">
//       <select class="media-card__collection" data-action="collection">
//       <button class="media-card__btn--assign" data-action="assign">
//     </div>
//     <p class="media-card__error" role="alert">
//   </article>
//
// Contrato de los callbacks (REQ-107): cada uno recibe un contexto
// `{ item, entry, card, ... }` y puede devolver `void` o un
// `Result` (spec 00 §4.1). Si devuelve un `Result` fallido, la
// tarjeta revierte el cambio optimista y muestra el mensaje en
// español (UI-10).
// =============================================================

// -------------------------------------------------------------
// 1. Constantes y etiquetas (REQ-C5, DB-101, DB-103)
// -------------------------------------------------------------

/** Tipos de medio del catálogo (00 §4.1). */
export const MEDIA_TYPES = Object.freeze([
  "SERIES",
  "ANIME",
  "MANGA",
  "BOOK",
  "AUDIOBOOK",
  "MOVIE",
  "GAME",
]);

/** Etiqueta en español del tipo de medio (badge del póster). */
export const MEDIA_TYPE_LABELS = Object.freeze({
  SERIES: "Serie",
  ANIME: "Anime",
  MANGA: "Manga",
  BOOK: "Libro",
  AUDIOBOOK: "Audiolibro",
  MOVIE: "Película",
  GAME: "Videojuego",
});

/** Los 4 estados de tracking (00 §4.1, UI-10). */
export const ENTRY_STATUSES = Object.freeze([
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "DROPPED",
]);

/** Etiqueta en español de cada estado (UI-10). */
export const ENTRY_STATUS_LABELS = Object.freeze({
  PLANNED: "Planeado",
  IN_PROGRESS: "En curso",
  COMPLETED: "Completado",
  DROPPED: "Abandonado",
});

/** Opción "Sin entry" del menú de estados (UI-10). */
export const NO_ENTRY_LABEL = "Sin entry";

/** Estado con el que nace una entry (REQ-201, AC-115). */
export const DEFAULT_ENTRY_STATUS = "PLANNED";

/** Máximo de etiquetas de género visibles (UI-01: ≤2 + "+N"). */
export const MAX_VISIBLE_GENRES = 2;

/** Carácter de estrella ( IMDb-amarillo con CSS). */
export const STAR_CHARACTER = "★";

/** Número de estrellas de la valoración global (escala 0–10 ⇒ 5 ★). */
export const STAR_COUNT = 5;

/** Rol del `creator` según el tipo de medio (DB-101). */
export const CREATOR_ROLE_LABELS = Object.freeze({
  SERIES: "Creación",
  ANIME: "Creación",
  MANGA: "Autoría",
  BOOK: "Autoría",
  AUDIOBOOK: "Narración",
  MOVIE: "Dirección",
  GAME: "Estudio",
});

/** Mensaje por defecto cuando el callback falla sin mensaje (REQ-E2). */
export const DEFAULT_ERROR_MESSAGE =
  "No se ha podido guardar el cambio. Vuelve a intentarlo en unos segundos.";

// -------------------------------------------------------------
// 2. Tipos documentales (REQ-C6)
// -------------------------------------------------------------

/**
 * @typedef {"SERIES"|"ANIME"|"MANGA"|"BOOK"|"AUDIOBOOK"|"MOVIE"|"GAME"} MediaType
 * @typedef {"PLANNED"|"IN_PROGRESS"|"COMPLETED"|"DROPPED"} EntryStatus
 */

/**
 * @typedef {object} MediaCardItem
 * @property {string} id
 * @property {string} title
 * @property {MediaType} mediaType
 * @property {string|null} [coverUrl]
 * @property {number|null} [releaseYear]
 * @property {string[]} [genres]
 * @property {number|null} [avgRating]
 * @property {string|null} [creator]
 */

/**
 * @typedef {object} MediaCardEntry
 * @property {string|null} [mediaId]
 * @property {EntryStatus} status
 * @property {number|null} [score]
 * @property {string|null} [review]
 * @property {object|null} [progress]
 * @property {*} [updatedAt]
 */

/**
 * @typedef {object} MediaCardCollection
 * @property {string} id
 * @property {string} name
 */

/**
 * @typedef {{ ok: true, value?: * } | { ok: false, code?: string, message?: string }} MediaCardResult
 */

/**
 * @typedef {object} MediaCardContext
 * @property {MediaCardItem} item
 * @property {MediaCardEntry|null} entry
 * @property {HTMLElement} card
 * @property {string} action "add" | "status" | "assign"
 * @property {EntryStatus|null} [status] estado pedido (null ⇒ "Sin entry")
 * @property {MediaCardEntry|null} [previousEntry] estado anterior (rollback)
 * @property {string|null} [collectionId] colección elegida (acción "assign")
 */

/**
 * @typedef {(context: MediaCardContext) => void|MediaCardResult|Promise<void|MediaCardResult>} MediaCardCallback
 */

/**
 * @typedef {object} MediaCardOptions
 * @property {MediaCardEntry|null} [entry] entry personal inicial
 * @property {MediaCardCollection[]} [collections] colecciones del usuario
 * @property {string|null} [selectedCollectionId] colección preseleccionada
 * @property {MediaCardCallback} [onAdd] clic en `Añadir` (crea entry `PLANNED`)
 * @property {MediaCardCallback} [onStatusChange] cambio de estado (UI-10)
 * @property {MediaCardCallback} [onAssignCollection] asignar a colección
 * @property {(context: MediaCardContext) => void} [onEntryChange] aviso de entry cambiada
 * @property {Document} [document] documento DOM a usar (tests / iframes)
 * @property {string} [reason] motivo de recomendación (UI-30, opcional)
 * @property {number} [scoreMatch] coincidencia 0–100 (UI-30, opcional)
 */

/**
 * @typedef {object} MediaCardModel
 * @property {string} mediaId
 * @property {string} title
 * @property {MediaType} mediaType
 * @property {string} mediaTypeLabel
 * @property {string|null} coverUrl
 * @property {string} initials
 * @property {number|null} releaseYear
 * @property {string|null} releaseYearLabel
 * @property {number|null} avgRating
 * @property {string|null} avgRatingLabel
 * @property {string|null} avgRatingAriaLabel
 * @property {number|null} starFillPercent
 * @property {{labels: string[], visible: string[], overflow: number, total: number}} genres
 * @property {string|null} creator
 * @property {string|null} creatorText
 * @property {{status: EntryStatus, statusLabel: string, score: number|null, scoreLabel: string|null, scoreAriaLabel: string|null}|null} entry
 * @property {string} addAriaLabel
 * @property {string} statusAriaLabel
 * @property {string} collectionAriaLabel
 * @property {string} assignAriaLabel
 * @property {string} actionsAriaLabel
 * @property {MediaCardCollection[]} collections
 * @property {string|null} selectedCollectionId
 * @property {string|null} reason
 * @property {number|null} scoreMatch
 */

// -------------------------------------------------------------
// 3. Parte pura: normalización y etiquetas (UI-01)
// -------------------------------------------------------------

/** Etiqueta en español del tipo de medio. */
export function mediaTypeLabel(mediaType) {
  return MEDIA_TYPE_LABELS[mediaType] ?? "Medio";
}

/** Etiqueta en español del estado de tracking. */
export function entryStatusLabel(status) {
  return ENTRY_STATUS_LABELS[status] ?? NO_ENTRY_LABEL;
}

/** Rol del creador según el tipo de medio ("Dirección", "Autoría", …). */
export function creatorRoleLabel(mediaType) {
  return CREATOR_ROLE_LABELS[mediaType] ?? "Creación";
}

/**
 * Normaliza un `MediaItem` del catálogo (DB-101) a la forma que usa
 * la tarjeta. Nunca lanza.
 * @param {*} item
 * @returns {MediaCardItem}
 */
export function normalizeMediaItem(item) {
  const src = item && typeof item === "object" && !Array.isArray(item) ? item : {};
  const title = typeof src.title === "string" && src.title.trim() !== "" ? src.title.trim() : "Sin título";
  const genres = Array.isArray(src.genres)
    ? src.genres.filter((genre) => typeof genre === "string" && genre.trim() !== "")
    : [];
  const releaseYear =
    typeof src.releaseYear === "number" && Number.isFinite(src.releaseYear) ? src.releaseYear : null;
  const avgRating =
    typeof src.avgRating === "number" && Number.isFinite(src.avgRating) ? src.avgRating : null;
  return {
    id: typeof src.id === "string" ? src.id : "",
    title,
    mediaType: MEDIA_TYPES.includes(src.mediaType) ? src.mediaType : null,
    coverUrl: typeof src.coverUrl === "string" && src.coverUrl.trim() !== "" ? src.coverUrl.trim() : null,
    releaseYear,
    genres,
    avgRating,
    creator: typeof src.creator === "string" && src.creator.trim() !== "" ? src.creator.trim() : null,
  };
}

/**
 * Normaliza una `Entry` (DB-103). Devuelve `null` si no hay entry
 * válida (o el estado no pertenece al enum).
 * @param {*} entry
 * @returns {MediaCardEntry|null}
 */
export function normalizeMediaEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const status = ENTRY_STATUSES.includes(entry.status) ? entry.status : null;
  if (status === null) return null;
  const score =
    typeof entry.score === "number" && Number.isInteger(entry.score) && entry.score >= 1 && entry.score <= 10
      ? entry.score
      : null;
  return {
    mediaId: typeof entry.mediaId === "string" ? entry.mediaId : typeof entry.id === "string" ? entry.id : null,
    status,
    score,
    review: typeof entry.review === "string" ? entry.review : null,
    progress: entry.progress && typeof entry.progress === "object" ? entry.progress : null,
    updatedAt: entry.updatedAt ?? null,
  };
}

/**
 * Normaliza la lista de colecciones (DB-104) para el selector.
 * @param {*} collections
 * @returns {MediaCardCollection[]}
 */
export function normalizeCollections(collections) {
  if (!Array.isArray(collections)) return [];
  const seen = new Set();
  const list = [];
  for (const collection of collections) {
    if (!collection || typeof collection !== "object") continue;
    const id = typeof collection.id === "string" ? collection.id.trim() : "";
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    list.push({
      id,
      name: typeof collection.name === "string" && collection.name.trim() !== "" ? collection.name.trim() : id,
    });
  }
  return list;
}

// -------------------------------------------------------------
// 4. Parte pura: géneros, iniciales y valoración (UI-01)
// -------------------------------------------------------------

/**
 * Géneros visibles de la tarjeta: como máximo **2 etiquetas** y, si
 * hay más, una tercera etiqueta literal `+N` con
 * `N = genres.length - 2` (UI-01). El cálculo es el mismo en las
 * 4 vistas porque vive en este único componente (AC-116).
 * @param {*} genres
 * @returns {{labels: string[], visible: string[], overflow: number, total: number}}
 */
export function formatGenres(genres) {
  const list = Array.isArray(genres)
    ? genres
        .filter((genre) => typeof genre === "string" && genre.trim() !== "")
        .map((genre) => genre.trim())
    : [];
  const visible = list.slice(0, MAX_VISIBLE_GENRES);
  const overflow = Math.max(list.length - MAX_VISIBLE_GENRES, 0);
  const labels = visible.slice();
  if (overflow > 0) labels.push(`+${overflow}`);
  return { labels, visible, overflow, total: list.length };
}

/**
 * Iniciales del título para el póster de reserva (UI-01).
 * "El Último Signo" ⇒ "EU"; "Matrix" ⇒ "M".
 * @param {*} title
 * @returns {string}
 */
export function initialsForTitle(title) {
  const words = String(title ?? "")
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  if (words.length === 0) return "?";
  const letters = [];
  for (const word of words.slice(0, 2)) {
    const first = [...word][0];
    if (first) letters.push(first);
  }
  return letters.join("").toUpperCase() || "?";
}

/**
 * Formatea una valoración 0–10 con un decimal (coma decimal en
 * español). Devuelve `null` si no hay dato.
 * @param {*} value
 * @returns {string|null}
 */
export function formatRating(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const clamped = Math.min(Math.max(value, 0), 10);
  return clamped.toFixed(1).replace(".", ",");
}

/**
 * Porcentaje de relleno de las estrellas de la valoración global
 * (0–100). `null` si no hay valoración.
 * @param {*} value
 * @returns {number|null}
 */
export function starFillPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const clamped = Math.min(Math.max(value, 0), 10);
  return Math.round((clamped / 10) * 10000) / 100;
}

// -------------------------------------------------------------
// 5. Parte pura: modelo de la tarjeta (UI-01)
// -------------------------------------------------------------

/**
 * Construye el modelo (datos ya traducidos) de una tarjeta. Es la
 * parte que se puede testear sin DOM y la que usan el renderizador
 * y las vistas.
 * @param {MediaCardItem|object} item
 * @param {MediaCardEntry|object|null} [entry]
 * @param {MediaCardOptions} [options]
 * @returns {MediaCardModel}
 */
export function buildMediaCardModel(item, entry = null, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const mediaItem = normalizeMediaItem(item);
  const personal = normalizeMediaEntry(entry);
  const title = mediaItem.title;
  const avgRatingLabel = formatRating(mediaItem.avgRating);
  const score = personal ? personal.score : null;

  return {
    mediaId: mediaItem.id,
    title,
    mediaType: mediaItem.mediaType,
    mediaTypeLabel: mediaTypeLabel(mediaItem.mediaType),
    coverUrl: mediaItem.coverUrl,
    initials: initialsForTitle(title),
    releaseYear: mediaItem.releaseYear,
    releaseYearLabel:
      typeof mediaItem.releaseYear === "number" ? String(mediaItem.releaseYear) : null,
    avgRating: mediaItem.avgRating,
    avgRatingLabel,
    avgRatingAriaLabel:
      avgRatingLabel === null ? null : `Valoración media ${avgRatingLabel} de 10`,
    starFillPercent: starFillPercent(mediaItem.avgRating),
    genres: formatGenres(mediaItem.genres),
    creator: mediaItem.creator,
    creatorText:
      mediaItem.creator === null
        ? null
        : `${creatorRoleLabel(mediaItem.mediaType)}: ${mediaItem.creator}`,
    entry: personal
      ? {
          status: personal.status,
          statusLabel: entryStatusLabel(personal.status),
          score,
          scoreLabel: score === null ? null : `${score}/10`,
          scoreAriaLabel: score === null ? null : `Tu puntuación: ${score} de 10`,
        }
      : null,
    addAriaLabel: `Añadir «${title}» a tu perfil`,
    statusAriaLabel: `Cambiar el estado de «${title}»`,
    collectionAriaLabel: `Colección para «${title}»`,
    assignAriaLabel: `Asignar «${title}» a la colección seleccionada`,
    actionsAriaLabel: `Acciones sobre «${title}»`,
    collections: normalizeCollections(opts.collections),
    selectedCollectionId:
      typeof opts.selectedCollectionId === "string" ? opts.selectedCollectionId : null,
    reason:
      typeof opts.reason === "string" && opts.reason.trim() !== "" ? opts.reason.trim() : null,
    scoreMatch:
      typeof opts.scoreMatch === "number" && Number.isFinite(opts.scoreMatch)
        ? Math.round(opts.scoreMatch)
        : null,
  };
}

// -------------------------------------------------------------
// 6. Parte DOM: `MediaCard` (UI-01, UI-10, UI-11, UI-32)
// -------------------------------------------------------------

/** Contador para ids únicos (accesibilidad: `aria-labelledby`). */
let cardSequence = 0;

/** Devuelve el documento DOM a usar (inyectable para tests). */
function resolveDocument(options) {
  const candidate = options && typeof options === "object" ? options.document : null;
  const doc = candidate ?? globalThis.document;
  if (!doc || typeof doc.createElement !== "function") {
    throw new Error("No hay un documento DOM disponible para crear la MediaCard.");
  }
  return doc;
}

/** Crea un elemento con clase y contenido textual. */
function createElement(doc, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

/**
 * Crea la `MediaCard`: un único `<article>` accesible con las
 * acciones rápidas de REQ-107.
 *
 * @param {MediaCardItem|object} item ítem del catálogo (DB-101)
 * @param {MediaCardOptions} [options]
 * @returns {HTMLElement} el `<article>` con la tarjeta
 */
export function createMediaCard(item, options = {}) {
  const doc = resolveDocument(options);
  const controller = createMediaCardController(item, options, doc);
  return controller.element;
}

/**
 * Monta una rejilla de tarjetas en un contenedor (AC-116: las 4
 * vistas usan exactamente el mismo DOM y los mismos estilos).
 * @param {HTMLElement} container
 * @param {MediaCardItem[]} items
 * @param {MediaCardOptions} [options]
 * @returns {HTMLElement} el contenedor
 */
export function mountMediaCards(container, items, options = {}) {
  if (!container || typeof container.appendChild !== "function") {
    throw new Error("mountMediaCards necesita un contenedor del DOM.");
  }
  const doc = options.document ?? container.ownerDocument ?? globalThis.document;
  const list = Array.isArray(items) ? items : [];
  const fragment = doc.createDocumentFragment();
  for (const entry of list) {
    fragment.appendChild(createMediaCard(entry, { ...options, document: doc }));
  }
  container.replaceChildren(fragment);
  return container;
}

/** Controladores por elemento (para leer/actualizar el estado). */
const CONTROLLERS = new WeakMap();

/**
 * Devuelve el controlador de una tarjeta creada por este módulo
 * (`null` si el elemento no es una `MediaCard`).
 * @param {HTMLElement} element
 * @returns {object|null}
 */
export function getMediaCardController(element) {
  if (!element || typeof element !== "object") return null;
  return CONTROLLERS.get(element) ?? null;
}

/**
 * Actualiza el estado de una tarjeta (entry, colecciones, …) y la
 * vuelve a pintar sin perder el foco.
 * @param {HTMLElement} element
 * @param {{entry?: MediaCardEntry|null, collections?: MediaCardCollection[], selectedCollectionId?: string|null}} patch
 */
export function updateMediaCard(element, patch = {}) {
  const controller = getMediaCardController(element);
  if (!controller) return;
  controller.update(patch);
}

/**
 * Entry personal actual de una tarjeta (`null` si no hay).
 * @param {HTMLElement} element
 * @returns {MediaCardEntry|null}
 */
export function getMediaCardEntry(element) {
  const controller = getMediaCardController(element);
  return controller ? controller.state.entry : null;
}

/**
 * Crea el controlador de una tarjeta: estado, DOM y callbacks.
 * @param {MediaCardItem|object} item
 * @param {MediaCardOptions} options
 * @param {Document} doc
 * @returns {object}
 */
function createMediaCardController(item, options, doc) {
  const opts = options && typeof options === "object" ? options : {};
  const state = {
    item: normalizeMediaItem(item),
    entry: normalizeMediaEntry(opts.entry),
    collections: normalizeCollections(opts.collections),
    selectedCollectionId:
      typeof opts.selectedCollectionId === "string" ? opts.selectedCollectionId : null,
    pending: false,
    error: null,
  };

  const model = () =>
    buildMediaCardModel(state.item, state.entry, {
      collections: state.collections,
      selectedCollectionId: state.selectedCollectionId,
      reason: opts.reason,
      scoreMatch: opts.scoreMatch,
    });

  cardSequence += 1;
  const titleId = `media-card-title-${state.item.id || "item"}-${cardSequence}`;

  // --- Raíz -------------------------------------------------
  const root = doc.createElement("article");
  root.className = "media-card";
  root.dataset.mediaId = state.item.id;
  if (state.item.mediaType) root.dataset.mediaType = state.item.mediaType;
  root.setAttribute("aria-labelledby", titleId);

  // --- Póster 2:3 + badge de tipo + badge de estado ---------
  const poster = createElement(doc, "div", "media-card__poster");
  const image = createElement(doc, "img", "media-card__poster-image");
  image.loading = "lazy";
  image.decoding = "async";
  const fallback = createElement(doc, "span", "media-card__poster-fallback");
  fallback.hidden = true;
  fallback.setAttribute("aria-hidden", "true");
  const typeBadge = createElement(doc, "span", "media-card__type-badge");
  const entryBadge = createElement(doc, "span", "media-card__entry-badge");
  entryBadge.hidden = true;

  image.addEventListener("error", () => {
    image.hidden = true;
    fallback.hidden = false;
  });

  poster.append(image, fallback, typeBadge, entryBadge);

  // --- Cuerpo ------------------------------------------------
  const body = createElement(doc, "div", "media-card__body");
  const title = createElement(doc, "h3", "media-card__title");
  title.id = titleId;

  const meta = createElement(doc, "p", "media-card__meta");
  const year = createElement(doc, "span", "media-card__year");
  const rating = createElement(doc, "span", "media-card__rating");
  const stars = createElement(doc, "span", "media-card__stars");
  const starsBg = createElement(doc, "span", "media-card__stars-bg", STAR_CHARACTER.repeat(STAR_COUNT));
  const starsFill = createElement(doc, "span", "media-card__stars-fill", STAR_CHARACTER.repeat(STAR_COUNT));
  const ratingValue = createElement(doc, "span", "media-card__rating-value");
  const personalScore = createElement(doc, "span", "media-card__personal-score");
  stars.setAttribute("role", "img");
  starsBg.setAttribute("aria-hidden", "true");
  starsFill.setAttribute("aria-hidden", "true");
  stars.append(starsBg, starsFill);
  rating.append(stars, ratingValue);

  const genres = createElement(doc, "ul", "media-card__genres");
  const creator = createElement(doc, "p", "media-card__creator");
  const reason = createElement(doc, "p", "media-card__reason");
  reason.hidden = true;

  meta.append(year, rating, personalScore);
  body.append(title, meta, genres, creator, reason);

  // --- Acciones (REQ-107) -----------------------------------
  const actions = createElement(doc, "div", "media-card__actions");
  actions.setAttribute("role", "group");

  const addButton = createElement(doc, "button", "media-card__btn media-card__btn--add");
  addButton.type = "button";
  addButton.dataset.action = "add";
  addButton.textContent = "Añadir";

  const statusSelect = doc.createElement("select");
  statusSelect.className = "media-card__select media-card__status";
  statusSelect.dataset.action = "status";

  const collectionSelect = doc.createElement("select");
  collectionSelect.className = "media-card__select media-card__collection";
  collectionSelect.dataset.action = "collection";

  const assignButton = createElement(doc, "button", "media-card__btn media-card__btn--assign");
  assignButton.type = "button";
  assignButton.dataset.action = "assign";
  assignButton.textContent = "Asignar a colección";

  actions.append(addButton, statusSelect, collectionSelect, assignButton);

  // --- Error inline (REQ-E2, UI-10 rollback) -----------------
  const error = createElement(doc, "p", "media-card__error");
  error.setAttribute("role", "alert");
  error.hidden = true;

  root.append(poster, body, actions, error);

  // -------------------------------------------------------------
  // Render
  // -------------------------------------------------------------

  /** Rellena las opciones del menú de estados (UI-10). */
  function renderStatusOptions(current) {
    const options = [];
    const noEntry = doc.createElement("option");
    noEntry.value = "";
    noEntry.textContent = NO_ENTRY_LABEL;
    options.push(noEntry);
    for (const status of ENTRY_STATUSES) {
      const option = doc.createElement("option");
      option.value = status;
      option.textContent = entryStatusLabel(status);
      options.push(option);
    }
    statusSelect.replaceChildren(...options);
    statusSelect.value = current ?? "";
  }

  /** Rellena las opciones del selector de colecciones (UI-14). */
  let collectionSignature = "";
  function renderCollectionOptions(current) {
    const signature = state.collections.map((collection) => `${collection.id}:${collection.name}`).join("|");
    if (signature !== collectionSignature) {
      collectionSignature = signature;
      const options = [];
      const none = doc.createElement("option");
      none.value = "";
      none.textContent = "Sin colección";
      options.push(none);
      for (const collection of state.collections) {
        const option = doc.createElement("option");
        option.value = collection.id;
        option.textContent = collection.name;
        options.push(option);
      }
      collectionSelect.replaceChildren(...options);
    }
    collectionSelect.value = current ?? "";
  }

  /** Pinta el estado actual de la tarjeta. */
  function render() {
    const data = model();

    // Póster.
    if (data.coverUrl) {
      if (image.getAttribute("src") !== data.coverUrl) image.setAttribute("src", data.coverUrl);
      image.hidden = false;
      fallback.hidden = true;
      image.setAttribute("alt", `Póster de «${data.title}»`);
    } else {
      image.removeAttribute("src");
      image.hidden = true;
      fallback.hidden = false;
    }
    fallback.textContent = data.initials;
    typeBadge.textContent = data.mediaTypeLabel;

    // Estado personal (AC-115, AC-117).
    if (data.entry) {
      entryBadge.hidden = false;
      entryBadge.textContent = data.entry.statusLabel;
      entryBadge.className = `media-card__entry-badge media-card__entry-badge--${data.entry.status.toLowerCase()}`;
      entryBadge.setAttribute("aria-label", `Estado: ${data.entry.statusLabel}`);
    } else {
      entryBadge.hidden = true;
      entryBadge.textContent = "";
    }

    // Título y meta.
    title.textContent = data.title;
    year.textContent = data.releaseYearLabel ?? "";
    year.hidden = data.releaseYearLabel === null;

    if (data.avgRatingLabel === null) {
      rating.hidden = true;
      rating.removeAttribute("aria-label");
    } else {
      rating.hidden = false;
      rating.setAttribute("aria-label", data.avgRatingAriaLabel);
      stars.setAttribute("aria-label", data.avgRatingAriaLabel);
      starsFill.style.setProperty("--fill", `${data.starFillPercent}%`);
      ratingValue.textContent = data.avgRatingLabel;
    }

    if (data.entry && data.entry.scoreLabel) {
      personalScore.hidden = false;
      personalScore.textContent = `Tu nota: ${data.entry.scoreLabel}`;
      personalScore.setAttribute("aria-label", data.entry.scoreAriaLabel);
    } else {
      personalScore.hidden = true;
      personalScore.textContent = "";
      personalScore.removeAttribute("aria-label");
    }

    // Géneros: ≤2 etiquetas + "+N" (UI-01).
    const genreNodes = [];
    for (const label of data.genres.visible) {
      genreNodes.push(createElement(doc, "li", "media-card__genre", label));
    }
    if (data.genres.overflow > 0) {
      const more = createElement(doc, "li", "media-card__genre media-card__genre--more", `+${data.genres.overflow}`);
      more.setAttribute("aria-label", `${data.genres.overflow} géneros más`);
      more.title = `${data.genres.overflow} géneros más`;
      genreNodes.push(more);
    }
    genres.replaceChildren(...genreNodes);
    genres.hidden = genreNodes.length === 0;
    genres.setAttribute("aria-label", `Géneros de «${data.title}»`);

    // Creador.
    creator.textContent = data.creatorText ?? "";
    creator.hidden = data.creatorText === null;

    // Motivo de recomendación (UI-30, opcional).
    if (data.reason) {
      reason.hidden = false;
      reason.textContent = data.reason;
    } else {
      reason.hidden = true;
      reason.textContent = "";
    }

    // Acciones.
    actions.setAttribute("aria-label", data.actionsAriaLabel);
    addButton.setAttribute("aria-label", data.addAriaLabel);
    statusSelect.setAttribute("aria-label", data.statusAriaLabel);
    collectionSelect.setAttribute("aria-label", data.collectionAriaLabel);
    assignButton.setAttribute("aria-label", data.assignAriaLabel);
    addButton.disabled = state.pending || data.entry !== null;
    statusSelect.disabled = state.pending;
    collectionSelect.disabled = state.pending;
    assignButton.disabled = state.pending || state.collections.length === 0;

    renderStatusOptions(data.entry ? data.entry.status : "");
    renderCollectionOptions(state.selectedCollectionId ?? "");

    // Error inline.
    if (state.error) {
      error.hidden = false;
      error.textContent = state.error;
    } else {
      error.hidden = true;
      error.textContent = "";
    }

    root.setAttribute("aria-busy", state.pending ? "true" : "false");
  }

  // -------------------------------------------------------------
  // Acciones (REQ-107, UI-10)
  // -------------------------------------------------------------

  /**
   * Ejecuta una acción con actualización optimista y rollback si el
   * `Result` devuelto es fallido (UI-10).
   * @param {MediaCardEntry|null|undefined} nextEntry entry optimista (`undefined` ⇒ no cambia)
   * @param {MediaCardCallback|undefined} callback
   * @param {MediaCardContext} context
   * @returns {Promise<MediaCardResult|void|null>}
   */
  async function runAction(nextEntry, callback, context) {
    const previousEntry = state.entry;
    const changed = nextEntry !== undefined && nextEntry !== previousEntry;
    if (changed) state.entry = nextEntry;
    state.error = null;
    state.pending = true;
    render();

    let result = null;
    try {
      result = typeof callback === "function" ? await callback(context) : undefined;
      if (result && result.ok === false) {
        if (changed) state.entry = previousEntry;
        state.error = result.message || DEFAULT_ERROR_MESSAGE;
        return result;
      }
      if (result && result.ok === true && result.value !== undefined && result.value !== null) {
        const confirmed = normalizeMediaEntry(result.value);
        if (confirmed) state.entry = confirmed;
      }
      return result;
    } catch (error) {
      if (changed) state.entry = previousEntry;
      state.error = (error && error.message) || DEFAULT_ERROR_MESSAGE;
      return null;
    } finally {
      state.pending = false;
      render();
      if (state.entry !== previousEntry && typeof opts.onEntryChange === "function") {
        opts.onEntryChange({ item: state.item, entry: state.entry, card: root, action: context.action });
      }
    }
  }

  addButton.addEventListener("click", () => {
    if (state.pending) return;
    const nextEntry = {
      mediaId: state.item.id,
      status: DEFAULT_ENTRY_STATUS,
      score: state.entry ? state.entry.score : null,
    };
    void runAction(nextEntry, opts.onAdd, {
      item: state.item,
      entry: nextEntry,
      previousEntry: state.entry,
      card: root,
      action: "add",
    });
  });

  statusSelect.addEventListener("change", () => {
    if (state.pending) return;
    const value = statusSelect.value;
    const previousEntry = state.entry;
    const nextEntry =
      value === ""
        ? null
        : {
            mediaId: state.item.id,
            status: value,
            score: previousEntry ? previousEntry.score : null,
          };
    void runAction(nextEntry, opts.onStatusChange, {
      item: state.item,
      entry: nextEntry,
      previousEntry,
      status: value === "" ? null : value,
      card: root,
      action: "status",
    });
  });

  collectionSelect.addEventListener("change", () => {
    state.selectedCollectionId = collectionSelect.value === "" ? null : collectionSelect.value;
  });

  assignButton.addEventListener("click", () => {
    if (state.pending) return;
    const collectionId = collectionSelect.value;
    if (!collectionId) {
      state.error = "Selecciona una colección para asignarla.";
      render();
      return;
    }
    void runAction(undefined, opts.onAssignCollection, {
      item: state.item,
      entry: state.entry,
      collectionId,
      card: root,
      action: "assign",
    });
  });

  const controller = {
    element: root,
    state,
    /** Actualiza estado y vuelve a pintar. */
    update(patch = {}) {
      if (patch && Object.prototype.hasOwnProperty.call(patch, "entry")) {
        state.entry = normalizeMediaEntry(patch.entry);
      }
      if (patch && Object.prototype.hasOwnProperty.call(patch, "collections")) {
        state.collections = normalizeCollections(patch.collections);
      }
      if (patch && Object.prototype.hasOwnProperty.call(patch, "selectedCollectionId")) {
        state.selectedCollectionId =
          typeof patch.selectedCollectionId === "string" ? patch.selectedCollectionId : null;
      }
      render();
    },
  };

  CONTROLLERS.set(root, controller);
  render();
  return controller;
}

export default createMediaCard;
