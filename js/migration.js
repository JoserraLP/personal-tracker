// =============================================================
// Minimal storage migration (issue #200, A2): pruning of detail
// fields that are no longer persisted (ON_DEMAND_DETAIL_FIELDS).
//
// Items added after the deployment of this feature only store the
// minimum fields (card + alerts); older documents keep the
// historical data from the daily curation (synopsis, cast,
// trailer, platforms...). This migration removes them once per
// user: it shrinks the documents (Firestore bills per byte)
// without losing anything visible, because the detail view asks
// the API for those fields on demand (js/item-details.js + 24 h
// cache).
//
// Best-effort and fail-open: a network/permissions error aborts
// the migration without blocking app startup, and it is retried
// in the next session (the marker is not stamped). Books keep
// `description` (exception documented in constants.js: the card
// and the book detail view render it instantly).
// =============================================================

import { ON_DEMAND_DETAIL_FIELDS } from "./constants.js";
import { deleteField } from "./firebase.js";

// Migration version: whenever it changes (or fields are added to
// the list), users get pruned again once.
const MIGRATION_VERSION = "200-a2";

// Concurrency of the pruning writes.
const PODA_CONCURRENCY = 4;

// Simple promise pool (same pattern as mapConcurrent in
// daily-check.js, without depending on it).
async function mapConcurrent(items, limit, fn) {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex;
      nextIndex += 1;
      await fn(items[i], i);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(limit, items.length); w += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
}

/**
 * Prunes the on-demand detail fields of all the user's groups.
 * Idempotent: deleteField on a nonexistent field is a no-op, so an
 * interrupted run halfway through breaks nothing.
 *
 * @param {string} uid - UID of the Firebase Auth user
 * @param {object} ctx - App context (getItemsOnce, updateItem,
 *   getUserProfile, upsertUserProfile)
 * @returns {Promise<boolean>} - true if the migration finished and the
 *   marker was stamped; false if it failed (retried in the next
 *   session).
 */
export async function runStorageMigration(uid, ctx) {
  let profile = null;
  try {
    profile = await ctx.getUserProfile(uid);
  } catch (err) {
    return false;
  }
  if (profile && profile.storageMigration === MIGRATION_VERSION) {
    return true;
  }

  const types = ["movie", "tv", "book", "game"];
  for (const type of types) {
    let items;
    try {
      items = await ctx.getItemsOnce(uid, type);
    } catch (err) {
      console.error("Migración de almacenamiento: no se pudo leer", type, err);
      return false;
    }
    try {
      await mapConcurrent(items, PODA_CONCURRENCY, async (item) => {
        const update = {};
        for (const field of ON_DEMAND_DETAIL_FIELDS) {
          // Books exception: description is kept (constants.js).
          if (type === "book" && field === "description") continue;
          if (field in item) update[field] = deleteField();
        }
        if (Object.keys(update).length) {
          await ctx.updateItem(uid, type, item.id, update);
        }
      });
    } catch (err) {
      console.error("Migración de almacenamiento: no se pudo podar", type, err);
      return false;
    }
  }

  try {
    await ctx.upsertUserProfile(uid, { storageMigration: MIGRATION_VERSION });
  } catch (err) {
    console.error("Migración de almacenamiento: no se pudo estampar el marcador:", err);
    return false;
  }
  return true;
}