import { describe, it, expect } from "vitest";
import {
  tvTimeDateToIso,
  statusFromTvTime,
  tvTimeSeasonsMeta,
  tvTimeWatchedMap,
  tvTimeNextEpisode,
  buildTvTimeItem,
  parseTvTimeExport,
} from "../js/tvtime-import.js";

describe("tvTimeDateToIso", () => {
  it("extrae el día de la fecha y hora de TV Time", () => {
    expect(tvTimeDateToIso("2023-01-12 20:20:32")).toBe("2023-01-12");
  });

  it("devuelve null para valores inválidos", () => {
    expect(tvTimeDateToIso(null)).toBeNull();
    expect(tvTimeDateToIso("no-es-fecha")).toBeNull();
  });
});

describe("statusFromTvTime", () => {
  const total = 10;

  it("up_to_date: completado si vio todos, en_curso si no", () => {
    expect(statusFromTvTime("up_to_date", 10, total)).toBe("completado");
    expect(statusFromTvTime("up_to_date", 4, total)).toBe("en_curso");
  });

  it("continuing: en_curso o pendiente sin nada visto", () => {
    expect(statusFromTvTime("continuing", 3, total)).toBe("en_curso");
    expect(statusFromTvTime("continuing", 0, total)).toBe("pendiente");
  });

  it("stopped: abandonado o pendiente sin nada visto", () => {
    expect(statusFromTvTime("stopped", 3, total)).toBe("abandonado");
    expect(statusFromTvTime("stopped", 0, total)).toBe("pendiente");
  });

  it("esos no reconocidos caen a pendiente", () => {
    expect(statusFromTvTime("loquesea", 3, total)).toBe("pendiente");
  });
});

describe("tvTimeSeasonsMeta", () => {
  it("solo temporadas normales, ordenadas, con nº de episodios", () => {
    const entry = {
      seasons: [
        { number: 2, is_specials: false, episodes: [{ number: 1 }, { number: 2 }] },
        { number: 0, is_specials: true, episodes: [{ number: 1 }] },
        { number: 1, is_specials: false, episodes: [{ number: 1 }] },
      ],
    };
    expect(tvTimeSeasonsMeta(entry)).toEqual([
      { seasonNumber: 1, episodeCount: 1 },
      { seasonNumber: 2, episodeCount: 2 },
    ]);
  });
});

describe("tvTimeWatchedMap", () => {
  const entry = {
    seasons: [
      {
        number: 0,
        is_specials: true,
        episodes: [{ number: 1, special: true, is_watched: true, watched_at: "2023-01-01 10:00:00" }],
      },
      {
        number: 1,
        is_specials: false,
        episodes: [
          { number: 1, is_watched: true, watched_at: "2023-01-12 20:20:32", watched_count: 1, rewatch_count: 0 },
          { number: 2, is_watched: true, watched_at: "2025-03-05 08:00:00", watched_count: 2, rewatch_count: 1 },
          { number: 3, is_watched: false, watched_at: null },
        ],
      },
      {
        number: 2,
        is_specials: false,
        episodes: [{ number: 1, is_watched: true, watched_at: "no-fecha", watched_count: 1, rewatch_count: 0 }],
      },
    ],
  };

  it("crea el mapa { temporada: { episodio: { date, rating, times } } } ignorando especiales", () => {
    const { watched, episodesWatched } = tvTimeWatchedMap(entry);
    expect(watched).toEqual({
      "1": {
        "1": { date: "2023-01-12", rating: null, times: 1 },
        "2": { date: "2025-03-05", rating: null, times: 3 },
      },
      "2": { "1": { date: null, rating: null, times: 1 } },
    });
    expect(episodesWatched).toBe(3);
  });

  it("calcula primera y última fecha de visionado", () => {
    const { firstWatchedAt, lastWatchedAt } = tvTimeWatchedMap(entry);
    expect(firstWatchedAt).toBe("2023-01-12");
    expect(lastWatchedAt).toBe("2025-03-05");
  });
});

describe("tvTimeNextEpisode", () => {
  const entry = {
    seasons: [
      { number: 1, is_specials: false, episodes: [{ number: 1, is_watched: true }, { number: 2, is_watched: false }] },
      { number: 2, is_specials: false, episodes: [{ number: 1, is_watched: true }] },
    ],
  };

  it("devuelve el primer episodio no visto en orden", () => {
    expect(tvTimeNextEpisode(entry)).toEqual({ season: 1, episode: 2 });
  });

  it("devuelve null si está todo visto", () => {
    const full = {
      seasons: [
        { number: 1, is_specials: false, episodes: [{ number: 1, is_watched: true }, { number: 2, is_watched: true }] },
      ],
    };
    expect(tvTimeNextEpisode(full)).toBeNull();
  });
});

describe("buildTvTimeItem", () => {
  it("construye el borrador completo de serie manual", () => {
    const entry = {
      title: "Money Heist",
      status: "up_to_date",
      seasons: [
        {
          number: 1,
          is_specials: false,
          episodes: [
            { number: 1, is_watched: true, watched_at: "2023-01-12 20:20:32", watched_count: 1, rewatch_count: 0 },
            { number: 2, is_watched: false, watched_at: null },
          ],
        },
      ],
    };

    const item = buildTvTimeItem(entry);
    expect(item).toMatchObject({
      type: "tv",
      title: "Money Heist",
      manual: true,
      externalId: null,
      status: "en_curso",
      nextEpisode: { season: 1, episode: 2 },
      firstWatchedAt: "2023-01-12",
      lastWatchedAt: "2023-01-12",
      timesCompleted: 0,
      seasonsMeta: [{ seasonNumber: 1, episodeCount: 2 }],
    });
    expect(item.watched["1"]["1"]).toEqual({ date: "2023-01-12", rating: null, times: 1 });
  });

  it("serie completada: status completado y sin nextEpisode", () => {
    const entry = {
      title: "Dark",
      status: "up_to_date",
      seasons: [{ number: 1, is_specials: false, episodes: [{ number: 1, is_watched: true, watched_at: "2023-01-28 18:15:23" }] }],
    };
    const item = buildTvTimeItem(entry);
    expect(item.status).toBe("completado");
    expect(item.nextEpisode).toBeNull();
    expect(item.timesCompleted).toBe(1);
  });

  it("serie nunca empezada: pendiente sin fechas", () => {
    const item = buildTvTimeItem({ title: "Peacemaker", status: "not_started_yet", seasons: [] });
    expect(item.status).toBe("pendiente");
    expect(item.firstWatchedAt).toBeNull();
  });

  it("serie parada con episodios vistos: abandonado", () => {
    const entry = {
      title: "13 Reasons Why",
      status: "stopped",
      seasons: [{
        number: 1,
        is_specials: false,
        episodes: [{ number: 1, is_watched: true, watched_at: "2023-01-08 20:17:41" }, { number: 2, is_watched: false, watched_at: null }],
      }],
    };
    expect(buildTvTimeItem(entry).status).toBe("abandonado");
  });

  it("devuelve null para entradas inválidas", () => {
    expect(buildTvTimeItem(null)).toBeNull();
    expect(buildTvTimeItem({})).toBeNull();
  });
});

describe("parseTvTimeExport", () => {
  it("rechaza ficheros que no sean una lista", () => {
    expect(() => parseTvTimeExport({})).toThrow();
    expect(() => parseTvTimeExport(null)).toThrow();
  });

  it("cuenta las series buenas y salta las inválidas", () => {
    const result = parseTvTimeExport([
      { title: "A", status: "up_to_date", seasons: [] },
      null,
      { status: "up_to_date", seasons: [] },
      { title: "B", status: "stopped", seasons: [] },
    ]);
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.skipped).toBe(2);
    expect(result.totalEpisodesWatched).toBe(0);
  });

  it("cuenta los episodios vistos del conjunto", () => {
    const entry = {
      title: "A",
      status: "up_to_date",
      seasons: [{
        number: 1,
        is_specials: false,
        episodes: [
          { number: 1, is_watched: true, watched_at: "2023-01-01 10:00:00" },
          { number: 2, is_watched: true, watched_at: "2023-01-02 10:00:00" },
          { number: 3, is_watched: false, watched_at: null },
        ],
      }],
    };
    expect(parseTvTimeExport([entry]).totalEpisodesWatched).toBe(2);
  });
});
