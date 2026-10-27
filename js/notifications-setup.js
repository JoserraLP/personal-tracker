// =============================================================
// Wiring of the notifications dropdown: open/close, mark all
// as read, delete all. Extracted from app.js.
// Includes focus management for accessibility.
// =============================================================

import { trapFocus } from "./focus-utils.js";

export function setupNotifications(ctx) {
  const { deleteNotification, markNotificationRead } = ctx;
  const notifWrap = document.querySelector(".notif-wrap");
  const notifDropdown = document.getElementById("notif-dropdown");
  const btnNotifications = document.getElementById("btn-notifications");

  let focusTrapCleanup = null;

  function closeNotifDropdown() {
    notifDropdown.classList.add("hidden");
    if (focusTrapCleanup) {
      focusTrapCleanup();
      focusTrapCleanup = null;
    }
    // Restore focus to the notifications button
    if (btnNotifications) btnNotifications.focus();
  }

  btnNotifications.addEventListener("click", () => {
    const wasHidden = notifDropdown.classList.contains("hidden");
    notifDropdown.classList.toggle("hidden");

    if (!notifDropdown.classList.contains("hidden")) {
      // Mark as read
      ctx.getNotifications()
        .filter((n) => !n.read)
        .forEach((n) => markNotificationRead(ctx.getCurrentUser().uid, n.id));

      // Trap focus inside the dropdown
      focusTrapCleanup = trapFocus(notifDropdown);

      // Escape to close
      function escHandler(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeNotifDropdown();
          document.removeEventListener("keydown", escHandler);
        }
      }
      document.addEventListener("keydown", escHandler);
    } else {
      closeNotifDropdown();
    }
  });

  document.addEventListener("click", (e) => {
    if (notifWrap && !notifWrap.contains(e.target) && !notifDropdown.classList.contains("hidden")) {
      closeNotifDropdown();
    }
  });

  document.getElementById("btn-clear-notifs").addEventListener("click", async () => {
    for (const n of ctx.getNotifications()) {
      await deleteNotification(ctx.getCurrentUser().uid, n.id);
    }
  });
}
