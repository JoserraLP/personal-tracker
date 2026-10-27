// =============================================================
// section-lists — the two PRIVATE list sections of Ocio:
//   - Wishlist («Compras»): things to buy.
//   - Experiences («Experiencias»): experiences done or to do.
// Both are the SAME kind of section (ADR-119: switchable list like
// the Recipes one), so they are built from ONE factory: cards in a
// vertical list, filter chips, editing in the generic window and a
// live subscription per section.
//
// The module receives the app context (ctx) with the data access
// functions (repo pattern: it does not talk to Firebase directly)
// and renders inside the tab (the skeleton HTML lives in
// ocio/compras.html / ocio/experiences.html, loaded as partials).
// The pure parts (validation, formatting) are separated so they can
// be tested without the DOM.
// =============================================================

import * as ui from "./ui.js";
import { trapFocus } from "./focus-utils.js";

// -------------------------------------------------------------
// Pure parts (testable without DOM)
// -------------------------------------------------------------

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Normalizes user URLs: if they typed a domain without scheme
// ("www.dominio.com/xxx"), we prepend https://. Anything else that
// does not look like a URL returns null.
export function sanitizeListUrl(value) {
  const v = (value || "").trim();
  if (!v) return null;
  if (/^https?:\/\/\S+$/i.test(v)) return v;
  if (/^(?:www\.)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(v)) return "https://" + v;
  return null;
}

// Price format for the card: "12,50 €" (if there is a price) or "".
export function formatWishlistPrice(price) {
  const p = Number(price);
  if (!Number.isFinite(p) || p <= 0) return "";
  return p.toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €";
}

// Date format for the experience card: dd/mm/yyyy (or "").
export function formatExperienceDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

// Validates the wishlist draft. Returns { ok, errors: [], data }:
// the title is the only required field; the price, if provided, must
// be a reasonable number (≥ 0); the product/photo URLs, if provided,
// must be valid (http/https with domain).
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

  const urlClean = sanitizeListUrl(url);
  if (url && url.trim() && !urlClean) errors.push("La URL del producto no es válida.");
  const photoClean = sanitizeListUrl(photoUrl);
  if (photoUrl && photoUrl.trim() && !photoClean) errors.push("La URL de la foto no es válida.");

  return {
    ok: errors.length === 0,
    errors,
    data: { title: titleTrimmed, price, url: urlClean, photoUrl: photoClean },
  };
}

// Validates the experience draft. The title is required; the date,
// optional, must be ISO (yyyy-mm-dd); the description is free text.
export function validateExperienceDraft(title, dateText, description) {
  const errors = [];
  const titleTrimmed = (title || "").trim();
  if (!titleTrimmed) errors.push("El título es obligatorio.");

  let date = null;
  const dateRaw = (dateText || "").trim();
  if (dateRaw) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) date = dateRaw;
    else errors.push("La fecha no es válida (formato yyyy-mm-dd).");
  }

  return {
    ok: errors.length === 0,
    errors,
    data: { title: titleTrimmed, date, description: (description || "").trim() },
  };
}

// -------------------------------------------------------------
// Cards and form (the HTML of each section)
// -------------------------------------------------------------

const PLACEHOLDER_PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='140'><rect width='100%' height='100%' fill='none' stroke='currentColor' stroke-opacity='0.3' stroke-dasharray='6 4'/><text x='50%' y='52%' font-family='sans-serif' font-size='14' fill='currentColor' fill-opacity='0.5' text-anchor='middle'>Sin foto</text></svg>`
  );

function wishlistCardHtml(item, index) {
  return `
  <article class="wishlist-card ${item.purchased ? "wishlist-card--comprado" : ""}">
    <button type="button" class="wishlist-card__open" data-index="${index}"
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
        <input type="checkbox" data-check="${index}" ${item.purchased ? "checked" : ""} />
        <span>Comprado</span>
      </label>
      <button type="button" class="wishlist-card__delete" data-delete="${index}"
              aria-label="Borrar ${escapeHtml(item.title)}">🗑️</button>
    </div>
  </article>`;
}

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

function experienceCardHtml(item, index) {
  return `
  <article class="experience-card ${item.done ? "experience-card--hecha" : ""}">
    <button type="button" class="experience-card__open" data-index="${index}"
            title="${escapeHtml(item.title)}" aria-label="Editar ${escapeHtml(item.title)}">
      <div class="experience-card__body">
        <div class="experience-card__title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
        ${item.date ? `<div class="experience-card__date">${escapeHtml(formatExperienceDate(item.date))}</div>` : ""}
        <div class="experience-card__desc" title="${escapeHtml(item.description || "")}">${escapeHtml(item.description || "")}</div>
      </div>
    </button>
    <div class="experience-card__actions">
      <label class="experience-card__check">
        <input type="checkbox" data-check="${index}" ${item.done ? "checked" : ""} />
        <span>${item.done ? "Hecha" : "Por hacer"}</span>
      </label>
      <button type="button" class="experience-card__delete" data-delete="${index}"
              aria-label="Borrar ${escapeHtml(item.title)}">🗑️</button>
    </div>
  </article>`;
}

function experienceFormHtml(item) {
  const editing = !!item?.id;
  return `
  <form id="experience-form" class="manual-form">
    <h3 class="manual-form__title">${editing ? "Editar experiencia" : "Añadir a la lista de experiencias"}</h3>
    <div class="field-group">
      <label for="experience-title">Título *</label>
      <input id="experience-title" class="manual-input" maxlength="120" required
             value="${escapeHtml(item?.title || "")}" />
    </div>
    <div class="field-group">
      <label for="experience-date">Fecha — opcional</label>
      <input id="experience-date" type="date" class="manual-input" value="${escapeHtml(item?.date || "")}" />
    </div>
    <div class="field-group">
      <label>¿Hecha?</label>
      <label class="experience-card__check">
        <input id="experience-done" type="checkbox" ${item?.done ? "checked" : ""} />
        <span>${item?.done ? "Hecha" : "Pendiente"}</span>
      </label>
    </div>
    <div class="field-group">
      <label for="experience-desc">Descripción — opcional</label>
      <textarea id="experience-desc" class="manual-input" rows="4" maxlength="2000">${escapeHtml(item?.description || "")}</textarea>
    </div>
    <div id="experience-form-errors" class="manual-form__errors hidden"></div>
    <div class="manual-form__actions">
      <button type="submit" class="btn btn--primary">Guardar</button>
      <button type="button" class="btn btn--outline" id="btn-experience-cancel">Cancelar</button>
    </div>
  </form>`;
}

// -------------------------------------------------------------
// Section factory (the shared engine of the two lists)
// -------------------------------------------------------------

/**
 * Builds one private list section.
 *
 * @param {Object} section — config:
 *   crud        { add, update, delete } — method names of ctx
 *   doneField / doneAtField              — mark field + date mark
 *           ("purchased"/"purchasedAt", "done"/"doneAt")
 *   chips       { attr, scope, selector }
 *   listId / emptyId / addBtnId          — DOM ids of the partial
 *   cardHtml(item, index) / formHtml(item?)
 *   collectDraft(content)                — validates the form → { ok, errors, data }
 *   newItemDefaults(data)                — defaults for a NEW item
 *   texts       { empty, filtered, deleted(title) }
 */
function createListSection(section) {
  let ctxRef = null;
  let items = [];
  let filter = "todos";
  let modalTrapCleanup = null;

  function render() {
    const listEl = document.getElementById(section.listId);
    const emptyEl = document.getElementById(section.emptyId);
    if (!listEl || !emptyEl) return;

    const shown =
      filter === "todos"
        ? items
        : items.filter((i) => Boolean(i[section.doneField]) === (filter === section.doneChipValue));

    if (!shown.length) {
      emptyEl.textContent = items.length ? section.texts.filtered : section.texts.empty;
      listEl.innerHTML = "";
      emptyEl.classList.remove("hidden");
      return;
    }
    emptyEl.classList.add("hidden");

    listEl.innerHTML = shown.map((item, index) => section.cardHtml(item, index)).join("");

    // Wiring per card. The list is repainted entirely on each
    // snapshot, so the listeners are ephemeral (same pattern as the
    // rest).
    listEl.querySelectorAll("[data-index]").forEach((btn) => {
      btn.addEventListener("click", () => openForm(shown[Number(btn.dataset.index)]));
    });
    listEl.querySelectorAll("[data-check]").forEach((input) => {
      input.addEventListener("change", () => {
        const item = shown[Number(input.dataset.check)];
        const changes = { [section.doneField]: input.checked };
        // When checked: date of the FIRST mark; when unchecked, it
        // is cleared.
        if (input.checked) {
          if (!item[section.doneAtField]) {
            changes[section.doneAtField] = new Date().toISOString().slice(0, 10);
          }
        } else {
          changes[section.doneAtField] = null;
        }
        ctxRef[section.crud.update](ctxRef.getCurrentUser().uid, item.id, changes).catch((err) => {
          console.error("No se pudo actualizar el elemento de la lista:", err);
          ui.showToast("No se pudo actualizar el elemento de la lista.");
        });
      });
    });
    listEl.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = shown[Number(btn.dataset.delete)];
        if (confirm(section.texts.deleted(item.title))) {
          ctxRef[section.crud.delete](ctxRef.getCurrentUser().uid, item.id);
        }
      });
    });
  }

  function openForm(item) {
    const modal = document.getElementById("item-modal");
    const content = document.getElementById("modal-content");
    content.innerHTML = section.formHtml(item);

    content.querySelector("[id$='-cancel']")?.addEventListener("click", () => ui.closeModal());
    content.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const draft = section.collectDraft(content);
      const errorsBox = content.querySelector(".manual-form__errors");
      if (!draft.ok) {
        errorsBox.textContent = draft.errors.join(" ");
        errorsBox.classList.remove("hidden");
        return;
      }
      try {
        if (item?.id) {
          await ctxRef[section.crud.update](ctxRef.getCurrentUser().uid, item.id, draft.data);
        } else {
          await ctxRef[section.crud.add](ctxRef.getCurrentUser().uid, section.newItemDefaults(draft.data));
        }
        ui.closeModal();
      } catch (err) {
        console.error("No se pudo guardar el elemento de la lista:", err);
        errorsBox.textContent = "No se pudo guardar: " + (err.message || err);
        errorsBox.classList.remove("hidden");
      }
    });

    if (modalTrapCleanup) modalTrapCleanup();
    modal._previousActiveElement = document.activeElement;
    modal._focusTrapCleanup = null;
    modalTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
    modal.classList.remove("hidden");
    content.querySelector("input")?.focus();
  }

  function wireControls() {
    // Chips (delegation in the partial's bar, wired once)
    const chipsBar = document.querySelector(`[data-${section.chips.attr}-scope="${section.chips.scope}"]`);
    if (chipsBar && !chipsBar.dataset.sectionChipsWired) {
      chipsBar.dataset.sectionChipsWired = "1";
      chipsBar.addEventListener("click", (e) => {
        const chip = e.target.closest(section.chips.selector);
        if (!chip) return;
        filter = chip.dataset[section.chips.filterAttr];
        chipsBar.querySelectorAll(section.chips.selector).forEach((c) => {
          const isActive = c.dataset[section.chips.filterAttr] === filter;
          c.classList.toggle("is-active", isActive);
          c.setAttribute("aria-pressed", String(isActive));
        });
        render();
      });
    }
    const addBtn = document.getElementById(section.addBtnId);
    if (addBtn && !addBtn.dataset.sectionAddWired) {
      addBtn.dataset.sectionAddWired = "1";
      addBtn.addEventListener("click", () => openForm(null));
    }
  }

  return {
    bind: (ctx) => {
      ctxRef = ctx;
    },
    setItems: (next) => {
      items = next || [];
      render();
    },
    wireControls,
    reset: () => {
      items = [];
      filter = "todos";
      if (modalTrapCleanup) {
        modalTrapCleanup();
        modalTrapCleanup = null;
      }
      ctxRef = null;
    },
  };
}

// -------------------------------------------------------------
// Sections (the two configs + their setup)
// -------------------------------------------------------------

function wishlistCollectDraft(content) {
  const draft = validateWishlistDraft(
    content.querySelector("#wishlist-title").value,
    content.querySelector("#wishlist-price").value,
    content.querySelector("#wishlist-url").value,
    content.querySelector("#wishlist-photo").value
  );
  // The description lives in the textarea of the same form.
  draft.data.description = content.querySelector("#wishlist-desc").value.trim();
  return draft;
}

const WISHLIST_SECTION = {
  crud: { add: "addWishlistItem", update: "updateWishlistItem", delete: "deleteWishlistItem" },
  doneField: "purchased",
  doneAtField: "purchasedAt",
  doneChipValue: "comprado",
  chips: { attr: "wishlist", scope: "compras", selector: ".wishlist-chip", filterAttr: "wishlistFilter" },
  listId: "wishlist-grid",
  emptyId: "wishlist-empty",
  addBtnId: "btn-wishlist-add",
  cardHtml: wishlistCardHtml,
  formHtml: wishlistFormHtml,
  collectDraft: wishlistCollectDraft,
  // If the user removes the photo, null is saved and the card comes
  // back to the placeholder.
  newItemDefaults: (data) => ({ ...data, purchased: false, purchasedAt: null }),
  texts: {
    empty: "Tu lista de cosas que comprar está vacía. Pulsa «Añadir cosa» para registrar la primera.",
    filtered: "No hay ninguna cosa con ese filtro.",
    deleted: (title) => `¿Borrar «${title}» de la lista de compras?`,
  },
};

const EXPERIENCE_SECTION = {
  crud: { add: "addExperience", update: "updateExperience", delete: "deleteExperience" },
  doneField: "done",
  doneAtField: "doneAt",
  doneChipValue: "hecha",
  chips: { attr: "experience", scope: "experiencias", selector: ".experience-chip", filterAttr: "experienceFilter" },
  listId: "experiences-list",
  emptyId: "experiences-empty",
  addBtnId: "btn-experience-add",
  cardHtml: experienceCardHtml,
  formHtml: experienceFormHtml,
  collectDraft: (content) => {
    const draft = validateExperienceDraft(
      content.querySelector("#experience-title").value,
      content.querySelector("#experience-date").value,
      content.querySelector("#experience-desc").value
    );
    draft.data.done = content.querySelector("#experience-done").checked;
    return draft;
  },
  newItemDefaults: (data) => ({
    ...data,
    doneAt: data.done ? new Date().toISOString().slice(0, 10) : null,
  }),
  texts: {
    empty: "Tu lista de experiencias está vacía. Pulsa «Añadir experiencia» para registrar la primera.",
    filtered: "No hay ninguna experiencia con ese filtro.",
    deleted: (title) => `¿Borrar «${title}» de la lista de experiencias?`,
  },
};

// Module singletons: the design keeps one section instance alive for
// the app's lifetime (same state pattern as the old modules).
const wishlistApiObject = createListSection(WISHLIST_SECTION);
const experienceApiObject = createListSection(EXPERIENCE_SECTION);

/**
 * Connects the wish list (Shopping) to the app.
 * @param {Object} ctx - Application context (ctx from app.js).
 * @returns {{ setWishlistItems: Function, wireControls: Function, reset: Function }}
 */
export function setupWishlist(ctx) {
  wishlistApiObject.bind(ctx);
  return {
    setWishlistItems: wishlistApiObject.setItems,
    wireControls: wishlistApiObject.wireControls,
    reset: wishlistApiObject.reset,
  };
}

/**
 * Connects the Experiences list to the app.
 * @param {Object} ctx - Application context (ctx from app.js).
 * @returns {{ setExperienceItems: Function, wireControls: Function, reset: Function }}
 */
export function setupExperiences(ctx) {
  experienceApiObject.bind(ctx);
  return {
    setExperienceItems: experienceApiObject.setItems,
    wireControls: experienceApiObject.wireControls,
    reset: experienceApiObject.reset,
  };
}

/** Logout: clears the state of BOTH sections. */
export function resetSectionLists() {
  wishlistApiObject.reset();
  experienceApiObject.reset();
}
