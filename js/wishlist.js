// =============================================================
// Wish list («Compras», in Ocio): things to buy with title,
// description, price (optional), product URL (optional), photo by
// URL (optional) and whether it is already bought.
//
// The module receives the app context (ctx) with the data access
// functions (repo pattern: it does not talk to Firebase directly)
// and renders inside the tab (the skeleton HTML lives in
// ocio/compras.html, loaded as a partial). The pure parts
// (validation and formatting) are separated so they can be tested
// without the DOM.
// =============================================================

import * as ui from "./ui.js";
import { trapFocus } from "./focus-utils.js";

const PLACEHOLDER_PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='140'><rect width='100%' height='100%' fill='none' stroke='currentColor' stroke-opacity='0.3' stroke-dasharray='6 4'/><text x='50%' y='52%' font-family='sans-serif' font-size='14' fill='currentColor' fill-opacity='0.5' text-anchor='middle'>Sin foto</text></svg>`
  );

// -------------------------------------------------------------
// Pure parts (testable without DOM)
// -------------------------------------------------------------

// Validates the form draft. Returns { ok, errors: [] }:
// the title is the only required field; the price, if provided, must
// be a reasonable number (≥ 0); the URL and the photo, if provided,
// must be a valid URL (http/https, with domain).
export function validateWishlistDraft(title, priceText, url, photoUrl) {
  const errors = [];
  const titleTrimmed = (title || "").trim();
  if (!titleTrimmed) errors.push("El título es obligatorio.");

  let price = null;
  const priceRaw = (priceText || "").trim().replace(",", ".");
  if (priceRaw) {
    price = Number(priceRaw);
    if (!Number.isFinite(price) || price < 0) {
      errors.push("El precio debe ser un número mayor o igual que 0.");
      price = null;
    }
  }

  const cleanUrl = sanitizeUrl(url);
  if (url && url.trim() && !cleanUrl && !sanitizeLooseUrl(url)) {
    errors.push("La URL del producto no es válida.");
  }
  const cleanPhoto = sanitizeUrl(photoUrl);
  if (photoUrl && photoUrl.trim() && !cleanPhoto && !sanitizeLooseUrl(photoUrl)) {
    errors.push("La URL de la foto no es válida.");
  }

  return {
    ok: errors.length === 0,
    errors,
    data: {
      title: titleTrimmed,
      price,
      url: cleanUrl || sanitizeLooseUrl(url),
      photoUrl: cleanPhoto || sanitizeLooseUrl(photoUrl),
    },
  };
}

// Normalizes user URLs: if they typed a domain without scheme
// ("www.dominio.com/xxx" or "dominio.com/xxx"), we prepend https://.
// Anything else that does not look like a URL returns null.
export function sanitizeUrl(value) {
  const v = (value || "").trim();
  if (!v) return null;
  return sanitizeLooseUrl(v);
}

function sanitizeLooseUrl(value) {
  const v = (value || "").trim();
  if (!v) return null;
  if (/^https?:\/\/\S+$/i.test(v)) return v;
  if (/^(?:www\.)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(v)) {
    return "https://" + v;
  }
  return null;
}

// Price format for the card: "12,50 €" (if there is a price) or
// empty string. Negative prices stay unpresented (validation
// already filters them on input).
export function formatWishlistPrice(price) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return "";
  return p.toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €";
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// -------------------------------------------------------------
// State and render (the panel is already in the DOM: the partial loaded it)
// -------------------------------------------------------------

let ctxRef = null;
let wishlistItems = [];
let wishlistFilter = "todos";
let modalTrapCleanup = null;

function renderWishlist() {
  const gridEl = document.getElementById("wishlist-grid");
  const emptyEl = document.getElementById("wishlist-empty");
  if (!gridEl || !emptyEl) return;

  const items =
    wishlistFilter === "todos"
      ? wishlistItems
      : wishlistItems.filter((i) => i.purchased === (wishlistFilter === "comprado"));

  if (!items.length) {
    if (wishlistItems.length) {
      emptyEl.textContent = "No hay ninguna cosa con ese filtro.";
    } else {
      emptyEl.textContent =
        "Tu lista de cosas que comprar está vacía. Pulsa «Añadir cosa» para registrar la primera.";
    }
    gridEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  gridEl.innerHTML = items
    .map(
      (item, index) => `
      <article class="wishlist-card ${item.purchased ? "wishlist-card--comprado" : ""}">
        <button type="button" class="wishlist-card__open" data-wishlist-index="${index}"
                title="${escapeHtml(item.title)}" aria-label="Editar ${escapeHtml(item.title)}">
          <img class="wishlist-card__photo" loading="lazy"
               src="${escapeHtml(item.photoUrl || PLACEHOLDER_PHOTO)}" alt="" />
          <div class="wishlist-card__body">
            <div class="wishlist-card__title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
            ${formatWishlistPrice(item.price) ? `<div class="wishlist-card__price">${formatWishlistPrice(item.price)}</div>` : ""}
            <div class="wishlist-card__desc" title="${escapeHtml(item.description || "")}">${escapeHtml(item.description || "")}</div>
            ${item.url ? `<div class="wishlist-card__url" title="${escapeHtml(item.url)}">${escapeHtml(item.url)}</div>` : ""}
          </div>
        </button>
        <div class="wishlist-card__actions">
          <label class="wishlist-card__check">
            <input type="checkbox" data-wishlist-check="${index}" ${item.purchased ? "checked" : ""} />
            <span>Comprado</span>
          </label>
          <button type="button" class="wishlist-card__delete" data-wishlist-delete="${index}"
                  aria-label="Borrar ${escapeHtml(item.title)}">🗑️</button>
        </div>
      </article>`
    )
    .join("");

  // Wiring per card. The grid is repainted entirely on each snapshot,
  // so the listeners are ephemeral (same pattern as the rest).
  gridEl.querySelectorAll("[data-wishlist-index]").forEach((btn) => {
    btn.addEventListener("click", () => openWishlistForm(items[Number(btn.dataset.wishlistIndex)]));
  });
  gridEl.querySelectorAll("[data-wishlist-check]").forEach((input) => {
    input.addEventListener("change", () => {
      const item = items[Number(input.dataset.wishlistCheck)];
      const changes = { purchased: input.checked };
      // When checked: purchase date the first time; when unchecked: it
      // is cleared (even totals).
      if (input.checked) {
        if (!item.purchasedAt) changes.purchasedAt = new Date().toISOString();
      } else {
        changes.purchasedAt = null;
      }
      ctxRef.updateWishlistItem(ctxRef.getCurrentUser().uid, item.id, changes);
    });
  });
  gridEl.querySelectorAll("[data-wishlist-delete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = items[Number(btn.dataset.wishlistDelete)];
      if (confirm(`¿Borrar «${item.title}» de la lista de compras?`)) {
        ctxRef.deleteWishlistItem(ctxRef.getCurrentUser().uid, item.id);
      }
    });
  });
}

// -------------------------------------------------------------
// Form (generic window #item-modal)
// -------------------------------------------------------------

function wishlistFormHtml(item) {
  const editing = !!item?.id;
  return `
    <form id="wishlist-form" class="manual-form">
      <h3 class="manual-form__title">${editing ? "Editar compra" : "Añadir a la lista de compras"}</h3>
      <div class="field-group">
        <label for="wishlist-title">Título *</label>
        <input id="wishlist-title" class="manual-input" maxlength="120" required
               value="${escapeHtml(item?.title || "")}" />
      </div>
      <div class="field-group">
        <label for="wishlist-price">Precio (€) — opcional</label>
        <input id="wishlist-price" class="manual-input" inputmode="decimal"
               placeholder="12,99" value="${item?.price != null ? String(item.price).replace(".", ",") : ""}" />
      </div>
      <div class="field-group">
        <label for="wishlist-url">URL del producto — opcional</label>
        <input id="wishlist-url" class="manual-input" inputmode="url"
               placeholder="https://..." value="${escapeHtml(item?.url || "")}" />
      </div>
      <div class="field-group">
        <label for="wishlist-photo">Foto (URL de la imagen) — opcional</label>
        <input id="wishlist-photo" class="manual-input" inputmode="url"
               placeholder="https://..." value="${escapeHtml(item?.photoUrl || "")}" />
      </div>
      <div class="field-group">
        <label for="wishlist-desc">Descripción — opcional</label>
        <textarea id="wishlist-desc" class="manual-input" rows="3" maxlength="2000">${escapeHtml(item?.description || "")}</textarea>
      </div>
      <div id="wishlist-form-errors" class="manual-form__errors hidden"></div>
      <div class="manual-form__actions">
        <button type="submit" class="btn btn--primary">Guardar</button>
        <button type="button" class="btn btn--outline" id="btn-wishlist-cancel">Cancelar</button>
      </div>
    </form>`;
}

export function openWishlistForm(item) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");
  content.innerHTML = wishlistFormHtml(item);

  content.querySelector("#btn-wishlist-cancel").addEventListener("click", () => ui.closeModal());
  content.querySelector("#wishlist-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const draft = validateWishlistDraft(
      content.querySelector("#wishlist-title").value,
      content.querySelector("#wishlist-price").value,
      content.querySelector("#wishlist-url").value,
      content.querySelector("#wishlist-photo").value
    );
    const errorsBox = content.querySelector("#wishlist-form-errors");
    if (!draft.ok) {
      errorsBox.textContent = draft.errors.join(" ");
      errorsBox.classList.remove("hidden");
      return;
    }
    const data = { ...draft.data, description: content.querySelector("#wishlist-desc").value.trim() };
    try {
      if (item?.id) {
        // If the user removes the photo, null is saved and the card
        // goes back to the placeholder.
        await ctxRef.updateWishlistItem(ctxRef.getCurrentUser().uid, item.id, data);
      } else {
        await ctxRef.addWishlistItem(ctxRef.getCurrentUser().uid, {
          ...data,
          purchased: false,
          purchasedAt: null,
        });
      }
      ui.closeModal();
    } catch (err) {
      console.error("No se pudo guardar el elemento de la lista de compras:", err);
      errorsBox.textContent = "No se pudo guardar: " + (err.message || err);
      errorsBox.classList.remove("hidden");
    }
  });

  if (modalTrapCleanup) modalTrapCleanup();
  modal._previousActiveElement = document.activeElement;
  modal._focusTrapCleanup = null;
  modalTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
  modal.classList.remove("hidden");
  content.querySelector("#wishlist-title")?.focus();
}

// -------------------------------------------------------------
// Filter chips (delegation in the partial's bar)
// -------------------------------------------------------------

function wireChips() {
  const chips = document.querySelector('[data-wishlist-scope="compras"]');
  if (!chips) return;
  chips.addEventListener("click", (e) => {
    const chip = e.target.closest(".wishlist-chip");
    if (!chip) return;
    wishlistFilter = chip.dataset.wishlistFilter;
    document.querySelectorAll('[data-wishlist-scope="compras"] .wishlist-chip').forEach((c) => {
      const isActive = c.dataset.wishlistFilter === wishlistFilter;
      c.classList.toggle("is-active", isActive);
      c.setAttribute("aria-pressed", String(isActive));
    });
    renderWishlist();
  });
}

// -------------------------------------------------------------
// Setup (called by app.js once per group snapshot)
// -------------------------------------------------------------

/**
 * Connects the wish list to the app: wiring of the «Añadir» button,
 * chips and data state. Used by app.js.
 * @param {Object} ctx - Application context (ctx from app.js).
 * @returns {{ setWishlistItems: Function }}
 */
export function setupWishlist(ctx) {
  ctxRef = ctx;

  return {
    // Called by app.js on each snapshot of the wishlist group.
    setWishlistItems: (items) => {
      wishlistItems = items || [];
      renderWishlist();
    },
    // Called by loadOcioPartial of app.js when the partial with the
    // «Añadir» button and the chips is already in the DOM (lazy
    // loading: the markup does not exist until then).
    wireControls: wireControls,
  };
}

function wireControls() {
  wireChips();
  const addBtn = document.getElementById("btn-wishlist-add");
  if (addBtn && !addBtn.dataset.wishlistWired) {
    addBtn.dataset.wishlistWired = "1";
    addBtn.addEventListener("click", () => openWishlistForm(null));
  }
}
