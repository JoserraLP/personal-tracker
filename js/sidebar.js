// =============================================================
// Navigation sidebar (issue #46) — fixed drawer on the left, Gmail
// style. It opens with the header's hamburger button
// (#btn-sidebar-toggle), and closes with Escape (temporary listener,
// pattern from notifications-setup.js), click on the backdrop, the
// ✕ button or pressing an entry.
// Entries live in the SECTIONS array (exported): to add a future
// section you only need to add an entry, without touching the rest
// of the module. Entries with `pinned: true` render in the lower
// footer (#app-sidebar-footer), separated from the rest (issue #75:
// «Ajustes» under «Ocio»).
// =============================================================

import { trapFocus } from "./focus-utils.js";
import { closeGlobalSearch, isGlobalSearchOpen } from "./global-search.js";
import { navigate, getLastRecipesTab, getLastGymTab } from "./router.js";

// Sidebar entries: { id, label, icon, onClick, pinned }.
// "Ocio" is the current site (tabs Shows / Movies / Books); when
// pressed it closes the drawer, smooth-scrolls to the top and goes
// back to the first tab, syncing the URL (issue #59).
// "Recetas" (issue #64) opens the new recipes section
// (#/recetas, the tab that was active last time).
// "Ajustes" (pinned) opens the profile in the Settings section: the
// callback is injected by app.js via setupSidebar({ onOpenSettings }).
export const SECTIONS = [
  {
    id: "ocio",
    label: "Ocio",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="2.18" />
      <line x1="7" y1="2" x2="7" y2="22" />
      <line x1="17" y1="2" x2="17" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="2" y1="7" x2="7" y2="7" />
      <line x1="2" y1="17" x2="7" y2="17" />
      <line x1="17" y1="17" x2="22" y2="17" />
      <line x1="17" y1="7" x2="22" y2="7" />
    </svg>`,
    onClick: () => {
      if (
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        window.scrollTo(0, 0);
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      // Go back to the first tab (Series) syncing the URL:
      // the callback is injected by app.js via setupSidebar({ onGoOcio }).
      if (onGoOcio) onGoOcio();
    },
  },
  {
    id: "recetas",
    label: "Recetas",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 11h16a1.6 1.6 0 0 1 1.6 1.6V14A5.6 5.6 0 0 1 16 19.6H8A5.6 5.6 0 0 1 2.4 14v-1.4A1.6 1.6 0 0 1 4 11z" />
      <path d="M2.5 12.3h19" />
      <path d="M8.5 8.5h7" />
      <path d="M7.5 5.5a2.5 2.5 0 0 1 5 0 2.5 2.5 0 0 1 5 0" />
    </svg>`,
    onClick: () => {
      // Open the Recetas section syncing the URL: it goes back to
      // the tab that was active last time (issue #64).
      navigate({ section: "recetas", tab: getLastRecipesTab() });
    },
  },
  {
    id: "gimnasio",
    label: "Gimnasio",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="8" y1="12" x2="16" y2="12" />
      <rect x="2.5" y="9" width="3" height="6" rx="1" />
      <rect x="6.5" y="7.5" width="2" height="9" rx="0.7" />
      <rect x="15.5" y="7.5" width="2" height="9" rx="0.7" />
      <rect x="18.5" y="9" width="3" height="6" rx="1" />
    </svg>`,
    onClick: () => {
      // Open the Gimnasio section syncing the URL: it goes back to
      // the tab that was active last time (issue #62).
      navigate({ section: "gimnasio", tab: getLastGymTab() });
    },
  },
  {
    id: "settings",
    label: "Ajustes",
    pinned: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>`,
    onClick: () => {
      if (openSettings) openSettings();
    },
  },
];

// Module callbacks injected by app.js in setupSidebar:
// openSettings for «Ajustes» and onGoOcio for «Ocio» (hash router).
let openSettings = null;
let onGoOcio = null;

// Active section for the sidebar highlight (issue #206, iteration
// 2026-08-11): before, the highlight was fixed at «Ocio» and did not
// change when navigating. app.js updates it via setActiveSection on
// each route change; renderSidebar respects it when re-rendering.
let activeSection = "ocio";

// Visibility predicate for sections, injected by app.js via
// setupSidebar({ isSectionVisible }) (issue #97): with only one
// visible section the sidebar makes no sense and is replaced by the
// header's Settings button #btn-header-settings.
let isSectionVisible = () => true;

// DOM elements resolved in setupSidebar; reused by
// renderSidebar and updateHeaderNavButtons (issue #97), which are
// also called from app.js when the visible sections change.
let sidebar = null;
let backdrop = null;
let toggle = null;
let closeBtn = null;
let nav = null;
let footer = null;
let headerSettings = null;

let focusTrapCleanup = null;

export function setupSidebar(opts) {
  openSettings = opts?.onOpenSettings || null;
  onGoOcio = opts?.onGoOcio || null;
  isSectionVisible = opts?.isSectionVisible || (() => true);

  sidebar = document.getElementById("app-sidebar");
  backdrop = document.getElementById("app-sidebar-backdrop");
  toggle = document.getElementById("btn-sidebar-toggle");
  closeBtn = document.getElementById("btn-sidebar-close");
  nav = document.getElementById("app-sidebar-nav");
  footer = document.getElementById("app-sidebar-footer");
  headerSettings = document.getElementById("btn-header-settings");

  if (!sidebar || !backdrop || !toggle || !closeBtn || !nav) {
    console.warn("sidebar: elementos DOM no encontrados");
    return;
  }

  // The header gear button (issue #97) opens Settings,
  // same as the pinned sidebar entry.
  headerSettings?.addEventListener("click", () => {
    if (openSettings) openSettings();
  });

  toggle.addEventListener("click", () => {
    // Deliberate order (issue #253): FIRST the drawer, THEN the
    // search. openGlobalSearch sets isOpen=true before firing
    // toggle.click() to auto-close the drawer; if this check of the
    // search were first, that inner click would not close the
    // sidebar and its backdrop would cover the dropdown.
    if (sidebar.classList.contains("is-open")) {
      closeSidebar();
    } else if (isGlobalSearchOpen()) {
      // ✕ mode: with the search open, the hamburger turns into a ✕
      // (CSS animation, class is-search-open) and pressing it
      // closes the search instead of opening the side menu.
      closeGlobalSearch();
    } else {
      openSidebar();
    }
  });

  closeBtn.addEventListener("click", closeSidebar);
  backdrop.addEventListener("click", closeSidebar);

  // Escape closes the drawer only if open (single listener,
  // registered once: no leaks from repeated open/close).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sidebar.classList.contains("is-open")) {
      e.preventDefault();
      closeSidebar();
    }
  });

  // Pressing an entry (nav or footer): close the drawer and run
  // its action. The ✕ button uses #btn-sidebar-close with class
  // app-sidebar__close, it does not interfere with this delegate.
  sidebar.addEventListener("click", (e) => {
    const btn = e.target.closest(".app-sidebar__link");
    if (!btn) return;
    const section = SECTIONS.find((s) => s.id === btn.dataset.section);
    closeSidebar();
    if (section && section.onClick) section.onClick();
  });

  // Initial state: between ☰ and ⚙ depending on the number of visible sections.
  renderSidebar();
}

function openSidebar() {
  sidebar.classList.add("is-open");
  backdrop.classList.remove("hidden");
  sidebar.setAttribute("aria-hidden", "false");
  toggle.setAttribute("aria-expanded", "true");

  // If the search dropdown is open, close it: the drawer's
  // backdrop (z-index 55) would cover it (z-index 40).
  closeGlobalSearch();

  // Trap focus inside the drawer while it is open
  focusTrapCleanup = trapFocus(sidebar);
}

function closeSidebar() {
  sidebar.classList.remove("is-open");
  backdrop.classList.add("hidden");
  sidebar.setAttribute("aria-hidden", "true");
  toggle.setAttribute("aria-expanded", "false");

  if (focusTrapCleanup) {
    focusTrapCleanup();
    focusTrapCleanup = null;
  }

  // Restore focus to the hamburger button. When only one section
  // remains visible the toggle becomes hidden (class hidden) but
  // stays in the DOM; the guard is for robustness if the element
  // were missing.
  if (toggle) toggle.focus();
}

// Number of visible (non-pinned) sections according to the injected
// predicate. With <= 1, the sidebar is replaced by the gear.
function visibleSectionCount() {
  return SECTIONS.filter((s) => !s.pinned && isSectionVisible(s.id)).length;
}

// Chooses between the ☰ toggle and the header's ⚙ Settings button.
function updateHeaderNavButtons() {
  const count = visibleSectionCount();
  if (toggle) toggle.classList.toggle("hidden", count <= 1);
  if (headerSettings) headerSettings.classList.toggle("hidden", count > 1);
}

// Re-render of the sidebar after visibility changes of
// sections (issue #97). Called by app.js via refreshNavigation.
export function renderSidebar() {
  if (!nav || !footer) return;

  // If the drawer is open and will end up with no sections to list,
  // close it first (avoids an open, empty drawer).
  if (sidebar && sidebar.classList.contains("is-open") && visibleSectionCount() <= 1) {
    closeSidebar();
  }

  // Render of the entries from the SECTIONS array. The ids are
  // literals controlled by this module (no user data).
  // Only visible sections are listed; pinned ones (e.g.
  // «Ajustes») always go to the footer. The active section (marked
  // with .is-active) is decided by setActiveSection from app.js.
  nav.innerHTML = SECTIONS.filter((s) => !s.pinned && isSectionVisible(s.id))
    .map(
      (s) => `<button type="button" class="app-sidebar__link${s.id === activeSection ? " is-active" : ""}"
               data-section="${s.id}">
        <span aria-hidden="true">${s.icon}</span>
        <span>${s.label}</span>
      </button>`
    )
    .join("");

  // Lower footer: pinned entries (e.g. «Ajustes»), visually separated
  // from the rest by a line. If the container does not exist
  // (old HTML), we do nothing: defensive.
  // (No visibility filter: these are utility sections, not
  // hideable content.)
  footer.innerHTML = SECTIONS.filter((s) => s.pinned)
    .map(
      (s) => `<button type="button" class="app-sidebar__link${s.id === activeSection ? " is-active" : ""}"
               data-section="${s.id}">
        <span aria-hidden="true">${s.icon}</span>
        <span>${s.label}</span>
      </button>`
    )
    .join("");

  updateHeaderNavButtons();
}

// Highlights the active section's entry in the sidebar (issue
// #206, iteration 2026-08-11): when switching sections (Ocio,
// Recetas or Ajustes via the profile), the .is-active highlight must
// move and not stay stuck at «Ocio». Called by app.js in the router
// onRoute. It receives the section id from the SECTIONS array (ocio,
// recetas, settings) or null to highlight none (e.g. in the profile
// outside Ajustes, which has no own sidebar entry).
export function setActiveSection(sectionId) {
  activeSection = sectionId || null;
  // Apply the highlight without re-rendering: existing entries
  // keep their state; renderSidebar respects it when rebuilding.
  [nav, footer].forEach((container) => {
    container?.querySelectorAll(".app-sidebar__link").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.section === activeSection);
    });
  });
}
