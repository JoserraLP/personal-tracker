// =============================================================
// Gym section (issue #62) — tabs «Summary», «Workouts»
// and «Exercises».
// The Summary tab (issue #269) aggregates the workouts of a chosen
// period (current week/month or free range) into totals and a breakdown
// per exercise. It also manages the registration of workouts (date,
// name, note and exercises with sets of weight × reps) and the
// user's exercise catalog (users/{uid}/gym-workouts and
// users/{uid}/gym-exercises).
//
// Weight and unit (issue #62): the canonical weight in Firestore is
// ALWAYS kg (pesoKg). The display unit (kg/lbs) lives in
// settings.unidadPeso and only affects the displays, the inputs
// and the placeholder of the inputs: the saved values never
// change when toggling.
//
// Pattern: like recipes.js, it is connected from app.js via
// setupGym({ ctx }), which returns the opening API of the view
// ({ openGym({ tab }) }) for the router and the sidebar.
// =============================================================

import { navigate } from "./router.js";
import { trapFocus } from "./focus-utils.js";
import { showToast } from "./ui.js";
import { getUnit, setUnit } from "./settings.js";

// ---------- Constants ----------

// Conversion kg → lbs (1 kg = 2.20462 lbs). The weight is always stored
// in kg; this constant only feeds the display.
const KG_PER_LB = 2.20462;

// Muscle groups of the exercise catalog (issue #62): presets
// of the select of the create/edit form. Saved workouts keep the
// group as text; the ids below are canonical.
const GYM_MUSCLE_GROUPS = [
  { id: "pecho", label: "Pecho" },
  { id: "espalda", label: "Espalda" },
  { id: "hombros", label: "Hombros" },
  { id: "biceps", label: "Bíceps" },
  { id: "triceps", label: "Tríceps" },
  { id: "antebrazos", label: "Antebrazos" },
  { id: "piernas", label: "Piernas" },
  { id: "gluteos", label: "Glúteos" },
  { id: "core", label: "Core" },
  { id: "cardio", label: "Cardio" },
  { id: "cuerpo_completo", label: "Cuerpo completo" },
  { id: "otro", label: "Otro" },
];

const GROUP_LABELS = Object.fromEntries(GYM_MUSCLE_GROUPS.map((g) => [g.id, g.label]));

// ---------- Module state ----------

let currentUser = null;
let ctx = null;
let workouts = [];
let exercises = [];
// Active Gym tab: only the tab being viewed is re-rendered
// when new data arrives (pattern from recipes.js #209).
// The default is «resumen»: the first tab of the section (#269).
let currentTab = "resumen";

// Modals: null = closed; "read" | "edit" | "new". The edit flag
// blocks closing by backdrop/Escape (pattern recipes.js:159-186).
let workoutModalMode = null;
let exerciseCardModalMode = null;
let workoutModalCleanup = null;
let exerciseModalCleanup = null;

// Workout in edition: document id (null when creating) and in-memory
// draft (weight ALWAYS in kg). The form is re-rendered from
// the draft on each change of the builder.
let editingWorkoutId = null;
let workoutDraft = null;

// Exercise in edition: id (null when creating). The form is read
// when pressing Save (no draft: there is no builder).
let editingExerciseId = null;

// Free range of the summary (issue #269, iteration 3): YYYY-MM-DD dates
// chosen in the calendar of the single box; null = open limit.
// There are no longer two independent date inputs: the first click on the
// calendar sets «from» and the second «to» (swapping if the
// second is earlier than the first). Iteration 4: the calendar does NOT
// close when only the first bound is set — it stays open until
// the two dates are chosen (closing on completing the range
// and on outside/Escape/«Listo» remain).
let summaryRange = { from: null, to: null };
// Month visible in the range calendar ({year, month 0-11}).
let summaryRangeMonth = null;
// The calendar is open (aria-expanded of the trigger).
let summaryRangePopoverOpen = false;

// Wiring of the DOM listeners (idempotent): setupGym runs after
// each login and the addEventListener calls must not accumulate.
let gymWired = false;

// ---------- Utilities ----------

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Active display unit (read fresh from localStorage).
function unit() {
  return getUnit();
}

// Short label of the active unit for placeholders and summaries.
function unitLabel() {
  return unit();
}

// kg (canonical) → display unit, rounded to 1 decimal.
function kgToDisplay(kg) {
  const v = unit() === "lbs" ? kg * KG_PER_LB : kg;
  return Math.round(v * 10) / 10;
}

// display unit → kg (canonical), rounded to 2 decimals.
function displayToKg(v) {
  const kg = unit() === "lbs" ? v / KG_PER_LB : v;
  return Math.round(kg * 100) / 100;
}

// Label of a muscle group (known preset or free text).
function groupLabel(id) {
  return GROUP_LABELS[id] || id || "";
}

// ---------- Setup ----------

// Idempotent: the DOM elements are wired once even if
// setupGym is called after each login (see app.js).
export function setupGym(opts) {
  ctx = opts?.ctx || null;

  if (gymWired) return { openGym };
  gymWired = true;

  document.getElementById("btn-new-workout").addEventListener("click", () => openWorkoutModal());
  document.getElementById("btn-new-exercise").addEventListener("click", () => openExerciseModal());

  // Tabs (issue #62): the UI only navigates; the router (fromRouter)
  // does the render. Pattern from recipes (recipes.js).
  document.querySelectorAll("[data-gym-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigate({ section: "gimnasio", tab: btn.dataset.gymTab });
    });
  });

  // Summary period selector (issue #269): the click on a chip
  // syncs the UI (is-active/aria-pressed) and the visibility of
  // the free range box (only with the «Rango» option, iteration
  // of the comment of the issue), and if the period changed the
  // summary is re-rendered (it reads the new period from the DOM). The
  // current week/month chips do not apply to the free range.
  document.querySelectorAll("[data-summary-period]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const previous = document.querySelector(".gym-summary-chip.is-active")?.dataset.summaryPeriod || null;
      syncSummaryPeriodUI(chip.dataset.summaryPeriod);
      if (previous !== chip.dataset.summaryPeriod) renderSummary();
    });
  });

  // Single box of the range (iteration 3): the trigger opens/closes the
  // calendar; inside, «from» (first click) and «to»
  // (second click) are chosen in the same control. It closes with «Listo», with
  // Escape or when clicking outside the box.
  //
  // Iteration 4: the click outside must NOT close the calendar when
  // a day has just been pressed — the grid re-render made by
  // onSummaryRangeDayClick() detaches the pressed button before the
  // event reaches this handler (bubble phase on document), and
  // e.target.closest("#gym-summary-range") would fail on a detached
  // node, closing the calendar with only «from» chosen. The
  // mark in the CAPTURE phase (which runs before the re-render) remembers
  // that the click was born inside the box: the calendar remains
  // open until the two dates are chosen (closing on
  // completing the range is done by onSummaryRangeDayClick(), and Escape /
  // «Listo» / real outside click still close the same way).
  document.getElementById("gym-summary-range")?.addEventListener("click", (e) => {
    e.__summaryRangeInside = true;
  }, true);
  const rangeTrigger = document.getElementById("gym-summary-range-trigger");
  rangeTrigger?.addEventListener("click", () => {
    if (summaryRangePopoverOpen) {
      closeSummaryRangePopover();
    } else {
      openSummaryRangePopover();
    }
  });
  document.getElementById("gym-summary-range-prev")?.addEventListener("click", () => {
    shiftSummaryRangeMonth(-1);
  });
  document.getElementById("gym-summary-range-next")?.addEventListener("click", () => {
    shiftSummaryRangeMonth(1);
  });
  document.getElementById("gym-summary-range-days")?.addEventListener("click", (e) => {
    const day = e.target.closest("[data-summary-range-day]");
    if (!day) return;
    onSummaryRangeDayClick(day.dataset.summaryRangeDay);
  });
  document.getElementById("gym-summary-range-clear")?.addEventListener("click", () => {
    // Clearing the range leaves both bounds open and the calendar
    // open to choose again.
    summaryRange = { from: null, to: null };
    renderSummaryRangeCalendar();
    updateSummaryRangeSummary();
    renderSummary();
  });
  document.getElementById("gym-summary-range-done")?.addEventListener("click", closeSummaryRangePopover);
  document.addEventListener("click", (e) => {
    if (summaryRangePopoverOpen && !e.__summaryRangeInside && !e.target.closest(".gym-summary-chip")) {
      closeSummaryRangePopover();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && summaryRangePopoverOpen) closeSummaryRangePopover();
  });

  // Weight unit selector (issue #62): it is persisted with setUnit
  // (localStorage + sync to Firestore) and the active tab is re-rendered
  // (Summary included, #269) and the open workout modal,
  // if any.
  const unitSelect = document.getElementById("gym-unit-select");
  if (unitSelect) {
    unitSelect.addEventListener("change", () => {
      setUnit(unitSelect.value);
      renderAllWithUnit();
    });
  }

  // Workout modal: close by ✕, backdrop and Escape. Backdrop and
  // Escape only close in read mode; in edit they are blocked to
  // not lose the builder's progress (pattern recipes.js #234).
  document.getElementById("gym-workout-modal-close").addEventListener("click", closeWorkoutModal);
  document.getElementById("gym-workout-modal-backdrop").addEventListener("click", () => {
    if (workoutModalMode === "read") closeWorkoutModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("gym-workout-modal").classList.contains("hidden") && workoutModalMode === "read") {
      e.preventDefault();
      closeWorkoutModal();
    }
  });

  // Exercise modal: same pattern.
  document.getElementById("gym-exercise-modal-close").addEventListener("click", closeExerciseModal);
  document.getElementById("gym-exercise-modal-backdrop").addEventListener("click", () => {
    if (exerciseCardModalMode === "read") closeExerciseModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("gym-exercise-modal").classList.contains("hidden") && exerciseCardModalMode === "read") {
      e.preventDefault();
      closeExerciseModal();
    }
  });

  // Workout cards: the whole card is the button; click (and
  // Enter/Space) open the detail in read mode.
  document.getElementById("gym-workouts-list").addEventListener("click", (e) => {
    const card = e.target.closest("[data-workout-id]");
    if (!card) return;
    openWorkoutModal(card.dataset.workoutId);
  });
  document.getElementById("gym-workouts-list").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest("[data-workout-id]");
    if (!card) return;
    e.preventDefault();
    openWorkoutModal(card.dataset.workoutId);
  });

  // Exercise catalog cards: ditto.
  document.getElementById("gym-exercises-catalog").addEventListener("click", (e) => {
    const card = e.target.closest("[data-exercise-id]");
    if (!card) return;
    openExerciseModal(card.dataset.exerciseId);
  });
  document.getElementById("gym-exercises-catalog").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest("[data-exercise-id]");
    if (!card) return;
    e.preventDefault();
    openExerciseModal(card.dataset.exerciseId);
  });

  return { openGym };
}

// Starts the real-time subscriptions (app.js calls it after the
// login, like the rest of sections). Returns the cancellation
// function. Each snapshot only re-renders the tab being viewed
// (pattern from recipes.js).
export function subscribeGymData(uid, onChange, onError) {
  currentUser = uid;
  const subs = [];

  subs.push(ctx.subscribeToGymWorkouts(uid, (items) => {
    workouts = items;
    if (currentTab === "entrenos") renderWorkouts();
    // The summary (issue #269) lives off the workouts: it is re-rendered
    // in real time on create/edit/delete.
    if (currentTab === "resumen") renderSummary();
    if (onChange) onChange();
  }, onError));

  subs.push(ctx.subscribeToGymExercises(uid, (items) => {
    exercises = items;
    if (currentTab === "ejercicios") renderCatalog();
    // The summary (issue #269) uses the catalog to resolve the muscle
    // group and the canonical name of the exercises: if a new
    // snapshot arrives with the tab being viewed, it is repainted.
    if (currentTab === "resumen") renderSummary();
    // Open workout builder (create/edit): the catalog may
    // arrive later than the modal (issue #62, first exercise from
    // «Ver catálogo de ejercicios»). The draft is in kg, so
    // re-rendering is safe; the editor is repainted with the updated
    // select.
    const workoutModal = document.getElementById("gym-workout-modal");
    if (workoutModal && !workoutModal.classList.contains("hidden")) {
      if (workoutModalMode === "edit" || workoutModalMode === "new") {
        renderWorkoutEditor();
      }
    }
    if (onChange) onChange();
  }, onError));

  return () => subs.forEach((unsub) => unsub && unsub());
}

// Clears the local state (app.js calls it on logout, so the
// previous user's data isn't shown to the next one),
// including the free range of the summary and the calendar (iteration 3).
export function resetGymData() {
  workouts = [];
  exercises = [];
  currentTab = "resumen";
  editingWorkoutId = null;
  workoutDraft = null;
  editingExerciseId = null;
  summaryRange = { from: null, to: null };
  summaryRangeMonth = null;
  summaryWeekdayLabels = null;
  const rangeBox = document.getElementById("gym-summary-range");
  if (rangeBox) rangeBox.hidden = true;
  summaryRangePopoverOpen = false;
  const popover = document.getElementById("gym-summary-range-popover");
  if (popover) popover.hidden = true;
  document.getElementById("gym-summary-range-trigger")?.setAttribute("aria-expanded", "false");
  closeWorkoutModal();
  closeExerciseModal();
}

// ---------- Opening / closing of the view ----------

export function openGym({ tab = "resumen", fromRouter = false } = {}) {
  if (!fromRouter) {
    navigate({ section: "gimnasio", tab });
  }
  currentTab = tab;
  document.getElementById("app").classList.add("hidden");
  document.getElementById("profile-view").classList.add("hidden");
  document.getElementById("recipes-view").classList.add("hidden");
  document.getElementById("gym-view").classList.remove("hidden");

  document.querySelectorAll("[data-gym-tab]").forEach((btn) => {
    const isActive = btn.dataset.gymTab === tab;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });

  const panels = {
    resumen: "panel-gym-summary-tab",
    entrenos: "panel-gym-workouts-tab",
    ejercicios: "panel-gym-exercises-tab",
  };
  Object.entries(panels).forEach(([key, panelId]) => {
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.toggle("hidden", key !== tab);
  });

  // Render dispatch per tab (#269): the summary enters as one
  // more tab, with no chained if/else.
  const renderers = { resumen: renderSummary, entrenos: renderWorkouts, ejercicios: renderCatalog };
  renderers[tab]?.();
}

// ---------- Weight unit: global re-render (issue #62) ----------

// After changing the unit select, everything showing weights
// is repainted: the active tab and, if the workout modal is open,
// its view (read or edit, from the in-memory draft).
function renderAllWithUnit() {
  // Render dispatch per tab (#269): the summary is repainted for
  // uniformity and because since iterations 3/4 it shows weights (the
  // Difference column) converted once when painting: when changing the unit
  // it must be repainted with the new conversion.
  const renderers = { resumen: renderSummary, entrenos: renderWorkouts, ejercicios: renderCatalog };
  renderers[currentTab]?.();
  const workoutModal = document.getElementById("gym-workout-modal");
  if (workoutModal && !workoutModal.classList.contains("hidden")) {
    if (workoutModalMode === "read") {
      const workout = workouts.find((w) => w.id === editingWorkoutId);
      if (workout) openWorkoutModal(workout.id);
    } else if (workoutModalMode === "edit" || workoutModalMode === "new") {
      renderWorkoutEditor();
    }
  }
}

// ---------- Workouts tab: list ----------

function renderWorkouts() {
  const container = document.getElementById("gym-workouts-list");
  if (!container) return;

  if (!workouts.length) {
    container.innerHTML = `<p class="empty-state">Aún no hay entrenos. Pulsa «+ Nuevo entreno» para registrar el primero.</p>`;
    return;
  }

  container.innerHTML = `<div class="gym-workouts-grid">
    ${workouts.map(workoutCardHtml).join("")}
  </div>`;
}

function workoutCardHtml(w) {
  const ejercicios = w.ejercicios || [];
  const series = ejercicios.reduce((n, e) => n + (e.series || []).length, 0);
  const summary = `${ejercicios.length} ${ejercicios.length === 1 ? "ejercicio" : "ejercicios"} · ${series} ${series === 1 ? "serie" : "series"}`;
  const title = w.nombre || "Entreno";
  return `<article class="gym-workout-card" role="button" tabindex="0" data-workout-id="${escapeHtml(w.id)}"
    aria-label="Ver entreno ${escapeHtml(title)} (${(ctx.formatDateEs(w.fechaISO) || "").replace(/\//g, "/")})">
    <h3 class="gym-card__title">${escapeHtml(title)}</h3>
    <p class="gym-card__meta">${escapeHtml(ctx.formatDateEs(w.fechaISO) || w.fechaISO || "")} · ${escapeHtml(summary)}</p>
  </article>`;
}

// ---------- Exercises tab: catalog ----------

function renderCatalog() {
  const container = document.getElementById("gym-exercises-catalog");
  if (!container) return;

  if (!exercises.length) {
    container.innerHTML = `<p class="empty-state">El catálogo de ejercicios está vacío. Pulsa «+ Nuevo ejercicio» para
      añadir los que haces, y luego podrás usarlos al registrar entrenos.</p>`;
    return;
  }

  // The snapshot already arrives sorted by name (db.js); the local sort
  // with tie-break by id is defensive against old catalogs.
  const sorted = [...exercises].sort(
    (a, b) => a.nombre.localeCompare(b.nombre, "es") || a.id.localeCompare(b.id)
  );

  container.innerHTML = `<div class="gym-exercises-grid">
    ${sorted.map(exerciseCardHtml).join("")}
  </div>`;
}

function exerciseCardHtml(ex) {
  const group = groupLabel(ex.grupoMuscular);
  return `<article class="gym-exercise-card" role="button" tabindex="0" data-exercise-id="${escapeHtml(ex.id)}"
    aria-label="Ver ejercicio ${escapeHtml(ex.nombre)}">
    <h3 class="gym-card__title">${escapeHtml(ex.nombre)}</h3>
    ${group ? `<span class="gym-muscle-chip">${escapeHtml(group)}</span>` : ""}
  </article>`;
}

// ---------- Summary tab (issue #269) ----------

// Date range (fechaISO YYYY-MM-DD) of the active period, read
// from the DOM (chip .gym-summary-chip.is-active) and from the state of the
// free range chosen in the calendar of the single box (#269), with the
// UTC pattern of ctx.todayISO():
//   - week: Monday of the current week → today.
//   - month: first day of the current month → today.
//   - custom: summaryRange.from/summaryRange.to, inclusive.
//     An empty bound is an open limit (null); if from > to they
//     are swapped (the calendar already avoids it when choosing, defensive).
function summaryPeriodRange() {
  const today = ctx.todayISO();
  const active = document.querySelector(".gym-summary-chip.is-active")?.dataset.summaryPeriod || "week";
  if (active === "month") {
    return { period: "month", custom: false, from: today.slice(0, 8) + "01", to: today };
  }
  if (active === "custom") {
    let { from, to } = summaryRange;
    if (from && to && from > to) [from, to] = [to, from];
    return { period: "custom", custom: true, from, to };
  }
  // Current week: Monday is today − ((getUTCDay() + 6) % 7) days
  // (Sunday = 0 → offset 6; Monday = 1 → offset 0).
  const monday = new Date(`${today}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return { period: "week", custom: false, from: monday.toISOString().slice(0, 10), to: today };
}

// Grouping key of a workout's exercise entry: the
// canonical id if it exists and is still in the catalog; otherwise (exercise
// deleted from the catalog or legacy data without id) it groups by the
// normalized snapshot name.
function summaryExerciseKey(e) {
  if (e?.ejercicioId && exercises.some((x) => x.id === e.ejercicioId)) {
    return e.ejercicioId;
  }
  return String(e?.nombre || "").trim().toLowerCase();
}

// Muscle group of a workout entry: the one saved in the entry itself
// if it has it; otherwise the catalog's one (by ejercicioId or, for
// legacy without id, by normalized name).
function summaryGroupFor(e) {
  if (e?.grupoMuscular) return e.grupoMuscular;
  const byId = e?.ejercicioId && exercises.find((x) => x.id === e.ejercicioId);
  if (byId?.grupoMuscular) return byId.grupoMuscular;
  const norm = String(e?.nombre || "").trim().toLowerCase();
  if (!norm) return null;
  const byName = exercises.find((x) => String(x.nombre || "").trim().toLowerCase() === norm);
  return byName?.grupoMuscular || null;
}

// Aggregates the workouts of the range [from, to] (YYYY-MM-DD dates,
// lexicographic comparison; null from/to = open limit) into:
//   - totals { entrenos, ejercicios } of the period (number of workouts and
//     number of distinct exercises).
//   - perExercise: Map key → { nombre, grupoMuscular, veces,
//     pesoAntiguo, pesoNuevo } with veces = number of distinct workouts
//     where it appears and the OLDEST and the NEWEST registered weight
//     in the period (canonical kg; sets without weight —null or ≤ 0—
//     don't count).
//   - perGroup: Map group → { label, ejercicios, entrenos } with the number
//     of distinct exercises and workouts of each muscle group.
// Iterations from the user's comments on the issue: the
// totals of sets, repetitions and volume are removed — the
// summary focuses on what is asked: number of workouts, total
// exercises, breakdown by muscle groups and, since iteration 4, the
// WEIGHT DIFFERENCE per exercise (the oldest weight of the period
// vs the newest, signed: positive if it increased, negative if
// it went down). An entry without id or name neither groups nor counts (there is
// no exercise to attribute it to); without a muscle group it only counts in the
// totals, not in the group breakdown.
function summarizeWorkouts(workoutsList, from, to) {
  const totals = { entrenos: 0, ejercicios: 0 };
  const perExercise = new Map();
  const perGroup = new Map();
  const seenWorkouts = new Map(); // exercise key → Set of workout ids

  // workoutsList arrives sorted desc by fechaISO (subscription of
  // db.js, ADR-095): the FIRST workout processed is the NEWEST and the
  // LAST is the OLDEST. That order defines the chronological bounds
  // of iteration 4 (the oldest and the newest weight), not the
  // minimums/maximums of iteration 3.
  for (const w of workoutsList) {
    if (from && w.fechaISO < from) continue;
    if (to && w.fechaISO > to) continue;
    totals.entrenos += 1;
    for (const e of w.ejercicios || []) {
      const key = summaryExerciseKey(e);
      // Entry without id or name: neither groups nor counts (there is
      // no exercise to attribute it to).
      if (!key) continue;
      let agg = perExercise.get(key);
      if (!agg) {
        const catalogEx = e.ejercicioId ? exercises.find((x) => x.id === e.ejercicioId) : null;
        agg = {
          nombre: catalogEx?.nombre || e.nombre || "",
          grupoMuscular: summaryGroupFor(e),
          veces: 0,
          pesoAntiguo: null,
          pesoNuevo: null,
        };
        perExercise.set(key, agg);
      }
      if (!seenWorkouts.has(key)) seenWorkouts.set(key, new Set());
      seenWorkouts.get(key).add(w.id);
      // Chronological weight bounds of the period (canonical kg,
      // iteration 4): a set without a registered weight (null or ≤ 0,
      // e.g. body weight) cannot be a bound. Within a
      // workout, the oldest weight is the first set with weight and
      // the newest the last. Across workouts (desc list), the
      // first time the exercise is seen fixes its NEWEST weight (the
      // most recent workout of the period) and each subsequent workout
      // overwrites the OLDEST weight until keeping the one of the
      // earliest workout of the period.
      let serieAntigua = null;
      let serieNueva = null;
      for (const s of e.series || []) {
        const kg = s?.pesoKg;
        if (kg == null || kg <= 0) continue;
        if (serieAntigua == null) serieAntigua = kg;
        serieNueva = kg;
      }
      if (serieNueva != null) {
        if (agg.pesoNuevo == null) agg.pesoNuevo = serieNueva;
        agg.pesoAntiguo = serieAntigua;
      }
      const group = agg.grupoMuscular;
      if (!group) continue;
      let gagg = perGroup.get(group);
      if (!gagg) {
        gagg = { label: groupLabel(group), ejercicios: 0, entrenos: 0, keys: new Set(), workouts: new Set() };
        perGroup.set(group, gagg);
      }
      gagg.keys.add(key);
      gagg.workouts.add(w.id);
    }
  }
  // Veces = number of distinct workouts where the exercise appears;
  // total exercises = number of distinct exercises of the period.
  totals.ejercicios = perExercise.size;
  for (const [key, agg] of perExercise) {
    agg.veces = seenWorkouts.get(key)?.size || 0;
  }
  for (const gagg of perGroup.values()) {
    gagg.ejercicios = gagg.keys.size;
    gagg.entrenos = gagg.workouts.size;
  }
  return { totals, perExercise, perGroup };
}

// Paints the summary of the active period in #gym-summary-data: header
// with the range, cards (workouts and total exercises) and two
// breakdowns — by muscle groups and per exercise — sorted by
// frequency desc, alphabetical tie-break (iteration of the issue's
// comment: without totals of sets/reps/volume).
function renderSummary() {
  const container = document.getElementById("gym-summary-data");
  if (!container) return;
  const { from, to } = summaryPeriodRange();

  if (!workouts.length) {
    container.innerHTML = `<p class="empty-state">Aún no has registrado entrenos. Registra entrenos en la pestaña «Entrenos» para ver aquí tu resumen.</p>`;
    return;
  }

  const { totals, perExercise, perGroup } = summarizeWorkouts(workouts, from, to);

  if (!totals.entrenos) {
    container.innerHTML = `<p class="empty-state">No hay entrenos en este periodo. Registra entrenos en la pestaña «Entrenos» para ver aquí tu resumen.</p>`;
    return;
  }

  const fmtDate = (iso) => (iso ? ctx.formatDateEs(iso) : "sin límite");

  const cards = `
    <div class="gym-summary-grid">
      <div class="gym-summary-card">
        <span class="gym-summary-card__label">Entrenos</span>
        <span class="gym-summary-card__value">${totals.entrenos}</span>
      </div>
      <div class="gym-summary-card">
        <span class="gym-summary-card__label">Ejercicios</span>
        <span class="gym-summary-card__value">${totals.ejercicios}</span>
      </div>
    </div>`;

  const groupRows = [...perGroup.values()]
    .sort((a, b) => b.ejercicios - a.ejercicios || a.label.localeCompare(b.label, "es"))
    .map((g) => `
      <tr>
        <td>${escapeHtml(g.label)}</td>
        <td>${g.ejercicios}</td>
        <td>${g.entrenos}</td>
      </tr>`)
    .join("");

  const groupsTable = groupRows.length
    ? `<h3 class="gym-summary-section-title">Por grupos musculares</h3>
        <div class="gym-summary-table-wrap">
          <table class="gym-summary-table">
            <thead>
              <tr>
                <th>Grupo muscular</th>
                <th>Ejercicios</th>
                <th>Entrenos</th>
              </tr>
            </thead>
            <tbody>${groupRows}</tbody>
          </table>
        </div>`
    : "";

  // Iteration 4: each exercise shows ONLY the weight difference of the
  // period — the newest weight vs the oldest one, signed
  // (positive if it increased, negative if it went down) — in the active
  // display unit; «—» if there is no set with weight in the
  // period (all without registered weight). The min/max bounds of
  // iteration 3 are removed: the user wants to see only the
  // change between the oldest weight and the newest.
  const unitHeader = escapeHtml(unitLabel());
  // Formats the difference with an explicit sign (+ for increase, −
  // for decrease; 0 without sign). It is computed in canonical kg and
  // converted once when painting (same pattern as iteration 3).
  const fmtDiff = (kg) => {
    if (kg == null) return "—";
    const d = kgToDisplay(kg);
    return escapeHtml(d > 0 ? `+${d}` : String(d));
  };
  // Iteration 5: the difference is painted with semantic color — green if
  // it increased, red if it went down — and WITHOUT a class when it is zero (it inherits the
  // normal color of the cell, «white like now»). The shade is
  // applied by css/styles.css with AA variants per theme family.
  const diffClass = (kg) =>
    kg == null || kg === 0 ? "" : `gym-summary-table__diff--${kg > 0 ? "up" : "down"}`;
  const rows = [...perExercise.values()]
    .sort((a, b) => b.veces - a.veces || a.nombre.localeCompare(b.nombre, "es"))
    .map((agg) => {
      // Difference = newest weight − oldest weight of the period
      // (canonical kg); null if either bound is missing.
      const diffKg = agg.pesoAntiguo != null && agg.pesoNuevo != null ? agg.pesoNuevo - agg.pesoAntiguo : null;
      return `
      <tr>
        <td class="gym-summary-table__name">
          ${escapeHtml(agg.nombre)}
          ${agg.grupoMuscular ? `<span class="gym-muscle-chip">${escapeHtml(groupLabel(agg.grupoMuscular))}</span>` : ""}
        </td>
        <td>${agg.veces}</td>
        <td class="${diffClass(diffKg)}">${fmtDiff(diffKg)}</td>
      </tr>`;
    })
    .join("");

  const table = rows.length
    ? `<h3 class="gym-summary-section-title">Por ejercicio</h3>
        <div class="gym-summary-table-wrap">
          <table class="gym-summary-table">
            <thead>
              <tr>
                <th>Ejercicio</th>
                <th>Veces</th>
                <th>Diferencia (${unitHeader})</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`
    : "";

  container.innerHTML = `
    <p class="gym-summary-period">Periodo: ${escapeHtml(fmtDate(from))} – ${escapeHtml(fmtDate(to))}</p>
    ${cards}
    ${groupsTable}
    ${table}`;
}

// Syncs the UI of the period selector: is-active/aria-pressed
// only on the chip of the given period (the others stay inactive) and
// the free range box visible only with the «Rango» option (iteration
// of the issue's comment). When activating «Rango»
// the calendar is born open and with the already chosen range summarized in the
// trigger; when going back to week/month the calendar closes.
function syncSummaryPeriodUI(period) {
  document.querySelectorAll("[data-summary-period]").forEach((chip) => {
    const isActive = chip.dataset.summaryPeriod === period;
    chip.classList.toggle("is-active", isActive);
    chip.setAttribute("aria-pressed", String(isActive));
  });
  const rangeBox = document.getElementById("gym-summary-range");
  if (rangeBox) {
    rangeBox.hidden = period !== "custom";
    if (period === "custom") {
      openSummaryRangePopover();
    } else {
      closeSummaryRangePopover();
    }
  }
}

// Text of the trigger of the free range box
// (#gym-summary-range-summary): the «from – to» dates already
// chosen in the calendar (or «sin límite» if a bound is
// empty), in the same format as the painted period header.
function updateSummaryRangeSummary() {
  const summaryEl = document.getElementById("gym-summary-range-summary");
  if (!summaryEl) return;
  const { from, to } = summaryRange;
  const fmtDate = (iso) => (iso ? ctx.formatDateEs(iso) : "sin límite");
  summaryEl.textContent = `${fmtDate(from)} – ${fmtDate(to)}`;
}

// ---------- Free range calendar (issue #269, iteration 3) ----------

// Initial month of the calendar: the one of the «from» bound (or «to» if
// only that one was chosen) if there is a range; otherwise the current month.
function summaryRangeCalMonth() {
  const anchor = summaryRange.from || summaryRange.to;
  if (anchor) {
    const [y, m] = anchor.split("-").map(Number);
    return { year: y, month: m - 1 };
  }
  const [y, m] = ctx.todayISO().split("-").map(Number);
  return { year: y, month: m - 1 };
}

// Week row headers (Monday first) in the interface language
// (es-ES): "L M X J V S D". They are computed once and
// remembered (explicit fallback if the environment doesn't produce them).
let summaryWeekdayLabels = null;
function summaryWeekdayLabelsFn() {
  if (summaryWeekdayLabels) return summaryWeekdayLabels;
  const fallback = ["L", "M", "X", "J", "V", "S", "D"];
  summaryWeekdayLabels = Array.from({ length: 7 }, (_, i) => {
    // 2024-01-01 was a Monday: the first 7 days of January 2024
    // cover the full week in order.
    const label = new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString("es-ES", {
      weekday: "narrow",
      timeZone: "UTC",
    });
    return label || fallback[i];
  });
  return summaryWeekdayLabels;
}

// Title of the calendar month ("Agosto de 2026", es-ES).
function summaryRangeMonthLabel(year, month) {
  const label = new Date(Date.UTC(year, month, 1)).toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : `${year}`;
}

// Grid of the current month: 42 cells (6 rows × 7 columns, Monday
// first). Cells outside the month are null (empty) so the
// grid doesn't jump in height when navigating between months.
function summaryRangeDayGrid(year, month) {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const offset = (firstWeekday + 6) % 7; // Monday first (Sunday = 0 → 6)
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length < 42) cells.push(null);
  return cells;
}

// First click (no range or with a complete range): starts a new
// range on that day. Second click (with «from» chosen and «to»
// empty): closes the range, swapping the bounds if the click
// is earlier than the «from»; when completed the calendar closes.
function onSummaryRangeDayClick(iso) {
  if (!summaryRange.from || (summaryRange.from && summaryRange.to)) {
    summaryRange = { from: iso, to: null };
  } else {
    let { from, to } = summaryRange;
    if (iso < from) {
      to = from;
      from = iso;
    } else {
      to = iso;
    }
    summaryRange = { from, to };
  }
  const completed = summaryRange.from && summaryRange.to;
  renderSummaryRangeCalendar();
  updateSummaryRangeSummary();
  renderSummary();
  if (completed) closeSummaryRangePopover();
}

// Paints the visible month in the box's calendar: header with the
// month and the navigation, weekday row and day grid
// with the states (today, range bounds, intermediate days).
function renderSummaryRangeCalendar() {
  const grid = document.getElementById("gym-summary-range-days");
  if (!grid) return;
  const monthEl = document.getElementById("gym-summary-range-month");
  const weekdaysEl = document.getElementById("gym-summary-range-weekdays");
  const cal = summaryRangeMonth;
  if (monthEl) monthEl.textContent = summaryRangeMonthLabel(cal.year, cal.month);
  if (weekdaysEl) {
    weekdaysEl.innerHTML = summaryWeekdayLabelsFn()
      .map((l) => `<span class="gym-summary-range__cal-weekday">${l}</span>`)
      .join("");
  }
  const today = ctx.todayISO();
  const { from, to } = summaryRange;
  grid.innerHTML = summaryRangeDayGrid(cal.year, cal.month).map((iso) => {
    if (!iso) return `<span class="gym-summary-range__cal-blank" aria-hidden="true"></span>`;
    const selected = iso === from || iso === to;
    const inRange = !selected && from && to && iso > from && iso < to;
    const classes = [
      "gym-summary-range__day",
      iso === today ? "gym-summary-range__day--today" : "",
      selected ? "gym-summary-range__day--selected" : "",
      inRange ? "gym-summary-range__day--in-range" : "",
    ].filter(Boolean).join(" ");
    return `<button type="button" class="${classes}" data-summary-range-day="${iso}"
      aria-label="${escapeHtml(ctx.formatDateEs(iso))}" aria-pressed="${selected ? "true" : "false"}">${Number(iso.slice(8))}</button>`;
  }).join("");
}

// Opens the calendar: it remembers the month of the chosen range (or the current
// month), repaints and leaves the focus on the «from» bound (or on today if
// the range is empty) so it can also be navigated with the keyboard.
function openSummaryRangePopover() {
  const popover = document.getElementById("gym-summary-range-popover");
  const trigger = document.getElementById("gym-summary-range-trigger");
  if (!popover || !trigger || !popover.hidden) return;
  summaryRangeMonth = summaryRangeCalMonth();
  renderSummaryRangeCalendar();
  updateSummaryRangeSummary();
  popover.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  summaryRangePopoverOpen = true;
  const focusDay = summaryRange.from
    ? document.querySelector(`[data-summary-range-day="${summaryRange.from}"]`)
    : document.querySelector(".gym-summary-range__day--today");
  (focusDay || trigger).focus({ preventScroll: false });
}

function closeSummaryRangePopover() {
  const popover = document.getElementById("gym-summary-range-popover");
  const trigger = document.getElementById("gym-summary-range-trigger");
  if (!popover || popover.hidden) return;
  popover.hidden = true;
  trigger?.setAttribute("aria-expanded", "false");
  summaryRangePopoverOpen = false;
  // Return focus to the trigger (a11y): except when the box is left
  // hidden right after (chip change to current week/month), in which
  // case focusing a hidden element would drop the focus to body.
  const rangeBox = document.getElementById("gym-summary-range");
  if (trigger && rangeBox && !rangeBox.hidden) {
    trigger.focus({ preventScroll: false });
  }
}

// Navigates the calendar one month (delta ±1); the visible month is
// recomputed with modular arithmetic on (year, month 0-11).
function shiftSummaryRangeMonth(delta) {
  const cal = summaryRangeMonth;
  const m = cal.month + delta;
  const year = cal.year + Math.floor(m / 12);
  summaryRangeMonth = { year, month: ((m % 12) + 12) % 12 };
  renderSummaryRangeCalendar();
}

// ---------- Workout modal ----------

// Opens the workout modal: with id = detail in read mode (with
// Edit/Delete); without id = create with the exercise builder.
function openWorkoutModal(id) {
  const modal = document.getElementById("gym-workout-modal");
  const content = document.getElementById("gym-workout-modal-content");
  const workout = id ? workouts.find((w) => w.id === id) : null;
  const wasHidden = modal.classList.contains("hidden");

  if (workout) {
    editingWorkoutId = workout.id;
    workoutModalMode = "read";
  } else {
    editingWorkoutId = null;
    workoutModalMode = "new";
    workoutDraft = {
      fechaISO: ctx.todayISO(),
      nombre: "",
      nota: "",
      ejercicios: [],
    };
  }

  modal.querySelector(".modal__card").setAttribute(
    "aria-label",
    workout ? `Entreno: ${workout.nombre || "Sin nombre"}` : "Nuevo entreno"
  );

  content.innerHTML = workout ? workoutDetailHtml(workout) : renderWorkoutEditorHtml();
  bindWorkoutDetailHandlers(content, workout);
  if (workoutModalMode !== "read") bindWorkoutEditorHandlers(content);

  if (wasHidden) {
    modal._previousActiveElement = document.activeElement;
    modal.classList.remove("hidden");
  }
  if (workoutModalCleanup) workoutModalCleanup();
  workoutModalCleanup = trapFocus(modal.querySelector(".modal__card"));
  if (workoutModalMode !== "read") {
    // Focus on the date field on create/edit (pattern of the
    // ingredient modal): in a second rAF after trapFocus's one (which
    // focuses the ✕) the final focus ends on the input.
    requestAnimationFrame(() => {
      content.querySelector("#gym-wk-fecha")?.focus({ preventScroll: false });
    });
  }
}

function closeWorkoutModal() {
  const modal = document.getElementById("gym-workout-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  workoutModalMode = null;
  editingWorkoutId = null;
  workoutDraft = null;
  if (workoutModalCleanup) {
    workoutModalCleanup();
    workoutModalCleanup = null;
  }
  if (modal._previousActiveElement) modal._previousActiveElement.focus();
}

// Read-only view of the workout: date, optional name and note,
// exercises with their sets table (weight × repetitions, active
// display unit) and Edit/Delete actions.
function workoutDetailHtml(w) {
  const ejercicios = w.ejercicios || [];
  const blocks = ejercicios.map((ex, i) => {
    const seriesRows = (ex.series || []).map((s) => `
      <div class="gym-series-row">
        <span>${s.pesoKg != null ? escapeHtml(String(kgToDisplay(s.pesoKg))) : ""} ${escapeHtml(unitLabel())}</span>
        <span>${s.reps != null ? escapeHtml(String(s.reps)) : ""} reps</span>
        <span></span>
      </div>`).join("");
    return `<div class="gym-exercise-block">
      <div class="gym-exercise-block__header">
        <h4 class="gym-exercise-block__name">${escapeHtml(ex.nombre || "Ejercicio")}</h4>
        <span class="gym-muscle-chip">${(ex.series || []).length} ${(ex.series || []).length === 1 ? "serie" : "series"}</span>
      </div>
      <div class="gym-series-table">${seriesRows}</div>
    </div>`;
  }).join("");

  return `<div class="gym-modal__view">
    <h3 class="gym-modal__title">${escapeHtml(w.nombre || "Entreno")}</h3>
    <div class="gym-form__field">
      <span class="gym-modal__label">Fecha</span>
      <p class="gym-modal__text">${escapeHtml(ctx.formatDateEs(w.fechaISO) || w.fechaISO || "Sin fecha")}</p>
    </div>
    ${w.nombre ? `<div class="gym-form__field">
      <span class="gym-modal__label">Nombre</span>
      <p class="gym-modal__text">${escapeHtml(w.nombre)}</p>
    </div>` : ""}
    ${w.nota ? `<div class="gym-form__field">
      <span class="gym-modal__label">Nota</span>
      <p class="gym-modal__text">${escapeHtml(w.nota)}</p>
    </div>` : ""}
    <div class="gym-form__field">
      <span class="gym-modal__label">Ejercicios</span>
      ${ejercicios.length ? blocks : `<p class="gym-modal__text">Sin ejercicios.</p>`}
    </div>
    <div class="gym-modal__actions">
      <button type="button" class="btn btn--small btn--danger" data-gym-wk-delete>Eliminar</button>
      <button type="button" class="btn btn--small" data-gym-wk-edit>✏️ Editar</button>
    </div>
  </div>`;
}

function bindWorkoutDetailHandlers(content, workout) {
  content.querySelector("[data-gym-wk-edit]")?.addEventListener("click", () => {
    if (!workout) return;
    // The edit draft starts from the saved data (canonical
    // kg; the conversion happens in the inputs' render).
    workoutDraft = {
      fechaISO: workout.fechaISO || ctx.todayISO(),
      nombre: workout.nombre || "",
      nota: workout.nota || "",
      ejercicios: (workout.ejercicios || []).map((ex) => ({
        ejercicioId: ex.ejercicioId || null,
        nombre: ex.nombre || "",
        series: (ex.series || []).map((s) => ({ pesoKg: s.pesoKg || 0, reps: s.reps || 0 })),
      })),
    };
    workoutModalMode = "edit";
    renderWorkoutEditor();
  });

  content.querySelector("[data-gym-wk-delete]")?.addEventListener("click", async () => {
    if (!workout) return;
    if (!confirm(`¿Eliminar el entreno «${workout.nombre || ctx.formatDateEs(workout.fechaISO) || "sin fecha"}»?`)) return;
    try {
      await ctx.deleteGymWorkout(currentUser, workout.id);
      closeWorkoutModal();
      showToast("Entreno eliminado.");
    } catch (err) {
      console.error("No se pudo eliminar el entreno:", err);
      showToast("No se pudo eliminar el entreno.");
    }
  });
}

// Render of the editor (create or edit): it is fully repainted from
// workoutDraft on each change of the builder (add/remove
// set or exercise).
function renderWorkoutEditor() {
  const modal = document.getElementById("gym-workout-modal");
  const content = document.getElementById("gym-workout-modal-content");
  modal.querySelector(".modal__card").setAttribute(
    "aria-label",
    workoutModalMode === "edit" ? "Editar entreno" : "Nuevo entreno"
  );
  content.innerHTML = renderWorkoutEditorHtml();
  bindWorkoutEditorHandlers(content);
}

// Last occurrence of an exercise (#265, #270): it walks workouts (already
// sorted by fechaISO desc from db.js) and returns the most recent
// occurrence with sets as {fechaISO, series} — copy of {pesoKg,
// reps} — or null. Canonical match by ejercicioId with strict
// priority; only if there is no canonical entry is the fallback
// by normalized snapshot name used (legacy without id).
function lastWorkoutForExercise(exerciseId, nombre) {
  const norm = (s) => String(s || "").trim().toLowerCase();
  const nameNorm = norm(nombre);
  let legacy = null; // { w, ex } of the first legacy entry with sets
  for (const w of workouts) {
    for (const ex of w.ejercicios || []) {
      if (!(ex.series || []).length) continue;
      if (exerciseId && ex.ejercicioId === exerciseId) {
        return { fechaISO: w.fechaISO, series: ex.series.map((s) => ({ pesoKg: s.pesoKg || 0, reps: s.reps || 0 })) };
      }
      if (legacy === null && !ex.ejercicioId && nameNorm && norm(ex.nombre) === nameNorm) {
        legacy = { w, ex };
      }
    }
  }
  return legacy
    ? { fechaISO: legacy.w.fechaISO, series: legacy.ex.series.map((s) => ({ pesoKg: s.pesoKg || 0, reps: s.reps || 0 })) }
    : null;
}

// Pre-fill (#265): only if the block does not have sets yet (it does not
// overwrite what is already written or what was brought from a workout in
// edition). It re-renders and returns the focus to the select (pattern
// of «Añadir serie»).
function maybePrefillSeriesFromLastWorkout(select) {
  if (!workoutDraft) return;
  const block = select.closest(".gym-exercise-block");
  if (!block) return;
  const idx = parseInt(block.dataset.gymExIdx, 10);
  const entry = workoutDraft.ejercicios[idx];
  const exerciseId = select.value || null;
  if (!exerciseId || !entry || entry.series.length) return;
  const prev = lastWorkoutForExercise(exerciseId, entry.nombre);
  if (!prev) return;
  workoutDraft.ejercicios[idx].series = prev.series;
  renderWorkoutEditor();
  document.querySelector(`[data-gym-ex-idx="${idx}"]`)
    ?.querySelector("[data-gym-ex-select]")?.focus();
}

function renderWorkoutEditorHtml() {
  const d = workoutDraft;
  const exercisesHtml = d.ejercicios.map((ex, i) => workoutExerciseBlockHtml(ex, i)).join("");
  const hint = !exercises.length
    ? `<p class="gym-empty-hint">Añade ejercicios de tu catálogo para registrar pesos y repeticiones.</p>`
    : "";
  const emptyCatalogHint = !exercises.length
    ? `<button type="button" class="btn btn--small" data-gym-open-catalog>Ver catálogo de ejercicios</button>`
    : "";

  return `<form id="gym-workout-form" class="gym-modal__form">
    <h3 class="gym-modal__title">${workoutModalMode === "edit" ? "Editar entreno" : "Nuevo entreno"}</h3>
    <div class="gym-form__field">
      <label for="gym-wk-fecha">Fecha *</label>
      <input type="date" id="gym-wk-fecha" required value="${escapeHtml(d.fechaISO)}" />
    </div>
    <div class="gym-form__field">
      <label for="gym-wk-nombre">Nombre</label>
      <input type="text" id="gym-wk-nombre" maxlength="200" autocomplete="off" placeholder="P. ej. Push day"
             value="${escapeHtml(d.nombre)}" />
    </div>
    <div class="gym-form__field">
      <label for="gym-wk-nota">Nota</label>
      <textarea id="gym-wk-nota" rows="3" placeholder="Cómo fue el entreno, sensaciones, progreso…">${escapeHtml(d.nota)}</textarea>
    </div>
    <div class="gym-form__field">
      <label for="gym-wk-unit">Unidad de peso</label>
      <select id="gym-wk-unit" aria-label="Unidad de peso del entreno">
        <option value="kg"${unit() === "kg" ? " selected" : ""}>kg</option>
        <option value="lbs"${unit() === "lbs" ? " selected" : ""}>lbs</option>
      </select>
    </div>
    <div class="gym-form__field">
      <label>Ejercicios</label>
      ${hint}
      ${exercisesHtml}
      ${emptyCatalogHint}
      <div class="gym-block-button-row">
        <button type="button" class="btn btn--small" data-gym-add-exercise>+ Añadir ejercicio</button>
        <button type="button" class="btn btn--small" data-gym-new-exercise>Nuevo ejercicio</button>
      </div>
    </div>
    <div class="gym-modal__actions">
      <button type="button" class="btn btn--small" data-gym-wk-cancel>Cancelar</button>
      <button type="submit" class="btn btn--small btn--primary">Guardar</button>
    </div>
  </form>`;
}

// Block of one exercise of the builder: catalog select (with
// the snapshot-name placeholder for old data without id),
// sets rows (weight in the active unit + reps) and buttons to
// remove set/exercise.
function workoutExerciseBlockHtml(ex, i) {
  const options = exercises.map((e) =>
    `<option value="${escapeHtml(e.id)}"${e.id === ex.ejercicioId ? " selected" : ""}>${escapeHtml(e.nombre)}</option>`
  ).join("");
  // Old data (legacy «Otro…»): without id and with snapshot name; the
  // name is shown as a placeholder so the reference is not lost.
  const placeholderLabel = ex.ejercicioId === null && ex.nombre ? ex.nombre : "Elige un ejercicio…";
  const seriesRows = ex.series.map((s, si) => workoutSeriesRowHtml(i, si, s)).join("");
  // Header of the sets table (weight/reps labels, #265): same
  // grid as the rows so the columns stay aligned; the
  // third cell is empty because in the rows it is the ✕ button.
  const seriesHead = `<div class="gym-series-row gym-series-row--head" aria-hidden="true">
    <span>Peso (${escapeHtml(unitLabel())})</span>
    <span>Repeticiones</span>
    <span></span>
  </div>`;

  return `<div class="gym-exercise-block" data-gym-ex-idx="${i}">
    <div class="gym-exercise-block__header">
      <select data-gym-ex-select aria-label="Ejercicio ${i + 1}">
        <option value="">${escapeHtml(placeholderLabel)}</option>
        ${options}
      </select>
      <button type="button" class="gym-remove-btn" data-gym-ex-remove="${i}" aria-label="Quitar ejercicio ${i + 1}">✕</button>
    </div>
    <div class="gym-series-table">${seriesHead}${seriesRows}</div>
    <div class="gym-block-button-row">
      <button type="button" class="gym-add-series-btn" data-gym-add-series="${i}">+ Añadir serie</button>
      <button type="button" class="gym-add-series-btn" data-gym-dup-series="${i}">Duplicar serie</button>
    </div>
  </div>`;
}

// Sets row of an exercise of the builder: weight (active unit,
// step 0.5 and inputmode decimal for numeric keyboard) + reps (minimum
// 1) + remove button. Value in the display unit.
function workoutSeriesRowHtml(exIdx, si, s) {
  const peso = s.pesoKg ? kgToDisplay(s.pesoKg) : "";
  return `<div class="gym-series-row">
    <input type="number" data-gym-series-peso="${exIdx}-${si}" step="0.5" min="0" inputmode="decimal"
           placeholder="${escapeHtml(unitLabel())}" aria-label="Peso de la serie ${si + 1} del ejercicio ${exIdx + 1} (${escapeHtml(unitLabel())})"
           value="${escapeHtml(String(peso))}" />
    <input type="number" data-gym-series-reps="${exIdx}-${si}" min="1" step="1" inputmode="numeric"
           placeholder="reps" aria-label="Repeticiones de la serie ${si + 1} del ejercicio ${exIdx + 1}"
           value="${s.reps ? escapeHtml(String(s.reps)) : ""}" />
    <button type="button" class="gym-remove-btn" data-gym-series-remove="${exIdx}-${si}" aria-label="Quitar serie ${si + 1}">✕</button>
  </div>`;
}

// Reading of the form into the draft (weight converted to kg).
// It runs before each mutation of the builder and on save.
function syncWorkoutDraftFromDom() {
  const form = document.getElementById("gym-workout-form");
  if (!form) return;
  workoutDraft.fechaISO = form.querySelector("#gym-wk-fecha").value;
  workoutDraft.nombre = form.querySelector("#gym-wk-nombre").value;
  workoutDraft.nota = form.querySelector("#gym-wk-nota").value;
  workoutDraft.ejercicios = Array.from(form.querySelectorAll(".gym-exercise-block")).map((block, idx) => {
    const select = block.querySelector("[data-gym-ex-select]");
    const ejercicioId = select.value || null;
    // If the exercise was deleted from the catalog after saving the
    // workout, the select no longer has its option: the snapshot name
    // of the draft is kept (saved workouts keep their name).
    const found = exercises.find((e) => e.id === select.value);
    const nombre = found?.nombre ?? workoutDraft.ejercicios[idx]?.nombre ?? "";
    // The sets rows are the .gym-series-row WITHOUT the labels header
    // (.gym-series-row--head, #265): the header only has
    // spans and must not be read as a data row.
    const series = Array.from(block.querySelectorAll(".gym-series-row:not(.gym-series-row--head)")).map((row) => ({
      pesoKg: displayToKg(parseFloat(row.querySelector("[data-gym-series-peso]").value) || 0),
      reps: parseInt(row.querySelector("[data-gym-series-reps]").value, 10) || 0,
    }));
    return { ejercicioId, nombre, series };
  });
}

function bindWorkoutEditorHandlers(content) {
  // Weight unit selector of the modal (create/edit, #265): same
  // logic and persistence as the global #gym-unit-select, so
  // only what shows weights is re-rendered (renderAllWithUnit
  // repaints the tab, the open editor and keeps the global select in sync).
  content.querySelector("#gym-wk-unit")?.addEventListener("change", (e) => {
    // Save what was typed before re-rendering: the re-render starts
    // from the draft (canonical kg) and would convert and keep what
    // was typed instead of losing it.
    syncWorkoutDraftFromDom();
    setUnit(e.target.value);
    const globalSelect = document.getElementById("gym-unit-select");
    if (globalSelect) globalSelect.value = unit();
    renderAllWithUnit();
  });

  // Catalog exercise selection: the draft is synced (the
  // snapshot name may change when moving from one exercise to another) and the
  // sets are pre-filled with the last ones (#265).
  content.querySelectorAll("[data-gym-ex-select]").forEach((select) => {
    select.addEventListener("change", () => {
      syncWorkoutDraftFromDom();
      maybePrefillSeriesFromLastWorkout(select);
    });
  });

  // Add set: saves what was typed into the draft and re-renders.
  content.querySelectorAll("[data-gym-add-series]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncWorkoutDraftFromDom();
      const idx = parseInt(btn.dataset.gymAddSeries, 10);
      workoutDraft.ejercicios[idx].series.push({ pesoKg: 0, reps: 0 });
      renderWorkoutEditor();
      const row = document.querySelector(`[data-gym-series-peso="${idx}-${workoutDraft.ejercicios[idx].series.length - 1}"]`);
      row?.focus();
    });
  });

  // Duplicar serie (#265): copies the last set of the exercise (weight and
  // reps) to the end, without having to rewrite it. It warns if there isn't any.
  content.querySelectorAll("[data-gym-dup-series]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncWorkoutDraftFromDom();
      const idx = parseInt(btn.dataset.gymDupSeries, 10);
      const series = workoutDraft.ejercicios[idx].series;
      if (!series.length) {
        showToast("No hay ninguna serie que duplicar.");
        return;
      }
      const last = series[series.length - 1];
      series.push({ pesoKg: last.pesoKg, reps: last.reps });
      renderWorkoutEditor();
      const row = document.querySelector(`[data-gym-series-peso="${idx}-${series.length - 1}"]`);
      row?.focus();
    });
  });

  // Quitar serie: ditto, without the row.
  content.querySelectorAll("[data-gym-series-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncWorkoutDraftFromDom();
      const [exIdx, si] = btn.dataset.gymSeriesRemove.split("-").map(Number);
      workoutDraft.ejercicios[exIdx].series.splice(si, 1);
      renderWorkoutEditor();
      const block = document.querySelector(`[data-gym-ex-idx="${exIdx}"]`);
      block?.querySelector(".gym-add-series-btn")?.focus();
    });
  });

  // Remove exercise from the builder.
  content.querySelectorAll("[data-gym-ex-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncWorkoutDraftFromDom();
      const idx = parseInt(btn.dataset.gymExRemove, 10);
      workoutDraft.ejercicios.splice(idx, 1);
      renderWorkoutEditor();
      const addBtn = document.querySelector("[data-gym-add-exercise]");
      addBtn?.focus();
    });
  });

  // Add empty exercise to the builder.
  content.querySelector("[data-gym-add-exercise]")?.addEventListener("click", () => {
    syncWorkoutDraftFromDom();
    workoutDraft.ejercicios.push({ ejercicioId: "", nombre: "", series: [] });
    renderWorkoutEditor();
    const block = document.querySelector(".gym-exercise-block:last-of-type");
    block?.querySelector("[data-gym-ex-select]")?.focus();
  });

  // Nuevo ejercicio (#265): opens the same create modal as the
  // Exercises tab without closing the workout's one (pattern of open-catalog).
  content.querySelector("[data-gym-new-exercise]")?.addEventListener("click", () => {
    openExerciseModal();
  });

  // Shortcut to the catalog (hint when the catalog is empty and the
  // builder can't offer options): opens the exercise create modal
  // without closing the workout's one (pattern of the recipes
  // modals when opening the ingredient catalog).
  content.querySelector("[data-gym-open-catalog]")?.addEventListener("click", () => {
    openExerciseModal();
  });

  // Cancel: returns to the read view (if editing) or closes.
  content.querySelector("[data-gym-wk-cancel]")?.addEventListener("click", () => {
    if (workoutModalMode === "edit" && editingWorkoutId) {
      workoutModalMode = "read";
      workoutDraft = null;
      const workout = workouts.find((w) => w.id === editingWorkoutId);
      if (workout) {
        openWorkoutModal(workout.id);
        return;
      }
    }
    closeWorkoutModal();
  });

  content.querySelector("#gym-workout-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    syncWorkoutDraftFromDom();
    // Save guard (issue #62): only the sets with
    // reps ≥ 1 count; exercises without valid sets are discarded. Without
    // any valid set it cannot be saved.
    const validExercises = workoutDraft.ejercicios
      .map((ex) => ({ ...ex, series: ex.series.filter((s) => s.reps > 0) }))
      .filter((ex) => ex.series.length > 0);
    if (!validExercises.length) {
      showToast("Añade al menos un ejercicio con una serie (reps ≥ 1).");
      return;
    }
    const payload = {
      fechaISO: workoutDraft.fechaISO,
      ...(workoutDraft.nombre.trim() && { nombre: workoutDraft.nombre.trim() }),
      ...(workoutDraft.nota.trim() && { nota: workoutDraft.nota.trim() }),
      ejercicios: validExercises,
    };
    try {
      if (workoutModalMode === "edit" && editingWorkoutId) {
        await ctx.updateGymWorkout(currentUser, editingWorkoutId, payload);
        showToast("Entreno actualizado.");
      } else {
        await ctx.addGymWorkout(currentUser, payload);
        showToast("Entreno guardado.");
      }
      closeWorkoutModal();
    } catch (err) {
      console.error("No se pudo guardar el entreno:", err);
      showToast("No se pudo guardar el entreno.");
    }
  });
}

// ---------- Exercise modal ----------

// Opens the exercise modal: with id = detail in read mode (with
// Edit/Delete); without id = create.
function openExerciseModal(id) {
  const modal = document.getElementById("gym-exercise-modal");
  const content = document.getElementById("gym-exercise-modal-content");
  const exercise = id ? exercises.find((x) => x.id === id) : null;
  const wasHidden = modal.classList.contains("hidden");

  if (exercise) {
    editingExerciseId = exercise.id;
    exerciseCardModalMode = "read";
  } else {
    editingExerciseId = null;
    exerciseCardModalMode = "new";
  }

  modal.querySelector(".modal__card").setAttribute(
    "aria-label",
    exercise ? `Ejercicio: ${exercise.nombre}` : "Nuevo ejercicio"
  );

  content.innerHTML = exercise
    ? exerciseDetailHtml(exercise)
    : exerciseFormHtml(null);
  bindExerciseDetailHandlers(content, exercise);
  if (!exercise) bindExerciseFormHandlers(content);

  if (wasHidden) {
    modal._previousActiveElement = document.activeElement;
    modal.classList.remove("hidden");
  }
  if (exerciseModalCleanup) exerciseModalCleanup();
  exerciseModalCleanup = trapFocus(modal.querySelector(".modal__card"));
  if (!exercise) {
    requestAnimationFrame(() => {
      content.querySelector("#gym-ex-nombre")?.focus({ preventScroll: false });
    });
  }
}

function closeExerciseModal() {
  const modal = document.getElementById("gym-exercise-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  exerciseCardModalMode = null;
  editingExerciseId = null;
  if (exerciseModalCleanup) {
    exerciseModalCleanup();
    exerciseModalCleanup = null;
  }
  if (modal._previousActiveElement) modal._previousActiveElement.focus();
}

// Read-only view of the exercise: name, muscle group, notes
// and the «Last time» section (#270) with the date and the sets of the
// most recent workout where it was trained; Edit/Delete actions.
function exerciseDetailHtml(ex) {
  const last = lastWorkoutForExercise(ex.id, ex.nombre);
  const lastSection = last
    ? `<div class="gym-form__field">
        <span class="gym-modal__label">Última vez</span>
        <p class="gym-modal__text">${escapeHtml(ctx.formatDateEs(last.fechaISO) || last.fechaISO || "")}</p>
        <div class="gym-series-table">
          ${last.series.map((s) => `
            <div class="gym-series-row">
              <span>${s.pesoKg != null ? escapeHtml(String(kgToDisplay(s.pesoKg))) : ""} ${escapeHtml(unitLabel())}</span>
              <span>${s.reps != null ? escapeHtml(String(s.reps)) : ""} reps</span>
              <span></span>
            </div>`).join("")}
        </div>
      </div>`
    : "";
  return `<div class="gym-modal__view">
    <h3 class="gym-modal__title">${escapeHtml(ex.nombre)}</h3>
    <div class="gym-form__field">
      <span class="gym-modal__label">Grupo muscular</span>
      ${ex.grupoMuscular
        ? `<span class="gym-muscle-chip" style="align-self:flex-start">${escapeHtml(groupLabel(ex.grupoMuscular))}</span>`
        : `<p class="gym-modal__text">Sin indicar</p>`}
    </div>
    <div class="gym-form__field">
      <span class="gym-modal__label">Notas</span>
      <p class="gym-modal__text">${ex.notas ? escapeHtml(ex.notas) : "Sin notas."}</p>
    </div>
    ${lastSection}
    <div class="gym-modal__actions">
      <button type="button" class="btn btn--small btn--danger" data-gym-ex-delete>Eliminar</button>
      <button type="button" class="btn btn--small" data-gym-ex-edit>✏️ Editar</button>
    </div>
  </div>`;
}

function bindExerciseDetailHandlers(content, exercise) {
  content.querySelector("[data-gym-ex-edit]")?.addEventListener("click", () => {
    if (!exercise) return;
    exerciseCardModalMode = "edit";
    renderExerciseForm(exercise);
  });

  content.querySelector("[data-gym-ex-delete]")?.addEventListener("click", async () => {
    if (!exercise) return;
    if (!confirm(`¿Eliminar el ejercicio «${exercise.nombre}» del catálogo?`)) return;
    try {
      await ctx.deleteGymExercise(currentUser, exercise.id);
      closeExerciseModal();
      // The saved workouts keep the name (snapshot, #62).
      showToast("Ejercicio eliminado (los entrenos guardados conservan su nombre).");
    } catch (err) {
      console.error("No se pudo eliminar el ejercicio:", err);
      showToast("No se pudo eliminar el ejercicio.");
    }
  });
}

// Render of the exercise form (create or edit).
function renderExerciseForm(exercise) {
  const modal = document.getElementById("gym-exercise-modal");
  const content = document.getElementById("gym-exercise-modal-content");
  modal.querySelector(".modal__card").setAttribute(
    "aria-label",
    exercise ? "Editar ejercicio" : "Nuevo ejercicio"
  );
  content.innerHTML = exerciseFormHtml(exercise);
  bindExerciseFormHandlers(content);
  requestAnimationFrame(() => {
    content.querySelector("#gym-ex-nombre")?.focus({ preventScroll: false });
  });
}

function exerciseFormHtml(exercise) {
  const nombre = exercise?.nombre || "";
  const grupo = exercise?.grupoMuscular || "";
  const notas = exercise?.notas || "";
  const options = GYM_MUSCLE_GROUPS.map((g) =>
    `<option value="${escapeHtml(g.id)}"${g.id === grupo ? " selected" : ""}>${escapeHtml(g.label)}</option>`
  ).join("");
  return `<form id="gym-exercise-form" class="gym-modal__form">
    <h3 class="gym-modal__title">${exercise ? "Editar ejercicio" : "Nuevo ejercicio"}</h3>
    <div class="gym-form__field">
      <label for="gym-ex-nombre">Nombre *</label>
      <input type="text" id="gym-ex-nombre" required maxlength="200" autocomplete="off"
             placeholder="P. ej. press banca" value="${escapeHtml(nombre)}" />
    </div>
    <div class="gym-form__field">
      <label for="gym-ex-grupo">Grupo muscular</label>
      <select id="gym-ex-grupo" aria-label="Grupo muscular del ejercicio">
        <option value="">Sin categoría</option>
        ${options}
      </select>
    </div>
    <div class="gym-form__field">
      <label for="gym-ex-notas">Notas</label>
      <textarea id="gym-ex-notas" rows="3" placeholder="Técnica, anotaciones, variantes…">${escapeHtml(notas)}</textarea>
    </div>
    <div class="gym-modal__actions">
      <button type="button" class="btn btn--small" data-gym-ex-cancel>Cancelar</button>
      <button type="submit" class="btn btn--small btn--primary">Guardar</button>
    </div>
  </form>`;
}

function bindExerciseFormHandlers(content) {
  content.querySelector("[data-gym-ex-cancel]")?.addEventListener("click", () => {
    if (exerciseCardModalMode === "edit" && editingExerciseId) {
      const exercise = exercises.find((x) => x.id === editingExerciseId);
      exerciseCardModalMode = "read";
      if (exercise) {
        openExerciseModal(exercise.id);
        return;
      }
    }
    closeExerciseModal();
  });

  content.querySelector("#gym-exercise-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = content.querySelector("#gym-ex-nombre").value.trim();
    if (!nombre) return;
    const grupo = content.querySelector("#gym-ex-grupo").value;
    const notas = content.querySelector("#gym-ex-notas").value.trim();
    const payload = {
      nombre,
      ...(grupo && { grupoMuscular: grupo }),
      ...(notas && { notas }),
    };
    try {
      if (exerciseCardModalMode === "edit" && editingExerciseId) {
        await ctx.updateGymExercise(currentUser, editingExerciseId, payload);
        showToast("Ejercicio actualizado.");
      } else {
        await ctx.addGymExercise(currentUser, payload);
        showToast("Ejercicio añadido al catálogo.");
      }
      closeExerciseModal();
    } catch (err) {
      console.error("No se pudo guardar el ejercicio:", err);
      showToast("No se pudo guardar el ejercicio.");
    }
  });
}