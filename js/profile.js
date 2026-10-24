// =============================================================
// Perfil, estadísticas y amigos. Extraído de app.js.
// Maneja la vista de perfil con gráficas (Chart.js) y la sección
// de amigos (lista + detalle de solo lectura).
// =============================================================

import { normalizeEntry } from "./tv-progress.js";
import { STATUS_LABELS_NEUTRAL } from "./constants.js";
import { setupExportBackup } from "./export-backup.js";
import { setupExportIcs } from "./export-ics.js";
import { setupTvTimeImport } from "./tvtime-import.js";
import { renderSettings, normalizeTabKey } from "./settings.js";
import { logout } from "./firebase.js";
import { trapFocus } from "./focus-utils.js";
import { navigate, parseHash, getLastOcioKey, getLastRecipesTab, getLastGymTab, getLastSection } from "./router.js";

let activityChart = null;
let statusChart = null;
let genreChart = null;
let platformChart = null;

// Normaliza una fecha (string YYYY-MM-DD o Timestamp de Firestore) a
// string YYYY-MM-DD; devuelve null si no es válida (mismo patrón que
// maybePushDateEvent de activity-feed.js, issue #174).
function toDateStr(date) {
  if (!date) return null;
  if (typeof date === "object" && date.toDate) {
    return date.toDate().toISOString().slice(0, 10);
  }
  if (typeof date === "object" && date.seconds) {
    return new Date(date.seconds * 1000).toISOString().slice(0, 10);
  }
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }
  return null;
}

function getCurrentStatsFilter() {
  const statsPeriodSelect = document.getElementById("stats-period-select");
  const statsRangeStart = document.getElementById("stats-range-start");
  const statsRangeEnd = document.getElementById("stats-range-end");

  if (statsPeriodSelect.value === "custom") {
    return {
      type: "custom",
      start: statsRangeStart.value || null,
      end: statsRangeEnd.value || null,
    };
  }
  return { type: statsPeriodSelect.value };
}

function withinPeriod(dateStr, filter) {
  if (!dateStr) return false;
  if (filter.type === "all") return true;
  if (filter.type === "custom") {
    if (filter.start && dateStr < filter.start) return false;
    if (filter.end && dateStr > filter.end) return false;
    return true;
  }
  const now = new Date();
  const d = new Date(dateStr);
  if (filter.type === "year") return d.getFullYear() === now.getFullYear();
  if (filter.type === "month") {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  return true;
}

function computeStats(filter, ctx) {
  const allItems = ctx.getAllItems();
  const monthly = {};
  let moviesWatched = 0;
  allItems.movies.forEach((m) => {
    (m.watchLog || []).forEach((date) => {
      if (withinPeriod(date, filter)) {
        moviesWatched++;
        const key = date.slice(0, 7);
        monthly[key] = (monthly[key] || 0) + 1;
      }
    });
  });

  let episodesWatched = 0;
  let seriesCompleted = 0;
  allItems.tv.forEach((s) => {
    Object.values(s.watched || {}).forEach((seasonMap) => {
      Object.values(seasonMap).forEach((raw) => {
        const entry = normalizeEntry(raw);
        if (!entry || !entry.date) return;
        if (withinPeriod(entry.date, filter)) {
          episodesWatched++;
          const key = entry.date.slice(0, 7);
          monthly[key] = (monthly[key] || 0) + 1;
        }
      });
    });
    if (s.status === "completado" && withinPeriod(s.lastWatchedAt, filter)) seriesCompleted++;
  });

  let booksRead = 0;
  allItems.books.forEach((b) => {
    (b.readLog || []).forEach((entry) => {
      if (entry.finishedAt && withinPeriod(entry.finishedAt, filter)) {
        booksRead++;
        const key = entry.finishedAt.slice(0, 7);
        monthly[key] = (monthly[key] || 0) + 1;
      }
    });
  });

  // Videojuegos (issue #174): la fecha efectiva de una sesión es
  // finishedAt ?? startedAt (una sola fecha por sesión, evita doble
  // conteo). Fallback: si el juego está completado y no tiene sesiones
  // en el periodo, se cuenta con su updatedAt si cae en el periodo.
  let gamesPlayed = 0;
  let gamesCompleted = 0;
  let gameSessions = 0;
  let gameHours = 0;
  const genreCounts = {};
  const platformCounts = {};
  allItems.games.forEach((g) => {
    let playedInPeriod = false;
    const playedGenres = new Set();
    const playedPlatforms = new Set();
    (g.playLog || []).forEach((entry) => {
      const eff = toDateStr(entry.finishedAt) ?? toDateStr(entry.startedAt);
      if (eff && withinPeriod(eff, filter)) {
        gameSessions++;
        const key = eff.slice(0, 7);
        monthly[key] = (monthly[key] || 0) + 1;
        if (Number.isFinite(Number(entry.hours)) && Number(entry.hours) > 0) {
          gameHours += Number(entry.hours);
        }
        playedInPeriod = true;
      }
    });
    const u = toDateStr(g.updatedAt);
    if (!playedInPeriod && g.status === "completado" && u && withinPeriod(u, filter)) {
      playedInPeriod = true;
    }
    if (g.status === "completado") {
      // Un juego completado cuenta en el periodo si la ÚLTIMA sesión
      // terminada cae en el periodo (el momento de completado es el fin
      // de la última partida); fallback a updatedAt si no hay sesiones.
      const finishedDates = (g.playLog || [])
        .map((entry) => toDateStr(entry.finishedAt))
        .filter(Boolean)
        .sort();
      const lastFinished = finishedDates[finishedDates.length - 1];
      if ((lastFinished && withinPeriod(lastFinished, filter)) || (u && withinPeriod(u, filter))) {
        gamesCompleted++;
      }
    }
    if (playedInPeriod) {
      (g.genres || []).forEach((gen) => {
        const t = String(gen).trim();
        if (t) playedGenres.add(t);
      });
      (g.platforms || []).forEach((plat) => {
        const t = String(plat).trim();
        if (t) playedPlatforms.add(t);
      });
    }
    if (playedInPeriod) gamesPlayed++;
    playedGenres.forEach((gen) => {
      genreCounts[gen] = (genreCounts[gen] || 0) + 1;
    });
    playedPlatforms.forEach((plat) => {
      platformCounts[plat] = (platformCounts[plat] || 0) + 1;
    });
  });

  const statusCounts = {};
  [...allItems.movies, ...allItems.tv, ...allItems.books, ...allItems.games].forEach((i) => {
    statusCounts[i.status] = (statusCounts[i.status] || 0) + 1;
  });

  return {
    moviesWatched,
    episodesWatched,
    seriesCompleted,
    booksRead,
    gamesPlayed,
    gamesCompleted,
    gameSessions,
    gameHours,
    genreCounts,
    platformCounts,
    monthly,
    statusCounts,
  };
}

// Formatea horas a "X h" o "X,Y h" (coma decimal, 1 decimal); si no es
// un número finito muestra "0 h".
function formatHours(h) {
  if (!Number.isFinite(h)) return "0 h";
  const rounded = Math.round(h * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded} h`;
  return `${String(rounded).replace(".", ",")} h`;
}

function renderStats(filter, ctx) {
  const stats = computeStats(filter, ctx);
  const summaryEl = document.getElementById("stats-summary");
  summaryEl.innerHTML = `
    <div class="stat-tile"><span class="stat-tile__value">${stats.moviesWatched}</span><span class="stat-tile__label">Películas vistas</span></div>
    <div class="stat-tile"><span class="stat-tile__value">${stats.episodesWatched}</span><span class="stat-tile__label">Episodios vistos</span></div>
    <div class="stat-tile"><span class="stat-tile__value">${stats.seriesCompleted}</span><span class="stat-tile__label">Series completadas</span></div>
    <div class="stat-tile"><span class="stat-tile__value">${stats.booksRead}</span><span class="stat-tile__label">Libros leídos</span></div>
    <div class="stat-tile"><span class="stat-tile__value">${stats.gamesPlayed}</span><span class="stat-tile__label">Juegos jugados</span></div>
    <div class="stat-tile"><span class="stat-tile__value">${stats.gamesCompleted}</span><span class="stat-tile__label">Juegos completados</span></div>
    <div class="stat-tile"><span class="stat-tile__value">${stats.gameSessions}</span><span class="stat-tile__label">Sesiones de juego</span></div>
    <div class="stat-tile"><span class="stat-tile__value">${formatHours(stats.gameHours)}</span><span class="stat-tile__label">Horas jugadas</span></div>
  `;

  if (typeof Chart === "undefined") return;

  const months = Object.keys(stats.monthly).sort();
  const activityCtx = document.getElementById("chart-activity");
  if (activityChart) activityChart.destroy();
  activityChart = new Chart(activityCtx, {
    type: "bar",
    data: {
      labels: months,
      datasets: [{ label: "Actividad", data: months.map((m) => stats.monthly[m]), backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--teal-reel").trim() }],
    },
    options: { responsive: true, plugins: { legend: { display: false } } },
  });

  const statusLabelsPresent = Object.keys(stats.statusCounts).filter((k) => stats.statusCounts[k] > 0);
  const statusCtx = document.getElementById("chart-status");
  if (statusChart) statusChart.destroy();
  statusChart = new Chart(statusCtx, {
    type: "doughnut",
    data: {
      labels: statusLabelsPresent.map((k) => STATUS_LABELS_NEUTRAL[k] || k),
      datasets: [
        {
          data: statusLabelsPresent.map((k) => stats.statusCounts[k]),
          backgroundColor: [
            getComputedStyle(document.documentElement).getPropertyValue("--ink-soft").trim(),
            getComputedStyle(document.documentElement).getPropertyValue("--teal-reel").trim(),
            getComputedStyle(document.documentElement).getPropertyValue("--ochre-spine").trim(),
            getComputedStyle(document.documentElement).getPropertyValue("--ochre-spine-dark").trim(),
            getComputedStyle(document.documentElement).getPropertyValue("--stamp").trim(),
          ],
        },
      ],
    },
    options: { responsive: true },
  });

  // Top 6 de géneros y plataformas de los juegos jugados en el periodo
  // (barras horizontales; paleta de variables de tema, sin hex).
  function topN(counts, n = 6) {
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, n);
  }
  const PALETTE = ["--teal-reel", "--ochre-spine", "--stamp", "--ink-soft", "--ochre-spine-dark"];
  const colorAt = (i) =>
    getComputedStyle(document.documentElement).getPropertyValue(PALETTE[i % PALETTE.length]).trim();

  const genreEntries = topN(stats.genreCounts);
  const platformEntries = topN(stats.platformCounts);
  const genreCtx = document.getElementById("chart-genres");
  const platformCtx = document.getElementById("chart-platforms");
  if (genreChart) genreChart.destroy();
  genreChart = new Chart(genreCtx, {
    type: "bar",
    data: {
      labels: genreEntries.map(([k]) => k),
      datasets: [
        {
          label: "Juegos",
          data: genreEntries.map(([, v]) => v),
          backgroundColor: genreEntries.map((_, i) => colorAt(i)),
        },
      ],
    },
    options: { indexAxis: "y", responsive: true, plugins: { legend: { display: false } } },
  });
  if (platformChart) platformChart.destroy();
  platformChart = new Chart(platformCtx, {
    type: "bar",
    data: {
      labels: platformEntries.map(([k]) => k),
      datasets: [
        {
          label: "Juegos",
          data: platformEntries.map(([, v]) => v),
          backgroundColor: platformEntries.map((_, i) => colorAt(i)),
        },
      ],
    },
    options: { indexAxis: "y", responsive: true, plugins: { legend: { display: false } } },
  });
}

export function setupProfile(ctx) {
  const profileSubtabs = document.querySelectorAll(".profile-subtab");
  const statsSection = document.getElementById("profile-section-stats");
  const settingsSection = document.getElementById("profile-section-settings");
  const statsPeriodWrap = document.querySelector(".stats-period");
  const statsPeriodSelect = document.getElementById("stats-period-select");
  const statsRangeFields = document.getElementById("stats-range-fields");
  const statsRangeStart = document.getElementById("stats-range-start");
  const statsRangeEnd = document.getElementById("stats-range-end");

  /* ---------- Apertura de secciones del perfil ---------- */

  // Abre una sección del perfil. Cuando la llamada viene del router
  // (fromRouter: true, p. ej. recarga directa en #/perfil/...) NO se
  // vuelve a navegar (evita bucle); desde la UI sí se sincroniza la
  // URL con navigate().
  function openProfileSection(section, ctx, opts = {}) {
    const { fromRouter = false } = opts;
    if (!fromRouter) {
      // Navegación por la UI: el hash se sincroniza (navigate() no-op
      // si ya estamos en la ruta canónica, así no hay doble ejecución).
      navigate({ section: "perfil", profileSection: section });
    }
    document.getElementById("app").classList.add("hidden");
    document.getElementById("profile-view").classList.remove("hidden");
    profileSubtabs.forEach((b) => {
      const isActive = b.dataset.section === section;
      b.classList.toggle("is-active", isActive);
      b.setAttribute("aria-selected", String(isActive));
    });
    statsSection.classList.toggle("hidden", section !== "stats");
    if (settingsSection) settingsSection.classList.toggle("hidden", section !== "settings");
    statsPeriodWrap.classList.toggle("hidden", section !== "stats");
    if (section === "stats") {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          renderStats(getCurrentStatsFilter(), ctx);
        });
      });
    } else if (section === "settings" && ctx) {
      renderSettings(ctx);
    }
  }

  /* ---------- Dropdown del menú de perfil ---------- */

  const profileMenuWrap = document.querySelector(".profile-menu-wrap");
  const profileDropdown = document.getElementById("profile-dropdown");
  const btnOpenProfile = document.getElementById("btn-open-profile");
  let focusTrapCleanup = null;

  function escHandler(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeProfileDropdown();
    }
  }

  function closeProfileDropdown() {
    profileDropdown.classList.add("hidden");
    if (focusTrapCleanup) {
      focusTrapCleanup();
      focusTrapCleanup = null;
    }
    document.removeEventListener("keydown", escHandler);
    btnOpenProfile.setAttribute("aria-expanded", "false");
    btnOpenProfile.focus();
  }

  btnOpenProfile.addEventListener("click", () => {
    profileDropdown.classList.toggle("hidden");
    if (profileDropdown.classList.contains("hidden")) {
      closeProfileDropdown();
      return;
    }
    btnOpenProfile.setAttribute("aria-expanded", "true");
    focusTrapCleanup = trapFocus(profileDropdown);
    document.addEventListener("keydown", escHandler);
  });

  document.addEventListener("click", (e) => {
    if (profileMenuWrap && !profileMenuWrap.contains(e.target) && !profileDropdown.classList.contains("hidden")) {
      closeProfileDropdown();
    }
  });

  // Clas de perfil y subtabs: la UI solo navega (el hash cambia y el
  // router, vía openProfileSection con fromRouter, hace el render).
  // Así la URL es la única fuente de verdad y no hay doble trabajo.
  profileDropdown.querySelectorAll("[data-section]").forEach((item) => {
    item.addEventListener("click", () => {
      closeProfileDropdown();
      navigate({ section: "perfil", profileSection: item.dataset.section });
    });
  });

  document.getElementById("btn-profile-logout").addEventListener("click", () => {
    closeProfileDropdown();
    logout();
  });

  // Flecha de volver del perfil (issue #206, iteración 2026-08-11): el
  // perfil vuelve a tener su cabecera propia con la flecha y las
  // pestañas en la misma fila; la cabecera global no aparece aquí.
  // Cierra la vista (toggle manual: cubre el caso de navegar sin
  // cambiar el hash) y vuelve a la última sección de primer nivel en
  // la que estuviera el usuario (Ocio, Recetas o Gimnasio, issues
  // #213 y #268) con su última pestaña activa (normalizada a la
  // primera visible si esa pestaña quedó oculta, issue #97). El
  // onRoute del router se encarga de mostrar de nuevo la cabecera
  // global y la vista.
  document.getElementById("btn-close-profile").addEventListener("click", () => {
    document.getElementById("profile-view").classList.add("hidden");
    if (getLastSection() === "recetas") {
      // Rama Recetas: navegar cambia el hash (#/perfil → #/recetas) y
      // dispara onRoute → openRecipes, que ya oculta #app y
      // #profile-view y destapa #recipes-view con su pestaña.
      navigate({ section: "recetas", tab: normalizeTabKey("recetas", getLastRecipesTab()) });
    } else if (getLastSection() === "gimnasio") {
      // Rama Gimnasio (issue #268): navegar cambia el hash
      // (#/perfil → #/gimnasio) y dispara onRoute → openGym, que ya
      // oculta #app y #profile-view y destapa #gym-view con su
      // pestaña (mismo patrón que la rama Recetas, issue #213).
      navigate({ section: "gimnasio", tab: normalizeTabKey("gimnasio", getLastGymTab()) });
    } else {
      // Rama Ocio: comportamiento actual (mostrar #app antes de
      // navegar; el onRoute de Ocio activa la pestaña y re-muestra la
      // cabecera global).
      document.getElementById("app").classList.remove("hidden");
      navigate(normalizeTabKey("ocio", getLastOcioKey()));
    }
  });

  statsPeriodSelect.addEventListener("change", () => {
    const isCustom = statsPeriodSelect.value === "custom";
    statsRangeFields.classList.toggle("hidden", !isCustom);
    if (!isCustom) renderStats(getCurrentStatsFilter(), ctx);
    else if (statsRangeStart.value && statsRangeEnd.value) renderStats(getCurrentStatsFilter(), ctx);
  });

  statsRangeStart.addEventListener("change", () => {
    if (statsRangeStart.value && statsRangeEnd.value) renderStats(getCurrentStatsFilter(), ctx);
  });
  statsRangeEnd.addEventListener("change", () => {
    if (statsRangeStart.value && statsRangeEnd.value) renderStats(getCurrentStatsFilter(), ctx);
  });

  // Inicializar botones de exportación/importación de datos
  setupExportBackup(ctx);
  setupExportIcs(ctx);
  setupTvTimeImport(ctx);

  profileSubtabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate({ section: "perfil", profileSection: btn.dataset.section });
    });
  });

  return { openProfileSection };
}
