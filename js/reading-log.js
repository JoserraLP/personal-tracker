// =============================================================
// Book reading history: an array of stretches
// { startedAt, finishedAt }. finishedAt is null while the book
// is being read. Allows re-reading without losing the record
// of previous readings.
// =============================================================

export function startReading(readLog, date) {
  return [...(readLog || []), { startedAt: date, finishedAt: null }];
}

export function finishReading(readLog, date) {
  const log = [...(readLog || [])];
  if (log.length && !log[log.length - 1].finishedAt) {
    log[log.length - 1] = { ...log[log.length - 1], finishedAt: date };
  } else {
    log.push({ startedAt: date, finishedAt: date });
  }
  return log;
}

export function removeReadEntry(readLog, index) {
  const log = [...(readLog || [])];
  log.splice(index, 1);
  return log;
}

export function updateReadEntry(readLog, index, changes) {
  const log = [...(readLog || [])];
  log[index] = { ...log[index], ...changes };
  return log;
}

export function statusFromReadLog(readLog) {
  if (!readLog || !readLog.length) return "pendiente";
  const last = readLog[readLog.length - 1];
  return last.finishedAt ? "completado" : "en_curso";
}
