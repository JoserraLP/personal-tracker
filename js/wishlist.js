// =============================================================
// Lista de deseos («Compras», en Ocio): cosas que comprar con
// título, descripción, precio (opcional), URL del producto
// (opcional), foto por URL (opcional) y si ya está comprada.
//
// El módulo recibe el contexto de la app (ctx) con las funciones
// de acceso a datos (patrón del repo: no habla con Firebase
// directamente) y renderiza en la pestaña (el HTML del esqueleto
// vive en ocio/compras.html, cargado como partial). Las partes
// puras (validación y formato) están separadas para poder
// testearlas sin DOM.
// =============================================================

import * as ui from "./ui.js";
import { trapFocus } from "./focus-utils.js";

const PLACEHOLDER_PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='140'><rect width='100%' height='100%' fill='none' stroke='currentColor' stroke-opacity='0.3' stroke-dasharray='6 4'/><text x='50%' y='52%' font-family='sans-serif' font-size='14' fill='currentColor' fill-opacity='0.5' text-anchor='middle'>Sin foto</text></svg>`
  );

// -------------------------------------------------------------
// Partes puras (testeables sin DOM)
// -------------------------------------------------------------

// Valida el borrador del formulario. Devuelve { ok, errors: [] }:
// el título es el único obligatorio; el precio, si viene, debe ser
// un número razonable (≥ 0); la URL y la foto, si vienen, deben
// ser una URL válida (http/https, con dominio).
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

// Normaliza URLs del usuario: si escribió dominio sin esquema
// ("www.dominio.com/xxx" o "dominio.com/xxx"), anteponemos https://.
// Cualquier otra cosa que no tenga pinta de URL devuelve null.
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

// Formato del precio para la tarjeta: "12,50 €" (si hay precio) o
// cadena vacía. Los precios negativos quedan sin presentar (la
// validación ya los filtra a la entrada).
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
// Estado y render (el panel ya está en el DOM: lo cargó el partial)
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

  // Wiring por tarjeta. El grid se repinta entero en cada snapshot,
  // así que los listeners son efímeros (mismo patrón que el resto).
  gridEl.querySelectorAll("[data-wishlist-index]").forEach((btn) => {
    btn.addEventListener("click", () => openWishlistForm(items[Number(btn.dataset.wishlistIndex)]));
  });
  gridEl.querySelectorAll("[data-wishlist-check]").forEach((input) => {
    input.addEventListener("change", () => {
      const item = items[Number(input.dataset.wishlistCheck)];
      const changes = { purchased: input.checked };
      // Al marcar: fecha de compra la primera vez; al desmarcar: se
      // limpia (totales prestados).
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
// Formulario (ventana genérica #item-modal)
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
        // Si el usuario borra la foto, se guarda null y la tarjeta
        // vuelve al placeholder.
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
// Chips de filtro (delegación en la barra del partial)
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
// Setup (lo llama app.js una vez por snapshot del grupo)
// -------------------------------------------------------------

/**
 * Conecta la lista de deseos con la app: wiring del botón «Añadir»,
 * chips y estado de datos. Lo usa app.js.
 * @param {Object} ctx - Contexto de la aplicación (ctx de app.js).
 * @returns {{ setWishlistItems: Function }}
 */
export function setupWishlist(ctx) {
  ctxRef = ctx;

  return {
    // Lo llama app.js en cada snapshot del grupo wishlist.
    setWishlistItems: (items) => {
      wishlistItems = items || [];
      renderWishlist();
    },
    // Lo llama loadOcioPartial de app.js cuando el partial con el
    // botón «Añadir» y los chips ya está en el DOM (lazy loading:
    // el markup no existe hasta entonces).
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
