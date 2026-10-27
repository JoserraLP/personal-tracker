// =============================================================
// Auto-hide navigation on scroll (issue #137, #256)
//
// When scrolling down in the leisure lists (TV series,
// movies, books — and any future tab) and recipe lists
// (issue #256: Recipes, Ingredients, Menu and Shopping), the
// header (top search bar) and the tab bar are hidden;
// when scrolling up they reappear. The animation is a simple
// translateY that makes them "emerge from the edge of the screen"
// (defined in css/styles.css, block "Ocultar navegación al
// desplazar").
//
// Added: when the list controls (the .library-controls filters
// of the leisure panel or the toolbar
// of the active recipes tab) are entirely out of
// view and the navigation is hidden, the floating button
// #btn-back-to-top is shown, centered at the top, to go back to the
// beginning of the list.
//
// Design rules:
// - The navigation is NEVER hidden while the user interacts
//   with it (focus in the search, open dropdown, modal, drawer)
//   nor in screens that are not lists (login, profile/settings).
// - prefers-reduced-motion is respected: scrolling when pressing "Back
//   to top" is instant (auto) instead of smooth.
// - The state is reflected in <body> classes (is-nav-hidden and
//   is-back-to-top-visible); the CSS does the rest, without touching the
//   document flow (only transforms of fixed elements).
// =============================================================

// Behavior thresholds. hideThreshold: distance from the
// top of the page below which the navigation is never
// hidden (so it isn't hidden right when starting to scroll).
// deltaThreshold: scroll increment (px) needed to decide
// the direction; below it the previous state is kept
// (avoids flicker with minimal movements or inertia).
const CONFIG = { hideThreshold: 80, deltaThreshold: 8 };

let navHidden = false;
let lastY = window.scrollY;

// Active list panel: the leisure section visible inside the
// app or, if the app is hidden (Recipes view, issue #256), the
// active recipes panel (#recipes-view is a first-level
// sibling of profile-view, outside #app). Returns null if there is none
// (login or profile/settings screens, where hide-on-scroll
// does not apply).
function activePanel() {
  const app = document.getElementById("app");
  if (app && !app.classList.contains("hidden")) {
    return document.querySelector("#app .panel:not(.hidden)");
  }
  const recipesView = document.getElementById("recipes-view");
  if (recipesView && !recipesView.classList.contains("hidden")) {
    // The Recipes tabs are sibling <section> elements inside
    // .recipes-view__body; the active one is the only one without .hidden.
    return recipesView.querySelector(".recipes-view__body section:not(.hidden)");
  }
  // Gym view (issue #62): same first-level pattern as
  // Recipes; the active section is the only one of its list without .hidden.
  const gymView = document.getElementById("gym-view");
  if (gymView && !gymView.classList.contains("hidden")) {
    return gymView.querySelector(".gym-view__body section:not(.hidden)");
  }
  return null;
}

// Is the user interacting with something that requires keeping the
// navigation visible? If so, hiding is disabled.
function isInteracting() {
  // Focus inside the header or the tab bar (e.g.
  // typing in the global search): hiding them while
  // using the keyboard would break the interaction.
  const focus = document.activeElement;
  if (focus && focus.closest(".app-header, .tabs--bar")) return true;

  // Open dropdowns anchored to the header (notifications,
  // profile menu and search results): hiding the
  // header would detach them from their anchor.
  if (
    document.querySelector("#notif-dropdown:not(.hidden)") ||
    document.querySelector("#profile-dropdown:not(.hidden)") ||
    document.querySelector(".global-search__results:not(.hidden)")
  ) {
    return true;
  }

  // Open Recipes filter panels (issue #256): on mobile
  // they are anchored to the viewport below the header (top: var(--header-h)),
  // so hiding it would leave them detached, like the header
  // dropdowns.
  if (
    document.querySelector(".recipes-filter__panel:not(.hidden)") ||
    document.querySelector(".ingredients-filter__panel:not(.hidden)")
  ) {
    return true;
  }

  // Side drawer (hamburger) open.
  if (document.querySelector(".app-sidebar.is-open")) return true;

  // Open modal (item detail, rating, recipe, etc.).
  if (document.querySelector(".modal:not(.hidden)")) return true;

  // Login screen (the whole app is hidden) or without a visible list
  // panel (profile/settings): hide-on-scroll only
  // makes sense over the leisure and recipes lists. activePanel()
  // returns null on those screens (and also when #recipes-view
  // is hidden), so this guard is enough.
  if (!activePanel()) return true;

  return false;
}

// Applies the hidden-navigation state only when it changes (avoids
// unnecessary work and reflows) and keeps the floating button
// synchronized.
function setNavHidden(hidden) {
  if (hidden === navHidden) return;
  navHidden = hidden;
  document.body.classList.toggle("is-nav-hidden", hidden);
  updateBackToTop();
}

// The "Back to top" button is only shown when the navigation
// is hidden AND the controls of the active list have gone
// entirely out of view (element's bottom edge above
// the viewport: getBoundingClientRect().bottom <= 0). The controls
// are the leisure filters (.library-controls) or the toolbar of
// the active recipes tab (issue #256:
// .recipes-toolbar, .ingredients-toolbar, .menu-toolbar,
// .shopping-toolbar); if the panel has no controls, the button does
// not appear.
const CONTROLS_SELECTOR =
  ".library-controls, .recipes-toolbar, .ingredients-toolbar, .menu-toolbar, .shopping-toolbar, .gym-toolbar";

function updateBackToTop() {
  const panel = activePanel();
  const controls = panel ? panel.querySelector(CONTROLS_SELECTOR) : null;
  const visible =
    navHidden && controls !== null && controls.getBoundingClientRect().bottom <= 0;
  document.body.classList.toggle("is-back-to-top-visible", visible);
}

// Decides the navigation state based on the scroll direction
// and ongoing interactions. The delta is computed by the scroll
// listener (see initAutoHideNav): inside the rAF window.scrollY already equals
// lastY and the delta would always be 0 (issue #137, QA review).
// If the delta doesn't exceed the threshold the previous state is kept,
// so inertia or a slow trackpad doesn't make the
// navigation flicker.
function evaluate(delta = 0) {
  let hidden = navHidden;
  if (isInteracting() || window.scrollY < CONFIG.hideThreshold) {
    hidden = false;
  } else if (delta > CONFIG.deltaThreshold) {
    hidden = true;
  } else if (delta < -CONFIG.deltaThreshold) {
    hidden = false;
  }
  setNavHidden(hidden);
  // The "Back to top" button is re-evaluated on each scroll frame:
  // it depends on the position of the filters, which changes during the
  // same descent in which the navigation hides (not just when the
  // navigation state changes or on resize).
  updateBackToTop();
}

export function initAutoHideNav() {
  const body = document.body;

  // Scroll: compute the delta HERE, in the listener, and re-evaluate
  // once per frame (throttle with rAF). The delta cannot be computed
  // inside the rAF: the scroll event is dispatched before the rAF
  // of the same frame, so there window.scrollY already equals
  // lastY and the delta would always be 0 (QA review, issue #137).
  let scrollTicking = false;
  window.addEventListener(
    "scroll",
    () => {
      const delta = window.scrollY - lastY;
      lastY = window.scrollY;
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(() => {
        scrollTicking = false;
        evaluate(delta);
      });
    },
    { passive: true }
  );

  // Focus entering the navigation (e.g. Tab into the search):
  // re-evaluate to show it immediately.
  document.addEventListener("focusin", (e) => {
    if (e.target.closest?.(".app-header, .tabs--bar")) evaluate();
  });

  // Dropdown opens by click and global search: re-evaluate when
  // opening them (the anchored dropdown requires a visible header). The
  // listeners are wrapped so the Event is not passed as the first
  // argument (delta): evaluate(Event) would coerce to NaN and
  // keep the state by accident (QA review, issue #137).
  document.getElementById("btn-notifications")?.addEventListener("click", () => evaluate());
  document.getElementById("btn-open-profile")?.addEventListener("click", () => evaluate());
  document.getElementById("global-search-input")?.addEventListener("focus", () => evaluate());

  // Observe class changes on the elements that condition the
  // state (tab/panel change, opening of modals and
  // dropdowns, app visibility, drawer...). It includes the
  // first-level sibling views of #app (issue #256 recipes,
  // issue #62 gym): they are hidden/shown when entering/leaving the
  // section and their sections (panels) toggle .hidden when changing
  // tabs. If <body> itself changes (our classes) the
  // re-evaluation is harmless: setNavHidden does nothing if the
  // state doesn't change.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.target.matches?.(
          ".panel, .modal, .app-sidebar, #notif-dropdown, #profile-dropdown, .global-search__results, #app, #recipes-view, .recipes-view__body section, #gym-view, .gym-view__body section, .recipes-filter__panel, .ingredients-filter__panel, body"
        )
      ) {
        evaluate();
        return;
      }
    }
  });
  observer.observe(body, {
    attributes: true,
    attributeFilter: ["class"],
    subtree: true,
  });

  // Viewport size changes (rotation, zoom, browser bar):
  // the position of the filters changes, navigation and
  // floating button must be re-decided.
  window.addEventListener("resize", () => {
    evaluate();
  });

  // "Back to top": show the navigation and scroll up to the beginning of
  // the list. With prefers-reduced-motion the jump is instant.
  document.getElementById("btn-back-to-top")?.addEventListener("click", () => {
    setNavHidden(false);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });

  // Initial state (loaded with the page at the very top).
  evaluate();
}
