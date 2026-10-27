// =============================================================
// DOM rendering. This module does not talk to Firebase nor to the
// external APIs: it receives ready-made data and returns HTML,
// or fires callbacks that app.js wires with db.js / TMDB.
// =============================================================

import { todayISO, formatDateEs } from "./dates.js";
import { STATUS_LABELS } from "./constants.js";
import { totalPlayHours } from "./game-log.js";
import { steamHoursLabel } from "./api-steam.js";
import { getNextEpisodeAirInfo, isItemUnreleased } from "./sorting.js";
import { normalizeEntry, computeEpisodeAverageRating } from "./tv-progress.js";
import { trapFocus } from "./focus-utils.js";
import { unreleasedConfirmMessage, isUnreleasedDate, episodeUnreleasedMessage } from "./release.js";
import { counterFieldLabel, counterBadgeText, sanitizeSeenCount, naturalTimes } from "./counter.js";

function scopeFor(type) {
  return type === "book" ? "book" : type === "game" ? "game" : "media";
}

export function statusLabel(status, type) {
  const scope = scopeFor(type);
  return STATUS_LABELS[scope][status] || status;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// HTML for a community score badge (TMDB, IGDB for video games).
// Compact variant (--sm) for episode rows (issue #45).
function communityRatingValueHtml(value, label = "TMDB") {
  const val = Number(value).toFixed(1);
  return `<span class="community-rating community-rating--sm">
    <span class="community-rating__label">${label}</span>
    <span class="community-rating__value">${val}</span>
  </span>`;
}

// HTML for the community score (TMDB) on compact cards.
// Returns an empty string when there is no data (takes no space in
// the grid).
function communityRatingHtml(item) {
  if (item.communityRating == null) return "";
  const label = item.type === "game" ? "IGDB" : "TMDB";
  return communityRatingValueHtml(item.communityRating, label).replace(
    "community-rating community-rating--sm",
    "community-rating"
  );
}

// For modals: it always shows one line, either the real score or
// a "Sin puntuaciones" indicator when there is no TMDB/IGDB data.
function communityRatingDisplay(item) {
  const label = item.type === "game" ? "IGDB" : "TMDB";
  if (item.communityRating != null) {
    const val = Number(item.communityRating).toFixed(1);
    return `<div class="modal-detail__ratings">
      <span class="community-rating">
        <span class="community-rating__label">${label}</span>
        <span class="community-rating__value">${val}</span>
      </span>
    </div>`;
  }
  return `<div class="modal-detail__ratings">
    <span class="community-rating community-rating--empty">Sin puntuaciones</span>
  </div>`;
}

// HTML for the YouTube trailer button.
// Returns an empty string when no trailer URL is available.
function trailerButtonHtml(item) {
  if (!item.trailerUrl) return "";
  return `<a href="${escapeHtml(item.trailerUrl)}" target="_blank" rel="noopener noreferrer" class="trailer-btn" aria-label="Ver tráiler en YouTube">
    <span class="trailer-btn__icon" aria-hidden="true">▶</span>
    <span class="trailer-btn__label">Tráiler</span>
  </a>`;
}

function typeLabel(type) {
  if (type === "movie") return "Película";
  if (type === "tv") return "Serie";
  if (type === "game") return "Videojuego";
  return "Libro";
}

export const PLACEHOLDER_COVER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='300'><rect width='100%' height='100%' fill='#e3dac4'/><text x='50%' y='50%' font-family='sans-serif' font-size='16' fill='#948a76' text-anchor='middle'>Sin imagen</text></svg>`
  );

/* ---------- Screens ---------- */

// Placeholder of the global search bar (issue #46): on entry it
// shows "Personal Tracker" and after 3.5 s it switches to the default
// placeholder. The timer is cleared on logout. The default
// placeholder no longer mentions friends: the search is scoped to
// the section (issue #206) and only restores in the access screen.
export const DEFAULT_SEARCH_PLACEHOLDER = "Buscar películas, series, libros y videojuegos...";
const SEARCH_BRAND_PLACEHOLDER = "Personal Tracker";
const SEARCH_PLACEHOLDER_SWITCH_MS = 3500;
let searchPlaceholderTimer = null;

// Placeholder and aria-label depending on the active section (issue #206): the
// top search is scoped to the section (Ocio / Perfil / Recetas).
const SEARCH_PLACEHOLDER_BY_SECTION = {
  ocio: "Buscar películas, series, libros y videojuegos...",
  perfil: "Buscar amigos...",
  recetas: "Buscar recetas...",
  gimnasio: "Buscar en tu gimnasio...",
};
const SEARCH_ARIA_BY_SECTION = {
  ocio: "Buscar en tu registro de ocio",
  perfil: "Buscar en tus amigos",
  recetas: "Buscar en tus recetas",
  gimnasio: "Buscar en tu registro de gimnasio",
};
let currentSearchSection = "ocio";

// Changes the bar's placeholder when navigating sections (called by
// the onRoute of app.js). It cuts the animated welcome placeholder:
// if the user switches section during the 3.5 s, the section's one
// shows immediately.
export function setSearchSection(section) {
  currentSearchSection = SEARCH_PLACEHOLDER_BY_SECTION[section] ? section : "ocio";
  const searchInput = getGlobalSearchInput();
  if (!searchInput) return;
  clearTimeout(searchPlaceholderTimer);
  searchPlaceholderTimer = null;
  searchInput.placeholder = SEARCH_PLACEHOLDER_BY_SECTION[currentSearchSection];
  searchInput.setAttribute("aria-label", SEARCH_ARIA_BY_SECTION[currentSearchSection]);
}

function getGlobalSearchInput() {
  return document.getElementById("global-search-input");
}

export function showAuthScreen() {
  // On exit: stop the placeholder sequence and restore the normal one
  clearTimeout(searchPlaceholderTimer);
  searchPlaceholderTimer = null;
  const searchInput = getGlobalSearchInput();
  if (searchInput) searchInput.placeholder = DEFAULT_SEARCH_PLACEHOLDER;

  document.getElementById("auth-screen").classList.remove("hidden");
  document.getElementById("app").classList.add("hidden");
  // Global header (issue #206): only visible while signed in
  document.getElementById("app-header")?.classList.add("hidden");
}

export function showApp(user) {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  // Global header visible in every section (issue #206)
  document.getElementById("app-header")?.classList.remove("hidden");
  document.getElementById("user-avatar").src = user.photoURL || PLACEHOLDER_COVER;

  // Animated placeholder: "Personal Tracker" → section placeholder
  const searchInput = getGlobalSearchInput();
  if (searchInput) {
    clearTimeout(searchPlaceholderTimer);
    searchInput.placeholder = SEARCH_BRAND_PLACEHOLDER;
    searchInput.setAttribute("aria-label", SEARCH_ARIA_BY_SECTION[currentSearchSection]);
    searchPlaceholderTimer = setTimeout(() => {
      searchInput.placeholder = SEARCH_PLACEHOLDER_BY_SECTION[currentSearchSection];
      searchPlaceholderTimer = null;
    }, SEARCH_PLACEHOLDER_SWITCH_MS);
  }
}

export function setAuthError(message) {
  const el = document.getElementById("auth-error");
  if (!message) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = message;
  el.classList.remove("hidden");
}

/* ---------- Preview of search results (issue #22) ---------- */

// Shows the information of a search result in the detail modal,
// as if it were already added to the collection. The "añadir"
// button delegates to onAdd (which returns true when the add
// succeeded, so the caller closes the modal). If onEnrich is
// passed, the extended details (duration, cast, synopsis, rating,
// trailer) are loaded without re-rendering the modal structure. If
// onClose is passed, it is invoked instead of closing the modal
// from the "Cerrar" button, the ✕ button, the backdrop and
// Escape key (the saga movie preview uses it, issue #280, to
// restore the detail view being seen).
export function openSearchPreviewModal(item, { added = false, onAdd = null, onEnrich = null, onClose = null } = {}) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");
  const metaLine =
    item.type === "book"
      ? [item.author, item.year, item.pages ? `${item.pages} págs.` : null].filter(Boolean).join(" · ")
      : [typeLabel(item.type), item.year].filter(Boolean).join(" · ");
  const editionsNote =
    item.type === "book" && item.editionsCount > 1
      ? `<p class="book-confirm__editions">${item.editionsCount} ediciones — al añadir podrás elegir portada</p>`
      : "";
  const isBook = item.type === "book";

  content.innerHTML = `
    <div class="modal-detail__header">
      <img class="modal-detail__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div>
        <h3 class="modal-detail__title">${escapeHtml(item.title)}</h3>
        <div class="modal-detail__meta">${escapeHtml(metaLine)}</div>
      </div>
    </div>
    ${editionsNote}
    <div id="preview-details">
      ${gamePlatformsHtml(item)}
      ${extraInfoHtml(item)}
      ${previewPagesHtml(item)}
      ${previewSeasonsHtml(item)}
      ${onEnrich ? `<p class="extra-info__line" id="preview-loading">Cargando detalles…</p>` : ""}
    </div>
    ${isBook ? "" : `${communityRatingDisplay(item)}${trailerButtonHtml(item)}`}
    <div class="modal-actions">
      <button class="btn btn--outline" id="btn-preview-close">Cerrar</button>
      <button class="btn ${isBook ? "btn--accent-books" : "btn--accent-media"}"
              id="btn-preview-add" ${added ? "disabled" : ""}>
        ${added ? "Ya añadido" : "añadir"}
      </button>
    </div>
  `;

  content.querySelector("#btn-preview-close").addEventListener("click", () => {
    if (onClose) onClose();
    else closeModal();
  });

  const addBtn = content.querySelector("#btn-preview-add");
  if (onAdd && !added) {
    addBtn.addEventListener("click", () => onAdd(item, addBtn));
  }

  // Standard opening pattern of the project. The custom close
  // (onClose) is stored in the modal so the backdrop, the ✕ and
  // Escape respect it the same as the "Cerrar" button (issue #280, QA D3).
  modal._onClose = onClose || null;
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));

  if (onEnrich) {
    const previewDetailsEl = content.querySelector("#preview-details");
    const loadingHint = content.querySelector("#preview-loading");

    (async () => {
      let details;
      try {
        details = await onEnrich(item);
      } catch (err) {
        // Network/API failure: we do not block the preview
      }
      // The loading hint is always removed (success or failure)
      if (loadingHint) loadingHint.remove();

      // Guards: the modal may have been closed or re-rendered meanwhile
      if (!previewDetailsEl.isConnected || modal.classList.contains("hidden")) return;
      if (!details) return;

      const prevRating = item.communityRating;
      const hadTrailer = Boolean(item.trailerUrl);
      Object.assign(item, details);

      // Only the details block is re-rendered, not the structure
      previewDetailsEl.innerHTML = gamePlatformsHtml(item) + extraInfoHtml(item) + previewPagesHtml(item) + previewSeasonsHtml(item);

      // If a new community rating or trailer arrived, refresh those
      // blocks (they may not exist: e.g. books)
      if (details.communityRating !== undefined && details.communityRating !== prevRating) {
        const ratingsEl = content.querySelector(".modal-detail__ratings");
        if (ratingsEl) ratingsEl.outerHTML = communityRatingDisplay(item);
      }
      if (details.trailerUrl && !hadTrailer) {
        const trailerEl = content.querySelector(".trailer-btn");
        if (trailerEl) {
          trailerEl.outerHTML = trailerButtonHtml(item);
        } else {
          // Search results never carry trailerUrl, so the button does not
// exist in the initial render: insert it before the modal actions
          const actions = content.querySelector(".modal-actions");
          if (actions) actions.insertAdjacentHTML("beforebegin", trailerButtonHtml(item));
        }
      }
    })();
  }
}

/* ---------- Biblioteca personal: grid y lista ---------- */

function progressLine(item) {
  if (item.type === "movie") {
    const log = item.watchLog || [];
    if (!log.length) return "";
    const last = log[log.length - 1];
    return `Vista el ${formatDateEs(last)}${log.length > 1 ? ` · ×${log.length}` : ""}`;
  }
  if (item.type === "tv") {
    if (item.status === "standby") return "En pausa";
    if (item.status === "abandonado") return "Abandonada";
    if (item.status === "completado") {
      const times = (item.timesCompleted || 0) + 1;
      return `Completa${times > 1 ? ` · ×${times}` : ""} · ${formatDateEs(item.lastWatchedAt)}`;
    }
    if (item.nextEpisode) {
      return `Siguiente: T${item.nextEpisode.season}E${item.nextEpisode.episode}`;
    }
    return "";
  }
  if (item.type === "book") {
    if (item.status === "standby") return "En pausa";
    if (item.status === "abandonado") return "Abandonado";
    const log = item.readLog || [];
    if (!log.length) return "";
    const last = log[log.length - 1];
    if (!last.finishedAt) return `Leyendo desde ${formatDateEs(last.startedAt)}`;
    const times = log.filter((e) => e.finishedAt).length;
    return `Leído el ${formatDateEs(last.finishedAt)}${times > 1 ? ` · ×${times}` : ""}`;
  }
  if (item.type === "game") {
    if (item.status === "standby") return "En pausa";
    if (item.status === "abandonado") return "Abandonado";
    const log = item.playLog || [];
    if (!log.length) return "";
    const last = log[log.length - 1];
    if (!last.finishedAt) return `Jugando desde ${formatDateEs(last.startedAt)}`;
    const times = log.filter((e) => e.finishedAt).length;
    return `Jugado el ${formatDateEs(last.finishedAt)}${times > 1 ? ` · ×${times}` : ""}`;
  }
  return "";
}

function metaLineFor(item) {
  return item.type === "book"
    ? [item.author, item.year].filter(Boolean).join(" · ")
    : [typeLabel(item.type), item.year].filter(Boolean).join(" · ");
}

// Short label of the quick action button (list mode and swipe).
function quickActionLabel(item) {
  if (item.type === "movie") return "Vista ✓";
  if (item.type === "tv") {
    if (!item.nextEpisode) return "Completa ✓";
    return `Ver T${item.nextEpisode.season}E${item.nextEpisode.episode}`;
  }
  if (item.type === "game") {
    const log = item.playLog || [];
    const isPlaying = log.length && !log[log.length - 1].finishedAt;
    if (isPlaying) return "Terminar ✓";
    if (log.length) return "Rejugar ↺";
    return "Empezar ✓";
  }
  const log = item.readLog || [];
  const isReading = log.length && !log[log.length - 1].finishedAt;
  if (isReading) return "Terminar ✓";
  if (log.length) return "Releer ↺";
  return "Empezar ✓";
}

function upcomingBadge(item) {
  if (!isItemUnreleased(item)) return "";
  const cls = "item-card__upcoming item-card__upcoming--unreleased";
  if (item.type === "movie") {
    return `<div class="${cls}">Aún no estrenada${item.releaseDate ? ` · ${formatDateEs(item.releaseDate)}` : ""}</div>`;
  }
  if (item.awaitingRelease && item.nextEpisode) { // show not yet released (premiere)
    return `<div class="${cls}">Aún no estrenada${item.firstAirDate ? ` · ${formatDateEs(item.firstAirDate)}` : ""}</div>`;
  }
  // Ongoing show with the next episode not yet released. isItemUnreleased
  // guarantees there is info, but for safety if there is none it is
  // not painted.
  const info = getNextEpisodeAirInfo(item);
  if (!info) return "";
  return `<div class="${cls}">Aún no estrenado · T${info.season}E${info.episode}${info.airDate ? ` · ${formatDateEs(info.airDate)}` : ""}</div>`;
}

function renderGrid(gridEl, items, onOpen) {
  gridEl.className = "library-grid";
  gridEl.innerHTML = items
    .map((item, index) => {
      const stars = ratingStarsHtml(item.rating);
      const communityBadge = communityRatingHtml(item);
      const hasRatings = stars || communityBadge;
      const progress = progressLine(item);
      const counterBadge = counterBadgeText(item);
      const blockedClass = isItemUnreleased(item) ? " item-card--unreleased" : "";
      return `
      <article class="item-card item-card--${item.status}${blockedClass}">
        <div class="item-card__cover-wrap">
          <img class="item-card__cover" loading="lazy"
               src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
          <span class="item-card__stamp item-card__stamp--${item.status}">
            ${statusLabel(item.status, item.type)}
          </span>
        </div>
        <div class="item-card__perforation"></div>
        <div class="item-card__body">
          ${upcomingBadge(item)}
          <div class="item-card__title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          <div class="item-card__meta" title="${escapeHtml(metaLineFor(item))}">${escapeHtml(metaLineFor(item))}</div>
          ${progress ? `<div class="item-card__progress">${escapeHtml(progress)}</div>` : ""}
          ${counterBadge ? `<div class="item-card__counter">${counterBadge}</div>` : ""}
          ${hasRatings ? `<div class="item-card__ratings">
            ${stars ? `<span class="item-card__rating">${stars}</span>` : ""}
            ${communityBadge}
          </div>` : ""}
        </div>
        <button class="item-card__btn" data-index="${index}"
                title="${escapeHtml(item.title)} — ${escapeHtml(metaLineFor(item))}"
                aria-label="Ver detalles de ${escapeHtml(item.title)}"></button>
      </article>`;
    })
    .join("");

  gridEl.querySelectorAll("button[data-index]").forEach((btn) => {
    btn.addEventListener("click", () => onOpen(items[Number(btn.dataset.index)]));
  });
}

function attachSwipe(row, content, onTrigger) {
  let startX = 0;
  let startY = 0;
  let deltaX = 0;
  let dragging = false;
  let lock = null; // null | 'vertical' | 'horizontal'
  let startTouchId = null;
  const lockThreshold = 10; // slop de decisión de dirección
  const threshold = 70;

  row.addEventListener(
    "touchstart",
    (e) => {
      const touch = e.changedTouches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startTouchId = touch.identifier;
      dragging = true;
      row.classList.add("is-dragging");
    },
    { passive: true }
  );

  row.addEventListener(
    "touchmove",
    (e) => {
      if (!dragging) return;
      // Follow the original finger by identifier (fallback to the first)
      const touch =
        Array.from(e.touches).find((t) => t.identifier === startTouchId) ||
        e.touches[0];
      deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      // Axis lock: when crossing the slop the axis is decided and not turned
      // back. A tie wins 'vertical' (the scroll always rules).
      if (
        lock === null &&
        (Math.abs(deltaX) >= lockThreshold || Math.abs(deltaY) >= lockThreshold)
      ) {
        lock = Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
      }
      if (lock === "vertical") return; // scroll gesture: no transform nor toggle
      if (lock === "horizontal") {
        const clamped = Math.max(-120, Math.min(120, deltaX));
        content.style.transform = `translateX(${clamped}px)`;
        row.classList.toggle("swipe-reveal", Math.abs(clamped) > 24);
      }
    },
    { passive: true }
  );

  const resetGesture = () => {
    dragging = false;
    row.classList.remove("is-dragging", "swipe-reveal");
    content.style.transform = "";
    lock = null;
    startTouchId = null;
    deltaX = 0;
  };

  row.addEventListener("touchend", () => {
    // Evaluate before resetGesture(): it resets the lock and deltaX
    const shouldTrigger = lock !== "vertical" && Math.abs(deltaX) > threshold;
    resetGesture();
    if (shouldTrigger) onTrigger();
  });

  row.addEventListener("touchcancel", () => {
    resetGesture();
  });
}

function renderList(gridEl, items, { onOpen, onQuickAction }) {
  gridEl.className = "library-list";
  gridEl.innerHTML = items
    .map((item, index) => {
      const progress = progressLine(item);
      const counterBadge = counterBadgeText(item);
      const blockedClass = isItemUnreleased(item) ? " list-row--unreleased" : "";
      return `
      <div class="list-row list-row--${item.status}${blockedClass}" data-index="${index}">
        <div class="list-row__swipe-bg">✓ ${escapeHtml(quickActionLabel(item))}</div>
        <div class="list-row__content">
          <button class="list-row__open" data-index="${index}"
                  aria-label="Ver detalles de ${escapeHtml(item.title)}">
            <img class="list-row__cover" loading="lazy"
                 src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
            <div class="list-row__info">
              <div class="list-row__title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
              <div class="list-row__meta" title="${escapeHtml(metaLineFor(item))}">${escapeHtml(metaLineFor(item))}</div>
              ${progress ? `<div class="list-row__progress">${escapeHtml(progress)}</div>` : ""}
              ${counterBadge ? `<span class="item-card__counter">${counterBadge}</span>` : ""}
              ${upcomingBadge(item)}
            </div>
            <span class="item-card__stamp item-card__stamp--${item.status} list-row__stamp">
              ${statusLabel(item.status, item.type)}
            </span>
          </button>
          <button class="list-row__action" data-index="${index}">
            ${escapeHtml(quickActionLabel(item))}
          </button>
        </div>
      </div>`;
    })
    .join("");

  gridEl.querySelectorAll(".list-row__open").forEach((btn) => {
    btn.addEventListener("click", () => onOpen(items[Number(btn.dataset.index)]));
  });
  gridEl.querySelectorAll(".list-row__action").forEach((btn) => {
    btn.addEventListener("click", () => onQuickAction(items[Number(btn.dataset.index)], btn));
  });
  gridEl.querySelectorAll(".list-row").forEach((row) => {
    const content = row.querySelector(".list-row__content");
    const item = items[Number(row.dataset.index)];
    attachSwipe(row, content, () => onQuickAction(item, null));
  });
}

export function renderLibrary(gridEl, emptyEl, items, viewMode, { onOpen, onQuickAction }) {
  if (!items.length) {
    gridEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  if (viewMode === "list") {
    renderList(gridEl, items, { onOpen, onQuickAction });
  } else {
    renderGrid(gridEl, items, onOpen);
  }
}

/* ---------- Campos comunes ---------- */

// Normalizes a rating to 0.5 steps (0, 0.5, 1, ... 5). The pickers
// accept half stars (issue #276), so every entry point goes through
// here to sanitize external values.
function normalizeRating(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  const half = Math.round(v * 2) / 2;
  if (half < 0) return 0;
  if (half > 5) return 5;
  return half;
}

// Accessible label of a picker button for value N (1-5).
function ratingButtonAriaLabel(n) {
  return n === 1 ? "1 estrella" : `${n} estrellas`;
}

// Informational HTML of an item's stars (cards and read-only
// detail view). Half stars show as «½» after the full ones
// (e.g. 2.5) issue #276.
export function ratingStarsHtml(rating) {
  const v = normalizeRating(rating);
  if (!v) return "";
  const full = "...".repeat(Math.floor(v));
  return v % 1 === 0 ? full : full + "";
}

// HTML of the star picker (1-5, with halves since issue #276).
// idPrefix avoids duplicate ids when several pickers are on screen
// at once (e.g. the pop-up rating window's one, which uses
// "rm-rating"). A value like 2.5 paints «is-active» on 1-2 and the
// half star on button 3 (is-half class).
export function ratingPickerHtml(rating, idPrefix = "field-rating", extraHtml = "") {
  const value = normalizeRating(rating);
  return `
    <div class="field-group">
      <label>Valoración</label>
      <div class="rating-picker" id="${idPrefix}">
        ${[1, 2, 3, 4, 5]
          .map((n) => {
            const full = value >= n;
            const half = value === n - 0.5;
            return `<button type="button" data-value="${n}" class="${
              full ? "is-active" : ""
            }${half ? " is-half" : ""}" aria-label="${
              half ? `${String(n - 0.5).replace(".", ",")} estrellas` : ratingButtonAriaLabel(n)
            }">${half ? "½" : n}</button>`;
          })
          .join("")}
      </div>
      ${extraHtml}
    </div>`;
}

// Average rating of the rated episodes of the show (issue #80).
// No average: hidden span (placeholder updateEpisodeAverage updates).
function episodeAverageHtml(watched, idPrefix) {
  const avg = computeEpisodeAverageRating(watched);
  if (!avg) {
    return `<span class="episode-average" id="${idPrefix}-episode-average" hidden></span>`;
  }
  const ratedLabel = avg.count === 1 ? "1 episodio valorado" : `${avg.count} episodios valorados`;
  return `<span class="episode-average" id="${idPrefix}-episode-average" title="Media de ${ratedLabel}">Media episodios: <strong>${avg.average.toFixed(1)}</strong></span>`;
}

function notesFieldHtml(notes) {
  return `
    <div class="field-group">
      <label for="field-notes">Notas</label>
      <textarea id="field-notes" placeholder="Impresiones...">${escapeHtml(notes || "")}</textarea>
    </div>`;
}

// Wiring of the picker with half stars (issue #276). Press cycle
// on the same button N: 1st press → N; 2nd press → N−0.5;
// 3rd press → 0 (clear the rating, as before). Returns a getter
// with the selected value (0 or a multiple of 0.5 between 0.5 and 5).
export function wireRatingAndGetValue(content, initialRating, idPrefix = "field-rating") {
  let selectedRating = normalizeRating(initialRating);
  const buttons = content.querySelectorAll(`#${idPrefix} button`);
  const repaint = () => {
    buttons.forEach((b) => {
      const n = Number(b.dataset.value);
      const full = selectedRating >= n;
      const half = selectedRating === n - 0.5;
      b.classList.toggle("is-active", full && !half);
      b.classList.toggle("is-half", half);
      b.textContent = half ? "½" : n;
      b.setAttribute(
        "aria-label",
        half ? `${String(n - 0.5).replace(".", ",")} estrellas` : ratingButtonAriaLabel(n)
      );
    });
  };
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = Number(btn.dataset.value);
      if (selectedRating === value) selectedRating = value - 0.5;
      else if (selectedRating === value - 0.5) selectedRating = 0;
      else selectedRating = value;
      repaint();
    });
  });
  repaint();
  return () => selectedRating;
}

// Pause / abandon / resume buttons, shared by shows and books.
function renderStatusActions(status) {
  if (status === "completado") return "";
  const buttons = [];
  if (status !== "standby") {
    buttons.push(
      `<button type="button" class="btn btn--small btn--outline" id="btn-status-standby">En pausa</button>`
    );
  }
  if (status !== "abandonado") {
    buttons.push(
      `<button type="button" class="btn btn--small btn--danger" id="btn-status-abandon">Abandonar</button>`
    );
  }
  if (status === "standby" || status === "abandonado") {
    buttons.push(
      `<button type="button" class="btn btn--small btn--primary" id="btn-status-resume">Retomar</button>`
    );
  }
  return `<div class="status-actions">${buttons.join("")}</div>`;
}

function renderStandbyBanner(status, extraText, abandonLabel = "Abandonado/a") {
  if (status !== "standby" && status !== "abandonado") return "";
  const label = status === "standby" ? "En pausa" : abandonLabel;
  return `<div class="standby-banner"><span>${label}${
    extraText ? " · " + escapeHtml(extraText) : ""
  } — tu progreso se conserva.</span></div>`;
}

function wireStatusActions(content, handleStatusChange) {
  const standbyBtn = content.querySelector("#btn-status-standby");
  if (standbyBtn) {
    standbyBtn.addEventListener("click", () => handleStatusChange("standby"));
  }
  const abandonBtn = content.querySelector("#btn-status-abandon");
  if (abandonBtn) {
    abandonBtn.addEventListener("click", () => {
      if (!window.confirm("¿Marcar como abandonado? No se perderá tu progreso.")) return;
      handleStatusChange("abandonado");
    });
  }
  const resumeBtn = content.querySelector("#btn-status-resume");
  if (resumeBtn) {
    resumeBtn.addEventListener("click", () => handleStatusChange(null));
  }
}

// Extended TMDB info (duration, genre, director/creators,
// cast, synopsis) or from the books source (synopsis). Not all
// fields are always available, so each line is optional.
function extraInfoHtml(item) {
  const lines = [];
  const metaBits = [];
  if (item.runtime) metaBits.push(`${item.runtime} min`);
  if (item.episodeRuntime) metaBits.push(`~${item.episodeRuntime} min/episodio`);
  if (item.genres && item.genres.length) metaBits.push(item.genres.join(", "));
  if (metaBits.length) lines.push(`<p class="extra-info__line">${escapeHtml(metaBits.join(" · "))}</p>`);
  if (item.director) {
    lines.push(`<p class="extra-info__line"><strong>Director:</strong> ${escapeHtml(item.director)}</p>`);
  }
  if (item.creators && item.creators.length) {
    lines.push(
      `<p class="extra-info__line"><strong>Creador${item.creators.length > 1 ? "es" : ""}:</strong> ${escapeHtml(
        item.creators.join(", ")
      )}</p>`
    );
  }
  if (item.cast && item.cast.length) {
    lines.push(`<p class="extra-info__line"><strong>Reparto:</strong> ${escapeHtml(item.cast.join(", "))}</p>`);
  }
  if (item.type === "game") {
    if (item.developers && item.developers.length) {
      lines.push(
        `<p class="extra-info__line"><strong>Desarrollador${item.developers.length > 1 ? "es" : ""}:</strong> ${escapeHtml(
          item.developers.join(", ")
        )}</p>`
      );
    }
    if (item.metacritic != null) {
      lines.push(`<p class="extra-info__line"><strong>Metacritic:</strong> ${escapeHtml(item.metacritic)}</p>`);
    }
    if (item.playtime) {
      lines.push(`<p class="extra-info__line"><strong>Duración media:</strong> ~${escapeHtml(item.playtime)} horas</p>`);
    }
    if (item.esrbName) {
      lines.push(`<p class="extra-info__line"><strong>Clasificación:</strong> ${escapeHtml(item.esrbName)}</p>`);
    }
  }
  const overview = item.overview || item.description;
  if (overview) lines.push(`<p class="extra-info__overview">${escapeHtml(overview)}</p>`);
  if (!lines.length) return detailStatusHtml(item);
  return `<div class="extra-info">${lines.join("")}</div>`;
}

// State of the on-demand detail (issue #200): if the
// document stores only the card (minimal storage) and the detail
// is still loading — or the network failed — an informative line
// is shown instead of an empty block (graceful degradation to
// «card only»).
// Books keep the synopsis in the document and manual items have no
// API to query: they never apply.

function detailStatusHtml(item) {
  if (item._detailsFailed) {
    return `<p class="extra-info__loading">No se pudieron cargar los detalles (revisa tu conexión).</p>`;
  }
  if (!item.manual && item.externalId) {
    if ((item.type === "movie" || item.type === "tv") && !item.overview) {
      return `<p class="extra-info__loading">Cargando detalles…</p>`;
    }
    if (item.type === "game" && !item.description) {
      return `<p class="extra-info__loading">Cargando detalles…</p>`;
    }
  }
  return "";
}

// Seasons block for a show's preview: read-only list (episode
// count and air date per season) plus the total. Empty when there
// is no data (missing or empty seasonsMeta).
function previewSeasonsHtml(item) {
  const seasons = item.seasonsMeta;
  if (!seasons || !seasons.length) return "";
  const rows = seasons.map((s) => {
    const name = s.name || `Temporada ${s.seasonNumber}`;
    const count = s.episodeCount || 0;
    const episodes = `${count} episodio${count === 1 ? "" : "s"}`;
    const airDate = s.airDate ? ` · ${formatDateEs(s.airDate)}` : "";
    return `<li class="preview-seasons__row">${escapeHtml(name)} · ${episodes}${airDate}</li>`;
  });
  const totalEpisodes = seasons.reduce((sum, s) => sum + (s.episodeCount || 0), 0);
  return `
    <div class="preview-seasons">
      <h4 class="preview-seasons__title">Temporadas</h4>
      <ul class="preview-seasons__list">
        ${rows.join("")}
      </ul>
      <p class="preview-seasons__total">${seasons.length} temporada${seasons.length === 1 ? "" : "s"} · ${totalEpisodes} episodio${totalEpisodes === 1 ? "" : "s"}</p>
    </div>
  `;
}

// Pages line of a book for the preview. item.pages arrives as a
// number from the API (pageCount || null); empty when absent.
function previewPagesHtml(item) {
  if (!item.pages) return "";
  return `<p class="extra-info__line"><strong>Páginas:</strong> ${item.pages}</p>`;
}

function editButtonHtml() {
  return `<button type="button" class="btn btn--small btn--outline edit-info-btn" id="btn-edit-item">✎ Editar información</button>`;
}

/* ---------- Add / edit of basic information ---------- */

function itemFormFields(type, values) {
  const isBook = type === "book";
  return `
    <div class="field-group">
      <label for="form-title">Título *</label>
      <input type="text" id="form-title" required value="${escapeHtml(values.title || "")}" />
    </div>
    ${
      isBook
        ? `<div class="field-group">
            <label for="form-author">Autor</label>
            <input type="text" id="form-author" value="${escapeHtml(values.author || "")}" />
          </div>`
        : ""
    }
    <div class="field-group">
      <label for="form-year">Año</label>
      <input type="number" id="form-year" min="0" max="2100" value="${escapeHtml(values.year || "")}" />
    </div>
    ${
      isBook
        ? `<div class="field-group">
            <label for="form-pages">Páginas</label>
            <input type="number" id="form-pages" min="0" value="${values.pages || ""}" />
          </div>`
        : ""
    }
    <div class="field-group">
      <label for="form-cover">URL de portada (opcional)</label>
      <input type="url" id="form-cover" placeholder="https://..." value="${escapeHtml(values.coverUrl || "")}" />
    </div>
  `;
}

export function openEditModal(item, { onSave, onCancel }) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");

  content.innerHTML = `
    <h3 class="modal-detail__title" style="margin-bottom:1rem">Editar información</h3>
    <form id="edit-form" class="manual-form">
      ${itemFormFields(item.type, item)}
      <div class="field-group">
        <label for="form-seen-count">${counterFieldLabel(item.type)}</label>
        <input id="form-seen-count" class="manual-input" inputmode="numeric"
               placeholder="${naturalTimes(item) || "0"}"
               value="${item.seenCount != null ? item.seenCount : (naturalTimes(item) || "")}" />
        <p class="field-hint">${item.type === "tv" ? "":"¿"}Cada sesión/visionado ya suma 1: esta caja sirve para corregirlo a mano (vacía = cuenta lo registrado).</p>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn--outline" id="btn-edit-cancel">Cancelar</button>
        <button type="submit" class="btn btn--primary">Guardar cambios</button>
      </div>
    </form>
  `;

  content.querySelector("#edit-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = content.querySelector("#form-title").value.trim();
    if (!title) return;
    const changes = {
      title,
      year: content.querySelector("#form-year").value || "",
      coverUrl: content.querySelector("#form-cover").value.trim() || null,
    };
    if (item.type === "book") {
      changes.author = content.querySelector("#form-author").value.trim();
      const pagesRaw = content.querySelector("#form-pages").value;
      changes.pages = pagesRaw ? Number(pagesRaw) : null;
    }
    const seenRaw = sanitizeSeenCount(content.querySelector("#form-seen-count").value);
    // If the typed value matches what is already in the logs,
    // nothing is recorded (the automatic count stays).
    changes.seenCount = seenRaw === naturalTimes(item) ? null : seenRaw;
    onSave(changes);
  });

  content.querySelector("#btn-edit-cancel").addEventListener("click", onCancel);

  // Record previous focus and trap
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
}

export function openManualAddModal(type, onSubmit) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");

  const titleText =
    type === "book"
      ? "añadir libro manualmente"
      : type === "tv"
      ? "añadir serie manualmente"
      : type === "game"
      ? "añadir videojuego manualmente"
      : "añadir película manualmente";

  content.innerHTML = `
    <h3 class="modal-detail__title" style="margin-bottom:1rem">${titleText}</h3>
    <form id="manual-form" class="manual-form">
      ${itemFormFields(type, {})}
      ${
        type === "tv"
          ? `<div class="field-group">
              <label for="manual-episodes">Número de episodios</label>
              <input type="number" id="manual-episodes" min="1" value="10" />
            </div>
            <p class="log-empty">
              Se asume una sola temporada con ese número de episodios.
            </p>`
          : ""
      }
      <div class="modal-actions">
        <button type="button" class="btn btn--outline" id="btn-manual-cancel">Cancelar</button>
        <button type="submit" class="btn btn--primary">añadir</button>
      </div>
    </form>
  `;

  content.querySelector("#manual-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const title = content.querySelector("#form-title").value.trim();
    if (!title) return;

    const draft = {
      title,
      year: content.querySelector("#form-year").value || "",
      coverUrl: content.querySelector("#form-cover").value.trim() || null,
    };
    if (type === "book") {
      draft.author = content.querySelector("#form-author").value.trim();
      const pagesRaw = content.querySelector("#form-pages").value;
      draft.pages = pagesRaw ? Number(pagesRaw) : null;
    }
    if (type === "tv") {
      draft.episodeCount = Number(content.querySelector("#manual-episodes").value) || 1;
    }
    onSubmit(draft);
  });

  content.querySelector("#btn-manual-cancel").addEventListener("click", closeModal);

  // Record previous focus and trap
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
}

/* ---------- Streaming platforms (watch providers) ---------- */

function providersGroupHtml(providers, label) {
  if (!providers || !providers.length) return "";
  return `
    <div class="watch-providers__group">
      <span class="watch-providers__type-label">${label}</span>
      <div class="watch-providers__logos">
        ${providers
          .map(
            (p) => `
          <span class="watch-provider" title="${escapeHtml(p.providerName)}">
            ${p.logoUrl
              ? `<img class="watch-provider__logo" src="${escapeHtml(p.logoUrl)}" alt="${escapeHtml(p.providerName)}" loading="lazy" />`
              : ""
            }
            <span class="watch-provider__name">${escapeHtml(p.providerName)}</span>
          </span>`
          )
          .join("")}
      </div>
    </div>`;
}

function watchProvidersHtml(item) {
  const wp = item.watchProviders;
  if (!wp) return "";
  const hasAny = (wp.flatrate && wp.flatrate.length) ||
                 (wp.rent && wp.rent.length) ||
                 (wp.buy && wp.buy.length);
  if (!hasAny) {
    return `<div class="watch-providers watch-providers--empty">
      <span class="watch-providers__title">Sin info. de streaming para este país</span>
    </div>`;
  }
  return `
    <div class="watch-providers">
      <span class="watch-providers__title">Disponible en:</span>
      ${providersGroupHtml(wp.flatrate, "Streaming")}
      ${providersGroupHtml(wp.rent, "Alquiler")}
      ${providersGroupHtml(wp.buy, "Compra")}
      ${wp.link ? `<a class="watch-providers__link" href="${escapeHtml(wp.link)}" target="_blank" rel="noopener">Ver opciones en TMDB</a>` : ""}
    </div>`;
}

// Chips with the playable platforms of a video game (IGDB), so
// they show as tags and not as plain text. Returns an empty string
// when there are no platforms (takes no space in the modal).
function gamePlatformsHtml(item) {
  if (!item.platforms || !item.platforms.length) return "";
  return `
    <div class="game-platforms">
      <span class="game-platforms__title">Plataformas:</span>
      <ul class="game-platforms__list">
        ${item.platforms
          .map((p) => `<li class="game-platform">${escapeHtml(p)}</li>`)
          .join("")}
      </ul>
    </div>`;
}

/* ---------- Recommendations (similar content) ---------- */

/**
 * Generates the HTML of the recommendations section.
 * @param {Array}  items       - Recommended items [{externalId, type, title, year, coverUrl}]
 * @param {Set}    existingIds - Set of already added externalIds to disable buttons
 * @param {string} group       - "movie" or "tv" (for button classes)
 * @param {boolean} interactive - true if "añadir" buttons must be shown
 * @param {Function} [onOpen]  - when a function, each card becomes a
 *                               pressable button calling onOpen(rec)
 *                               to open the extended preview of
 *                               that recommendation before adding it
 *                               (issue #280, iteration)
 * @returns {string} HTML of the recommendations block, or empty string
 */
function renderRecommendations(items, existingIds, group, interactive, onOpen) {
  if (!items || !items.length) return "";
  const accentClass = "btn--accent-media";
  const cardsHtml = items
    .map((rec, index) => {
      const added = existingIds.has(rec.externalId);
      const btnHtml = interactive
        ? `<button class="btn btn--small ${accentClass} rec-card__add" data-rec-index="${index}" ${added ? "disabled" : ""}>
             ${added ? "añadido" : "añadir"}
           </button>`
        : "";
      if (typeof onOpen === "function") {
        // Pressable card (issue #280, iteration): same mechanics as the
        // saga cards — the .rec-card__open button wraps the cover and
        // text (phrasing content, which is why .rec-card__body is a
        // span), and the "añadir" button stays as a sibling, anchored
        // at the bottom by the flex: 1 of the open button.
        return `
        <div class="rec-card rec-card--openable" data-rec-index="${index}">
          <button type="button" class="rec-card__open" data-rec-index="${index}"
                  aria-label="Ver información de ${escapeHtml(rec.title)}">
            <img class="rec-card__cover" src="${rec.coverUrl || PLACEHOLDER_COVER}" alt="" loading="lazy" />
            <span class="rec-card__body">
              <span class="rec-card__title">${escapeHtml(rec.title)}</span>
              <span class="rec-card__year">${escapeHtml(rec.year || "")}</span>
              <span class="rec-card__hint">Ver información</span>
            </span>
          </button>
          ${btnHtml}
        </div>`;
      }
      return `
        <div class="rec-card" data-rec-index="${index}">
          <img class="rec-card__cover" src="${rec.coverUrl || PLACEHOLDER_COVER}" alt="" loading="lazy" />
          <div class="rec-card__body">
            <div class="rec-card__title">${escapeHtml(rec.title)}</div>
            <div class="rec-card__year">${escapeHtml(rec.year || "")}</div>
            ${btnHtml}
          </div>
        </div>`;
    })
    .join("");

  return `
    <div class="recommendations">
      <h4 class="recommendations__title">Si te gustó esto, quizá te guste...</h4>
      <div class="recommendations__scroll">
        ${cardsHtml}
      </div>
    </div>`;
}

/**
 * Generates the HTML of the «Otras películas de la saga» section
 * (issue #280): the movies of the collection/saga the open item
 * belongs to, in cards with the same look as the recommendations.
 * It reuses the card classes of renderRecommendations
 * (.rec-card, .recommendations__scroll); the button uses
 * .saga-card__add (own class, different from .rec-card__add, so it
 * does not interfere with the recommendations wiring).
 * @param {Array}  sagaParts   - [{externalId, title, year, posterUrl}]
 * @param {Set}    existingIds - Set of already added externalIds
 * @param {boolean} interactive - true if "añadir" buttons are shown
 * @param {Function} [onOpen]  - when a function, each card becomes a
 *                               pressable button calling onOpen(movie)
 *                               to open the preview of that movie
 *                               before adding it (issue #280)
 * @returns {string} HTML of the section, or empty string
 */
function renderSagaMovies(sagaParts, existingIds, interactive, onOpen) {
  if (!sagaParts || !sagaParts.length) return "";
  const cardsHtml = sagaParts
    .map((m, index) => {
      const added = existingIds.has(String(m.externalId));
      const btnHtml = interactive
        ? `<button class="btn btn--small btn--accent-media saga-card__add" data-saga-index="${index}" ${added ? "disabled" : ""}>
             ${added ? "añadida" : "añadir"}
           </button>`
        : "";
      if (typeof onOpen === "function") {
        // Pressable card: the .saga-card__open button wraps the cover
        // and text (phrasing content, which is why .rec-card__body is a
        // span), and the "añadir" button stays as a sibling, anchored
        // at the bottom by the flex: 1 of the open button (issue #280, iteration).
        return `
        <div class="rec-card saga-card" data-saga-index="${index}">
          <button type="button" class="saga-card__open" data-saga-index="${index}"
                  aria-label="Ver información de ${escapeHtml(m.title)}">
            <img class="rec-card__cover" src="${m.posterUrl || PLACEHOLDER_COVER}" alt="" loading="lazy" />
            <span class="rec-card__body">
              <span class="rec-card__title">${escapeHtml(m.title)}</span>
              <span class="rec-card__year">${escapeHtml(m.year || "")}</span>
              <span class="saga-card__hint">Ver información</span>
            </span>
          </button>
          ${btnHtml}
        </div>`;
      }
      return `
        <div class="rec-card saga-card" data-saga-index="${index}">
          <img class="rec-card__cover" src="${m.posterUrl || PLACEHOLDER_COVER}" alt="" loading="lazy" />
          <div class="rec-card__body">
            <div class="rec-card__title">${escapeHtml(m.title)}</div>
            <div class="rec-card__year">${escapeHtml(m.year || "")}</div>
            ${btnHtml}
          </div>
        </div>`;
    })
    .join("");

  return `
    <div class="saga-movies">
      <h4 class="saga-movies__title">Otras películas de la saga</h4>
      <div class="recommendations__scroll">
        ${cardsHtml}
      </div>
    </div>`;
}

/* ---------- Detail modal: movies ---------- */

function renderWatchLogRows(watchLog) {
  if (!watchLog || !watchLog.length) {
    return `<p class="log-empty">Aún no la has visto.</p>`;
  }
  return `<div class="log-list">
    ${watchLog
      .map(
        (date, index) => `
        <div class="log-row">
          <input type="date" class="watch-date" data-index="${index}" value="${date}" />
          <button type="button" class="btn btn--small btn--danger watch-remove" data-index="${index}">Quitar</button>
        </div>`
      )
      .join("")}
  </div>`;
}

export function openMovieModal(item, callbacks, recommendations = [], existingIds = new Set(), sagaParts = null) {
  const { onAddWatch, onUpdateWatch, onRemoveWatch, onSaveMeta, onDelete, onEdit, onAddSaga, onAddRecommendation, onAddSagaMovie, onOpenSagaMovie, onOpenRecommendation } = callbacks;
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");
  const metaLine = [typeLabel(item.type), item.year].filter(Boolean).join(" · ");

  content.innerHTML = `
    <div class="modal-detail__header">
      <img class="modal-detail__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div>
        <h3 class="modal-detail__title">${escapeHtml(item.title)}</h3>
        <div class="modal-detail__meta">${escapeHtml(metaLine)}</div>
      </div>
    </div>
    ${editButtonHtml()}

    ${upcomingBadge(item)}
    ${communityRatingDisplay(item)}
    ${trailerButtonHtml(item)}
    ${watchProvidersHtml(item)}
    ${extraInfoHtml(item)}

    ${item.collectionId ? `
    <div class="saga-banner">
      <span class="saga-banner__label"><strong>Saga:</strong> ${escapeHtml(item.collectionName)}</span>
      <button type="button" class="btn btn--small btn--accent-media" id="btn-add-saga">añadir resto de la saga</button>
    </div>
    ${renderSagaMovies(sagaParts, existingIds, !!onAddSagaMovie, onOpenSagaMovie)}` : ""}

    ${renderRecommendations(recommendations, existingIds, "movie", !!onAddRecommendation, onOpenRecommendation)}

    <div class="field-group">
      <label>Visionados</label>
      ${renderWatchLogRows(item.watchLog)}
      <div class="log-add-row">
        <input type="date" id="field-new-watch-date" value="${todayISO()}" />
        <button type="button" class="btn btn--small btn--accent-media" id="btn-add-watch">
          ${item.watchLog && item.watchLog.length ? "añadir otro visionado" : "Marcar como vista"}
        </button>
      </div>
    </div>

    ${ratingPickerHtml(item.rating)}
    ${notesFieldHtml(item.notes)}

    <div class="modal-actions">
      <button class="btn btn--danger" id="btn-delete-item">Eliminar</button>
      <button class="btn btn--primary" id="btn-save-item">Guardar</button>
    </div>
  `;

  const getRating = wireRatingAndGetValue(content, item.rating);
  // Propagates all the arguments on re-render (issue #280): after
  // marking as watched, the saga section (and the recommendations)
  // stays, and the "añadida" button is kept thanks to the shared
  // existingIds Set.
  const rerender = () => openMovieModal(item, callbacks, recommendations, existingIds, sagaParts);

  content.querySelector("#btn-edit-item").addEventListener("click", () => onEdit());

  const addSagaBtn = content.querySelector("#btn-add-saga");
  if (addSagaBtn) {
    addSagaBtn.addEventListener("click", () => {
      if (onAddSaga) onAddSaga();
    });
  }

  // Wire recommendation "añadir" buttons
  if (onAddRecommendation) {
    content.querySelectorAll(".rec-card__add").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.recIndex);
        const recItem = recommendations[index];
        if (recItem) onAddRecommendation(recItem, btn);
      });
    });
  }

  // Wire saga "añadir" buttons (issue #280). Own class
  // .saga-card__add so it does not interfere with the recommendations.
  if (onAddSagaMovie) {
    content.querySelectorAll(".saga-card__add").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.sagaIndex);
        const movie = sagaParts[index];
        if (movie) onAddSagaMovie(movie, btn);
      });
    });
  }

  // Wire saga card open preview (issue #280, iteration): pressing
  // the card shows the movie's information before adding it.
  if (onOpenSagaMovie) {
    content.querySelectorAll(".saga-card__open").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.sagaIndex);
        const movie = sagaParts[index];
        if (movie) onOpenSagaMovie(movie);
      });
    });
  }

  // Wire recommendation card open preview (issue #280, iteration):
  // pressing the recommendation card also shows the extended
  // information before adding it, same as the saga cards.
  if (onOpenRecommendation) {
    content.querySelectorAll(".rec-card__open").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.recIndex);
        const recItem = recommendations[index];
        if (recItem) onOpenRecommendation(recItem);
      });
    });
  }

  content.querySelector("#btn-add-watch").addEventListener("click", async () => {
    const dateVal = content.querySelector("#field-new-watch-date").value;
    if (!dateVal) return;
    const confirmMsg = unreleasedConfirmMessage(item);
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    await onAddWatch(dateVal);
    rerender();
  });

  content.querySelectorAll(".watch-date").forEach((input) => {
    input.addEventListener("change", async () => {
      if (!input.value) return;
      await onUpdateWatch(Number(input.dataset.index), input.value);
      rerender();
    });
  });

  content.querySelectorAll(".watch-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("¿Quitar este visionado del historial?")) return;
      await onRemoveWatch(Number(btn.dataset.index));
      rerender();
    });
  });

  content.querySelector("#btn-save-item").addEventListener("click", () => {
    onSaveMeta({
      rating: getRating() || null,
      notes: content.querySelector("#field-notes").value.trim(),
    });
  });

  content.querySelector("#btn-delete-item").addEventListener("click", () => {
    onDelete();
  });

  // Record previous focus and trap
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
}

/* ---------- Modal selector de sagas ---------- */

// Shows a modal with a checklist of the movies of a saga so the
// user selects which ones to add to their record.
export function openSagaSelectionModal(collectionName, movies, callbacks) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");

  function renderList() {
    return movies.map((m, i) => `
      <label class="saga-row" data-index="${i}">
        <input type="checkbox" class="saga-checkbox" data-index="${i}" checked />
        <img class="saga-row__cover" src="${m.posterUrl || PLACEHOLDER_COVER}" alt="" loading="lazy" />
        <span class="saga-row__title">${escapeHtml(m.title)}</span>
        <span class="saga-row__year">${escapeHtml(m.year || "")}</span>
      </label>
    `).join("");
  }

  content.innerHTML = `
    <h3 class="modal-detail__title" style="margin-bottom:0.3rem">${escapeHtml(collectionName)}</h3>
    <p class="saga-subtitle">Selecciona las películas que quieras añadir:</p>
    <div class="saga-list" id="saga-list">
      ${renderList()}
    </div>
    <p class="saga-count" id="saga-count">Seleccionadas: ${movies.length}/${movies.length}</p>
    <div class="modal-actions">
      <button type="button" class="btn btn--outline" id="btn-saga-cancel">Cancelar</button>
      <button type="button" class="btn btn--accent-media" id="btn-saga-confirm">añadir seleccionadas</button>
    </div>
  `;

  function allSelected() {
    return content.querySelectorAll(".saga-checkbox:checked").length;
  }

  content.querySelectorAll(".saga-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => {
      content.querySelector("#saga-count").textContent =
        `Seleccionadas: ${allSelected()}/${movies.length}`;
    });
  });

  content.querySelector("#btn-saga-cancel").addEventListener("click", () => {
    callbacks.onCancel();
  });

  content.querySelector("#btn-saga-confirm").addEventListener("click", () => {
    const selectedIndices = [];
    content.querySelectorAll(".saga-checkbox:checked").forEach((cb) => {
      selectedIndices.push(Number(cb.dataset.index));
    });
    if (!selectedIndices.length) {
      showToast("Selecciona al menos una película.");
      return;
    }
    callbacks.onConfirm(selectedIndices.map((i) => movies[i]));
  });

  // Record previous focus and trap
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
}

/* ---------- Detail modal: books ---------- */

function renderReadLogRows(readLog) {
  if (!readLog || !readLog.length) {
    return `<p class="log-empty">Aún no has empezado a leerlo.</p>`;
  }
  return `<div class="log-list">
    ${readLog
      .map(
        (entry, index) => `
        <div class="log-row">
          <input type="date" class="read-start" data-index="${index}" value="${entry.startedAt}" />
          <span class="log-row__arrow">→</span>
          ${
            entry.finishedAt
              ? `<input type="date" class="read-finish" data-index="${index}" value="${entry.finishedAt}" />`
              : `<span class="log-row__reading">leyendo</span>`
          }
          <button type="button" class="btn btn--small btn--danger read-remove" data-index="${index}">Quitar</button>
        </div>`
      )
      .join("")}
  </div>`;
}

// Play session history of a video game (mirror of the read
// history, with its own semantics; issue #47).
function renderPlayLogRows(playLog) {
  if (!playLog || !playLog.length) {
    return `<p class="log-empty">Aún no has empezado a jugarlo.</p>`;
  }
  return `<div class="log-list">
    ${playLog
      .map(
        (entry, index) => `
        <div class="log-row">
          <input type="date" class="play-start" data-index="${index}" value="${entry.startedAt}" />
          <span class="log-row__arrow">→</span>
          ${
            entry.finishedAt
              ? `<input type="date" class="play-finish" data-index="${index}" value="${entry.finishedAt}" />`
              : `<span class="log-row__playing">jugando</span>`
          }
          <input type="number" class="play-hours" data-index="${index}" value="${entry.hours ?? ""}" min="0" step="0.5" placeholder="h" aria-label="Horas" />
          <button type="button" class="btn btn--small btn--danger play-remove" data-index="${index}">Quitar</button>
        </div>`
      )
      .join("")}
  </div>`;
}

export function openBookModal(item, callbacks) {
  const {
    onStartReading,
    onFinishReading,
    onUpdateEntry,
    onRemoveEntry,
    onSetStatus,
    onSaveMeta,
    onDelete,
    onEdit,
  } = callbacks;
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");
  const metaLine = [item.author, item.year].filter(Boolean).join(" · ");
  const isReading =
    item.readLog && item.readLog.length && !item.readLog[item.readLog.length - 1].finishedAt;

  content.innerHTML = `
    <div class="modal-detail__header">
      <img class="modal-detail__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div>
        <h3 class="modal-detail__title">${escapeHtml(item.title)}</h3>
        <div class="modal-detail__meta">${escapeHtml(metaLine)}</div>
      </div>
    </div>
    ${editButtonHtml()}

    ${extraInfoHtml(item)}

    ${renderStandbyBanner(item.status, item.progress ? `página ${item.progress}` : "")}
    ${renderStatusActions(item.status)}

    <div class="field-group">
      <label>Lecturas</label>
      ${renderReadLogRows(item.readLog)}
      <div class="log-add-row">
        <input type="date" id="field-log-date" value="${todayISO()}" />
        <button type="button" class="btn btn--small btn--accent-books" id="btn-log-action">
          ${isReading ? "Terminar de leer" : "Empezar a leer"}
        </button>
      </div>
    </div>

    <div class="field-group">
      <label for="field-progress">Página actual</label>
      <input type="number" min="0" id="field-progress" value="${item.progress ?? ""}" />
    </div>

    ${ratingPickerHtml(item.rating)}
    ${notesFieldHtml(item.notes)}

    <div class="modal-actions">
      <button class="btn btn--danger" id="btn-delete-item">Eliminar</button>
      <button class="btn btn--primary" id="btn-save-item">Guardar</button>
    </div>
  `;

  const getRating = wireRatingAndGetValue(content, item.rating);
  const rerender = () => openBookModal(item, callbacks);

  content.querySelector("#btn-edit-item").addEventListener("click", () => onEdit());

  content.querySelector("#btn-log-action").addEventListener("click", async () => {
    const dateVal = content.querySelector("#field-log-date").value;
    if (!dateVal) return;
    if (isReading) await onFinishReading(dateVal);
    else await onStartReading(dateVal);
    rerender();
  });

  content.querySelectorAll(".read-start").forEach((input) => {
    input.addEventListener("change", async () => {
      if (!input.value) return;
      await onUpdateEntry(Number(input.dataset.index), { startedAt: input.value });
      rerender();
    });
  });

  content.querySelectorAll(".read-finish").forEach((input) => {
    input.addEventListener("change", async () => {
      if (!input.value) return;
      await onUpdateEntry(Number(input.dataset.index), { finishedAt: input.value });
      rerender();
    });
  });

  content.querySelectorAll(".read-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("¿Quitar esta lectura del historial?")) return;
      await onRemoveEntry(Number(btn.dataset.index));
      rerender();
    });
  });

  wireStatusActions(content, async (newStatusOrNull) => {
    await onSetStatus(newStatusOrNull);
    rerender();
  });

  content.querySelector("#btn-save-item").addEventListener("click", () => {
    const raw = content.querySelector("#field-progress").value;
    onSaveMeta({
      rating: getRating() || null,
      notes: content.querySelector("#field-notes").value.trim(),
      progress: raw === "" ? null : Number(raw),
    });
  });

  content.querySelector("#btn-delete-item").addEventListener("click", () => {
    onDelete();
  });

  // Record previous focus and trap
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
}

/* ---------- Detail modal: video games (play sessions) ---------- */

export function openGameModal(item, callbacks) {
  const {
    onStartPlay,
    onFinishPlay,
    onUpdateEntry,
    onRemoveEntry,
    onSetStatus,
    onSaveMeta,
    onDelete,
    onEdit,
  } = callbacks;
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");
  const metaLine = [typeLabel(item.type), item.year].filter(Boolean).join(" · ");
  const isPlaying =
    item.playLog && item.playLog.length && !item.playLog[item.playLog.length - 1].finishedAt;
  // Played hours in the detail view (ADR-111): the total of the
  // sessions; the line only shows when there are hours to show
  // (pure + tested).
  const hoursLabel = steamHoursLabel(totalPlayHours(item));

  content.innerHTML = `
    <div class="modal-detail__header">
      <img class="modal-detail__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div>
        <h3 class="modal-detail__title">${escapeHtml(item.title)}</h3>
        <div class="modal-detail__meta">${escapeHtml(metaLine)}</div>
        ${hoursLabel ? `<div class="modal-detail__meta modal-detail__hours"><strong>${escapeHtml(hoursLabel)}</strong> jugadas</div>` : ""}
      </div>
    </div>
    ${editButtonHtml()}

    ${communityRatingDisplay(item)}
    ${trailerButtonHtml(item)}
    ${gamePlatformsHtml(item)}
    ${extraInfoHtml(item)}

    ${renderStandbyBanner(item.status, "", "Abandonado")}
    ${renderStatusActions(item.status)}

    <div class="field-group">
      <label>Sesiones de juego</label>
      ${renderPlayLogRows(item.playLog)}
      <div class="log-add-row">
        <input type="date" id="field-log-date" value="${todayISO()}" />
        <button type="button" class="btn btn--small btn--accent-games" id="btn-log-action">
          ${isPlaying ? "Terminar partida" : "Empezar partida"}
        </button>
      </div>
    </div>

    ${ratingPickerHtml(item.rating)}
    ${notesFieldHtml(item.notes)}

    <div class="modal-actions">
      <button class="btn btn--danger" id="btn-delete-item">Eliminar</button>
      <button class="btn btn--primary" id="btn-save-item">Guardar</button>
    </div>
  `;

  const getRating = wireRatingAndGetValue(content, item.rating);
  const rerender = () => openGameModal(item, callbacks);

  content.querySelector("#btn-edit-item").addEventListener("click", () => onEdit());

  content.querySelector("#btn-log-action").addEventListener("click", async () => {
    const dateVal = content.querySelector("#field-log-date").value;
    if (!dateVal) return;
    if (isPlaying) await onFinishPlay(dateVal);
    else await onStartPlay(dateVal);
    rerender();
  });

  content.querySelectorAll(".play-start").forEach((input) => {
    input.addEventListener("change", async () => {
      if (!input.value) return;
      await onUpdateEntry(Number(input.dataset.index), { startedAt: input.value });
      rerender();
    });
  });

  content.querySelectorAll(".play-finish").forEach((input) => {
    input.addEventListener("change", async () => {
      if (!input.value) return;
      await onUpdateEntry(Number(input.dataset.index), { finishedAt: input.value });
      rerender();
    });
  });

  // Hours of a session: empty is persisted as null (never undefined,
  // Firestore throws with updateDoc), invalid values are ignored and
  // the rest are rounded to 1 decimal (issue #174).
  content.querySelectorAll(".play-hours").forEach((input) => {
    input.addEventListener("change", async () => {
      const value = input.value;
      if (value === "") {
        await onUpdateEntry(Number(input.dataset.index), { hours: null });
        rerender();
        return;
      }
      const h = Number(value);
      if (!Number.isFinite(h) || h < 0) return;
      const rounded = Math.round(h * 10) / 10;
      await onUpdateEntry(Number(input.dataset.index), { hours: rounded });
      rerender();
    });
  });

  content.querySelectorAll(".play-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("¿Quitar esta sesión del historial?")) return;
      await onRemoveEntry(Number(btn.dataset.index));
      rerender();
    });
  });

  wireStatusActions(content, async (newStatusOrNull) => {
    await onSetStatus(newStatusOrNull);
    rerender();
  });

  content.querySelector("#btn-save-item").addEventListener("click", () => {
    onSaveMeta({
      rating: getRating() || null,
      notes: content.querySelector("#field-notes").value.trim(),
    });
  });

  content.querySelector("#btn-delete-item").addEventListener("click", () => {
    onDelete();
  });

  // Record previous focus and trap
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
}

/* ---------- Detail modal: shows (seasons and episodes) ---------- */

// Syncs the VISUAL state of an episode row with its actual entry
// (normalized or null) in item.watched: checkbox, is-watched class,
// date, row 2 (meta), counter and stars (issue #133/#136).
function applyEpisodeRowState(row, entry) {
  const checked = Boolean(entry && entry.date);
  const times = checked ? Math.max(1, Number(entry.times) || 1) : 0;
  const checkbox = row.querySelector(".episode-checkbox");
  const visual = row.querySelector(".episode-checkbox-visual");
  const dateInput = row.querySelector(".episode-date");
  const meta = row.querySelector(".episode-row__meta");
  const ratingWrap = row.querySelector(".episode-rating");
  checkbox.checked = checked;
  row.classList.toggle("is-watched", checked);
  dateInput.disabled = !checked;
  dateInput.value = checked ? entry.date : "";
  meta.classList.toggle("hidden", !checked);
  if (times > 1) visual.setAttribute("data-count", String(times));
  else visual.removeAttribute("data-count");
  ratingWrap.querySelectorAll(".episode-rating__star").forEach((s) => {
    const n = Number(s.dataset.value);
    const value = normalizeRating(checked ? entry.rating : 0);
    const full = value >= n;
    const half = value === n - 0.5;
    s.classList.toggle("is-active", full && !half);
    s.classList.toggle("is-half", half);
    s.textContent = half ? "½" : "★";
    s.setAttribute(
      "aria-label",
      half ? `${String(n - 0.5).replace(".", ",")} estrellas` : ratingButtonAriaLabel(n)
    );
  });
}

function renderSeasonBlock(s, watched) {
  const seasonWatched = (watched && watched[String(s.seasonNumber)]) || {};
  const watchedCount = Object.keys(seasonWatched).length;
  const allWatched = watchedCount >= s.episodeCount && s.episodeCount > 0;
  return `
    <div class="season-block" data-season="${s.seasonNumber}" data-episode-count="${s.episodeCount}">
      <div class="season-header">
        <button class="season-toggle" data-season="${s.seasonNumber}">
          <span class="season-chevron">▸</span>
          <span class="season-name">${escapeHtml(s.name)}</span>
          <span class="season-count">${watchedCount}/${s.episodeCount}</span>
        </button>
        <button class="btn btn--small season-mark-all" data-season="${s.seasonNumber}"
                data-all-watched="${allWatched ? "0" : "1"}">
          ${allWatched ? "Desmarcar todo" : "Marcar todo"}
        </button>
      </div>
      <div class="season-episodes hidden" data-season-episodes="${s.seasonNumber}"></div>
    </div>`;
}

// manual=true (manual shows): episodes are not marked as
// "unreleased" because they have no real TMDB dates.
function renderEpisodeRows(episodes, seasonWatched, { manual = false } = {}) {
  return episodes
    .map((e) => {
      const entry = normalizeEntry(seasonWatched[String(e.episodeNumber)]);
      const date = entry ? entry.date : "";
      const rating = entry ? entry.rating : null;
      const checked = Boolean(date);
      const times = checked ? Math.max(1, Number(entry.times) || 1) : 0;
      const future = !manual && isUnreleasedDate(e.airDate);
      // TMDB score badge: only on automatic shows and when the episode
      // has votes (episodeRating != null). Manual shows do not carry it.
      const communityBadge =
        !manual && e.episodeRating != null
          ? communityRatingValueHtml(e.episodeRating)
          : "";
      return `
      <div class="episode-row ${checked ? "is-watched" : ""}" data-episode="${e.episodeNumber}"
           data-air-date="${e.airDate || ""}" data-episode-name="${escapeHtml(e.name)}">
        <div class="episode-row__main">
          <label class="episode-checkbox-wrap">
            <input type="checkbox" class="episode-checkbox" ${checked ? "checked" : ""}
                   aria-label="${
                     checked
                       ? `E${e.episodeNumber} — ${escapeHtml(e.name)}: visto ${times} ${times === 1 ? "vez" : "veces"}. Pulsa para verlo de nuevo o desmarcarlo`
                       : `Marcar E${e.episodeNumber} — ${escapeHtml(e.name)} como visto`
                   }" />
            <span class="episode-checkbox-visual" aria-hidden="true"
                  ${times > 1 ? `data-count="${times}"` : ""}></span>
          </label>
          <span class="episode-row__num" aria-hidden="true">E${e.episodeNumber}</span>
          <span class="episode-row__name">${escapeHtml(e.name)}${
        future
          ? ` <em class="episode-row__future">${
              e.airDate ? `(sin estrenar · ${formatDateEs(e.airDate)})` : "(sin estrenar)"
            }</em>`
          : ""
      }</span>
          ${communityBadge}
        </div>
        <div class="episode-row__meta ${checked ? "" : "hidden"}">
          <div class="episode-rating">
            ${[1, 2, 3, 4, 5]
              .map((n) => {
                const value = normalizeRating(rating);
                const full = value >= n;
                const half = value === n - 0.5;
                return `<button type="button" class="episode-rating__star ${
                  full ? "is-active" : ""
                }${half ? " is-half" : ""}" data-value="${n}" aria-label="${
                  half ? `${String(n - 0.5).replace(".", ",")} estrellas` : ratingButtonAriaLabel(n)
                }">${half ? "½" : "★"}</button>`;
              })
              .join("")}
          </div>
          <input type="date" class="episode-date" value="${date}" ${checked ? "" : "disabled"} />
        </div>
      </div>`;
    })
    .join("");
}

export function openTvModal(item, seasonsMeta, progress, callbacks, recommendations = [], existingIds = new Set()) {
  const {
    onExpandSeason,
    onSetEpisodeDate,
    onSetEpisodeSeenAgain,
    onSetEpisodeRating,
    onToggleSeason,
    onRewatch,
    onSetStatus,
    onSaveMeta,
    onDelete,
    onEdit,
    onAddRecommendation,
    onUpdateNextEpisodeAirDate,
    onOpenRecommendation,
  } = callbacks;

  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");

  const nextLine = progress.nextEpisode
    ? `Siguiente: T${progress.nextEpisode.season}E${progress.nextEpisode.episode}`
    : "¡Serie completada!";
  const pct = progress.totalEpisodes
    ? Math.round((progress.totalWatched / progress.totalEpisodes) * 100)
    : 0;
  const times = (item.timesCompleted || 0) + (item.status === "completado" ? 1 : 0);

  content.innerHTML = `
    <div class="modal-detail__header">
      <img class="modal-detail__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div>
        <h3 class="modal-detail__title">${escapeHtml(item.title)}</h3>
        <div class="modal-detail__meta">${escapeHtml(item.year || "")}</div>
      </div>
    </div>
    ${editButtonHtml()}

    ${upcomingBadge(item)}
    ${communityRatingDisplay(item)}
    ${trailerButtonHtml(item)}
    ${watchProvidersHtml(item)}
    ${extraInfoHtml(item)}

    ${renderRecommendations(recommendations, existingIds, "tv", !!onAddRecommendation, onOpenRecommendation)}

    <div class="progress-banner">
      <span class="next-line">${nextLine}</span>
      <div class="progress-bar-track">
        <div class="progress-bar-fill" style="width:${pct}%"></div>
      </div>
      <span class="progress-count">${progress.totalWatched}/${progress.totalEpisodes} episodios</span>
    </div>

    ${renderStandbyBanner(item.status, `${progress.totalWatched}/${progress.totalEpisodes} episodios vistos`)}
    ${renderStatusActions(item.status)}

    ${
      item.status === "completado"
        ? `<div class="completion-banner">
            <p>Has terminado esta serie${times > 1 ? ` (visionado nº ${times})` : ""}.</p>
            <p class="completion-dates">
              Empezada: ${formatDateEs(item.firstWatchedAt)} · Terminada: ${formatDateEs(item.lastWatchedAt)}
            </p>
            <button type="button" class="btn btn--accent-media btn--small" id="btn-rewatch">
              Volver a verla desde el principio
            </button>
          </div>`
        : ""
    }

    ${
      item.history && item.history.length
        ? `<details class="rewatch-history">
            <summary>Visionados anteriores (${item.history.length})</summary>
            <ul>
              ${item.history
                .map(
                  (h) =>
                    `<li>${formatDateEs(h.startedAt)} → ${formatDateEs(h.finishedAt)}</li>`
                )
                .join("")}
            </ul>
          </details>`
        : ""
    }

    <div class="seasons-list">
      ${seasonsMeta.map((s) => renderSeasonBlock(s, item.watched)).join("")}
    </div>

    ${ratingPickerHtml(item.rating, "field-rating", episodeAverageHtml(item.watched, "field-rating"))}
    ${notesFieldHtml(item.notes)}

    <div class="modal-actions">
      <button class="btn btn--danger" id="btn-delete-item">Eliminar</button>
      <button class="btn btn--primary" id="btn-save-item">Guardar</button>
    </div>
  `;

  function updateBanner(newProgress) {
    const line = newProgress.nextEpisode
      ? `Siguiente: T${newProgress.nextEpisode.season}E${newProgress.nextEpisode.episode}`
      : "¡Serie completada!";
    content.querySelector(".next-line").textContent = line;
    const newPct = newProgress.totalEpisodes
      ? Math.round((newProgress.totalWatched / newProgress.totalEpisodes) * 100)
      : 0;
    content.querySelector(".progress-bar-fill").style.width = newPct + "%";
    content.querySelector(".progress-count").textContent =
      `${newProgress.totalWatched}/${newProgress.totalEpisodes} episodios`;
  }

  function updateSeasonCount(seasonNumber, watchedCount, episodeCount) {
    const block = content.querySelector(`.season-block[data-season="${seasonNumber}"]`);
    block.querySelector(".season-count").textContent = `${watchedCount}/${episodeCount}`;
    const markBtn = block.querySelector(".season-mark-all");
    const allWatched = watchedCount >= episodeCount && episodeCount > 0;
    markBtn.textContent = allWatched ? "Desmarcar todo" : "Marcar todo";
    markBtn.dataset.allWatched = allWatched ? "0" : "1";
  }

  function updateEpisodeAverage() {
    const avg = computeEpisodeAverageRating(item.watched);
    const el = content.querySelector("#field-rating-episode-average");
    if (!el) return;
    el.hidden = !avg;
    if (avg) {
      const ratedLabel =
        avg.count === 1 ? "1 episodio valorado" : `${avg.count} episodios valorados`;
      el.title = `Media de ${ratedLabel}`;
      el.innerHTML = `Media episodios: <strong>${avg.average.toFixed(1)}</strong>`;
    } else {
      // No rated episodes: hide and empty (avoids stale text
      // if the CSS ever stopped respecting the [hidden]).
      el.title = "";
      el.textContent = "";
    }
  }

  function wireEpisodeRows(block, seasonNumber, episodeCount) {
    block.querySelectorAll(".episode-row").forEach((row) => {
      const episodeNumber = Number(row.dataset.episode);
      const checkbox = row.querySelector(".episode-checkbox");
      const dateInput = row.querySelector(".episode-date");
      const ratingWrap = row.querySelector(".episode-rating");
      const airDate = row.dataset.airDate;

      checkbox.addEventListener("change", async () => {
        // REAL state before the click (the browser already toggled the checkbox)
        const currentEntry = normalizeEntry(
          (item.watched || {})[String(seasonNumber)]?.[String(episodeNumber)]
        );
        const wasWatched = Boolean(currentEntry && currentEntry.date);

        // Episode already watched: ask what to do (watch again or
        // unmark) instead of a bare unmark (issue #133).
        if (wasWatched) {
          // The dialog captures document.activeElement when opening, but
// the checkbox is disabled before (the browser moves focus to
// body): we store the previous active element here to
// restore focus to the checkbox on close (QA #133).
          const prevActive = document.activeElement;
          checkbox.checked = true; // restore instantly (no flicker)
          checkbox.disabled = true;
          try {
            const choice = await openEpisodeActionsModal({
              title: item.title,
              subtitle: `T${seasonNumber}E${episodeNumber} · ${row.dataset.episodeName || ""}`,
              times: currentEntry.times || 1,
            });
            let newProgress = null;
            if (choice === "seen_again") {
              newProgress = await onSetEpisodeSeenAgain(seasonNumber, episodeNumber);
            } else if (choice === "unmarked") {
              newProgress = await onSetEpisodeDate(seasonNumber, episodeNumber, null);
            }
            // Repaint ALWAYS derived from item.watched (issue #136 pattern):
            // on cancel the row goes back to its real state (harmless) and
            // there is no new progress to repaint in the banner.
            const entry2 = normalizeEntry(
              (item.watched || {})[String(seasonNumber)]?.[String(episodeNumber)]
            );
            applyEpisodeRowState(row, entry2);
            const watchedSeasonCount = block.querySelectorAll(".episode-row.is-watched").length;
            updateSeasonCount(seasonNumber, watchedSeasonCount, episodeCount);
            if (newProgress) updateBanner(newProgress);
          } catch (err) {
            showToast("No se pudo actualizar: " + String(err && err.message ? err.message : err));
          } finally {
            checkbox.disabled = false;
            if (prevActive && document.contains(prevActive)) prevActive.focus();
          }
          return;
        }

        // Unmarked episode: current flow (unreleased confirmation and
        // subsequent rating window on the modal-handlers side).
        if (checkbox.checked && !item.manual && isUnreleasedDate(airDate)) {
          const msg = episodeUnreleasedMessage(item.title, seasonNumber, episodeNumber, airDate);
          if (!window.confirm(msg)) {
            checkbox.checked = false;
            return;
          }
        }
        checkbox.disabled = true;
        const newDate = checkbox.checked ? todayISO() : null;
        try {
          const newProgress = await onSetEpisodeDate(seasonNumber, episodeNumber, newDate);
          // Painting DERIVED from item.watched (not the pressed checkbox):
          // it also reflects a possible Undo from the pop-up rating
          // window (issue #136).
          const entry2 = normalizeEntry(
            (item.watched || {})[String(seasonNumber)]?.[String(episodeNumber)]
          );
          applyEpisodeRowState(row, entry2);
          const watchedSeasonCount = block.querySelectorAll(".episode-row.is-watched").length;
          updateSeasonCount(seasonNumber, watchedSeasonCount, episodeCount);
          updateBanner(newProgress);
          updateEpisodeAverage();
        } catch (err) {
          checkbox.checked = !checkbox.checked;
        } finally {
          checkbox.disabled = false;
        }
      });

      dateInput.addEventListener("change", async () => {
        if (!dateInput.value) return;
        dateInput.disabled = true;
        try {
          const newProgress = await onSetEpisodeDate(seasonNumber, episodeNumber, dateInput.value);
          updateBanner(newProgress);
        } finally {
          dateInput.disabled = false;
        }
      });

      const starButtons = ratingWrap.querySelectorAll(".episode-rating__star");
      starButtons.forEach((btn) => {
        btn.addEventListener("click", async () => {
          const value = Number(btn.dataset.value);
          // REAL state of the rating (issue #136 pattern: derive from the
          // data, not from the visual count of active stars).
          const current = normalizeRating(
            normalizeEntry(
              (item.watched || {})[String(seasonNumber)]?.[String(episodeNumber)]
            )?.rating
          );
          // Half-star cycle (issue #276): N → N-0.5 → clear.
          let newValue;
          if (current === value) newValue = value - 0.5;
          else if (current === value - 0.5) newValue = null;
          else newValue = value;
          starButtons.forEach((b) => (b.disabled = true));
          try {
            await onSetEpisodeRating(seasonNumber, episodeNumber, newValue);
            starButtons.forEach((b) => {
              const n = Number(b.dataset.value);
              const v = normalizeRating(newValue || 0);
              const full = v >= n;
              const half = v === n - 0.5;
              b.classList.toggle("is-active", full && !half);
              b.classList.toggle("is-half", half);
              b.textContent = half ? "1/2" : "";
              b.setAttribute(
                "aria-label",
                half ? `${String(n - 0.5).replace(".", ",")} estrellas` : ratingButtonAriaLabel(n)
              );
            });
            updateEpisodeAverage();
          } finally {
            starButtons.forEach((b) => (b.disabled = false));
          }
        });
      });
    });
  }

  content.querySelectorAll(".season-toggle").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const seasonNumber = Number(btn.dataset.season);
      const block = content.querySelector(
        `.season-episodes[data-season-episodes="${seasonNumber}"]`
      );
      const chevron = btn.querySelector(".season-chevron");
      const isHidden = block.classList.contains("hidden");

      if (!isHidden) {
        block.classList.add("hidden");
        chevron.textContent = "-";
        return;
      }
      block.classList.remove("hidden");
      chevron.textContent = "-";
      if (block.dataset.loaded) return;

      block.innerHTML = `<p class="episode-loading">Cargando episodios…</p>`;
      try {
        const episodes = await onExpandSeason(seasonNumber);
        // If the user's next episode is in this season, we store its air
// date (or null when TMDB does not have it) to be able to warn
// about the "unreleased" without further API calls.
// Fire-and-forget: a failure here does not break the modal.
        if (
          !item.manual &&
          onUpdateNextEpisodeAirDate &&
          item.nextEpisode &&
          item.nextEpisode.season === seasonNumber
        ) {
          const nextEp = episodes.find((e) => e.episodeNumber === item.nextEpisode.episode);
          if (nextEp) {
            Promise.resolve(
              onUpdateNextEpisodeAirDate({
                season: seasonNumber,
                episode: item.nextEpisode.episode,
                airDate: nextEp.airDate || null,
              })
            ).catch(() => {});
          }
        }
        const seasonWatched = (item.watched && item.watched[String(seasonNumber)]) || {};
        block.innerHTML = renderEpisodeRows(episodes, seasonWatched, { manual: item.manual });
        block.dataset.loaded = "1";
        const episodeCount = Number(btn.closest(".season-block").dataset.episodeCount);
        wireEpisodeRows(block, seasonNumber, episodeCount);
      } catch (err) {
        block.innerHTML = `<p class="episode-loading">No se pudieron cargar los episodios.</p>`;
      }
    });
  });

  content.querySelectorAll(".season-mark-all").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const seasonNumber = Number(btn.dataset.season);
      const episodeCount = Number(btn.closest(".season-block").dataset.episodeCount);
      const shouldMarkAll = btn.dataset.allWatched === "1";

      // When marking a whole season, count the unreleased episodes
      // (no official date or future date) and ask for confirmation.
      // Manual shows are excluded: they have no real dates.
      let unreleasedCount = 0;
      if (shouldMarkAll && !item.manual) {
        const episodesBlock = content.querySelector(
          `.season-episodes[data-season-episodes="${seasonNumber}"]`
        );
        let episodes = null;
        if (episodesBlock && episodesBlock.dataset.loaded) {
          episodes = [...episodesBlock.querySelectorAll(".episode-row")].map((row) => ({
            episodeNumber: Number(row.dataset.episode),
            airDate: row.dataset.airDate || null,
          }));
        } else {
          try {
            episodes = await onExpandSeason(seasonNumber);
          } catch (err) {
            console.error("No se pudo verificar el estreno de la temporada:", err);
            episodes = null;
          }
        }
        if (episodes) {
          unreleasedCount = episodes.filter((e) => isUnreleasedDate(e.airDate)).length;
        }
      }
      if (unreleasedCount > 0) {
        const ok = window.confirm(
          `«${item.title}» · Temporada ${seasonNumber}: ${unreleasedCount} episodio(s) sin estrenar (sin fecha oficial o con fecha futura). ¿Marcarlos todos igualmente como vistos?`
        );
        if (!ok) return;
      }

      btn.disabled = true;
      try {
        const newProgress = await onToggleSeason(seasonNumber, shouldMarkAll);
        updateSeasonCount(seasonNumber, shouldMarkAll ? episodeCount : 0, episodeCount);
        updateBanner(newProgress);

        const episodesBlock = content.querySelector(
          `.season-episodes[data-season-episodes="${seasonNumber}"]`
        );
        if (episodesBlock.dataset.loaded) {
          episodesBlock.querySelectorAll(".episode-row").forEach((row) => {
            const entry = normalizeEntry(
              (item.watched || {})[String(seasonNumber)]?.[String(row.dataset.episode)]
            );
            applyEpisodeRowState(row, entry);
          });
        }
        updateEpisodeAverage();
      } finally {
        btn.disabled = false;
      }
    });
  });

  const rewatchBtn = content.querySelector("#btn-rewatch");
  if (rewatchBtn) {
    rewatchBtn.addEventListener("click", async () => {
      if (
        !window.confirm(
          `¿Volver a ver «${item.title}» desde el principio? Se guardará el visionado anterior en el historial.`
        )
      ) {
        return;
      }
      await onRewatch();
    });
  }

  content.querySelector("#btn-edit-item").addEventListener("click", () => onEdit());

  wireStatusActions(content, async (newStatusOrNull) => {
    const newProgress = await onSetStatus(newStatusOrNull);
    openTvModal(item, seasonsMeta, newProgress, callbacks);
  });

  const getRating = wireRatingAndGetValue(content, item.rating);

  content.querySelector("#btn-save-item").addEventListener("click", () => {
    onSaveMeta({
      rating: getRating() || null,
      notes: content.querySelector("#field-notes").value.trim(),
    });
  });

  content.querySelector("#btn-delete-item").addEventListener("click", () => {
    onDelete();
  });

  // Wire recommendation "añadir" buttons
  if (onAddRecommendation) {
    content.querySelectorAll(".rec-card__add").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.recIndex);
        const recItem = recommendations[index];
        if (recItem) onAddRecommendation(recItem, btn);
      });
    });
  }

  // Wire recommendation card open preview (issue #280, iteration):
  // pressing the recommendation card shows the extended information
  // before adding it, same as in the movie detail view.
  if (onOpenRecommendation) {
    content.querySelectorAll(".rec-card__open").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.recIndex);
        const recItem = recommendations[index];
        if (recItem) onOpenRecommendation(recItem);
      });
    });
  }

  // Record previous focus and trap
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
}

/* ---------- Confirmation modal when adding a book ---------- */

// Shows a selection modal when a book has multiple covers or
// synopses (result of grouping Google Books editions). If there
// is nothing to choose, it calls onConfirm directly.
export function openBookConfirmModal(item, { onConfirm, onCancel }) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");

  const hasMultipleCovers = item.allCovers && item.allCovers.length > 1;
  const hasMultipleDescriptions = item.allDescriptions && item.allDescriptions.length > 1;

  // If there is nothing to choose, confirm directly
  if (!hasMultipleCovers && !hasMultipleDescriptions) {
    onConfirm({ coverUrl: item.coverUrl, description: item.description || "" });
    return;
  }

  const metaLine = [item.author, item.year].filter(Boolean).join(" · ");
  const editionNote =
    item.editionsCount > 1
      ? `<p class="book-confirm__editions">${item.editionsCount} ediciones encontradas</p>`
      : "";

  // Cover picker
  let coverPickerHtml = "";
  if (hasMultipleCovers) {
    coverPickerHtml = `
      <div class="field-group">
        <label>Elige una portada</label>
        <div class="cover-picker" id="cover-picker">
          ${item.allCovers
            .map(
              (url, i) => `
            <button type="button" class="cover-picker__item ${i === 0 ? "is-selected" : ""}" data-index="${i}">
              <img src="${url}" alt="Edición ${i + 1}" loading="lazy" />
            </button>`
            )
            .join("")}
        </div>
      </div>`;
  }

  // Synopsis picker
  let descSelectorHtml = "";
  if (hasMultipleDescriptions) {
    descSelectorHtml = `
      <div class="field-group">
        <label>Elige una sinopsis</label>
        <div class="desc-picker" id="desc-picker">
          ${item.allDescriptions
            .map(
              (desc, i) => `
            <button type="button" class="desc-picker__item ${i === 0 ? "is-selected" : ""}" data-index="${i}">
              <p class="desc-picker__text">${escapeHtml(desc.length > 250 ? desc.slice(0, 250) + "…" : desc)}</p>
            </button>`
            )
            .join("")}
        </div>
      </div>`;
  }

  content.innerHTML = `
    <h3 class="modal-detail__title" style="margin-bottom:0.5rem">añadir libro</h3>
    <div class="modal-detail__header" style="margin-bottom:0.5rem">
      <img class="modal-detail__cover" src="${item.coverUrl || PLACEHOLDER_COVER}" alt="" />
      <div>
        <div style="font-weight:600;font-size:0.95rem">${escapeHtml(item.title)}</div>
        <div class="modal-detail__meta">${escapeHtml(metaLine)}</div>
      </div>
    </div>
    ${editionNote}
    ${coverPickerHtml}
    ${descSelectorHtml}
    <div class="modal-actions">
      <button type="button" class="btn btn--outline" id="btn-confirm-cancel">Cancelar</button>
      <button type="button" class="btn btn--accent-books" id="btn-confirm-add">añadir</button>
    </div>
  `;

  // Wiring of the cover picker
  let selectedCoverIndex = 0;
  if (hasMultipleCovers) {
    content.querySelectorAll("#cover-picker .cover-picker__item").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedCoverIndex = Number(btn.dataset.index);
        content.querySelectorAll("#cover-picker .cover-picker__item").forEach((b) =>
          b.classList.toggle("is-selected", b === btn)
        );
      });
    });
  }

  // Wiring of the synopsis picker
  let selectedDescIndex = 0;
  if (hasMultipleDescriptions) {
    content.querySelectorAll("#desc-picker .desc-picker__item").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedDescIndex = Number(btn.dataset.index);
        content.querySelectorAll("#desc-picker .desc-picker__item").forEach((b) =>
          b.classList.toggle("is-selected", b === btn)
        );
      });
    });
  }

  content.querySelector("#btn-confirm-cancel").addEventListener("click", onCancel);
  content.querySelector("#btn-confirm-add").addEventListener("click", () => {
    onConfirm({
      coverUrl: hasMultipleCovers ? item.allCovers[selectedCoverIndex] : item.coverUrl,
      description: hasMultipleDescriptions
        ? item.allDescriptions[selectedDescIndex]
        : item.description || "",
    });
  });

  // If we come from another modal (e.g. the search preview), clear
  // its focus trap before registering the new one
  if (modal._focusTrapCleanup) modal._focusTrapCleanup();

  // Record previous focus and trap
  modal._previousActiveElement = document.activeElement;
  modal.classList.remove("hidden");
  modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
}

export function closeModal() {
  const modal = document.getElementById("item-modal");

  // Consumes the registered custom close (_onClose): avoids a
// closed preview re-firing its onClose after restoring the
// detail view (issue #280, QA D3).
  modal._onClose = null;

  // Restore focus to the element that had it before opening
  if (modal._previousActiveElement && typeof modal._previousActiveElement.focus === 'function') {
    modal._previousActiveElement.focus();
  }

  // Clear the focus trap
  if (modal._focusTrapCleanup) {
    modal._focusTrapCleanup();
    modal._focusTrapCleanup = null;
  }
  modal._previousActiveElement = null;

  modal.classList.add("hidden");
  document.getElementById("modal-content").innerHTML = "";
}

/* ---------- Notifications (bell) ---------- */

export function renderNotifications(listEl, badgeEl, emptyEl, notifications, { onDelete }) {
  const unread = notifications.filter((n) => !n.read).length;
  if (unread > 0) {
    badgeEl.textContent = unread > 9 ? "9+" : String(unread);
    badgeEl.classList.remove("hidden");
  } else {
    badgeEl.classList.add("hidden");
  }

  if (!notifications.length) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  listEl.innerHTML = notifications
    .map(
      (n, index) => `
      <div class="notif-row ${n.read ? "" : "is-unread"}">
        <span class="notif-row__text">${escapeHtml(n.message)}</span>
        <button type="button" class="notif-row__delete" data-index="${index}" aria-label="Borrar">✕</button>
      </div>`
    )
    .join("");

  listEl.querySelectorAll(".notif-row__delete").forEach((btn) => {
    btn.addEventListener("click", () => onDelete(notifications[Number(btn.dataset.index)]));
  });
}

/* ---------- Floating notice ---------- */

let toastTimer = null;
let undoState = null; // { hide } of the active undo toast, or null

function clearUndoState() {
  if (undoState) {
    undoState.hide();
    undoState = null;
  }
}

export function showToast(message) {
  // If there is an active undo toast, hide it
  clearUndoState();
  clearTimeout(toastTimer);

  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3200);
}

/**
 * Shows a toast with a message and a "Deshacer" button.
 * The toast is NOT hidden automatically — the caller controls its
 * life cycle through the returned object's `hide()` method.
 *
 * @param {string}   title   - Title of the item that will be deleted
 * @param {Function} onUndo  - Callback when "Deshacer" is clicked
 * @returns {{ hide: () => void }}
 */
export function showUndoToast(title, onUndo) {
  // If another undo toast is already visible, hide it
  clearUndoState();
  clearTimeout(toastTimer);

  const toast = document.getElementById("toast");
  toast.innerHTML = `
    <span>«${escapeHtml(title)}» se eliminará…</span>
    <button class="toast__btn">Deshacer</button>
  `;
  toast.classList.add("toast--undo");
  toast.classList.remove("hidden");

  const hide = () => {
    if (undoState !== state) return; // Another toast already took over
    toast.classList.remove("toast--undo");
    toast.classList.add("hidden");
    toast.innerHTML = "";
    undoState = null;
  };

  const state = { hide };
  undoState = state;

  toast.querySelector(".toast__btn").addEventListener("click", () => {
    onUndo();
  });

  return { hide };
}