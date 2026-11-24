// =============================================================
// Seed inicial del catálogo (spec 002 API-03 / REQ-104, AC-114).
//
// Módulo PURO: solo importa la parte pura de `js/catalog.js`. No toca
// red, DOM ni Firebase, por lo que puede importarse en Node/vitest sin
// configuración (misma entidad que DB-101).
//
// Contrato (API-03):
//   - `SEED_ITEMS` es un `MediaItem[]` con >= 7 ítems, uno por cada
//     uno de los 7 `MediaType` de DB-101.
//   - Cada ítem lleva `seed: true` y un doc id determinista
//     `seed-<tipo>-<n>` (tipo en minúsculas), que también se guarda en
//     el campo `id`.
//   - `metadata.kind` deriva de `mediaType` (DB-102) y cada ítem pasa
//     `validateMediaItem` (DB-120).
//
// Idempotencia (AC-114): el seed se escribe con `setDoc` usando el
// `id` fijo de cada ítem; volver a ejecutarlo actualiza los mismos
// documentos y nunca duplica. `seedCatalog()` centraliza ese upsert.
// =============================================================

import {
  MEDIA_ITEM_TYPES,
  METADATA_KIND_BY_MEDIA_TYPE,
  normalizeTitle,
  validateMediaItem,
} from "../catalog.js";

/** Colección Firestore del catálogo (DB-101). */
export const SEED_COLLECTION = "catalog";

/** Patrón de los doc ids sembrados: `seed-<tipo>-<n>` (API-03). */
export const SEED_DOC_ID_PATTERN = /^seed-[a-z]+-[1-9]\d*$/;

// -------------------------------------------------------------
// Ítems semilla
// -------------------------------------------------------------

/**
 * Construye un `MediaItem` semilla completando los campos calculados
 * (`titleNormalized`) y fijando `seed: true`. No añade `createdAt` ni
 * `updatedAt`: los pone el repositorio con `serverTimestamp()` al
 * escribir, para que el seed no dependa del reloj ni de la red.
 * @param {object} item
 * @returns {object}
 */
function seedItem(item) {
  return {
    ...item,
    id: item.id,
    titleNormalized: normalizeTitle(item.title),
    seed: true,
  };
}

/**
 * Ítems del seed inicial (API-03, REQ-104): al menos uno por cada
 * `MediaType`, todos con doc id determinista y `seed: true`.
 * @type {ReadonlyArray<object>}
 */
export const SEED_ITEMS = Object.freeze([
  seedItem({
    id: "seed-movie-1",
    mediaType: "MOVIE",
    title: "El Último Signo",
    releaseYear: 2020,
    genres: ["Drama", "Misterio"],
    avgRating: 7.8,
    creator: "Lucía Ferrer",
    synopsis:
      "Una lingüista descubre que el último mensaje de una civilización desaparecida sigue cambiando cada noche.",
    metadata: { kind: "duration", durationMinutes: 118 },
  }),
  seedItem({
    id: "seed-movie-2",
    mediaType: "MOVIE",
    title: "Órbita 9",
    releaseYear: 2019,
    genres: ["Ciencia ficción", "Aventura"],
    avgRating: 7.1,
    creator: "Mateo Rivas",
    synopsis:
      "La tripulación de una estación orbital debe elegir entre volver a casa o desviar su rumbo para salvar una colonia.",
    metadata: { kind: "duration", durationMinutes: 104 },
  }),
  seedItem({
    id: "seed-series-1",
    mediaType: "SERIES",
    title: "Luces de Neón",
    releaseYear: 2021,
    genres: ["Drama", "Thriller"],
    avgRating: 8.2,
    creator: "Canal Aurora",
    synopsis:
      "Una detective nocturna investiga la desaparición de un cantante en una ciudad que nunca apaga sus carteles.",
    metadata: { kind: "episodes", totalEpisodes: 16, currentAvailable: 16 },
  }),
  seedItem({
    id: "seed-anime-1",
    mediaType: "ANIME",
    title: "Kaze no Uta",
    releaseYear: 2018,
    genres: ["Fantasía", "Aventura"],
    avgRating: 8.6,
    creator: "Estudio Hikari",
    synopsis:
      "Una joven cartógrafa recorre tierras suspendidas en el cielo siguiendo el canto del viento.",
    metadata: { kind: "episodes", totalEpisodes: 24, currentAvailable: 24 },
  }),
  seedItem({
    id: "seed-manga-1",
    mediaType: "MANGA",
    title: "Sombras de Kioto",
    releaseYear: 2016,
    genres: ["Misterio", "Sobrenatural"],
    avgRating: 8.0,
    creator: "Aiko Nakamura",
    synopsis:
      "Dos hermanos heredan una papelería cuyos cuadernos muestran recuerdos que aún no han ocurrido.",
    metadata: { kind: "pages", totalChapters: 24, totalPages: 220 },
  }),
  seedItem({
    id: "seed-book-1",
    mediaType: "BOOK",
    title: "El Jardín de las Horas",
    releaseYear: 2015,
    genres: ["Novela histórica", "Ficción"],
    avgRating: 7.9,
    creator: "Elena Sarmiento",
    synopsis:
      "Un relojero del siglo XIX construye un jardín donde cada planta florece a la hora de un recuerdo ajeno.",
    metadata: { kind: "pages", totalPages: 384 },
  }),
  seedItem({
    id: "seed-audiobook-1",
    mediaType: "AUDIOBOOK",
    title: "Voces del Norte",
    releaseYear: 2022,
    genres: ["Ensayo", "Viajes"],
    avgRating: 7.4,
    creator: "Narrado por Iván Costa",
    synopsis:
      "Crónica sonora de los pueblos del norte: sus leyendas, sus tormentas y las canciones que las acompañan.",
    metadata: { kind: "duration", durationMinutes: 615 },
  }),
  seedItem({
    id: "seed-game-1",
    mediaType: "GAME",
    title: "Cielo Roto",
    releaseYear: 2023,
    genres: ["Rol", "Mundo abierto"],
    avgRating: 8.8,
    creator: "Estudio Cierzo",
    synopsis:
      "Explora islas flotantes fragmentadas y recompón el cielo antes de que el último fragmento caiga.",
    metadata: {
      kind: "platforms",
      platforms: ["PC", "PlayStation 5", "Xbox Series X|S", "Nintendo Switch"],
      totalHours: 40,
    },
  }),
]);

/** `SEED_ITEMS` indexados por `mediaType` (≥1 por tipo, REQ-104). */
export const SEED_ITEMS_BY_TYPE = Object.freeze(
  Object.fromEntries(
    MEDIA_ITEM_TYPES.map((mediaType) => [
      mediaType,
      Object.freeze(SEED_ITEMS.filter((item) => item.mediaType === mediaType)),
    ]),
  ),
);

// -------------------------------------------------------------
// Helpers de validación e idempotencia
// -------------------------------------------------------------

/** ¿Es un doc id determinista de seed (`seed-<tipo>-<n>`)? (API-03) */
export function isSeedDocId(docId) {
  return typeof docId === "string" && SEED_DOC_ID_PATTERN.test(docId);
}

/**
 * Valida todas las semillas con `validateMediaItem` (DB-120) y
 * comprueba las invariantes propias de API-03: `seed: true`, `id`
 * determinista y coherente con `mediaType`, y `metadata.kind` derivado
 * del tipo (DB-102).
 * @returns {{ valid: boolean, errors: string[], byId: Record<string, string[]> }}
 */
export function validateSeedItems(items = SEED_ITEMS) {
  const errors = [];
  const byId = {};

  if (!Array.isArray(items)) {
    return {
      valid: false,
      errors: ["SEED_ITEMS debe ser una lista."],
      byId,
    };
  }

  const seen = new Set();
  items.forEach((item, index) => {
    const label = `SEED_ITEMS[${index}]`;
    const itemErrors = validateMediaItem(item).errors.slice();

    if (!item || typeof item !== "object") {
      const message = `${label}: debe ser un objeto.`;
      errors.push(message);
      byId[String(index)] = [message];
      return;
    }

    if (item.seed !== true) {
      itemErrors.push(`${label}: seed debe ser true (API-03).`);
    }

    if (!isSeedDocId(item.id)) {
      itemErrors.push(`${label}: id "${item.id}" no sigue seed-<tipo>-<n> (API-03).`);
    } else {
      const expectedPrefix = `seed-${String(item.mediaType).toLowerCase()}-`;
      if (!item.id.startsWith(expectedPrefix)) {
        itemErrors.push(
          `${label}: id "${item.id}" no corresponde al mediaType "${item.mediaType}".`,
        );
      }
    }

    if (seen.has(item.id)) {
      itemErrors.push(`${label}: id duplicado "${item.id}".`);
    }
    seen.add(item.id);

    const expectedKind = METADATA_KIND_BY_MEDIA_TYPE[item.mediaType];
    if (!item.metadata || item.metadata.kind !== expectedKind) {
      itemErrors.push(
        `${label}: metadata.kind debe ser "${expectedKind}" para ${item.mediaType} (DB-102).`,
      );
    }

    if (itemErrors.length > 0) {
      byId[String(item.id)] = itemErrors;
      errors.push(...itemErrors);
    }
  });

  for (const mediaType of MEDIA_ITEM_TYPES) {
    if (!items.some((item) => item && item.mediaType === mediaType)) {
      errors.push(`Falta al menos un ítem de tipo ${mediaType} (REQ-104).`);
    }
  }

  return { valid: errors.length === 0, errors, byId };
}

/**
 * Escribe todas las semillas con un escritor inyectado, usando su doc id
 * fijo (`setDoc`, no `addDoc`): re-ejecutar actualiza los mismos
 * documentos y no duplica (AC-114).
 *
 * @param {(docId: string, data: object) => Promise<unknown>} writeById
 *        escritor equivalente a `setDoc(doc(db, "catalog", docId), data)`.
 * @param {{ items?: ReadonlyArray<object> }} [options]
 * @returns {Promise<{ collection: string, ids: string[] }>}
 */
export async function seedCatalog(writeById, options = {}) {
  if (typeof writeById !== "function") {
    throw new TypeError("seedCatalog requiere una función de escritura (docId, data).");
  }

  const items = options.items ?? SEED_ITEMS;
  const report = validateSeedItems(items);
  if (!report.valid) {
    const error = new Error(`Seed inválido: ${report.errors.join(" ")}`);
    error.code = "validation";
    error.errors = report.errors;
    throw error;
  }

  const ids = items.map((item) => item.id);
  for (const item of items) {
    await writeById(item.id, item);
  }

  return { collection: SEED_COLLECTION, ids };
}
