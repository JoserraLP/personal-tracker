import { describe, it, expect } from "vitest";
import { totalPlayHours } from "../js/game-log.js";

describe("game-log.js — totalPlayHours (ADR-111)", () => {
  it("suma las horas de todas las sesiones", () => {
    expect(
      totalPlayHours({
        playLog: [
          { startedAt: "2026-10-01", finishedAt: "2026-10-01", hours: 3.5 },
          { startedAt: "2026-10-02", finishedAt: "2026-10-02", hours: 2 },
        ],
      })
    ).toBe(5.5);
  });

  it("redondea a 1 decimal y descarta sesiones sin horas", () => {
    expect(
      totalPlayHours({
        playLog: [
          { hours: 1.26 },
          { hours: null },
          { hours: undefined },
          { startedAt: "2026-10-02", finishedAt: null },
        ],
      })
    ).toBe(1.3);
  });

  it("sin sesiones usa steamPlaytimeHours (backfill de Steam)", () => {
    expect(totalPlayHours({ playLog: [], steamPlaytimeHours: 34.7 })).toBe(34.7);
    expect(totalPlayHours({ steamPlaytimeHours: 12 })).toBe(12);
  });

  it("las sesiones con horas tienen prioridad sobre Steam", () => {
    expect(totalPlayHours({ playLog: [{ hours: 5 }], steamPlaytimeHours: 100 })).toBe(5);
  });

  it("devuelve null si no hay nada computable (no se pinta la línea)", () => {
    expect(totalPlayHours({})).toBeNull();
    expect(totalPlayHours({ playLog: [{ hours: null }] })).toBeNull();
    expect(totalPlayHours(null)).toBeNull();
    expect(totalPlayHours({ steamPlaytimeHours: 0 })).toBeNull();
    expect(totalPlayHours({ steamPlaytimeHours: -3 })).toBeNull();
  });
});
