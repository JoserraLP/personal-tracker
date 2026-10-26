// =============================================================
// Contadores de "veces" de un elemento (ADR-107):
//   - película  → nº de veces vista   (len de watchLog, o un valor
//                  manual si está anotado)
//   - serie     → nº de veces completada (timesCompleted o valor manual)
//   - libro     → nº de veces leído    (len de readLog terminadas, o manual)
//   - videojuego→ nº de veces jugada   (len de playLog, o manual)
//
// La web ya registra cada sesión/visión con fecha en los logs; el
// contador se muestra en las tarjetas como chip «×N» y puede
// AJUSTARSE a mano desde la ficha de edición del artículo con el
// campo seenCount (para cuando re-viste/re-lee/re-juega algo y no
// quiere registrar una sesión por cada vez).
//
// Semántica de seenCount (anotación manual): si está presente, su
// valor ES el contador que se muestra (siempre >= 1); si no, se usa
// el natural del log. Un seenCount null/1 equivale al natural.
// Parte pura (sin DOM), para tests.
// =============================================================

// Nº natural de veces, a partir de los historiales del tipo.
export function naturalTimes(item) {
  if (!item) return 0;
  if (item.type === "movie") return (item.watchLog || []).length;
  if (item.type === "book") {
    return (item.readLog || []).filter((e) => e && e.finishedAt).length;
  }
  if (item.type === "game") return (item.playLog || []).length;
  return Number(item.timesCompleted) || 0; // series
}

// Contador que se muestra en la web: la anotación manual si hay; si
// no, el natural del log. Nunca baja de 0.
export function timesCount(item) {
  if (!item) return 0;
  const raw = Number(item.seenCount);
  if (!Number.isFinite(raw)) return naturalTimes(item);
  // Una anotación (>= 1) siempre se muestra; si alguien pone un
  // valor menor que el natural, gana el natural (no se puede ver
  // menos de lo registrado).
  return Math.max(naturalTimes(item), Math.max(0, raw));
}

// Etiqueta de la pregunta de edición según el tipo.
export function counterFieldLabel(type) {
  if (type === "tv") return "Veces completada";
  if (type === "book") return "Veces leído";
  if (type === "game") return "Veces jugada";
  return "Veces vista";
}

// Texto del chip de la tarjeta: "×3", o "" si el contador es 0.
export function counterBadgeText(item) {
  const n = timesCount(item);
  return n > 0 ? `×${n}` : "";
}

// Sanea el valor del campo de edición: número entero >= 0 o null.
// "0" equivale a resetear la anotación (null).
export function sanitizeSeenCount(value) {
  const raw = (value || "").toString().replace(",", ".").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n === 0 ? null : n;
}
