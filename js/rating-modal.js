// =============================================================
// Pop-up rating window (issue #21): second modal that overlays the
// detail modal (or appears over the library in quick actions) when
// marking a movie, a book or a show episode as watched/read. It
// reuses the #rating-modal frame from index.html, the community
// score styles and the star picker from ui.js.
//
// The promise returned by openRatingModal() resolves with the saved
// rating (1-5, with halves since issue #276), with
// RATING_MODAL_UNDONE if the marking was undone, or with null if it
// was discarded. It never rejects: save/undo errors are notified
// with a toast and the window stays open.
// =============================================================

import { ratingPickerHtml, wireRatingAndGetValue, showToast, PLACEHOLDER_COVER } from "./ui.js";
import { trapFocus } from "./focus-utils.js";

// Special value with which the promise resolves when the user hits
// «Deshacer»: the newly made marking was undone and the UI below
// must go back to its previous state (issue #136).
export const RATING_MODAL_UNDONE = "undone";

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Safe cover for the src attribute: only https URLs or
// data:image/ are accepted (repo pattern for placeholders, e.g.
// PLACEHOLDER_COVER). Any other scheme (javascript:, data:text/html...)
// or invalid URL falls back to the placeholder. It is combined with
// escapeHtml on the attribute for defense in depth.
function safeCoverUrl(url) {
  if (!url) return PLACEHOLDER_COVER;
  try {
    const parsed = new URL(url, window.location.href);
    if (
      parsed.protocol === "https:" ||
      (parsed.protocol === "data:" && parsed.pathname.startsWith("image/"))
    ) {
      return url;
    }
  } catch {
    // Unparseable URL → placeholder
  }
  return PLACEHOLDER_COVER;
}

// State of the currently open modal (or null). closeRatingModal()
// uses it to close the window from outside (e.g. the Escape key,
// which prioritizes the global handler of modal-handlers.js).
let currentClose = null;
// While the undo is in progress, external closes (✕, backdrop,
// Escape, «Ahora no») are ignored: they must not resolve the
// promise with null in the middle of the restoration (issue #136).
let undoInProgress = false;

/**
 * Closes the rating window without saving (if open).
 * Used by the global Escape handler in modal-handlers.js.
 */
export function closeRatingModal() {
  if (currentClose) currentClose(null);
}

// The close buttons of the static frame (✕ and backdrop) live in
// index.html, so their listeners are registered ONCE when the module
// loads (not on each open). They delegate to closeRatingModal(),
// which resolves the pending promise with null if nothing was saved,
// and is idempotent: with no open modal (currentClose null) it does
// nothing.
document.getElementById("rating-modal-close").addEventListener("click", () => closeRatingModal());
document.getElementById("rating-modal-backdrop").addEventListener("click", () => closeRatingModal());

/**
 * Opens the rating window over whatever is on screen.
 * @param {object} opts
 * @param {string} opts.type            - "movie" | "tv" | "book"
 * @param {string} opts.title           - Title of the item
 * @param {string|null} opts.coverUrl   - Cover (or null for the placeholder)
 * @param {string} [opts.episodeLabel]  - Optional episode line ("S1E3 · Pilot")
 * @param {number|null} opts.communityRating - Community score (or null → "Sin puntuaciones")
 * @param {string} opts.communityLabel  - "TMDB" or "TMDB · episode"
 * @param {number|null} opts.initialRating - Previous user rating (1-5, with halves)
 * @param {Function} opts.onSave        - async (rating) => {}, persists the rating
 * @param {Function} [opts.onUndo]      - async () => {}, undoes the just-made marking
 * @param {string} [opts.undoLabel]     - Text of the «Deshacer» button (default "Deshacer")
 * @returns {Promise<number|string|null>} Saved rating 1-5 (0.5 steps), RATING_MODAL_UNDONE if the
 *          marking was undone, or null if it was discarded.
 */
export function openRatingModal({ type, title, coverUrl, episodeLabel, communityRating, communityLabel, initialRating, onSave, onUndo, undoLabel = "Deshacer" }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("rating-modal");
    const content = document.getElementById("rating-modal-content");

    const ratingsHtml = communityRating != null
      ? `<div class="modal-detail__ratings">
          <span class="community-rating">
            <span class="community-rating__label">${escapeHtml(communityLabel)}</span>
            <span class="community-rating__value">${Number(communityRating).toFixed(1)}</span>
          </span>
        </div>`
      : `<div class="modal-detail__ratings">
          <span class="community-rating community-rating--empty">Sin puntuaciones</span>
        </div>`;

    content.innerHTML = `
      <div class="rating-modal__header">
        <img class="rating-modal__cover" src="${escapeHtml(safeCoverUrl(coverUrl))}" alt="" />
        <div class="rating-modal__info">
          <div class="rating-modal__title">${escapeHtml(title)}</div>
          ${episodeLabel ? `<div class="rating-modal__subtitle">${escapeHtml(episodeLabel)}</div>` : ""}
        </div>
      </div>
      ${ratingsHtml}
      <div class="rating-modal__stars">
        ${ratingPickerHtml(initialRating || 0, "rm-rating")}
      </div>
      <div class="rating-modal__actions">
        ${onUndo ? `<button type="button" class="btn btn--outline" id="rm-undo">${escapeHtml(undoLabel)}</button>` : ""}
        <button type="button" class="btn btn--outline" id="rm-save-later">Ahora no</button>
        <button type="button" class="btn btn--primary" id="rm-save">Guardar valoración</button>
      </div>
    `;

    // Compact picker for the small window
    const picker = content.querySelector(".rating-picker");
    if (picker) picker.classList.add("rating-picker--small");

    const getRating = wireRatingAndGetValue(content, initialRating || 0, "rm-rating");

    let settled = false;
    const close = (result) => {
      if (undoInProgress) return; // the undo in progress decides the close (issue #136)
      if (settled) return; // idempotent: closing twice does not resolve twice
      settled = true;
      currentClose = null;

      if (modal._focusTrapCleanup) {
        modal._focusTrapCleanup();
        modal._focusTrapCleanup = null;
      }
      // Restore focus to the previous element, if still in the DOM
      // (e.g. the episode checkbox or the quick action button)
      if (modal._previousActiveElement && document.contains(modal._previousActiveElement)) {
        modal._previousActiveElement.focus();
      }
      modal._previousActiveElement = null;

      modal.classList.add("hidden");
      content.innerHTML = "";
      resolve(result);
    };
    currentClose = close;

    // "Ahora no" also discards
    content.querySelector("#rm-save-later").addEventListener("click", () => close(null));

    // Save: persists and closes with the rating; if it fails, toast and the window stays open
    content.querySelector("#rm-save").addEventListener("click", async () => {
      const rating = getRating();
      if (!rating) {
        showToast("Elige una valoración (de 1 a 5 estrellas, con medias).");
        return;
      }
      const saveBtn = content.querySelector("#rm-save");
      saveBtn.disabled = true;
      try {
        await onSave(rating);
        close(rating);
      } catch (err) {
        // Robustness against errors that are not Error instances
        // (e.g. thrown strings/values): the toast never shows
        // "undefined".
        showToast("No se pudo guardar la valoración: " + String(err && err.message ? err.message : err));
        saveBtn.disabled = false;
      }
    });

    // Undo: cancels the just-made marking and closes with
    // RATING_MODAL_UNDONE; if it fails, toast and the window stays
    // open. Both buttons (undo and save) are disabled during the
    // operation to avoid races, and external closes are ignored
    // while it runs (issue #136).
    if (onUndo) {
      content.querySelector("#rm-undo").addEventListener("click", async () => {
        const undoBtn = content.querySelector("#rm-undo");
        const saveBtn = content.querySelector("#rm-save");
        undoBtn.disabled = true;
        saveBtn.disabled = true;
        undoInProgress = true;
        try {
          await onUndo();
          // Release the guard BEFORE closing: the close() with
          // RATING_MODAL_UNDONE must pass (the guard only blocks
          // external closes with null while the undo runs).
          undoInProgress = false;
          close(RATING_MODAL_UNDONE);
        } catch (err) {
          // Robustez frente a errores que no son instancia de Error
          // (p. ej. throw de strings/valores): el toast nunca muestra
          // "undefined".
          showToast("No se pudo deshacer: " + String(err && err.message ? err.message : err));
          undoBtn.disabled = false;
          saveBtn.disabled = false;
        } finally {
          undoInProgress = false;
        }
      });
    }

    // Record previous focus and trap
    modal._previousActiveElement = document.activeElement;
    modal.classList.remove("hidden");
    modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
  });
}
