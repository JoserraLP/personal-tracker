// =============================================================
// Historial de sesiones de juego de un videojuego: un array de
// tramos { startedAt, finishedAt }. finishedAt es null mientras
// la partida está en curso. Permite rejugar sin perder el
// registro de partidas anteriores.
// =============================================================

export function startPlay(playLog, date) {
  return [...(playLog || []), { startedAt: date, finishedAt: null }];
}

export function finishPlay(playLog, date) {
  const log = [...(playLog || [])];
  if (log.length && !log[log.length - 1].finishedAt) {
    log[log.length - 1] = { ...log[log.length - 1], finishedAt: date };
  } else {
    log.push({ startedAt: date, finishedAt: date });
  }
  return log;
}

export function removePlayEntry(playLog, index) {
  const log = [...(playLog || [])];
  log.splice(index, 1);
  return log;
}

export function updatePlayEntry(playLog, index, changes) {
  const log = [...(playLog || [])];
  log[index] = { ...log[index], ...changes };
  return log;
}

export function statusFromPlayLog(playLog) {
  if (!playLog || !playLog.length) return "pendiente";
  const last = playLog[logIndex(playLog)];
  return last.finishedAt ? "completado" : "en_curso";
}

function logIndex(playLog) {
  return playLog.length - 1;
}

/**
 * Horas jugadas totales de un videojuego (ADR-111): la SUMA de las
 * horas de las sesiones del historial cuando existe (la fuente de
 * verdad de la web); si no hay sesiones pero Steam ya aportó horas
 * (steamPlaytimeHours, sesión backfill), se usa esa cifra. Devuelve
 * null si no hay nada computable (no se muestra la línea).
 * Puro y testeado.
 */
export function totalPlayHours(item) {
  if (!item) return null;
  const log = Array.isArray(item.playLog) ? item.playLog : [];
  const sum = log.reduce((acc, e) => {
    const h = Number(e && e.hours);
    return acc + (Number.isFinite(h) && h > 0 ? h : 0);
  }, 0);
  if (sum > 0) return Math.round(sum * 10) / 10;
  const steam = Number(item.steamPlaytimeHours);
  if (Number.isFinite(steam) && steam > 0) return Math.round(steam * 10) / 10;
  return null;
}
