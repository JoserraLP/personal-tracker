// =============================================================
// Utilidades compartidas de los tests de `js/series/seriesRepository.js`.
// Sustituye `js/firebase.js` (Auth + Firestore) y
// `js/series/tmdbTvClient.js` por dobles con `mock.module` (flag
// `--experimental-test-module-mocks`), al estilo de `helpers.mjs`.
// Sin dependencias externas: usa `node:test` y una base de datos en
// memoria (Map por ruta de documento).
// =============================================================

import { mock } from "node:test";

const FIREBASE_URL = new URL("../../js/firebase.js", import.meta.url).href;
const TMDB_CLIENT_URL = new URL(
  "../../js/series/tmdbTvClient.js",
  import.meta.url
).href;

export const UID = "test-uid";
export const DAY_MS = 24 * 60 * 60 * 1000;

// -------------------------------------------------------------
// Estado de la doble base de datos
// -------------------------------------------------------------

/** Ruta de documento → datos (shallow copy al leer/escribir). */
const store = new Map();
let autoId = 0;

/** `writeBatch` commiteados, en orden: `{ sets, updates, deletes }`. */
export const batches = [];

export const auth = { currentUser: { uid: UID } };
export const db = Object.freeze({ __fake: "firestore" });

/** Llamadas y respuesta del doble de `getSeriesDetail`. */
export const tmdbState = { calls: [], detail: null };

/** Cambia (`null` simula sin sesión) o restablece el usuario. */
export function setUser(uid) {
  auth.currentUser = uid === null ? null : { uid };
}

/** Vacia la base, el registro de lotes y el doble TMDB. */
export function resetStore() {
  store.clear();
  batches.length = 0;
  autoId = 0;
  tmdbState.calls.length = 0;
  tmdbState.detail = null;
}

export function getSeriesDetailCalls() {
  return [...tmdbState.calls];
}

export function setSeriesDetailResponse(detail) {
  tmdbState.detail = detail;
}

// -------------------------------------------------------------
// Sentinels y timestamps
// -------------------------------------------------------------

/** `serverTimestamp()`: centinela reconocible y legible como «ahora». */
export function serverTimestamp() {
  return {
    __serverTimestamp: true,
    toMillis: () => Date.now(),
  };
}

export function isServerTimestamp(value) {
  return Boolean(value && value.__serverTimestamp === true);
}

/** Timestamp fijo (para sembrar docs cacheados). */
export function fakeTimestamp(millis) {
  return {
    __timestamp: true,
    toMillis: () => millis,
    valueOf: () => millis,
  };
}

/** ¿El timestamp está a menos de `toleranceMs` de la hora actual? */
export function isRecentTime(value, toleranceMs = 5000) {
  const millis =
    value && typeof value.toMillis === "function" ? value.toMillis() : null;
  return (
    typeof millis === "number" && Math.abs(millis - Date.now()) <= toleranceMs
  );
}

export const Timestamp = {
  now() {
    const millis = Date.now();
    return {
      __timestamp: true,
      toMillis: () => millis,
      valueOf: () => millis,
    };
  },
};

// -------------------------------------------------------------
// API de Firestore (solo la que usa seriesRepository.js)
// -------------------------------------------------------------

function pathOf(segments) {
  return segments.join("/");
}

export function collection(_db, ...segments) {
  return { kind: "collection", path: pathOf(segments), segments };
}

export function doc(_db, ...segments) {
  return {
    kind: "doc",
    path: pathOf(segments),
    id: segments[segments.length - 1],
    segments,
  };
}

export function query(source, ...constraints) {
  return { kind: "query", source, constraints };
}

export function where(field, op, value) {
  return { kind: "where", field, op, value };
}

export function arrayRemove(...values) {
  return { __arrayRemove: values };
}

export function onSnapshot(_target, _onData, _onError) {
  return () => {};
}

function matches(data, constraints) {
  return constraints.every((constraint) => {
    const actual = data[constraint.field];
    if (constraint.op === "===") return actual === constraint.value;
    if (constraint.op === "==") return actual === constraint.value;
    if (constraint.op === "array-contains") {
      return Array.isArray(actual) && actual.includes(constraint.value);
    }
    return true;
  });
}

function docSnapshot(ref) {
  const data = store.get(ref.path);
  return {
    id: ref.id,
    ref,
    exists: () => data !== undefined,
    data: () => (data === undefined ? undefined : { ...data }),
  };
}

function applyUpdate(ref, patch) {
  const current = store.get(ref.path);
  if (current === undefined) {
    throw new Error(`Documento inexistente: ${ref.path}`);
  }
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value && value.__arrayRemove !== undefined) {
      const list = Array.isArray(next[key]) ? [...next[key]] : [];
      next[key] = list.filter((item) => !value.__arrayRemove.includes(item));
    } else {
      next[key] = value;
    }
  }
  store.set(ref.path, next);
}

export async function getDoc(ref) {
  return docSnapshot(ref);
}

export async function getDocs(target) {
  const source = target.kind === "query" ? target.source : target;
  const constraints = target.kind === "query" ? target.constraints : [];
  const prefix = `${source.path}/`;

  const docs = [];
  for (const [path, data] of store) {
    if (!path.startsWith(prefix)) continue;
    const id = path.slice(prefix.length);
    if (id.includes("/")) continue; // subcolección
    if (!matches(data, constraints)) continue;
    docs.push({
      id,
      path,
      ref: { kind: "doc", path, id },
      exists: () => true,
      data: () => ({ ...data }),
    });
  }

  return { docs, size: docs.length, empty: docs.length === 0 };
}

export async function addDoc(collectionRef, data) {
  autoId += 1;
  const id = `auto-${autoId}`;
  const path = `${collectionRef.path}/${id}`;
  store.set(path, { ...data });
  return { id, path, ref: { kind: "doc", path, id } };
}

export async function updateDoc(ref, patch) {
  applyUpdate(ref, patch);
}

export async function runTransaction(_db, updateFunction) {
  const transaction = {
    get: (ref) => Promise.resolve(docSnapshot(ref)),
    set: (ref, data) => {
      store.set(ref.path, { ...data });
    },
    update: (ref, patch) => applyUpdate(ref, patch),
  };
  return updateFunction(transaction);
}

export function writeBatch(_db) {
  const ops = [];

  return {
    set(ref, data, options) {
      ops.push({ type: "set", ref, data: { ...data }, options });
    },
    update(ref, patch) {
      ops.push({ type: "update", ref, data: { ...patch } });
    },
    delete(ref) {
      ops.push({ type: "delete", ref });
    },
    async commit() {
      const record = { sets: [], updates: [], deletes: [] };
      for (const op of ops) {
        if (op.type === "set") {
          const current = store.get(op.ref.path) || {};
          store.set(op.ref.path, { ...current, ...op.data });
          record.sets.push(op.ref.path);
        } else if (op.type === "update") {
          applyUpdate(op.ref, op.data);
          record.updates.push(op.ref.path);
        } else {
          store.delete(op.ref.path);
          record.deletes.push(op.ref.path);
        }
      }
      ops.length = 0;
      batches.push(record);
    },
  };
}

// -------------------------------------------------------------
// Instalación de los mocks y carga del repositorio
// -------------------------------------------------------------

async function getSeriesDetail(seriesId) {
  tmdbState.calls.push(seriesId);
  const detail = tmdbState.detail;
  return typeof detail === "function" ? detail(seriesId) : detail;
}

let installed = false;

/**
 * Instala los mocks de `js/firebase.js` y del cliente TMDB y devuelve
 * `js/series/seriesRepository.js` recién importado. Llamar una sola
 * vez por archivo de test y ANTES de tocar el módulo bajo test.
 */
export async function loadRepository() {
  if (!installed) {
    installed = true;

    mock.module(FIREBASE_URL, {
      namedExports: {
        auth,
        db,
        collection,
        doc,
        addDoc,
        getDoc,
        getDocs,
        updateDoc,
        onSnapshot,
        query,
        where,
        serverTimestamp,
        arrayRemove,
        runTransaction,
        Timestamp,
        writeBatch,
      },
    });

    mock.module(TMDB_CLIENT_URL, {
      namedExports: { getSeriesDetail },
    });
  }

  return import("../../js/series/seriesRepository.js");
}

// -------------------------------------------------------------
// Sembrado y lectura de documentos
// -------------------------------------------------------------

function seriesPath(seriesId) {
  const uid = auth.currentUser ? auth.currentUser.uid : UID;
  return `users/${uid}/series/${seriesId}`;
}

export function seedSeries(seriesId, data) {
  store.set(seriesPath(seriesId), { ...data });
}

export function getStoredSeries(seriesId) {
  const data = store.get(seriesPath(seriesId));
  if (data === undefined) {
    throw new Error(`Serie no encontrada en el almacén: ${seriesId}`);
  }
  return { ...data };
}

export function seedEpisode(seriesId, key, data) {
  store.set(`${seriesPath(seriesId)}/episodes/${key}`, { ...data });
}

export function getStoredEpisode(seriesId, key) {
  const data = store.get(`${seriesPath(seriesId)}/episodes/${key}`);
  if (data === undefined) {
    throw new Error(`Episodio no encontrado en el almacén: ${key}`);
  }
  return { ...data };
}

/** Número de documentos de `users/{uid}/series` (sin subcolecciones). */
export function countSeriesDocs() {
  const prefix = `${seriesPath("")}`;
  let total = 0;
  for (const path of store.keys()) {
    if (!path.startsWith(prefix)) continue;
    if (path.slice(prefix.length).includes("/")) continue;
    total += 1;
  }
  return total;
}

/** Instala un `fetch` que registra y falla: nadie debe usar la red. */
export function installFetchCounter() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error(`Sin red en los tests: ${url}`);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

// -------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------

/** Documento `users/{uid}/series/{id}` con los defaults de DB-S01. */
export function baseSeriesDoc(overrides = {}) {
  return {
    source: "tmdb",
    tmdbId: 70523,
    name: "Dark",
    originalName: "Dark",
    posterPath: "/darkPoster.jpg",
    backdropPath: "/darkBackdrop.jpg",
    firstAirDate: "2017-12-01",
    firstAirYear: 2017,
    numberOfSeasons: 3,
    numberOfEpisodes: 24,
    tmdbStatus: "Ended",
    networks: ["Netflix"],
    episodeRuntime: 60,
    genreIds: [18, 878],
    genres: ["Drama", "Ciencia ficción"],
    overview: "Una familia perdida en el tiempo.",
    creators: ["Baran bo Odar"],
    cast: ["Louis Hofmann"],
    trailerKey: null,
    watchProviders: ["Netflix"],
    tmdbRating: 8.4,
    tmdbVoteCount: 12345,
    detailCachedAt: null,
    status: "watchlist",
    isFavorite: false,
    currentSeason: 1,
    currentEpisode: 1,
    watchedEpisodesCount: 0,
    favoriteEpisodesCount: 0,
    rewatchCount: 0,
    watchDates: [],
    lastWatchedAt: null,
    userRating: null,
    userReview: null,
    tags: [],
    hasSpoilers: false,
    collectionIds: [],
    addedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

/** Documento `…/series/{id}/episodes/{SxxExx}` con defaults de DB-S02. */
export function baseEpisodeDoc(seasonNumber, episodeNumber, overrides = {}) {
  return {
    seasonNumber,
    episodeNumber,
    episodeName: `Episodio ${episodeNumber}`,
    watched: false,
    watchedAt: null,
    isFavorite: false,
    userRating: null,
    userReview: "",
    hasSpoilers: false,
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

/** Resumen de catálogo (contrato del cliente TMDB en camelCase). */
export function summaryInput(overrides = {}) {
  return {
    id: 70523,
    name: "Dark",
    originalName: "Dark",
    posterPath: "/darkPoster.jpg",
    firstAirDate: "2017-12-01",
    genreIds: [18, 878],
    overview: "Una familia perdida en el tiempo.",
    voteAverage: 8.4,
    voteCount: 12345,
    ...overrides,
  };
}

/** Detalle normalizado (contrato `TmdbSeriesDetail` del cliente). */
export function detailResponse(overrides = {}) {
  return {
    id: 70523,
    name: "Dark",
    originalName: "Dark",
    posterPath: "/darkPoster.jpg",
    backdropPath: "/darkBackdrop.jpg",
    firstAirDate: "2017-12-01",
    numberOfSeasons: 3,
    numberOfEpisodes: 26,
    tmdbStatus: "Ended",
    networks: ["Netflix"],
    episodeRuntime: 60,
    genreIds: [18, 878],
    genres: ["Drama", "Ciencia ficción"],
    overview: "Una familia perdida en el tiempo.",
    creators: ["Baran bo Odar"],
    cast: ["Louis Hofmann"],
    trailerKey: "trailerKey1",
    watchProviders: ["Netflix"],
    voteAverage: 8.4,
    voteCount: 12345,
    ...overrides,
  };
}

/** Rango 1..n (para listas de episodios de temporada). */
export function range(n) {
  return Array.from({ length: n }, (_, index) => index + 1);
}
