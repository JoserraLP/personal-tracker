// =============================================================
// Movie watch history: a simple array of dates (one for each
// time you have watched it), so you can log rewatches without
// losing the previous ones.
// =============================================================

export function addWatch(watchLog, date) {
  return [...(watchLog || []), date].sort();
}

export function removeWatch(watchLog, index) {
  const log = [...(watchLog || [])];
  log.splice(index, 1);
  return log;
}

export function updateWatch(watchLog, index, date) {
  const log = [...(watchLog || [])];
  log[index] = date;
  return log.sort();
}

export function statusFromWatchLog(watchLog) {
  return watchLog && watchLog.length ? "completado" : "pendiente";
}
