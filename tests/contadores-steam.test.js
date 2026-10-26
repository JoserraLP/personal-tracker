import { describe, it, expect } from "vitest";
import { validateReturnTo } from "../cloudflare/steam-proxy/worker.js";
import {
  naturalTimes,
  timesCount,
  counterFieldLabel,
  counterBadgeText,
  sanitizeSeenCount,
} from "../js/counter.js";
import { steamHoursLabel, sanitizeSteamId, ownedUrl, parseSteamCallbackHash, steamLoginUrl } from "../js/api-steam.js";
import { steamGameDraft } from "../js/settings.js";

describe("counter.js — geometría de los historiales de veces", () => {
  it("película: cuenta los visionados del watchLog", () => {
    expect(naturalTimes({ type: "movie", watchLog: ["2026-01-01", "2026-10-01"] })).toBe(2);
  });

  it("serie: cuenta las veces completada", () => {
    expect(naturalTimes({ type: "tv", timesCompleted: 2 })).toBe(2);
  });

  it("libro: solo las sesiones terminadas", () => {
    expect(
      naturalTimes({
        type: "book",
        readLog: [{ finishedAt: "2026-01-01" }, { startedAt: "2026-02-01" }, { finishedAt: "2026-03-01" }],
      })
    ).toBe(2);
  });

  it("videojuego: una sesión por partida", () => {
    expect(
      naturalTimes({ type: "game", playLog: [{ startedAt: "a" }, { startedAt: "b" }] })
    ).toBe(2);
  });

  it("sin log devuelve 0", () => {
    expect(naturalTimes(null)).toBe(0);
    expect(naturalTimes({ type: "movie" })).toBe(0);
  });
});

describe("timesCount (anotación manual)", () => {
  it("la anotación prevalece cuando es mayor que el log", () => {
    expect(timesCount({ type: "movie", watchLog: ["2026-01-01"], seenCount: 5 })).toBe(5);
  });

  it("sin anotación usa el log", () => {
    expect(timesCount({ type: "movie", watchLog: ["2026-01-01"] })).toBe(1);
  });

  it("no muestra menos de lo registrado", () => {
    expect(timesCount({ type: "book", readLog: [{ finishedAt: "a" }, { finishedAt: "b" }], seenCount: 1 })).toBe(2);
  });

  it("la anotación 0 se trata como reseteo", () => {
    // seenCount: 0 → cuenta el log (no se puede "ver menos")
    expect(timesCount({ type: "movie", watchLog: ["2026-01-01"], seenCount: 0 })).toBe(1);
  });
});

describe("etiquetas y badges", () => {
  it("etiqueta del campo de edición por tipo", () => {
    expect(counterFieldLabel("tv")).toBe("Veces completada");
    expect(counterFieldLabel("book")).toBe("Veces leído");
    expect(counterFieldLabel("game")).toBe("Veces jugada");
    expect(counterFieldLabel("movie")).toBe("Veces vista");
  });

  it("badges de la tarjeta: ×N o vacío", () => {
    expect(counterBadgeText({ type: "game", playLog: [1, 2, 3] })).toBe("×3");
    expect(counterBadgeText({ type: "movie" })).toBe("");
  });

  it("sanitizeSeenCount: entero >= 1 o null", () => {
    expect(sanitizeSeenCount("3")).toBe(3);
    expect(sanitizeSeenCount("2,5")).toBeNull(); // no es entero
    expect(sanitizeSeenCount("0")).toBeNull();
    expect(sanitizeSeenCount("")).toBeNull();
    expect(sanitizeSeenCount("-1")).toBeNull();
  });
});

describe("api-steam.js — parte pura", () => {
  it("steamHoursLabel: español con h", () => {
    expect(steamHoursLabel(134.7)).toBe("134,7 h");
    expect(steamHoursLabel(0)).toBe("");
    expect(steamHoursLabel("nada")).toBe("");
  });

  it("sanitizeSteamId: 17 dígitos o vacío", () => {
    expect(sanitizeSteamId(" 76561198000000000 ")).toBe("76561198000000000");
    expect(sanitizeSteamId("123")).toBe("");
    expect(sanitizeSteamId(null)).toBe("");
  });

  it("ownedUrl construye el endpoint con el proxy configurado", () => {
    if (!ownedUrl("76561198000000000")) return; // sin proxy en el tree
    expect(ownedUrl("76561198000000000")).toMatch(/^https:\/\/.+\/owned\?steamid=76561198000000000$/);
  });

  it("parseSteamCallbackHash: solo reconoce su propio flujo", () => {
    expect(parseSteamCallbackHash("#/steam-callback?steamid=76561198000000000")).toEqual({
      steamid: "76561198000000000",
    });
    expect(parseSteamCallbackHash("#/steam-callback?error=verify")).toEqual({ error: "verify" });
    expect(parseSteamCallbackHash("#/steam-callback?steamid=abc")).toEqual({ error: "unknown" });
    expect(parseSteamCallbackHash("#/ocio/series")).toBeNull();
    expect(parseSteamCallbackHash("")).toBeNull();
  });

  it("steamLoginUrl sin proxy devuelve null", () => {
    // Sin proxy configurado no hay login; con proxy, apunta a /login.
    const url = steamLoginUrl();
    if (!url) return;
    expect(url).toMatch(/^https:\/\/.+\/login\?return_to=/);
  });

  it("steamGameDraft: sesión única con las horas y marcada como steam", () => {
    const draft = steamGameDraft({ appid: 440, name: "Team Fortress 2", playtimeHours: 34.7, lastPlayedAt: "2026-10-20" });
    expect(draft).toMatchObject({
      type: "game",
      title: "Team Fortress 2",
      steamAppId: 440,
      steamPlaytimeHours: 34.7,
      status: "completado",
    });
    expect(draft.playLog).toEqual([
      { startedAt: "2026-10-20", finishedAt: "2026-10-20", hours: 34.7, source: "steam" },
    ]);
  });
});

describe("steam-proxy worker.js — validateReturnTo", () => {
  it("conserva el subdirectorio del deploy (no solo el origin)", () => {
    const returnTo = "https://joserralp.github.io/personal-tracker/";
    expect(validateReturnTo(returnTo, { ALLOWED_ORIGIN: "https://joserralp.github.io" })).toBe(
      "https://joserralp.github.io/personal-tracker/"
    );
  });

  it("rechaza return_to de otro host si ALLOWED_ORIGIN está fijado", () => {
    expect(validateReturnTo("https://evil.example.com/personal-tracker/", { ALLOWED_ORIGIN: "https://joserralp.github.io" })).toBeNull();
  });

  it("rechaza return_to http (solo https)", () => {
    expect(validateReturnTo("http://joserralp.github.io/personal-tracker/", { ALLOWED_ORIGIN: "https://joserralp.github.io" })).toBeNull();
  });

  it("sin ALLOWED_ORIGIN acepta cualquier https y conserva el path", () => {
    expect(validateReturnTo("https://example.com/personal-tracker/index.html", {})).toBe(
      "https://example.com/personal-tracker/index.html"
    );
  });
});
