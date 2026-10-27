// =============================================================
// Global Search — searches ONLY inside the active section
// (issue #206): in Leisure it searches movies, TV series, books and
// videogames (collection + API catalog); in Profile, friends;
// in Recipes, the recipes. The search bar lives in the global
// header (#global-search-input inside .search-bar-wrap)
// and the results are shown in a dropdown anchored below it
// (#global-search-results). It opens on focus/click in the
// input, or with Ctrl+K / "/".
//
// NOTE (issue #46): the dropdown does NOT use trapFocus. It follows the
// pattern of the notifications dropdown (close with Escape, click outside the
// container): trapping focus in a non-modal dropdown would break the
// normal Tab navigation inside the document, which is the metaphor
// of a Gmail-like search bar.
//
// Issue #82: the search for new titles (catalog of TMDB/Google
// Books) is unified in this dropdown. The upper part of the dropdown
// has three type buttons (Serie / Película / Libro); when pressing
// one it searches the catalog and shows a "Catálogo · X" section
// with the «Add manually» row at the end. Only visible in Leisure.
// =============================================================

import { openItem } from "./modal-handlers.js";
import * as ui from "./ui.js";
import { navigate, parseHash } from "./router.js";
import { searchRecipes, openRecipeModal } from "./recipes.js";
import {
  searchExternal,
  handleAdd,
  handleAddSeen,
  handleManualAdd,
  openSearchPreviewFromResults,
  existingIdsFor,
  existingBookKeys,
  isBookAlreadyAdded,
} from "./search.js";
import { MEDIA_ICONS, seenActionLabels } from "./constants.js";
// ---- Internal state ----

let isOpen = false;
let highlightedIndex = -1;
let flatResults = [];

let searchCtx = null;

// Counter of suppressed focuses (issue #206): when opening the modal of a
// recipe from the dropdown it is armed with 2 — one for the programmatic focus
// of navigateTo and another for the refocus made by
// closeRecipeModal when closing the modal — so the dropdown does not
// reopen on its own at either moment. The counter reaches 0
// with the two focuses and the bar opens again with the next
// manual focus.
let suppressFocusCount = 0;

// State of the external search (API catalog), per group.
// externalCache[group] = { query, items, source } | null (only if the
// last search of that group finished successfully).
// inFlight[group] = a search is in progress.
// externalError[group] = { query, message } | null (last failure).
// externalQuery[group] = query of the search in progress.
// searchSeq: monotonic counter to discard obsolete responses
// (it changes with each search and when closing the dropdown).
const externalCache = { movies: null, tv: null, books: null, games: null };
const inFlight = { movies: false, tv: false, books: false, games: false };
const externalError = { movies: null, tv: null, books: null, games: null };
const externalQuery = { movies: "", tv: "", books: "", games: "" };
let searchSeq = 0;

// Type group pressed in the top buttons (null = none).
let activeGroup = null;

// Information about each group for the catalog sections.
// The icons are the SVGs of MEDIA_ICONS (the same ones as the tabs,
// with their color via CSS --type-accent / --group-accent, issue #134).
const GROUPS = [
  { key: "tv", label: "Serie", icon: MEDIA_ICONS.tv, itemLabel: "serie", manualText: "¿No la encuentras? Añadir manualmente una serie", type: "tv", accent: "" },
  { key: "movies", label: "Película", icon: MEDIA_ICONS.movies, itemLabel: "película", manualText: "¿No la encuentras? Añadir manualmente una película", type: "movie", accent: "" },
  { key: "books", label: "Libro", icon: MEDIA_ICONS.books, itemLabel: "libro", manualText: "¿No lo encuentras? Añadir manualmente un libro", type: "book", accent: " global-search__item-add--books" },
  { key: "games", label: "Videojuego", icon: MEDIA_ICONS.games, itemLabel: "videojuego", manualText: "¿No lo encuentras? Añadir manualmente un videojuego", type: "game", accent: " global-search__item-add--games" },
];

// ---- DOM references (assigned in setup) ----

let wrap, input, resultsEl, clearBtn;

// Hamburger button of the header (issue #253): with the search
// open it becomes a ✕ (class is-search-open) that when pressed
// closes the search. It is resolved in setup; the optional chaining covers
// the case of the element missing.
let toggleBtn = null;
const TOGGLE_ARIA_LABEL = "Abrir menú de navegación";

// ---- Utilities ----

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Safe cover for the src attribute: only https URLs or
// data:image/ are accepted (defense in depth, same pattern as rating-modal.js).
// Any other scheme (javascript:, data:text/html...) or invalid URL
// falls back to ui.js's placeholder.
function safeCoverUrl(url) {
  if (!url) return ui.PLACEHOLDER_COVER;
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
  return ui.PLACEHOLDER_COVER;
}

function groupInfo(group) {
  return GROUPS.find((g) => g.key === group) || GROUPS[0];
}

// ---- Search ----

// Active section (issue #206): leisure | profile | recipes. The top search
// is scoped to it; by default (or on errors) leisure.
function currentSection() {
  try {
    return parseHash().section || "ocio";
  } catch {
    return "ocio";
  }
}

function getSearchableText(item) {
  // For books, also search by author
  const author = item.author || "";
  return `${item.title} ${author}`.toLowerCase();
}

function relevanceScore(item, query) {
  const title = (item.title || "").toLowerCase();
  const author = (item.author || "").toLowerCase();
  const q = query.toLowerCase();

  if (title === q) return 100;
  if (title.startsWith(q)) return 50;
  if (title.includes(q)) return 10;
  if (author.includes(q)) return 5;
  return 0;
}

function filterItems(items, query) {
  const q = query.toLowerCase().trim();
  return items
    .filter((item) => {
      const text = getSearchableText(item);
      return text.includes(q);
    })
    .map((item) => ({ item, score: relevanceScore(item, q) }))
    .sort((a, b) => b.score - a.score || (a.item.title || "").localeCompare(b.item.title || ""))
    .map((r) => r.item);
}

// Results of the active section (issue #206):
// - leisure   → collection (user's movies/TV series/books/videogames),
//               no friends: the search bar is no longer global.
// - recipes   → only recipes (local filter, searchRecipes of recipes.js).
// - gym       → no results yet (issue #62, v1: no search scope of
//               its own; returning empty avoids falling into the Leisure
//               branch and mixing foreign collections).
// Synchronous: used by performSearch, runExternalSearch and
// refreshExternalResults.
function collectionResults(trimmed) {
  if (!searchCtx) {
    return { movies: [], tv: [], books: [], games: [], recipes: [] };
  }
  const section = currentSection();
  if (section === "perfil" || section === "gimnasio") {
    return { movies: [], tv: [], books: [], games: [], recipes: [] };
  }
  if (section === "recetas") {
    return { recipes: searchRecipes(trimmed).slice(0, 6) };
  }
  const allItems = searchCtx.getAllItems();
  return {
    movies: filterItems(allItems.movies || [], trimmed).slice(0, 5),
    tv: filterItems(allItems.tv || [], trimmed).slice(0, 5),
    books: filterItems(allItems.books || [], trimmed).slice(0, 5),
    games: filterItems(allItems.games || [], trimmed).slice(0, 5),
  };
}

// ---- Rendering ----

function statusClass(status) {
  const map = {
    pendiente: "chip--pendiente",
    en_curso: "chip--en_curso",
    completado: "chip--completado",
    standby: "chip--standby",
    abandonado: "chip--abandonado",
  };
  return map[status] || "";
}

// Top row of the dropdown with the type buttons (ALWAYS visible
// in Leisure; in Profile and Recipes the search does not use the external catalog
// and they are not rendered, issue #206).
// Each button carries the SVG icon of its type (same SVGs as the tabs)
// and a --<key> modifier class that the CSS uses to color with the
// accent of each type (issue #134).
function renderTypeButtons() {
  if (currentSection() !== "ocio") return "";
  return `<div class="global-search__type-buttons">
    ${GROUPS.map(
      (g) => `<button type="button" class="global-search__type-btn global-search__type-btn--${g.key}${g.key === activeGroup ? " is-active" : ""}" data-group="${g.key}"><span class="global-search__type-icon" aria-hidden="true">${g.icon}</span>${g.label}</button>`
    ).join("")}
  </div>`;
}

// Hint text depending on the active section (issue #206).
function sectionHintText() {
  if (currentSection() === "recetas") {
    return "Escribe al menos 2 caracteres para buscar en tus recetas.";
  }
  if (currentSection() === "gimnasio") {
    return "Escribe al menos 2 caracteres para buscar en tu gimnasio.";
  }
  return "Escribe al menos 2 caracteres para buscar en tus películas, series, libros y videojuegos.";
}

function hintHtml() {
  return renderTypeButtons() +
    `<p class="global-search__hint">${sectionHintText()}</p>`;
}

function renderHint() {
  resultsEl.innerHTML = hintHtml();
  flatResults = [];
  highlightedIndex = -1;
}

// «Add manually» row that closes each catalog section.
// It adds the row to flatResults so it is keyboard-navigable.
function manualRowHtml(group) {
  const g = groupInfo(group);
  const index = flatResults.length;
  flatResults.push({ kind: "manual", type: g.type, group, item: null });
  return `<button type="button" class="global-search__manual-add" data-global-idx="${index}">${g.manualText}</button>`;
}

// Catalog section (external source) of a group.
// States: valid cache → results + manual row; error → message +
// manual row; empty → message + manual row.
function renderExternalSection(group, query) {
  const g = groupInfo(group);
  const cache = externalCache[group];
  const err = externalError[group];
  let html = `<div class="global-search__group-title global-search__group-title--${g.key}">
    <span>${g.icon}</span>
    <span>Catálogo · ${g.label}s</span>
  </div>`;

  if (err && err.query === query) {
    html += `<p class="global-search__status">No se pudo buscar: ${escapeHtml(err.message)}</p>`;
    html += manualRowHtml(group);
    return html;
  }

  if (!cache || cache.query !== query) {
    html += `<p class="global-search__status">Buscando en el catálogo…</p>`;
    html += manualRowHtml(group);
    return html;
  }

  if (!cache.items.length) {
    html += `<p class="global-search__status">No hay resultados de ${g.itemLabel} para "${escapeHtml(query)}".</p>`;
    html += manualRowHtml(group);
    return html;
  }

  const ids = existingIdsFor(group, searchCtx);
  const bookKeys = group === "books" ? existingBookKeys(searchCtx) : null;

  for (const item of cache.items) {
    const added = group === "books" ? isBookAlreadyAdded(item, ids, bookKeys) : ids.has(item.externalId);
    const metaParts = [];
    if (item.year) metaParts.push(item.year);
    if (group === "books" && item.author) metaParts.push(item.author);
    const meta = metaParts.join(" · ");
    const index = flatResults.length;

    html += `<div class="global-search__item" data-global-idx="${index}" tabindex="0">
      <img class="global-search__item-cover" src="${escapeHtml(safeCoverUrl(item.coverUrl))}" alt="" loading="lazy" />
      <div class="global-search__item-info">
        <div class="global-search__item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
        <div class="global-search__item-meta" title="${escapeHtml(meta)}">${escapeHtml(meta)}</div>
      </div>
      <button type="button" class="global-search__item-add btn btn--small${g.accent}" data-add-index="${index}" ${added ? "disabled" : ""}>
        ${added ? "Añadido" : "Añadir"}
      </button>
      ${added ? "" : `<button type="button" class="global-search__item-seen btn btn--small" data-seen-index="${index}">${seenActionLabels(item.type).action}</button>`}
    </div>`;
    flatResults.push({ kind: "external", type: item.type, item, group });
  }

  html += manualRowHtml(group);
  return html;
}

function renderResults(results, query) {
  const { movies = [], tv = [], books = [], games = [], recipes = [] } = results;
  const trimmed = query.trim();

  const hasAny = movies.length || tv.length || books.length || games.length || recipes.length;

  if (!trimmed || trimmed.length < 2) {
    renderHint();
    return;
  }

  // Is there any external section (loading, error or valid cache) for the
  // current query and the active group? It decides whether the "no results"
  // message is shown. (Comment issue #82: single selection — only the
  // catalog of the pressed group.)
  const active = activeGroup;
  const hasExternalSection = active
    ? (inFlight[active] && externalQuery[active] === trimmed) ||
      (externalError[active] && externalError[active].query === trimmed) ||
      (externalCache[active] && externalCache[active].query === trimmed)
    : false;

  if (!hasAny && !hasExternalSection) {
    resultsEl.innerHTML = renderTypeButtons() +
      `<p class="global-search__empty">No se encontraron resultados para "${escapeHtml(trimmed)}".</p>`;
    flatResults = [];
    highlightedIndex = -1;
    return;
  }

  const groupLabels = {
    movies: "Películas",
    tv: "Series",
    books: "Libros",
    games: "Videojuegos",
    recipes: "Recetas",
  };

  // Group icons: TV series/movies/books/videogames use the
  // same SVGs as the tabs (MEDIA_ICONS, colored by CSS with
  // --<key>) and recipes use their dish (issue #206).
  const groupIcons = {
    movies: MEDIA_ICONS.movies,
    tv: MEDIA_ICONS.tv,
    books: MEDIA_ICONS.books,
    games: MEDIA_ICONS.games,
    recipes: "🍽️",
  };

  // Only the groups of the active section (issue #206)
  const section = currentSection();
  const groupKeys =
    section === "recetas" ? ["recipes"] : ["movies", "tv", "books", "games"];
  let html = renderTypeButtons();
  const newFlat = [];
  let globalIdx = 0;

  for (const key of groupKeys) {
    const items = results[key];
    if (!items || !items.length) continue;

    // Only the media groups carry the color modifier; recipes does not
    // (issue #206).
    html += `<div class="global-search__group-title${key === "recipes" ? "" : ` global-search__group-title--${key}`}">
      <span>${groupIcons[key]}</span>
      <span>${groupLabels[key]}</span>
      <span class="global-search__group-badge">${items.length}</span>
    </div>`;

    for (const entry of items) {
      if (key === "recipes") {
        // Recipe result (issue #206): opens the recipe modal in
        // read-only mode. The cover goes through safeCoverUrl like
        // the leisure items' one (placeholder if missing or invalid).
        const cover = safeCoverUrl(entry.fotoUrl);
        const metaParts = [];
        if (Number(entry.porciones)) {
          metaParts.push(`${entry.porciones} ${Number(entry.porciones) === 1 ? "porción" : "porciones"}`);
        }
        if (entry.ingredientes && entry.ingredientes.length) {
          metaParts.push(`${entry.ingredientes.length} ingredientes`);
        }
        const meta = metaParts.join(" · ");
        html += `<div class="global-search__item" data-global-idx="${globalIdx}" tabindex="0">
          <img class="global-search__item-cover" src="${escapeHtml(cover)}" alt="" loading="lazy" />
          <div class="global-search__item-info">
            <div class="global-search__item-title" title="${escapeHtml(entry.nombre)}">${escapeHtml(entry.nombre)}</div>
            <div class="global-search__item-meta" title="${escapeHtml(meta)}">${escapeHtml(meta)}</div>
          </div>
        </div>`;
        newFlat.push({ kind: "recipe", type: "recipe", item: entry, group: key });
      } else {
        // Item result (movie/tv/book/game)
        const cover = entry.coverUrl || "";
        const title = entry.title || "Sin título";
        const author = entry.author || "";
        const year = entry.year || "";
        const status = entry.status || "";
        const metaParts = [];
        if (year) metaParts.push(year);
        if (key === "books" && author) metaParts.push(author);
        const meta = metaParts.join(" · ");

        html += `<div class="global-search__item" data-global-idx="${globalIdx}" tabindex="0">
          <img class="global-search__item-cover" src="${escapeHtml(cover)}" alt="" loading="lazy" />
          <div class="global-search__item-info">
            <div class="global-search__item-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
            <div class="global-search__item-meta" title="${escapeHtml(meta)}">${escapeHtml(meta)}</div>
          </div>
          <span class="global-search__item-status chip ${statusClass(status)}">${ui.statusLabel(status, entry.type)}</span>
        </div>`;
        newFlat.push({ kind: "collection", type: entry.type || key, item: entry, group: key });
      }
      globalIdx++;
    }
  }

  // External section (API catalog): ONLY the one of the active group. If another
  // type button is pressed, the previous catalog results are
  // hidden (comment issue #82, single-selection option); the
  // collection is not affected. The state (loading/error/cache) is
  // kept per group to be able to come back without re-searching.
  flatResults = newFlat;
  if (activeGroup) {
    const g = groupInfo(activeGroup);
    const group = g.key;
    if (inFlight[group] && externalQuery[group] === trimmed) {
      html += externalSectionLoadingHtml(g);
    } else if (externalError[group] && externalError[group].query === trimmed) {
      html += renderExternalSection(group, trimmed);
    } else if (externalCache[group] && externalCache[group].query === trimmed) {
      html += renderExternalSection(group, trimmed);
    }
  }

  resultsEl.innerHTML = html;
  highlightedIndex = -1;

  // Connect click and keyboard events on each result
  resultsEl.querySelectorAll("[data-global-idx]").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = parseInt(el.dataset.globalIdx, 10);
      if (flatResults[idx]) {
        navigateTo(flatResults[idx]);
      }
    });

    // Enter and Space to activate the result. If the focus is on a
    // button of the row (Añadir / Marcar visto/leído/jugado), the event
    // is let through so the button activates its own
    // action (issue #115).
    el.addEventListener("keydown", (e) => {
      if (e.target !== el) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const idx = parseInt(el.dataset.globalIdx, 10);
        if (flatResults[idx]) {
          navigateTo(flatResults[idx]);
        }
      }
    });
  });

  // «Añadir» buttons of the catalog results
  resultsEl.querySelectorAll(".global-search__item-add").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.addIndex, 10);
      const entry = flatResults[idx];
      if (!entry || entry.kind !== "external") return;
      handleAdd(entry.item, btn, searchCtx).then((ok) => {
        if (ok) {
          btn.disabled = true;
          btn.textContent = "Añadido";
        }
      });
    });
  });

  // «Marcar visto»/«Marcar leído»/«Marcar jugado» buttons of the
  // catalog results (issues #115 and #177): direct creation as
  // completed + rating on the spot. During the flow the
  // «Añadir» of the row is also disabled to avoid double
  // creations; if the flow is aborted or undone, both are restored.
  resultsEl.querySelectorAll(".global-search__item-seen").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.seenIndex, 10);
      const entry = flatResults[idx];
      if (!entry || entry.kind !== "external") return;
      const labels = seenActionLabels(entry.item.type);
      const row = btn.closest(".global-search__item");
      const addBtn = row ? row.querySelector(".global-search__item-add") : null;
      if (addBtn) addBtn.disabled = true;
      btn.disabled = true;
      btn.textContent = "Marcando…";
      handleAddSeen(entry.item, btn, searchCtx).then((ok) => {
        if (!btn.isConnected) return;
        if (ok) {
          btn.disabled = true;
          btn.textContent = labels.done;
        } else {
          btn.disabled = false;
          btn.textContent = labels.action;
          if (addBtn && addBtn.isConnected) addBtn.disabled = false;
        }
      });
    });
  });
}

// Catalog section in the "loading" state: only the title and the notice,
// plus the manual-add row (available also during loading).
function externalSectionLoadingHtml(g) {
  const index = flatResults.length;
  flatResults.push({ kind: "manual", type: g.type, group: g.key, item: null });
  return `<div class="global-search__group-title global-search__group-title--${g.key}">
    <span>${g.icon}</span>
    <span>Catálogo · ${g.label}s</span>
  </div>
  <p class="global-search__status">Buscando en el catálogo…</p>
  <button type="button" class="global-search__manual-add" data-global-idx="${index}">${g.manualText}</button>`;
}

// ---- Type buttons (catalog search) ----

function handleTypeClick(group) {
  activeGroup = group;
  const query = input.value.trim();
  if (query.length < 2) {
    // Hint with the type buttons on top (renderTypeButtons already marks
    // the pressed group as active).
    resultsEl.innerHTML = renderTypeButtons() +
      `<p class="global-search__hint">Escribe al menos 2 caracteres para buscar en el catálogo.</p>`;
    flatResults = [];
    highlightedIndex = -1;
    return;
  }
  // Single selection: if the pressed group already has cached results
  // for this query, they are just shown (without re-calling the API); otherwise
  // it searches.
  const cache = externalCache[group];
  if (cache && cache.query === query && !inFlight[group]) {
    renderResults(collectionResults(query), query);
    return;
  }
  runExternalSearch(group, query);
}

// Searches a group in the catalog and re-renders its section. It captures the
// current seq and discards the result if it changed (new search or closing
// the dropdown). No pagination: only the first page, cap of 5.
async function runExternalSearch(group, query) {
  const seq = ++searchSeq;
  inFlight[group] = true;
  externalQuery[group] = query;
  externalError[group] = null;

  renderResults(collectionResults(query), query);

  let result;
  try {
    result = await searchExternal(group, query, 1);
  } catch (err) {
    if (seq !== searchSeq || !isOpen) {
      inFlight[group] = false;
      return;
    }
    inFlight[group] = false;
    externalError[group] = { query, message: err.message };
    renderResults(collectionResults(input.value.trim()), input.value.trim());
    return;
  }

  if (seq !== searchSeq || !isOpen) {
    inFlight[group] = false;
    return;
  }
  inFlight[group] = false;
  externalCache[group] = {
    query,
    items: (result.items || []).slice(0, 5),
    source: result.source || null,
  };
  renderResults(collectionResults(input.value.trim()), input.value.trim());
}

// Re-renders the external sections from the cache with the current
// collection state (app.js calls it after each Firestore
// snapshot to update the «Añadir»/«Añadido» buttons).
export function refreshExternalResults(ctx) {
  if (!isOpen) return;
  const query = input.value.trim();
  if (query.length < 2) return;
  if (ctx) searchCtx = ctx;
  renderResults(collectionResults(query), query);
}

// ---- Navigation ----

function navigateTo(result) {
  // Catalog result: preview without closing the dropdown.
  if (result.kind === "external") {
    openSearchPreviewFromResults(result.item, false, searchCtx);
    return;
  }

  // «Add manually» row: opens the form without closing the dropdown.
  if (result.kind === "manual") {
    const type = result.type;
    ui.openManualAddModal(type, (data) => handleManualAdd(type, data, searchCtx));
    return;
  }

  // Recipe result (issue #206): opens the recipe modal in
  // read-only mode. The counter of suppressed focuses is armed: the
  // programmatic focus and the modal's closing refocus must not
  // reopen the dropdown.
  if (result.kind === "recipe") {
    closeGlobalSearch();
    suppressFocusCount = 2;
    input.focus();
    openRecipeModal(result.item, { readOnly: true });
    return;
  }

  // It is an item of the collection (movie/tv/book/game)
  const item = result.item;
  if (!searchCtx) {
    ui.showToast("Error: contexto no disponible.");
    return;
  }
  closeGlobalSearch();
  // Small delay so the dropdown closing doesn't interfere
  setTimeout(() => {
    openItem(item, searchCtx);
  }, 150);
}

// ---- Open / Close ----

function openGlobalSearch() {
  if (isOpen) return;

  // In the profile the global header is hidden (issue #206, iteration
  // 2026-08-11): the top search is not available there. The
  // guard avoids the keyboard shortcuts (Ctrl+K, "/") opening an
  // orphan dropdown under an invisible header.
  if (currentSection() === "perfil") return;

  isOpen = true;

  // Issue #253: the header's ☰ hamburger becomes a ✕
  // (with CSS animation) that closes the search when pressed. The class and
  // the aria-label are applied BEFORE closing the side bar: if the
  // drawer is open, the toggle.click() below closes it and the
  // icon is already in ✕ mode.
  toggleBtn?.classList.add("is-search-open");
  toggleBtn?.setAttribute("aria-label", "Cerrar búsqueda");

  // If the side drawer is open, close it first: its backdrop
  // (z-index 55) would cover the results dropdown (z-index 40).
  // The click on the toggle triggers closeSidebar() of js/sidebar.js.
  const sidebar = document.getElementById("app-sidebar");
  if (sidebar && sidebar.classList.contains("is-open")) {
    if (toggleBtn) toggleBtn.click();
  }

  resultsEl.classList.remove("hidden");
  clearBtn.hidden = false;

  const query = input.value.trim();
  if (query.length < 2) {
    resultsEl.innerHTML = renderTypeButtons() + `<p class="global-search__hint">Escribe para buscar...</p>`;
    flatResults = [];
    highlightedIndex = -1;
  } else {
    // There is already text: repeat the search to show results
    performSearch(searchCtx);
  }

  // When opening with a keyboard shortcut (Ctrl+K, "/"), move the focus to
  // the input; if it was already focused, the focus event is not repeated.
  if (document.activeElement !== input) input.focus();
}

// State query for other modules (issue #253): sidebar.js uses it
// so the ☰/✕ button closes the search instead of opening the
// side bar while the dropdown is open.
export function isGlobalSearchOpen() {
  return isOpen;
}

export function closeGlobalSearch() {
  if (!isOpen) return;
  isOpen = false;

  // Issue #253: the header's ☰ hamburger stops being the ✕ that
  // closes the search and regains its icon and its menu aria-label.
  toggleBtn?.classList.remove("is-search-open");
  toggleBtn?.setAttribute("aria-label", TOGGLE_ARIA_LABEL);

  // Invalidate external searches in progress and clear their state
  searchSeq++;
  activeGroup = null;
  externalCache.movies = null;
  externalCache.tv = null;
  externalCache.books = null;
  externalCache.games = null;
  inFlight.movies = false;
  inFlight.tv = false;
  inFlight.books = false;
  inFlight.games = false;
  externalError.movies = null;
  externalError.tv = null;
  externalError.books = null;
  externalError.games = null;
  externalQuery.movies = "";
  externalQuery.tv = "";
  externalQuery.books = "";
  externalQuery.games = "";

  resultsEl.classList.add("hidden");
  resultsEl.innerHTML = "";
  flatResults = [];
  highlightedIndex = -1;
  clearBtn.hidden = true;

  // The input text is not cleared nor is the focus moved: the user
  // can press the bar again and resume where they were (Gmail).
}

// ---- Keyboard navigation ----

function highlightNext() {
  if (!flatResults.length) return;
  const newIdx = highlightedIndex < flatResults.length - 1 ? highlightedIndex + 1 : 0;
  setHighlight(newIdx);
}

function highlightPrev() {
  if (!flatResults.length) return;
  const newIdx = highlightedIndex > 0 ? highlightedIndex - 1 : flatResults.length - 1;
  setHighlight(newIdx);
}

function setHighlight(idx) {
  // Remove previous highlight
  resultsEl.querySelector(".global-search__item--highlighted")?.classList.remove("global-search__item--highlighted");

  highlightedIndex = idx;
  const target = resultsEl.querySelector(`[data-global-idx="${idx}"]`);
  if (!target) return;
  target.classList.add("global-search__item--highlighted");
  target.scrollIntoView({ block: "nearest" });
}

function activateHighlight() {
  if (highlightedIndex >= 0 && highlightedIndex < flatResults.length) {
    navigateTo(flatResults[highlightedIndex]);
  } else if (flatResults.length > 0) {
    navigateTo(flatResults[0]);
  }
}

// ---- Initialization ----

/**
 * Initializes the global search bar (dropdown anchored to the header
 * bar).
 * @param {Object} ctx - Application context (with getAllItems, etc.)
 */
export function setupGlobalSearch(ctx) {
  wrap = document.querySelector(".search-bar-wrap");
  input = document.getElementById("global-search-input");
  resultsEl = document.getElementById("global-search-results");
  clearBtn = document.getElementById("global-search-clear");
  toggleBtn = document.getElementById("btn-sidebar-toggle");

  if (!wrap || !input || !resultsEl || !clearBtn) {
    console.warn("global-search: DOM elements not found");
    return;
  }

  // We store ctx to use it in navigateTo
  searchCtx = ctx;

  // ---- Events ----

  // Open on focus or click in the input (the click covers the case
  // of pressing again an already focused bar). If there are suppressed
  // focuses left (issue #206: programmatic focus and refocus after
  // closing a recipe's modal), the focus event only consumes the
  // counter and doesn't reopen the dropdown.
  input.addEventListener("focus", () => {
    if (suppressFocusCount > 0) {
      suppressFocusCount -= 1;
      return;
    }
    openGlobalSearch();
  });
  input.addEventListener("click", openGlobalSearch);

  // Input with debounce
  let debounceTimer = null;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => performSearch(ctx), 200);
  });

  // Keys inside the input
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      // We only trap the Escape if the dropdown is open: if it is
      // closed (e.g. with an item modal on top), it must propagate
      // to the global handler of modal-handlers.js.
      if (isOpen) e.stopPropagation();
      closeGlobalSearch();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightNext();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightPrev();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      activateHighlight();
      return;
    }
    // Allow Ctrl+A, Ctrl+C, etc. without interfering
  });

  // Clear/close button of the bar
  clearBtn.addEventListener("click", () => {
    input.value = "";
    closeGlobalSearch();
    input.focus();
  });

  // Click outside the wrap → close the dropdown
  document.addEventListener("click", (e) => {
    if (isOpen && !wrap.contains(e.target)) {
      closeGlobalSearch();
    }
  });

  // Type buttons (Serie / Película / Libro): delegation on the
  // dropdown container because it is re-rendered on each search
  // (also in the hint with a short query).
  resultsEl.addEventListener("click", (e) => {
    const typeBtn = e.target.closest(".global-search__type-btn");
    if (typeBtn) {
      e.stopPropagation();
      handleTypeClick(typeBtn.dataset.group);
    }
  });

  // Issue #149: covers of the collection (e.g. fbcdn.net) and avatars
  // can fail (403/404 due to blocked hotlinking). The "error" event
  // does NOT bubble, but listeners in the CAPTURE phase of the container
  // do receive the error of any descendant <img>, including the
  // ones re-rendered with innerHTML (the container persists).
  resultsEl.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement)) return;
      if (!img.classList.contains("global-search__item-cover")) {
        return;
      }
      // Avoid loop: if it is already the placeholder (data URI), don't reassign.
      if (img.src === ui.PLACEHOLDER_COVER) return;
      img.src = ui.PLACEHOLDER_COVER;
    },
    true // capture: the "error" event doesn't bubble
  );

  // Escape with focus outside the input (e.g. on a result):
  // the input's keydown already closes with stopPropagation, so this
  // only acts when the focus is elsewhere in the document.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen && document.activeElement !== input) {
      e.preventDefault();
      closeGlobalSearch();
    }
  });

  // ---- Global keyboard shortcuts ----
  document.addEventListener("keydown", (e) => {
    // Ctrl+K / Cmd+K
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      if (isOpen) {
        closeGlobalSearch();
      } else {
        openGlobalSearch();
      }
      return;
    }

    // "/" key to open (only if no input is focused)
    if (e.key === "/" && !isOpen && !["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) {
      e.preventDefault();
      openGlobalSearch();
      return;
    }
  });
}

// ---- Search (called with debounce) ----

async function performSearch(ctx) {
  const query = input.value;
  const trimmed = query.trim();

  if (!trimmed || trimmed.length < 2) {
    // Issue #149: when clearing the text the active catalog is deselected so
    // the user picks a type button again (renderTypeButtons
    // marks is-active by comparing with activeGroup).
    activeGroup = null;
    renderHint();
    return;
  }

  // New search: invalidate external searches in progress
  searchSeq++;

  // Issue #149: if there is an active catalog and the current query has no
  // state (flight/cache/error) for this exact query, relaunch the
  // external search automatically. runExternalSearch does its own
  // renderResults (it shows «Buscando en el catálogo…» and then the
  // result); that's why we return and don't render twice.
  const group = activeGroup;
  if (group) {
    const sameQueryInFlight = inFlight[group] && externalQuery[group] === trimmed;
    const cachedForQuery = externalCache[group] && externalCache[group].query === trimmed;
    const erroredForQuery = externalError[group] && externalError[group].query === trimmed;
    if (!sameQueryInFlight && !cachedForQuery && !erroredForQuery) {
      runExternalSearch(group, trimmed);
      return;
    }
  }

  renderResults(collectionResults(trimmed), trimmed);
}
