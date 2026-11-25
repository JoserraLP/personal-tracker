// =============================================================
// `CollectionsPanel` — panel de colecciones propias (spec 03 UI-14).
//
// Specs cubiertas:
//   spec 03 — UI-14 (`CollectionsPanel`: lista de colecciones con
//     `name`, nº de ítems y `updatedAt`; formulario de crear/editar/
//     borrar; selector «Asignar a colección» desde la `MediaCard`),
//     REQ-206 (≤20 colecciones por usuario ⇒ la 21.ª se rechaza con
//     «Máximo 20 colecciones» y SIN escritura, AC-126),
//     REQ-207 (la vista de detalle pinta `MediaCard` y «Quitar» solo
//     actualiza `itemIds`, AC-127),
//     REQ-208 (borrar una colección NO toca `entries` ni `catalog`,
//     AC-128; borrar una entry NO toca la colección).
//   spec 02 — AC-116: el detalle usa la MISMA `MediaCard` compartida
//     (`createMediaCard` de `js/ui/media-card.js`).
//
// Convenciones (spec 00):
//   REQ-C1 — parte PURA (sin DOM, importable en Node/vitest) y
//            parte DOM (única que construye nodos).
//   REQ-C2 — cabecera con los IDs de spec.
//   REQ-C5 — textos de UI en español; enums en inglés mayúsculas.
//   REQ-C6 — tipos documentados con JSDoc (`@typedef`).
//
// Estructura del DOM:
//
//   <section class="collections-panel">
//     <div class="collections-panel__toolbar">
//       <button class="btn btn--primary">Nueva colección</button>
//       <p class="collections-panel__status" role="status">
//     </div>
//     <form class="collections-panel__form" novalidate>
//       <h3 class="collections-panel__form-title">
//       <p class="collections-panel__error" role="alert">
//       <label class="form-field">  Nombre
//       <label class="form-field">  Descripción
//       <button type="submit">Guardar colección</button>
//       <button type="button">Cancelar</button>
//     </form>
//     <div class="collections-panel__list-view">
//       <p class="collections-panel__empty">
//       <ul class="collections__list">
//         <li class="collection-card">
//           <div class="collection-card__header"><h3 class="collection-card__name">
//           <p class="collection-card__count">    (nº de ítems)
//           <p class="collection-card__description">
//           <p class="collection-card__updated">  (updatedAt)
//           <button>Abrir</button> <button>Editar</button> <button>Borrar</button>
//     </div>
//     <div class="collection-detail__header">…</div>
//     <ul class="media-grid">   ← `MediaCard` + botón «Quitar»
// =============================================================

import { validateCollection } from "../catalog.js";
import {
  MAX_COLLECTIONS_PER_USER,
  MAX_COLLECTION_ITEMS,
  collectionRepository,
} from "../repositories/collection-repository.js";
import { catalogRepository } from "../repositories/catalog-repository.js";
import { createMediaCard } from "./media-card.js";

export { MAX_COLLECTIONS_PER_USER, MAX_COLLECTION_ITEMS };

// -------------------------------------------------------------
// 1. Constantes y etiquetas (REQ-C5, DB-104, DB-123)
// -------------------------------------------------------------

/** Mensaje de validación al superar el máximo de colecciones (AC-126). */
export const MAX_COLLECTIONS_MESSAGE =
  "Máximo 20 colecciones por usuario. Elimina alguna antes de crear otra.";

/** Texto del estado vacío del listado de colecciones. */
export const EMPTY_COLLECTIONS_TEXT = "Todavía no tienes colecciones.";

/** Texto del estado vacío del detalle de una colección. */
export const EMPTY_COLLECTION_ITEMS_TEXT = "Esta colección todavía no tiene títulos.";

/** Longitud máxima del nombre (DB-123). */
export const COLLECTION_NAME_MAX = 60;

/** Longitud máxima de la descripción (DB-123). */
export const COLLECTION_DESCRIPTION_MAX = 300;

/** Etiqueta de la acción de abrir una colección. */
export const OPEN_COLLECTION_LABEL = "Abrir";

/** Etiqueta de la acción de quitar un ítem de una colección (AC-127). */
export const REMOVE_ITEM_LABEL = "Quitar";

// -------------------------------------------------------------
// 2. Tipos documentales (REQ-C6)
// -------------------------------------------------------------

/**
 * @typedef {object} CollectionSummary
 * @property {string} id
 * @property {string} name
 * @property {string|null} description
 * @property {string[]} itemIds
 * @property {number} itemCount
 * @property {string} itemCountLabel
 * @property {string} updatedAtLabel
 */

/**
 * @typedef {{ ok: true, value?: * } | { ok: false, code?: string, message?: string }} PanelResult
 */

// -------------------------------------------------------------
// 3. Parte pura: validación y etiquetas (UI-14, AC-126)
// -------------------------------------------------------------

/**
 * ¿El valor es una fecha utilizable?
 * @param {*} value
 * @returns {Date|null}
 */
function toDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (value && typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  return null;
}

/**
 * Milisegundos de una fecha (`updatedAt`), o `null`.
 * @param {*} value
 * @returns {number|null}
 */
function toMs(value) {
  const date = toDate(value);
  return date === null ? null : date.getTime();
}

/**
 * Nº de ítems de una colección en español ("1 ítem", "3 ítems").
 * @param {*} count
 * @returns {string}
 */
export function formatItemCount(count) {
  const total =
    typeof count === "number" && Number.isFinite(count) && count > 0
      ? Math.floor(count)
      : 0;
  return `${total} ${total === 1 ? "ítem" : "ítems"}`;
}

/**
 * Fecha de actualización en formato español `dd/mm/aaaa` ("" si no hay
 * fecha). Determinista: no depende de `Intl` ni del locale del sistema.
 * @param {*} value
 * @returns {string}
 */
export function formatUpdatedAt(value) {
  const date = toDate(value);
  if (date === null) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

/**
 * Etiqueta de `updatedAt` para la UI ("Actualizada el 12/03/2026").
 * @param {*} value
 * @returns {string}
 */
export function formatUpdatedAtLabel(value) {
  const text = formatUpdatedAt(value);
  return text === "" ? "Sin fecha" : `Actualizada el ${text}`;
}

/**
 * Normaliza una colección al modelo que pinta la vista (UI-14).
 * @param {*} collection
 * @returns {CollectionSummary}
 */
export function buildCollectionSummary(collection) {
  const src =
    collection && typeof collection === "object" && !Array.isArray(collection)
      ? collection
      : {};
  const itemIds = Array.isArray(src.itemIds)
    ? src.itemIds.filter((id) => typeof id === "string" && id.trim() !== "")
    : [];
  const name =
    typeof src.name === "string" && src.name.trim() !== ""
      ? src.name.trim()
      : "Sin nombre";
  return {
    id: typeof src.id === "string" ? src.id : "",
    name,
    description:
      typeof src.description === "string" && src.description.trim() !== ""
        ? src.description.trim()
        : null,
    itemIds,
    itemCount: itemIds.length,
    itemCountLabel: formatItemCount(itemIds.length),
    updatedAtLabel: formatUpdatedAtLabel(src.updatedAt),
  };
}

/**
 * Orden del listado de colecciones (DB-117): `updatedAt` desc + id asc.
 * @param {object[]} collections
 * @returns {object[]} copia ordenada
 */
export function sortCollectionsByUpdatedAt(collections) {
  const list = Array.isArray(collections) ? collections.slice() : [];
  return list.sort((a, b) => {
    const ta = toMs(a?.updatedAt);
    const tb = toMs(b?.updatedAt);
    if (ta === null && tb === null) return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
    if (ta === null) return 1;
    if (tb === null) return -1;
    if (ta === tb) return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
    return tb - ta;
  });
}

/**
 * Valida el formulario de colección (DB-123, AC-126).
 *
 * `name` 1–60, `description` ≤300 y, al CREAR, el máximo de 20
 * colecciones por usuario (REQ-206): con 20 ya existentes la 21.ª se
 * rechaza con «Máximo 20 colecciones…» y NO se escribe nada.
 *
 * @param {{name?: string, description?: string}} input
 * @param {{existingCount?: number, editing?: boolean}} [options]
 * @returns {{valid: boolean, errors: string[], name: string, description: string}}
 */
export function validateCollectionForm(input, options = {}) {
  const source = input && typeof input === "object" ? input : {};
  const opts = options && typeof options === "object" ? options : {};
  const name = typeof source.name === "string" ? source.name.trim() : "";
  const description =
    typeof source.description === "string" ? source.description.trim() : "";

  const errors = [];
  const report = validateCollection({ name, description, itemIds: [] });
  if (!report.valid) errors.push(...report.errors);

  const existingCount =
    typeof opts.existingCount === "number" && Number.isFinite(opts.existingCount)
      ? opts.existingCount
      : 0;
  if (opts.editing !== true && existingCount >= MAX_COLLECTIONS_PER_USER) {
    // AC-126: la 21.ª colección ⇒ validación ANTES de escribir.
    errors.push(MAX_COLLECTIONS_MESSAGE);
  }

  return { valid: errors.length === 0, errors, name, description };
}

// -------------------------------------------------------------
// 4. Parte DOM: `CollectionsPanel` (UI-14)
// -------------------------------------------------------------

/** Devuelve el documento DOM a usar (inyectable para tests). */
function resolveDocument(options) {
  const candidate = options && typeof options === "object" ? options.document : null;
  const doc = candidate ?? globalThis.document;
  if (!doc || typeof doc.createElement !== "function") {
    throw new Error("No hay un documento DOM disponible para crear el panel de colecciones.");
  }
  return doc;
}

/**
 * Crea el panel de colecciones propias (UI-14).
 *
 * @param {{
 *   repository?: object,
 *   catalogRepository?: object,
 *   getUid?: () => string|null,
 *   mediaCardOptions?: (item: object) => object,
 *   onChange?: (collections: object[]) => void,
 *   onRender?: () => void,
 *   confirm?: (message: string) => boolean|Promise<boolean>,
 *   document?: Document
 * }} [options]
 * @returns {object} controlador del panel
 */
export function createCollectionsPanel(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const doc = resolveDocument(opts);
  const repository = opts.repository ?? collectionRepository;
  const catalog = opts.catalogRepository ?? catalogRepository;
  const getUid = typeof opts.getUid === "function" ? opts.getUid : () => null;
  const buildMediaCardOptions =
    typeof opts.mediaCardOptions === "function" ? opts.mediaCardOptions : () => ({});
  const onChange = typeof opts.onChange === "function" ? opts.onChange : null;
  const onRender = typeof opts.onRender === "function" ? opts.onRender : null;
  const confirmDelete =
    typeof opts.confirm === "function"
      ? opts.confirm
      : (message) =>
          // Sin `confirm` disponible NO se borra nada (borrado aborted).
          typeof globalThis.confirm === "function" ? globalThis.confirm(message) : false;

  /**
   * Estado del panel.
   * @type {{
   *   collections: object[],
   *   openCollectionId: string|null,
   *   items: object[],
   *   loading: boolean,
   *   busy: boolean,
   *   editingId: string|null
   * }}
   */
  const state = {
    collections: [],
    openCollectionId: null,
    items: [],
    loading: false,
    busy: false,
    editingId: null,
  };

  // --- Raíz -------------------------------------------------
  const root = doc.createElement("section");
  root.className = "collections-panel";
  root.setAttribute("aria-label", "Colecciones");
  root.dataset.collectionsPanel = "true";

  // --- Barra de herramientas --------------------------------
  const toolbar = doc.createElement("div");
  toolbar.className = "collections-panel__toolbar";
  const newButton = doc.createElement("button");
  newButton.type = "button";
  newButton.className = "btn btn--primary";
  newButton.textContent = "Nueva colección";
  newButton.setAttribute("aria-expanded", "false");
  newButton.setAttribute("aria-controls", "collections-panel-form");
  newButton.addEventListener("click", () => openForm(null));
  const status = doc.createElement("p");
  status.className = "collections-panel__status";
  status.setAttribute("role", "status");
  toolbar.append(newButton, status);

  // --- Formulario (crear/editar) ---------------------------
  const form = doc.createElement("form");
  form.className = "collections-panel__form";
  form.id = "collections-panel-form";
  form.noValidate = true;
  form.hidden = true;

  const formTitle = doc.createElement("h3");
  formTitle.className = "collections-panel__form-title";
  formTitle.textContent = "Nueva colección";

  const error = doc.createElement("p");
  error.className = "collections-panel__error";
  // El id que referencia `aria-describedby` del campo de nombre.
  error.id = "collections-panel-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const nameField = doc.createElement("label");
  nameField.className = "form-field";
  const nameLabel = doc.createElement("span");
  nameLabel.className = "form-field__label";
  nameLabel.textContent = "Nombre *";
  const nameInput = doc.createElement("input");
  nameInput.type = "text";
  nameInput.name = "name";
  nameInput.className = "form-field__input";
  nameInput.maxLength = COLLECTION_NAME_MAX;
  nameInput.required = true;
  nameInput.setAttribute("aria-describedby", "collections-panel-error");
  nameField.append(nameLabel, nameInput);

  const descriptionField = doc.createElement("label");
  descriptionField.className = "form-field";
  const descriptionLabel = doc.createElement("span");
  descriptionLabel.className = "form-field__label";
  descriptionLabel.textContent = "Descripción";
  const descriptionInput = doc.createElement("textarea");
  descriptionInput.name = "description";
  descriptionInput.className = "form-field__textarea";
  descriptionInput.rows = 2;
  descriptionInput.maxLength = COLLECTION_DESCRIPTION_MAX;
  descriptionField.append(descriptionLabel, descriptionInput);

  const formActions = doc.createElement("div");
  formActions.className = "collections-panel__form-actions";
  const submitButton = doc.createElement("button");
  submitButton.type = "submit";
  submitButton.className = "btn btn--primary";
  submitButton.textContent = "Guardar colección";
  const cancelButton = doc.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "btn btn--secondary";
  cancelButton.textContent = "Cancelar";
  cancelButton.addEventListener("click", () => closeForm());
  formActions.append(submitButton, cancelButton);

  form.append(formTitle, error, nameField, descriptionField, formActions);

  // --- Vista de listado -------------------------------------
  const listView = doc.createElement("div");
  listView.className = "collections-panel__list-view";
  const empty = doc.createElement("p");
  empty.className = "collections-panel__empty muted";
  empty.textContent = EMPTY_COLLECTIONS_TEXT;
  empty.hidden = true;
  const list = doc.createElement("ul");
  list.className = "collections__list";
  list.setAttribute("aria-live", "polite");
  listView.append(empty, list);

  // --- Vista de detalle -------------------------------------
  const detail = doc.createElement("div");
  detail.className = "collection-detail";
  detail.hidden = true;
  const detailHeader = doc.createElement("div");
  detailHeader.className = "collection-detail__header";
  const detailEmpty = doc.createElement("p");
  detailEmpty.className = "collection-detail__empty muted";
  detailEmpty.textContent = EMPTY_COLLECTION_ITEMS_TEXT;
  detailEmpty.hidden = true;
  const grid = doc.createElement("ul");
  grid.className = "media-grid";
  grid.setAttribute("aria-live", "polite");
  detail.append(detailHeader, detailEmpty, grid);

  root.append(toolbar, form, listView, detail);

  // -------------------------------------------------------------
  // Utilidades de render
  // -------------------------------------------------------------

  /** Crea un botón con clase y acción. */
  function createButton(label, className, onClick) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  /** Muestra un error en español (REQ-E2). */
  function showError(message) {
    const text = typeof message === "string" ? message : "";
    error.textContent = text;
    error.hidden = text === "";
  }

  /** Oculta el error. */
  function hideError() {
    error.textContent = "";
    error.hidden = true;
  }

  /** Muestra un aviso de estado (`role="status"`). */
  function showStatus(message) {
    status.textContent = typeof message === "string" ? message : "";
  }

  /** Resumen de la colección abierta (o `null`). */
  function findSummary(collectionId) {
    const found = state.collections.find((entry) => entry.id === collectionId);
    return found ? buildCollectionSummary(found) : null;
  }

  /** Sustituye (o añade) una colección en el estado local. */
  function replaceCollection(updated) {
    if (!updated || typeof updated !== "object") return;
    const index = state.collections.findIndex((entry) => entry.id === updated.id);
    if (index === -1) state.collections.push(updated);
    else state.collections[index] = updated;
    state.collections = sortCollectionsByUpdatedAt(state.collections);
  }

  /** Avisa de un cambio en las colecciones (alta/edición/borrado/ítems). */
  function notifyChange() {
    if (!onChange) return;
    try {
      onChange(state.collections.slice());
    } catch {
      // Un callback del consumidor no puede tumbar el panel.
    }
  }

  // -------------------------------------------------------------
  // Formulario
  // -------------------------------------------------------------

  /** Abre el formulario de creación o de edición. */
  function openForm(collection) {
    state.editingId = collection ? collection.id : null;
    const summary = collection ? buildCollectionSummary(collection) : null;
    formTitle.textContent = summary ? "Editar colección" : "Nueva colección";
    submitButton.textContent = summary ? "Guardar cambios" : "Guardar colección";
    nameInput.value = summary ? summary.name === "Sin nombre" ? "" : summary.name : "";
    descriptionInput.value = summary && summary.description ? summary.description : "";
    hideError();
    form.hidden = false;
    newButton.setAttribute("aria-expanded", "true");
    if (typeof nameInput.focus === "function") nameInput.focus();
  }

  /** Cierra el formulario (sin guardar). */
  function closeForm() {
    state.editingId = null;
    form.hidden = true;
    nameInput.value = "";
    descriptionInput.value = "";
    hideError();
    newButton.setAttribute("aria-expanded", "false");
  }

  /**
   * Envío del formulario (REQ-206, AC-126): valida ANTES de escribir;
   * con 20 colecciones la 21.ª muestra «Máximo 20 colecciones…» y NO
   * escribe nada.
   */
  async function handleSubmit(event) {
    event.preventDefault();
    if (state.busy) return;

    const uid = getUid();
    if (typeof uid !== "string" || uid === "") {
      showError("No hay una sesión iniciada.");
      return;
    }

    const report = validateCollectionForm(
      { name: nameInput.value, description: descriptionInput.value },
      {
        existingCount: state.collections.length,
        editing: state.editingId !== null,
      },
    );
    if (!report.valid) {
      showError(report.errors.join(" "));
      if (typeof nameInput.focus === "function") nameInput.focus();
      return;
    }

    state.busy = true;
    submitButton.disabled = true;
    try {
      const result =
        state.editingId !== null
          ? await repository.update(uid, state.editingId, {
              name: report.name,
              description: report.description === "" ? null : report.description,
            })
          : await repository.create(uid, {
              name: report.name,
              description: report.description === "" ? null : report.description,
            });

      if (!result || result.ok !== true) {
        // AC-126: el repositorio también rechaza la 21.ª colección.
        showError(
          (result && result.message) || "No se ha podido guardar la colección.",
        );
        return;
      }

      replaceCollection(result.value);
      closeForm();
      showStatus("Colección guardada.");
      render();
      notifyChange();
    } finally {
      state.busy = false;
      submitButton.disabled = false;
    }
  }

  form.addEventListener("submit", handleSubmit);

  // -------------------------------------------------------------
  // Listado
  // -------------------------------------------------------------

  /** Crea la tarjeta de una colección del listado. */
  function createCollectionCard(summary) {
    const li = doc.createElement("li");
    li.className = "collection-card";
    li.dataset.collectionId = summary.id;

    const header = doc.createElement("div");
    header.className = "collection-card__header";
    const name = doc.createElement("h3");
    name.className = "collection-card__name";
    name.textContent = summary.name;
    header.appendChild(name);
    li.appendChild(header);

    const count = doc.createElement("p");
    count.className = "collection-card__count";
    count.textContent = summary.itemCountLabel;
    li.appendChild(count);

    if (summary.description) {
      const description = doc.createElement("p");
      description.className = "collection-card__description";
      description.textContent = summary.description;
      li.appendChild(description);
    }

    const updated = doc.createElement("p");
    updated.className = "collection-card__updated muted";
    updated.textContent = summary.updatedAtLabel;
    li.appendChild(updated);

    const actions = doc.createElement("div");
    actions.className = "collection-card__actions";
    actions.append(
      createButton(OPEN_COLLECTION_LABEL, "btn btn--secondary", () => {
        void openCollection(summary.id);
      }),
      createButton("Editar", "btn btn--secondary", () => {
        openForm(
          state.collections.find((entry) => entry.id === summary.id) ?? summary,
        );
      }),
      createButton("Borrar", "btn btn--danger", () => {
        void removeCollection(summary.id);
      }),
    );
    li.appendChild(actions);
    return li;
  }

  /** Pinta el listado de colecciones. */
  function renderList() {
    listView.hidden = false;
    detail.hidden = true;
    state.openCollectionId = null;

    const summaries = state.collections.map(buildCollectionSummary);
    empty.hidden = summaries.length > 0;
    list.replaceChildren(...summaries.map((summary) => createCollectionCard(summary)));
  }

  // -------------------------------------------------------------
  // Detalle
  // -------------------------------------------------------------

  /** Añade el botón «Quitar» a una `MediaCard` (AC-127). */
  function appendRemoveButton(card, item, summary) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "media-card__btn media-card__btn--remove";
    button.textContent = REMOVE_ITEM_LABEL;
    button.dataset.action = "remove";
    const title = item && typeof item.title === "string" ? item.title : item?.id ?? "";
    button.setAttribute(
      "aria-label",
      `Quitar «${title}» de la colección «${summary.name}»`,
    );
    button.addEventListener("click", () => {
      void removeItem(item.id);
    });
    const actions = card.querySelector(".media-card__actions");
    if (actions) actions.appendChild(button);
    else card.appendChild(button);
  }

  /** Pinta el detalle de la colección abierta (UI-14, AC-127). */
  function renderDetail() {
    const summary = findSummary(state.openCollectionId);
    listView.hidden = true;
    detail.hidden = false;

    if (!summary) {
      detailHeader.replaceChildren();
      grid.replaceChildren();
      detailEmpty.hidden = false;
      detailEmpty.textContent = EMPTY_COLLECTION_ITEMS_TEXT;
      return;
    }

    const info = doc.createElement("div");
    info.className = "collection-detail__info";
    const name = doc.createElement("h3");
    name.className = "collection-detail__name";
    name.textContent = summary.name;
    info.appendChild(name);
    if (summary.description) {
      const description = doc.createElement("p");
      description.className = "collection-detail__description";
      description.textContent = summary.description;
      info.appendChild(description);
    }
    const count = doc.createElement("p");
    count.className = "collection-card__count";
    count.textContent = summary.itemCountLabel;
    info.appendChild(count);
    const updated = doc.createElement("p");
    updated.className = "collection-card__updated muted";
    updated.textContent = summary.updatedAtLabel;
    info.appendChild(updated);

    const actions = doc.createElement("div");
    actions.className = "collection-detail__actions";
    actions.append(
      createButton("Editar", "btn btn--secondary", () => {
        openForm(
          state.collections.find((entry) => entry.id === summary.id) ?? summary,
        );
      }),
      createButton("Borrar", "btn btn--danger", () => {
        void removeCollection(summary.id);
      }),
      createButton("Volver", "btn btn--secondary", () => {
        closeCollection();
      }),
    );

    detailHeader.replaceChildren(info, actions);

    const items = state.items;
    detailEmpty.hidden = items.length > 0;
    detailEmpty.textContent = EMPTY_COLLECTION_ITEMS_TEXT;

    const fragment = doc.createDocumentFragment();
    for (const item of items) {
      // AC-116: la MISMA `MediaCard` que el catálogo y la búsqueda.
      const card = createMediaCard(item, {
        ...buildMediaCardOptions(item),
        document: doc,
      });
      appendRemoveButton(card, item, summary);
      fragment.appendChild(card);
    }
    grid.replaceChildren(fragment);
  }

  /** Pinta la vista activa (listado o detalle). */
  function render() {
    if (state.openCollectionId) renderDetail();
    else renderList();
    if (onRender) {
      try {
        onRender();
      } catch {
        // Un callback del consumidor no puede tumbar el panel.
      }
    }
  }

  /** Lee los títulos del catálogo de los `itemIds` de la colección. */
  async function loadItems(itemIds) {
    const ids = Array.isArray(itemIds) ? itemIds : [];
    if (ids.length === 0) return [];

    let result = null;
    if (typeof catalog.getAll === "function") {
      result = await catalog.getAll(...ids);
    } else if (typeof catalog.getMany === "function") {
      result = await catalog.getMany(...ids);
    } else {
      const items = [];
      for (const id of ids) {
        const one = await catalog.getById(id);
        if (one && one.ok === true && one.value) items.push(one.value);
      }
      return items;
    }

    if (!result || result.ok !== true) {
      showError(
        (result && result.message) ||
          "No se han podido cargar los títulos de la colección.",
      );
      return [];
    }
    const values = Array.isArray(result.value) ? result.value : [];
    const byId = new Map();
    for (const item of values) {
      if (item && typeof item.id === "string") byId.set(item.id, item);
    }
    // Se conserva el ORDEN de `itemIds` de la colección.
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  /** Abre el detalle de una colección (UI-14). */
  async function openCollection(collectionId) {
    const summary = findSummary(collectionId);
    if (!summary) return;
    state.openCollectionId = collectionId;
    state.items = [];
    hideError();
    render();

    const items = await loadItems(summary.itemIds);
    // La vista cambió mientras cargaba ⇒ se descarta la respuesta.
    if (state.openCollectionId !== collectionId) return;
    state.items = items;
    render();
  }

  /** Vuelve al listado de colecciones. */
  function closeCollection() {
    state.openCollectionId = null;
    state.items = [];
    render();
  }

  /**
   * Quita un ítem de la colección (REQ-207, AC-127): SOLO se actualiza
   * `itemIds`; la entry de tracking del título NO se toca.
   */
  async function removeItem(mediaId) {
    const uid = getUid();
    const collectionId = state.openCollectionId;
    if (typeof uid !== "string" || uid === "" || !collectionId) return;

    const result = await repository.removeItem(uid, collectionId, mediaId);
    if (!result || result.ok !== true) {
      showError(
        (result && result.message) ||
          "No se ha podido quitar el título de la colección.",
      );
      return;
    }
    replaceCollection(result.value);
    state.items = state.items.filter((item) => item.id !== mediaId);
    hideError();
    showStatus("Título quitado de la colección.");
    render();
    notifyChange();
  }

  /**
   * Borra una colección (REQ-206, REQ-208, AC-128): NO borra las
   * entries de tracking ni los ítems del catálogo.
   */
  async function removeCollection(collectionId) {
    const uid = getUid();
    if (typeof uid !== "string" || uid === "") return;
    const summary = findSummary(collectionId);
    const name = summary ? summary.name : "";
    const confirmed = await confirmDelete(
      `¿Seguro que quieres borrar la colección «${name}»? Los títulos no se borrarán, solo se desvincularán.`,
    );
    if (!confirmed) return;

    const result = await repository.delete(uid, collectionId);
    if (!result || result.ok !== true) {
      showError(
        (result && result.message) || "No se ha podido borrar la colección.",
      );
      return;
    }
    state.collections = state.collections.filter((entry) => entry.id !== collectionId);
    if (state.openCollectionId === collectionId) {
      state.openCollectionId = null;
      state.items = [];
    }
    hideError();
    showStatus("Colección borrada.");
    render();
    notifyChange();
  }

  /** Carga el listado de colecciones del usuario (DB-117). */
  async function load() {
    const uid = getUid();
    if (typeof uid !== "string" || uid === "") {
      state.collections = [];
      state.items = [];
      state.openCollectionId = null;
      render();
      return;
    }
    state.loading = true;
    const result = await repository.list(uid);
    state.loading = false;
    if (!result || result.ok !== true) {
      state.collections = [];
      showError(
        (result && result.message) || "No se han podido cargar las colecciones.",
      );
      render();
      return;
    }
    state.collections = sortCollectionsByUpdatedAt(
      Array.isArray(result.value) ? result.value : [],
    );
    hideError();
    render();
  }

  render();

  return {
    element: root,
    state,
    /** Carga el listado desde el repositorio. */
    load,
    /** Alias de `load` (recarga tras un cambio externo). */
    refresh: load,
    /** Abre el detalle de una colección. */
    openCollection,
    /** Vuelve al listado. */
    closeCollection,
    /** Sustituye el listado en memoria (sin I/O). */
    setCollections(collections) {
      state.collections = sortCollectionsByUpdatedAt(
        Array.isArray(collections) ? collections : [],
      );
      render();
    },
    /** Quita un ítem de la colección abierta. */
    removeItem,
    /** Borra una colección. */
    removeCollection,
    /** Borra la colección abierta. */
    deleteCollection: removeCollection,
    /** Vacía el panel (logout / cambio de sesión). */
    reset() {
      state.collections = [];
      state.openCollectionId = null;
      state.items = [];
      state.editingId = null;
      closeForm();
      hideError();
      showStatus("");
      render();
    },
  };
}

export default createCollectionsPanel;
