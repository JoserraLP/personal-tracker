// =============================================================
// Importación del historial completo desde un fichero JSON de
// TV Time. El export de TV Time es un array de series con sus
// temporadas/episodios y el estado de visionado de cada uno
// (is_watched + watched_at). Este módulo es PURO (parseo y
// transformación) para poder testearlo sin DOM/Firebase, y la
// función setupTvTimeImport conecta el botón de Ajustes con el
// flujo real (fichero → confirmación → alta en Firestore).
//
// Cada serie se importa como un ítem `type: "tv"` con `manual:
// true`: TV Time identificaba las series por TVDB y aquí no
// existe el id de TMDB, así que se excluye del flujo de
// "sin estrenar" (que depende de fechas de TMDB) y la ficha se
// edita como serie manual. Las temporadas "especiales"
// (temporada 0) no se importan. El marcado favorito tampoco se
// importa (la app no tiene favoritos).
// =============================================================

import * as ui from "./ui.js";

// El objeto ctx entrante manda (patrón del repo: los módulos no
// hablan con Firebase directamente, app.js inyecta en el contexto
// las funciones de acceso a datos que hacen falta).

// -------------------------------------------------------------
// Utilidades puras
// -------------------------------------------------------------

// watched_at de TV Time ("2023-01-12 20:20:32") → ISO de día
// ("2023-01-12"), el formato canónico de la web. Devuelve null si
// el valor no es una fecha razonable.
export function tvTimeDateToIso(watchedAt) {
  if (!watchedAt || typeof watchedAt !== "string") return null;
  const day = watchedAt.trim().split(" ")[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

// Estado original de TV Time (status) + datos de progreso → estado
// del registro (pendiente/en_curso/completado/abandonado/standby):
//   up_to_date    → completado si terminó todo lo registrado; si no, en_curso
//   not_started_yet → pendiente
//   continuing    → en_curso (o pendiente si no ha visto nada)
//   stopped       → abandonado (o pendiente si no ha visto nada)
//   desconocido   → pendiente
export function statusFromTvTime(status, watchedCount, episodeCount) {
  switch (status) {
    case "up_to_date":
      return episodeCount > 0 && watchedCount >= episodeCount ? "completado" : "en_curso";
    case "continuing":
      return watchedCount > 0 ? "en_curso" : "pendiente";
    case "stopped":
      return watchedCount > 0 ? "abandonado" : "pendiente";
    default:
      return "pendiente";
  }
}

// Temporadas NO especiales (content), en orden, con su número de
// episodios: la forma que la app usa como seasonsMeta en ficha.
export function tvTimeSeasonsMeta(entry) {
  const seasons = Array.isArray(entry?.seasons) ? entry.seasons : [];
  return seasons
    .filter((s) => s && s.is_specials === false && typeof s.number === "number" && s.number >= 1)
    .sort((a, b) => a.number - b.number)
    .map((s) => ({ seasonNumber: s.number, episodeCount: Number(s.episodes?.length) || 0 }));
}

// watched por temporada/episodio con las fechas del fichero: la
// forma canónica #{ temporada: { episodio: { date, rating, times } } }
// (js/tv-progress.js). Solo temporadas no especiales; un episodio
// contado varias veces se guarda con times = rewatch_count +
// watched_count si hay datos, o con lo mínimo (1).
export function tvTimeWatchedMap(entry) {
  const watched = {};
  let firstDate = null;
  let lastDate = null;
  let episodesWatched = 0;

  const seasons = Array.isArray(entry?.seasons) ? entry.seasons : [];
  for (const season of seasons) {
    if (!season || season.is_specials !== false || typeof season.number !== "number") continue;
    const episodes = Array.isArray(season.episodes) ? season.episodes : [];
    for (const ep of episodes) {
      if (!ep || typeof ep.number !== "number" || ep.number < 1 || !ep.is_watched) continue;
      const date = tvTimeDateToIso(ep.watched_at);
      const times = Math.max(1, (Number(ep.rewatch_count) || 0) + (Number(ep.watched_count) || 0));
      const key = String(season.number);
      const epKey = String(ep.number);
      watched[key] = watched[key] || {};
      watched[key][epKey] = { date: date || null, rating: null, times };
      episodesWatched++;
      if (date && (!firstDate || date < firstDate)) firstDate = date;
      if (date && (!lastDate || date > lastDate)) lastDate = date;
    }
  }
  return { watched, firstWatchedAt: firstDate, lastWatchedAt: lastDate, episodesWatched };
}

// Siguiente episodio pendiente: el primer episodio NO visto (en orden
// temporada → número) de las temporadas no especiales. null si la
// serie está completa según el fichero.
export function tvTimeNextEpisode(entry) {
  const seasons = tvTimeSeasonsMeta(entry);
  const fileEpisodes = new Map();
  for (const season of entry?.seasons || []) {
    if (season && season.is_specials === false && typeof season.number === "number") {
      fileEpisodes.set(season.number, season.episodes || []);
    }
  }
  for (const { seasonNumber } of seasons) {
    for (const ep of fileEpisodes.get(seasonNumber) || []) {
      if (ep && typeof ep.number === "number" && ep.number >= 1 && !ep.is_watched) {
        return { season: seasonNumber, episode: ep.number };
      }
    }
  }
  return null;
}

// Convierte UNA entrada de TV Time a un borrador de ítem series
// (`type: "tv"`). Devuelve null si la entrada no es válida
// (sin título o sin estructura mínima: el flujo la informa y la salta).
export function buildTvTimeItem(entry) {
  if (!entry || !entry.title) return null;

  const seasonsMeta = tvTimeSeasonsMeta(entry);
  const totalEpisodes = seasonsMeta.reduce((acc, s) => acc + s.episodeCount, 0);
  const { watched, firstWatchedAt, lastWatchedAt, episodesWatched } = tvTimeWatchedMap(entry);
  const nextEpisode = tvTimeNextEpisode(entry);
  const completed = nextEpisode === null && episodesWatched > 0;

  return {
    externalId: null,
    type: "tv",
    title: String(entry.title),
    year: null,
    coverUrl: null,
    author: null,
    pages: null,
    status: completed ? "completado" : statusFromTvTime(entry.status, episodesWatched, totalEpisodes),
    rating: null,
    notes: "",
    manual: true,
    watched,
    nextEpisode: completed ? null : nextEpisode,
    firstWatchedAt,
    lastWatchedAt,
    timesCompleted: completed ? 1 : 0,
    history: [],
    seasonsMeta,
  };
}

// Parsea el export completo y devuelve los borradores + contadores de
// errores. Lanza (Error con mensaje claro) si el fichero no tiene el
// aspecto esperado: el flujo UI muestra el motivo.
export function parseTvTimeExport(json) {
  if (!Array.isArray(json)) {
    throw new Error("El fichero no tiene el formato del export de TV Time (se esperaba una lista de series).");
  }

  const items = [];
  let skipped = 0;
  for (const entry of json) {
    const item = buildTvTimeItem(entry);
    if (item) {
      items.push(item);
    } else {
      skipped++;
    }
  }

  return {
    ok: items.length > 0,
    items,
    skipped,
    totalEpisodesWatched: items.reduce(
      (acc, it) => acc + Object.values(it.watched).reduce(
        (acc2, ses) => acc2 + Object.keys(ses).length,
        0
      ),
      0
    ),
  };
}

// -------------------------------------------------------------
// Flujo UI (varios ficheros fichero → confirma → crea)
// -------------------------------------------------------------

let _tvTimeFileInput = null;
function getTvTimeFileInput() {
  if (!_tvTimeFileInput) {
    _tvTimeFileInput = document.createElement("input");
    _tvTimeFileInput.type = "file";
    _tvTimeFileInput.accept = ".json,application/json";
    _tvTimeFileInput.style.display = "none";
    document.body.appendChild(_tvTimeFileInput);
  }
  return _tvTimeFileInput;
}

/**
 * Importa un fichero del export de TV Time:
 *   pregunta fichero → parsea → muestra resumen y pide confirmación →
 *   da de alta todas las series en Firestore.
 * Si una serie ya existe en el registro se importa otra vez (puede
 * duplicarse): se avisa en la confirmación.
 * @param {Object} ctx - Contexto de la aplicación (ctx de app.js).
 */
export function importTvTime(ctx) {
  const user = ctx.getCurrentUser();
  if (!user) {
    ui.showToast("No has iniciado sesión.");
    return;
  }

  const input = getTvTimeFileInput();
  const fresh = input.cloneNode(false);
  input.parentNode.replaceChild(fresh, input);
  _tvTimeFileInput = fresh;

  fresh.addEventListener("change", async () => {
    const file = fresh.files && fresh.files[0];
    if (!file) return;

    try {
      const parsed = parseTvTimeExport(JSON.parse(await file.text()));

      if (!parsed.ok) {
        ui.showToast("En el fichero no hay ninguna serie importable.");
        return;
      }

      const confirmMessage =
        `Se van a importar ${parsed.items.length} serie(s) con un total de ` +
        `${parsed.totalEpisodesWatched} episodios vistos` +
        (parsed.skipped ? ` (${parsed.skipped} entrada(s) inválidas se saltarán).` : ".") +
        "\n\nSe AÑADIRÁN a tu registro sin sustituir lo que ya tienes: si una serie ya estaba, quedará duplicada.";
      if (!confirm(confirmMessage)) return;

      const uid = user.uid;
      let added = 0;
      let errors = 0;

      ui.showToast(`Importando ${parsed.items.length} serie(s)…`);

      for (const item of parsed.items) {
        try {
          await ctx.addItem(uid, "tv", item);
          added++;
        } catch (err) {
          errors++;
          console.warn("Error importando serie de TV Time:", item.title, err);
        }
      }

      const msg = `Importadas ${added} serie(s).`;
      if (errors > 0) {
        ui.showToast(`${msg} ${errors} error(es) (ver consola).`);
      } else {
        ui.showToast(msg);
      }
    } catch (err) {
      console.error("Error importando TV Time:", err);
      ui.showToast("No se pudo importar: " + (err.message || err));
    }
  });

  fresh.click();
}

/**
 * Conecta el botón de Ajustes con el flujo de importación.
 * @param {Object} ctx - Contexto de la aplicación (ctx de app.js).
 */
export function setupTvTimeImport(ctx) {
  const btn = document.getElementById("btn-import-tvtime");
  if (btn) btn.addEventListener("click", () => importTvTime(ctx));
}
