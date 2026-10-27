// =============================================================
// Experiences (Ocio tab): experiences done or to do some day, with
// title, description, date (optional) and whether it is done.
//
// Mirror of wishlist.js (private collection, simple module): it
// receives the app context (ctx) with the data access functions
// (repo pattern: it does not talk to Firebase directly), renders
// inside the tab (the skeleton HTML lives in ocio/experiences.html,
// loaded as a partial) and keeps the pure parts (validation) apart
// so they can be tested without the DOM.
// =============================================================

import * as ui from "./ui.js";
import { trapFocus } from "./focus-utils.js";

// -------------------------------------------------------------
// Pure parts (testable without DOM)
// -------------------------------------------------------------

// Validates the form draft. Returns { ok, errors: [] }:
// the title is the only required field; the date, if provided, must
// be ISO (yyyy-mm-dd); the description is free text.
export function validateExperienceDraft(title, dateText, description) {
  const errors = [];
  const titleTrimmed = (title || "").trim();
  if (!titleTrimmed) errors.push("El título es obligatorio.");

  let date = null;
  const dateRaw = (dateText || "").trim();
  if (dateRaw) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      date = dateRaw;
    } else {
      errors.push("La fecha no es válida (formato yyyy-mm-dd).");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    data: {
      title: titleTrimmed,
      date,
      description: (description || "").trim(),
    },
  };
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Date format for the card: the same Spanish formatting as the rest
// of the web (dates.js via ctx.formatDateEs is not in the pure part:
// the render resolves it as callback; here with the local util).
function formatExperienceDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

// -------------------------------------------------------------
// State and render (the panel is already in the DOM: the partial loaded it)
// -------------------------------------------------------------

let ctxRef = null;
let experienceItems = [];
let experienceFilter = "todos";
let modalTrapCleanup = null;

function renderExperiences() {
  const listEl = document.getElementById("experiences-list");
  const emptyEl = document.getElementById("experiences-empty");
  if (!listEl || !emptyEl) return;

  const items =
    experienceFilter === "todos"
      ? experienceItems
      : experienceItems.filter((i) => i.done === (experienceFilter === "hecha"));

  if (!items.length) {
    if (experienceItems.length) {
      emptyEl.textContent = "No hay ninguna experiencia con ese filtro.";
    } else {
      emptyEl.textContent =
        "Tu lista de experiencias está vacía. Pulsa «Añadir experiencia» para registrar la primera.";
    }
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  listEl.innerHTML = items
    .map(
      (item, index) => `
      <article class="experience-card ${item.done ? "experience-card--hecha" : ""}">
        <button type="button" class="experience-card__open" data-experience-index="${index}"
                title="${escapeHtml(item.title)}" aria-label="Editar ${escapeHtml(item.title)}">
          <div class="experience-card__body">
            <div class="experience-card__title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
            ${item.date ? `<div class="experience-card__date">${escapeHtml(formatExperienceDate(item.date))}</div>` : ""}
            <div class="experience-card__desc" title="${escapeHtml(item.description || "")}">${escapeHtml(item.description || "")}</div>
          </div>
        </button>
        <div class="experience-card__actions">
          <label class="experience-card__check">
            <input type="checkbox" data-experience-check="${index}" ${item.done ? "checked" : ""} />
            <span>${item.done ? "Hecha" : "Por hacer"}</span>
          </label>
          <button type="button" class="experience-card__delete" data-experience-delete="${index}"
                  aria-label="Borrar ${escapeHtml(item.title)}">🗑️</button>
        </div>
      </article>`
    )
    .join("");

  // Wiring per card. The list is repainted entirely on each snapshot,
  // so the listeners are ephemeral (same pattern as the rest).
  listEl.querySelectorAll("[data-experience-index]").forEach((btn) => {
    btn.addEventListener("click", () => openExperienceForm(items[Number(btn.dataset.experienceIndex)]));
  });
  listEl.querySelectorAll("[data-experience-check]").forEach((input) => {
    input.addEventListener("change", () => {
      const item = items[Number(input.dataset.experienceCheck)];
      const changes = { done: input.checked };
      if (input.checked) {
        if (!item.doneAt) changes.doneAt = new Date().toISOString().slice(0, 10);
      } else {
        changes.doneAt = null;
      }
      ctxRef.updateExperience(ctxRef.getCurrentUser().uid, item.id, changes).catch((err) => {
        console.error("No se pudo actualizar la experiencia:", err);
        ui.showToast?.("No se pudo actualizar la experiencia.");
      });
    });
  });
  listEl.querySelectorAll("[data-experience-delete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = items[Number(btn.dataset.experienceDelete)];
      if (confirm(`¿Borrar «${item.title}» de la lista de experiencias?`)) {
        ctxRef.deleteExperience(ctxRef.getCurrentUser().uid, item.id);
      }
    });
  });
}

// -------------------------------------------------------------
// Form (generic window #item-modal)
// -------------------------------------------------------------

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

export function openExperienceForm(item) {
  const modal = document.getElementById("item-modal");
  const content = document.getElementById("modal-content");
  content.innerHTML = experienceFormHtml(item);

  content.querySelector("#btn-experience-cancel").addEventListener("click", () => ui.closeModal());
  content.querySelector("#experience-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const draft = validateExperienceDraft(
      content.querySelector("#experience-title").value,
      content.querySelector("#experience-date").value,
      content.querySelector("#experience-desc").value
    );
    const errorsBox = content.querySelector("#experience-form-errors");
    if (!draft.ok) {
      errorsBox.textContent = draft.errors.join(" ");
      errorsBox.classList.remove("hidden");
      return;
    }
    const data = { ...draft.data, done: content.querySelector("#experience-done").checked };
    try {
      if (item?.id) {
        await ctxRef.updateExperience(ctxRef.getCurrentUser().uid, item.id, data);
      } else {
        await ctxRef.addExperience(ctxRef.getCurrentUser().uid, {
          ...data,
          done: data.done,
          doneAt: data.done ? new Date().toISOString().slice(0, 10) : null,
        });
      }
      ui.closeModal();
    } catch (err) {
      console.error("No se pudo guardar la experiencia:", err);
      errorsBox.textContent = "No se pudo guardar: " + (err.message || err);
      errorsBox.classList.remove("hidden");
    }
  });

  if (modalTrapCleanup) modalTrapCleanup();
  modal._previousActiveElement = document.activeElement;
  modal._focusTrapCleanup = null;
  modalTrapCleanup = trapFocus(modal.querySelector(".modal__card"));
  modal.classList.remove("hidden");
  content.querySelector("#experience-title")?.focus();
}

// -------------------------------------------------------------
// Filter chips (delegation in the partial's bar)
// -------------------------------------------------------------

function wireChips() {
  const chips = document.querySelector('[data-experience-scope="experiencias"]');
  if (!chips) return;
  chips.addEventListener("click", (e) => {
    const chip = e.target.closest(".experience-chip");
    if (!chip) return;
    experienceFilter = chip.dataset.experienceFilter;
    document.querySelectorAll('[data-experience-scope="experiencias"] .experience-chip').forEach((c) => {
      const isActive = c.dataset.experienceFilter === experienceFilter;
      c.classList.toggle("is-active", isActive);
      c.setAttribute("aria-pressed", String(isActive));
    });
    renderExperiences();
  });
}

// -------------------------------------------------------------
// Setup (called by app.js once per group snapshot)
// -------------------------------------------------------------

/**
 * Connects the experience list to the app: wiring of the «Añadir»
 * button, chips and data state. Used by app.js.
 * @param {Object} ctx - Application context (ctx from app.js).
 * @returns {{ setExperienceItems: Function, wireControls: Function }}
 */
export function setupExperiences(ctx) {
  ctxRef = ctx;

  return {
    // Called by app.js on each snapshot of the experiences group.
    setExperienceItems: (items) => {
      experienceItems = items || [];
      renderExperiences();
    },
    // Called by loadOcioPartial of app.js when the partial with the
    // «Añadir» button and the chips is already in the DOM (lazy
    // loading: the markup does not exist until then).
    wireControls: wireControls,
  };
}

function wireControls() {
  wireChips();
  const addBtn = document.getElementById("btn-experience-add");
  if (addBtn && !addBtn.dataset.experienceWired) {
    addBtn.dataset.experienceWired = "1";
    addBtn.addEventListener("click", () => openExperienceForm(null));
  }
}

/** Logout: clears the in-memory state so the data of the previous user
    are not shown to the next. */
export function resetExperiencesData() {
  experienceItems = [];
  experienceFilter = "todos";
  if (modalTrapCleanup) {
    modalTrapCleanup();
    modalTrapCleanup = null;
  }
  ctxRef = null;
}
