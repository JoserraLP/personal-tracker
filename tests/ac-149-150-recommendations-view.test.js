// =============================================================
// Tests T-120 — AC-149 y AC-150 (issue #66; spec 05 UI-30..UI-32,
// REQ-407/408; acciones REQ-107 de UI-32).
//
//   AC-149 estado vacío no es error (REQ-408, UI-31)
//   AC-150 límite 20 (REQ-407)
//
// Cobertura en 2 niveles:
//  1. Servicio — `recommend`/`getRecommendations` en PURO con los
//     fakes de tests/fakes.js (sin red ni Firebase).
//  2. Vista — cableado de js/app.js leído como FUENTE (js/app.js toca
//     `document`/Firebase al cargar y por eso no se importa en Node),
//     mismo patrón que tests/ac-116-media-card-shared.test.js y
//     tests/ac-112-113-search-view.test.js. La parte pura del
//     componente (`buildMediaCardModel`) sí se importa.
// =============================================================
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  FALLBACK_REASON,
  RECOMMENDATION_LIMIT,
  createRecommendationService,
  recommend,
} from "../js/services/recommendation-service.js";
import { buildMediaCardModel } from "../js/ui/media-card.js";
import {
  FakeCatalogRepository,
  FakeTrackingRepository,
  expectValidScores,
  ids,
} from "./fakes.js";

const APP_SOURCE = readFileSync(
  fileURLToPath(new URL("../js/app.js", import.meta.url)),
  "utf8",
);
const INDEX_SOURCE = readFileSync(
  fileURLToPath(new URL("../index.html", import.meta.url)),
  "utf8",
);
const CSS_SOURCE = readFileSync(
  fileURLToPath(new URL("../css/app.css", import.meta.url)),
  "utf8",
);
const MEDIA_CARD_SOURCE = readFileSync(
  fileURLToPath(new URL("../js/ui/media-card.js", import.meta.url)),
  "utf8",
);

/** Devuelve el tramo de fuente entre dos marcadores. */
function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

// Tramo T-120 completo (vista de Recomendaciones de js/app.js).
const REC_BODY = sliceBetween(
  APP_SOURCE,
  "// T-120 — Vista de Recomendaciones del modelo 00-05",
  "// --- Init del catálogo",
);

// -------------------------------------------------------------
// AC-149 — estado vacío no es error (REQ-408, UI-31)
// -------------------------------------------------------------

describe("AC-149 (UI-31, REQ-408): sin entries ni catálogo ⇒ [] sin error", () => {
  it("AC-149: recommend([], []) ⇒ [] y getRecommendations ⇒ { ok:true, value: [] }", async () => {
    // Motor puro: lista vacía SIN lanzar (no es un error).
    expect(recommend([], [])).toEqual([]);

    // Servicio con fakes vacíos: Result correcto, nunca un fallo.
    const service = createRecommendationService({
      trackingRepository: new FakeTrackingRepository(),
      catalogRepository: new FakeCatalogRepository(),
    });
    const result = await service.getRecommendations("user-1");
    expect(result).toEqual({ ok: true, value: [] });
    expect(result.ok).toBe(true);
    expect(result.code).toBeUndefined();
  });

  it("AC-149: UI-31 — «Sigue valorando títulos con 8+…» visible SOLO con lista vacía", () => {
    // Fuente única del literal del estado vacío (UI-31).
    expect(REC_BODY).toContain(
      '"Sigue valorando títulos con 8+ para recibir recomendaciones";',
    );
    expect(REC_BODY).toContain(
      "recommendationsViewDom.empty.textContent = RECOMMENDATIONS_EMPTY_TEXT;",
    );
    // Visible ⇔ lista vacía (total === 0).
    expect(REC_BODY).toContain("recommendationsViewDom.empty.hidden = total !== 0;");

    // El error es un NODO SEPARADO (`role="alert"`), oculto por defecto.
    const mountBody = sliceBetween(
      REC_BODY,
      "function mountRecommendationsView()",
      "function normalizeScoreMatch(value)",
    );
    expect(mountBody).toContain('error.id = "recommendations-view-error";');
    expect(mountBody).toContain('error.setAttribute("role", "alert");');
    expect(mountBody).toContain("error.hidden = true;");
    expect(mountBody).toContain('empty.id = "recommendations-view-empty";');
    // El texto provisional de index.html se sustituye por la vista propia.
    expect(mountBody).toContain('const placeholder = view.querySelector("p.muted");');
    expect(mountBody).toContain("if (placeholder) placeholder.remove();");
    expect(INDEX_SOURCE).toContain(
      "Las recomendaciones aparecerán cuando valores títulos con 8 puntos o más.",
    );
    expect(INDEX_SOURCE).toContain('id="view-recommendations"');

    // Estado vacío con estilos propios (UI-31).
    expect(CSS_SOURCE).toContain(".recommendations-view__empty");
  });

  it("AC-149: la ruta ok:false es la ÚNICA que pinta error (el estado vacío no)", () => {
    const loadBody = sliceBetween(
      REC_BODY,
      "async function loadRecommendations()",
      "function scheduleRecommendationRefresh()",
    );
    // Éxito ⇒ items del Result y pintado; el error NUNCA se muestra.
    expect(loadBody).toContain("hideRecommendationsError();");
    expect(loadBody).toContain(
      "recommendationsViewState.items = Array.isArray(result.value) ? result.value : [];",
    );
    expect(loadBody).toContain("renderRecommendations();");
    // `showRecommendationsError` aparece SOLO en la rama de fallo.
    expect(loadBody.match(/showRecommendationsError\(/g)).toHaveLength(1);
    expect(loadBody).toContain("if (!result || result.ok !== true) {");
    expect(loadBody).toContain("clearRecommendationsGrid();");

    // Pintar el estado nunca toca el nodo de error.
    const stateBody = sliceBetween(
      REC_BODY,
      "function renderRecommendationsState()",
      "function clearRecommendationsGrid()",
    );
    expect(stateBody).not.toContain("showRecommendationsError");
  });

  it("AC-149 (REQ-408): aviso «destacados del catálogo» aparte del estado vacío", () => {
    // Aviso de afinidad insuficiente: literal propio con el mismo 8+.
    expect(REC_BODY).toContain(
      '"Todavía no hay suficiente afinidad: estos son los destacados del catálogo. Sigue valorando títulos con 8+ para recibir recomendaciones.";',
    );
    const stateBody = sliceBetween(
      REC_BODY,
      "function renderRecommendationsState()",
      "function clearRecommendationsGrid()",
    );
    // Se muestra SOLO si todas las razones son el fallback (REQ-408).
    expect(stateBody).toContain("const isFallback =");
    expect(stateBody).toContain("item.reason.trim() === FALLBACK_REASON,");
    expect(stateBody).toContain("recommendationsViewDom.hint.hidden = !isFallback;");
    // El aviso NO sustituye al estado vacío de AC-149 (casos distintos).
    expect(stateBody).toContain("recommendationsViewDom.empty.hidden = total !== 0;");
    expect(REC_BODY).toContain("FALLBACK_REASON,");
  });
});

// -------------------------------------------------------------
// AC-150 — límite 20 (REQ-407)
// -------------------------------------------------------------

describe("AC-150 (REQ-407): 50 candidatos + limit 20 ⇒ length = 20", () => {
  it("AC-150: recommend({limit:20}) sobre 50 elegibles ⇒ 20 (y cap a 20)", () => {
    expect(RECOMMENDATION_LIMIT).toBe(20);

    const entries = [{ mediaId: "seed", score: 9 }];
    const catalog = [{ id: "seed", title: "Seed", genres: ["Sci-Fi"] }];
    for (let index = 0; index < 50; index += 1) {
      catalog.push({
        id: `c${String(index).padStart(2, "0")}`,
        title: `Título ${String(index).padStart(2, "0")}`,
        genres: ["Sci-Fi"],
      });
    }
    // Forma posicional, objeto del contrato y límite por encima del cap.
    expect(recommend(entries, catalog, 20)).toHaveLength(RECOMMENDATION_LIMIT);
    expect(recommend({ entries, catalog, limit: 20 })).toHaveLength(
      RECOMMENDATION_LIMIT,
    );
    expect(recommend(entries, catalog)).toHaveLength(RECOMMENDATION_LIMIT);
    expect(recommend(entries, catalog, 999)).toHaveLength(RECOMMENDATION_LIMIT);
    expectValidScores(recommend(entries, catalog, 20));
  });

  it("AC-150: getRecommendations con 50 seed elegibles ⇒ 20 y scoreMatch válidos", async () => {
    const items = [
      { id: "seed", title: "Seed", genres: ["Sci-Fi"], seed: true },
    ];
    for (let index = 0; index < 50; index += 1) {
      const id = `c${String(index).padStart(2, "0")}`;
      items.push({ id, title: `Título ${id}`, genres: ["Sci-Fi"], seed: true });
    }
    const service = createRecommendationService({
      trackingRepository: new FakeTrackingRepository([{ mediaId: "seed", score: 9 }]),
      catalogRepository: new FakeCatalogRepository(items),
    });

    const withLimit = await service.getRecommendations("user-1", {
      limit: RECOMMENDATION_LIMIT,
    });
    expect(withLimit.ok).toBe(true);
    expect(withLimit.value).toHaveLength(RECOMMENDATION_LIMIT);
    expectValidScores(withLimit.value);
    // REQ-407: cada ítem lleva `reason` para la UI.
    expect(withLimit.value.every((entry) => typeof entry.reason === "string")).toBe(true);

    // Por defecto también son 20 (RECOMMENDATION_LIMIT es el máximo).
    const byDefault = await service.getRecommendations("user-1");
    expect(byDefault.value).toHaveLength(RECOMMENDATION_LIMIT);
  });

  it("AC-150: la vista pide limit: RECOMMENDATION_LIMIT (20) y pinta 1 tarjeta por ítem", () => {
    // El límite viene del servicio (fuente única, REQ-407).
    const serviceImportEnd = APP_SOURCE.indexOf(
      '} from "./services/recommendation-service.js";',
    );
    expect(serviceImportEnd).toBeGreaterThanOrEqual(0);
    const importBlock = APP_SOURCE.slice(
      Math.max(0, serviceImportEnd - 600),
      serviceImportEnd,
    );
    expect(importBlock).toContain("recommendationService,");
    expect(importBlock).toContain("RECOMMENDATION_LIMIT,");
    expect(importBlock).toContain("FALLBACK_REASON,");

    const loadBody = sliceBetween(
      REC_BODY,
      "async function loadRecommendations()",
      "function scheduleRecommendationRefresh()",
    );
    expect(loadBody).toContain("recommendationService.getRecommendations(uid, {");
    expect(loadBody).toContain("limit: RECOMMENDATION_LIMIT,");

    // 1 `<li>` por recomendación recibida (el cap lo pone el servicio).
    const renderBody = sliceBetween(
      REC_BODY,
      "function renderRecommendations()",
      "function renderRecommendationsState()",
    );
    expect(renderBody).toContain("for (const recommendation of items) {");
    expect(renderBody).toContain(
      "fragment.appendChild(createRecommendationItem(recommendation));",
    );
    expect(renderBody).toContain("grid.replaceChildren(fragment);");
    expect(renderBody).toContain("renderRecommendationsState();");
  });
});

// -------------------------------------------------------------
// REQ-407/408 en la UI (UI-30): reason bajo la tarjeta + badge
// -------------------------------------------------------------

describe("REQ-407/408 (UI-30): reason bajo la tarjeta y badge scoreMatch", () => {
  it("REQ-407: el pie (badge + reason) se añade DESPUÉS de la MediaCard", () => {
    const itemBody = sliceBetween(
      REC_BODY,
      "function createRecommendationItem(recommendation)",
      "function renderRecommendations()",
    );
    const cardAt = itemBody.indexOf(
      "li.appendChild(createMediaCard(item, recommendationCardOptions(item)));",
    );
    const captionAt = itemBody.indexOf("li.appendChild(caption);");
    expect(cardAt).toBeGreaterThanOrEqual(0);
    expect(captionAt).toBeGreaterThan(cardAt);

    // Badge `scoreMatch` (0–100) con aria-label en español.
    expect(itemBody).toContain('"recommendations-view__score",');
    expect(itemBody).toContain("`${scoreMatch} %`");
    expect(itemBody).toContain("Coincidencia ${scoreMatch} de 100");
    // `reason` (REQ-406) bajo la tarjeta, en su propio span.
    expect(itemBody).toContain(
      'createCatalogElement("span", "recommendations-view__reason", reason)',
    );
    expect(itemBody).toContain(
      'createCatalogElement("p", "recommendations-view__caption");',
    );
    expect(itemBody).toContain("li.appendChild(createMediaCard(");
  });

  it("REQ-407: normalizeScoreMatch acota a entero 0–100 y el grid usa la rejilla compartida", () => {
    const normalizeBody = sliceBetween(
      REC_BODY,
      "function normalizeScoreMatch(value)",
      "function recommendationCardOptions(item)",
    );
    expect(normalizeBody).toContain(
      "if (typeof value !== \"number\" || !Number.isFinite(value)) return null;",
    );
    expect(normalizeBody).toContain("return Math.min(100, Math.max(0, Math.round(value)));");

    // Misma rejilla/estilos que el resto de vistas (AC-116).
    const mountBody = sliceBetween(
      REC_BODY,
      "function mountRecommendationsView()",
      "function normalizeScoreMatch(value)",
    );
    expect(mountBody).toContain("grid.className = \"media-grid\";");
    expect(mountBody).toContain('grid.id = "recommendations-view-grid";');
    expect(CSS_SOURCE).toContain(".media-grid");
    expect(CSS_SOURCE).toContain(".recommendations-view__item");
    expect(CSS_SOURCE).toContain(".recommendations-view__item .media-card");
    expect(CSS_SOURCE).toContain(".recommendations-view__caption");
    expect(CSS_SOURCE).toContain(".recommendations-view__score");
    expect(CSS_SOURCE).toContain(".recommendations-view__reason");
  });

  it("REQ-407: el componente MediaCard acepta reason/scoreMatch opcionales (UI-30)", () => {
    const model = buildMediaCardModel(
      { id: "y", title: "Otra", mediaType: "MOVIE" },
      null,
      { reason: "Porque te gustó X", scoreMatch: 87 },
    );
    expect(model.reason).toBe("Porque te gustó X");
    expect(model.scoreMatch).toBe(87);
    // Sin datos ⇒ campos ausentes (el badge/pie de la vista es opcional).
    const plain = buildMediaCardModel({ id: "y", title: "Otra" }, null, {});
    expect(plain.reason).toBe(null);
    expect(plain.scoreMatch).toBe(null);
  });
});

// -------------------------------------------------------------
// UI-32 / done-when — acciones REQ-107 y recálculo al añadir
// -------------------------------------------------------------

describe("UI-32 (REQ-107): acciones activas y recálculo al añadir", () => {
  it("UI-32: recommendationCardOptions hereda las 3 acciones de REQ-107 y agenda el recálculo", () => {
    const optionsBody = sliceBetween(
      REC_BODY,
      "function recommendationCardOptions(item)",
      "function createRecommendationItem(recommendation)",
    );
    expect(optionsBody).toContain("const base = mediaCardOptions();");
    expect(optionsBody).toContain("...base,");
    expect(optionsBody).toContain("entry: getEntryFor(item),");
    expect(optionsBody).toContain("base.onEntryChange(context)");
    expect(optionsBody).toContain("scheduleRecommendationRefresh();");

    // `mediaCardOptions` (fuente compartida) aporta Añadir, Cambiar
    // estado y Asignar a colección (REQ-107).
    const baseBody = sliceBetween(
      APP_SOURCE,
      "function mediaCardOptions()",
      "function catalogCardOptions()",
    );
    expect(baseBody).toContain("onAdd: (context) => {");
    expect(baseBody).toContain("onStatusChange: (context) => {");
    expect(baseBody).toContain("onAssignCollection: (context) => assignMediaToCollection(context),");
    expect(baseBody).toContain("onEntryChange: (context) => {");

    // El selector de colecciones se alimenta al montar la vista
    // (sin esto «Asignar a colección» quedaría inactivo).
    const mountBody = sliceBetween(
      REC_BODY,
      "function mountRecommendationsView()",
      "function normalizeScoreMatch(value)",
    );
    expect(mountBody).toContain("void loadUserCollections();");

    // La pestaña de nav está habilitada (APP_VIEW_PENDING vacío ⇒
    // la vista es accesible y sus acciones, utilizables).
    expect(APP_SOURCE).toContain("const APP_VIEW_PENDING = Object.freeze([]);");
  });

  it("UI-32: scheduleRecommendationRefresh recalcula a los 400 ms y el logout cancela el timer", () => {
    expect(REC_BODY).toContain("const RECOMMENDATION_REFRESH_DELAY_MS = 400;");
    const scheduleBody = sliceBetween(
      REC_BODY,
      "function scheduleRecommendationRefresh()",
      "function resetRecommendationsView()",
    );
    expect(scheduleBody).toContain("clearTimeout(recommendationRefreshTimer);");
    expect(scheduleBody).toContain("recommendationRefreshTimer = setTimeout(() => {");
    expect(scheduleBody).toContain("}, RECOMMENDATION_REFRESH_DELAY_MS);");
    expect(scheduleBody).toContain("void loadRecommendations();");

    // `resetRecommendationsView` cierra el tramo T-120 (hasta el fin
    // de REC_BODY, cuyo marcador final queda fuera del propio tramo).
    const resetStart = REC_BODY.indexOf("function resetRecommendationsView()");
    expect(resetStart).toBeGreaterThanOrEqual(0);
    const resetBody = REC_BODY.slice(resetStart);
    expect(resetBody).toContain("clearTimeout(recommendationRefreshTimer);");
    expect(resetBody).toContain("recommendationRefreshTimer = null;");
    expect(resetBody).toContain("recommendationsViewState.requestId += 1;");
  });

  it("UI-32: al añadir, el ítem sale de la lista en el siguiente recálculo (REQ-404)", async () => {
    const tracking = new FakeTrackingRepository([{ mediaId: "seed", score: 9 }]);
    const catalog = new FakeCatalogRepository([
      { id: "seed", title: "Seed", genres: ["Sci-Fi"], seed: true },
      { id: "y", title: "Otra", genres: ["Sci-Fi"], seed: true },
    ]);
    const service = createRecommendationService({
      trackingRepository: tracking,
      catalogRepository: catalog,
    });

    // 1ª lectura: "y" es recomendable.
    const first = await service.getRecommendations("user-1");
    expect(first.ok).toBe(true);
    expect(ids(first.value)).toEqual(["y"]);
    expect(first.value[0].reason).toBe("Porque te gustó Seed");

    // Clic en «Añadir» (REQ-107/AC-115): entry PLANNED en 1 clic.
    const added = await tracking.upsertEntry("user-1", "y", { status: "PLANNED" });
    expect(added.ok).toBe(true);

    // Siguiente recálculo (lo programa scheduleRecommendationRefresh):
    // el ítem YA no se recomienda (REQ-404) ⇒ lista vacía (AC-149).
    const second = await service.getRecommendations("user-1");
    expect(second.ok).toBe(true);
    expect(second).toEqual({ ok: true, value: [] });
    expect(ids(second.value)).not.toContain("y");
  });

  it("UI-32: la MediaCard expone Añadir / Cambiar estado / Asignar a colección", () => {
    expect(MEDIA_CARD_SOURCE).toContain("// --- Acciones (REQ-107)");
    expect(MEDIA_CARD_SOURCE).toContain('addButton.textContent = "Añadir";');
    expect(MEDIA_CARD_SOURCE).toContain('assignButton.textContent = "Asignar a colección";');
    expect(MEDIA_CARD_SOURCE).toContain('statusSelect.dataset.action = "status";');
    expect(MEDIA_CARD_SOURCE).toContain('collectionSelect.dataset.action = "collection";');
    expect(MEDIA_CARD_SOURCE).toContain(
      "statusAriaLabel: `Cambiar el estado de «${title}»`,",
    );
    // Los 3 callbacks de la vista quedan cableados en el controlador.
    expect(MEDIA_CARD_SOURCE).toContain("void runAction(nextEntry, opts.onAdd, {");
    expect(MEDIA_CARD_SOURCE).toContain("void runAction(nextEntry, opts.onStatusChange, {");
    expect(MEDIA_CARD_SOURCE).toContain(
      "void runAction(undefined, opts.onAssignCollection, {",
    );
    expect(MEDIA_CARD_SOURCE).toContain("opts.onEntryChange({ item: state.item,");
  });
});
