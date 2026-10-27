// =============================================================
// Focus management utilities for accessibility.
// Provides functions to trap focus in modals/dropdowns
// and to get focusable elements inside a container.
// =============================================================

/**
 * Gets all the focusable elements inside a container.
 * @param {HTMLElement} container - Container to inspect
 * @returns {HTMLElement[]} Array of visible focusable elements
 */
export function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter(el => el.offsetParent !== null); // only visible elements
}

/**
 * Traps focus inside a modal/dropdown container.
 * Focus moves to the first focusable element when opened,
 * and cycles between the first and the last with Tab/Shift+Tab.
 *
 * @param {HTMLElement} container - The container element of the modal/dropdown
 * @returns {Function} Cleanup function to restore the normal behavior
 */
export function trapFocus(container) {
  if (!container) return () => {};
  const focusable = getFocusableElements(container);
  if (!focusable.length) return () => {};

  const firstFocusable = focusable[0];
  const lastFocusable = focusable[focusable.length - 1];

  function handleKeydown(e) {
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable.focus();
      }
    } else {
      if (document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable.focus();
      }
    }
  }

  document.addEventListener('keydown', handleKeydown);

  // Focus the first element after a microtask to
  // let the DOM finish updating
  requestAnimationFrame(() => {
    firstFocusable.focus();
  });

  return () => {
    document.removeEventListener('keydown', handleKeydown);
  };
}
