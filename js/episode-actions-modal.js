// =============================================================
// Dialog of actions for an already watched episode (issue #133): when
// clicking the checkbox of a marked episode, it asks whether it was
// watched again (adds 1 to the counter) or whether it should be unmarked.
// It reuses the #episode-actions-modal shell from index.html and the
// generic modal styles. It is PURE: it persists nothing; it returns
// the user's choice and the caller decides the repaint.
//
// The promise returned by openEpisodeActionsModal() resolves
// with "seen_again", "unmarked" or null (dismissed). It never rejects.
// =============================================================

import { trapFocus } from "./focus-utils.js";

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// State of the currently open modal (or null). closeEpisodeActionsModal()
// uses it to close the window from outside (e.g. the Escape key,
// which has priority over the global handler of modal-handlers.js).
let currentClose = null;

/**
 * Closes the actions dialog without a choice (if it is open).
 * Used by the global Escape handler in modal-handlers.js.
 */
export function closeEpisodeActionsModal() {
  if (currentClose) currentClose(null);
}

// The close buttons of the static shell (✕ and backdrop) live in
// index.html, so their listeners are registered ONCE when the module
// loads (not on every open). They delegate to closeEpisodeActionsModal(),
// which resolves the pending promise with null, and is idempotent: with no
// open modal (currentClose null) it does nothing.
document
  .getElementById("episode-actions-modal-close")
  .addEventListener("click", () => closeEpisodeActionsModal());
document
  .getElementById("episode-actions-modal-backdrop")
  .addEventListener("click", () => closeEpisodeActionsModal());

/**
 * Opens the actions dialog for an already watched episode.
 * @param {object} opts
 * @param {string} opts.title     - Title of the series
 * @param {string} [opts.subtitle] - Episode line ("T1E3 · Piloto")
 * @param {number} opts.times     - Times the episode has been watched
 * @returns {Promise<"seen_again"|"unmarked"|null>} User's choice,
 *          or null if dismissed.
 */
export function openEpisodeActionsModal({ title, subtitle, times }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("episode-actions-modal");
    const content = document.getElementById("episode-actions-modal-content");

    const timesLabel = `${times} ${times === 1 ? "vez" : "veces"}`;
    content.innerHTML = `
      <div class="rating-modal__header">
        <div class="rating-modal__info">
          <div class="rating-modal__title">${escapeHtml(title)}</div>
          ${subtitle ? `<div class="rating-modal__subtitle">${escapeHtml(subtitle)}</div>` : ""}
        </div>
      </div>
      <div class="eam-body">
        Ya has visto este episodio ${timesLabel}. ¿Qué quieres hacer?
      </div>
      <div class="rating-modal__actions">
        <button type="button" class="btn btn--primary" id="eam-seen-again">Lo he visto de nuevo</button>
        <button type="button" class="btn btn--outline" id="eam-unmark">Desmarcar</button>
        <button type="button" class="btn btn--outline" id="eam-cancel">Ahora no</button>
      </div>
    `;

    let settled = false;
    const close = (result) => {
      if (settled) return; // idempotent: closing twice doesn't resolve twice
      settled = true;
      currentClose = null;

      if (modal._focusTrapCleanup) {
        modal._focusTrapCleanup();
        modal._focusTrapCleanup = null;
      }
      // Restore focus to the previous element, if still in the DOM
      // (e.g. the episode checkbox)
      if (modal._previousActiveElement && document.contains(modal._previousActiveElement)) {
        modal._previousActiveElement.focus();
      }
      modal._previousActiveElement = null;

      modal.classList.add("hidden");
      content.innerHTML = "";
      resolve(result);
    };
    currentClose = close;

    content.querySelector("#eam-seen-again").addEventListener("click", () => close("seen_again"));
    content.querySelector("#eam-unmark").addEventListener("click", () => close("unmarked"));
    content.querySelector("#eam-cancel").addEventListener("click", () => close(null));

    // Record previous focus and trap
    modal._previousActiveElement = document.activeElement;
    modal.classList.remove("hidden");
    modal._focusTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
  });
}
