// =============================================================
// Deletion management with option to undo.
// Instead of deleting immediately from Firestore, the deletion is
// scheduled with a 6-second timer. If the user clicks "Deshacer"
// (Undo), it is cancelled. If the timer expires, deleteDoc runs.
// Only one undo toast is visible at a time. If another deletion is
// scheduled while one is pending, the previous one runs
// immediately.
// =============================================================

import * as ui from "./ui.js";

const DELAY_MS = 6000;

// Stores the single pending deletion (at most one at a time).
// Each entry: { timerId, uid, kind, itemId, hideToast }
const pending = new Map();

/**
 * Schedules the deletion of an item with the option to undo.
 * @param {Object} item  - The item to delete (must have .id and .title)
 * @param {string} uid   - UID of the authenticated user
 * @param {string} kind  - "movie" | "tv" | "book"
 * @param {Object} ctx   - Context with deleteItem(uid, kind, id)
 */
export function scheduleDeletion(item, uid, kind, ctx) {
  const itemId = item.id;

  // If there is already a pending deletion
  if (pending.size > 0) {
    for (const [key, data] of pending) {
      if (key === itemId) {
        // Same item — only restart the timer, do not delete yet
        clearTimeout(data.timerId);
        data.hideToast();
        pending.delete(key);
        break;
      } else {
        // Different item — run the pending one immediately
        clearTimeout(data.timerId);
        pending.delete(key);
        _executeDeletion(data, ctx);
        break;
      }
    }
  }

  // Callback when the user clicks "Deshacer"
  const onUndo = () => {
    const data = pending.get(itemId);
    if (!data) return;
    clearTimeout(data.timerId);
    data.hideToast();
    pending.delete(itemId);
    ui.showToast("Cancelado.");
  };

  // Show the toast with the undo button
  const { hide } = ui.showUndoToast(item.title, onUndo);

  // Timer that performs the definitive deletion
  const timerId = setTimeout(() => {
    const data = pending.get(itemId);
    if (!data) return;
    // Remove from the map BEFORE the async operation so that
    // the "Deshacer" button no longer has any effect
    pending.delete(itemId);
    _executeDeletion(data, ctx);
  }, DELAY_MS);

  pending.set(itemId, { timerId, uid, kind, itemId, hideToast: hide });
}

/**
 * Performs the definitive deletion in Firestore.
 */
async function _executeDeletion(data, ctx) {
  const { uid, kind, itemId, hideToast } = data;
  try {
    await ctx.deleteItem(uid, kind, itemId);
    hideToast();
    ui.showToast("Eliminado.");
  } catch (err) {
    hideToast();
    ui.showToast("No se pudo eliminar: " + err.message);
  }
}

/**
 * Cancels all pending deletions (useful in beforeunload).
 * Items remain in Firestore — no data is lost.
 */
export function cancelAllDeletions() {
  for (const [, data] of pending) {
    clearTimeout(data.timerId);
    data.hideToast();
  }
  pending.clear();
}

// On page reload, pending deletions are cancelled
window.addEventListener("beforeunload", cancelAllDeletions);