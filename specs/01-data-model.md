# 01 — Data Model: Firestore polimórfico

## 1. Esquema (DB-*)

```
catalog/{mediaId}                        # lectura: usuarios autenticados de la allowlist
users/{uid}/entries/{mediaId}            # tracking personal (doc id = mediaId)
users/{uid}/collections/{collectionId}   # colecciones personalizadas
```

| ID | Entidad | Campos (tipo, límites) | Notas |
|---|---|---|---|
| DB-101 | `MediaItem` (`catalog/{mediaId}`) | `id` string (doc id, slug `tipo-titulo-año`; en seed: `seed-<tipo>-<n>`); `mediaType` MediaType (REQ); `title` string 1–200; `titleNormalized` string (minúsculas, sin acentos, ≤200, calculado); `coverUrl` string? URL; `releaseYear` number? 1888–2100; `genres` string[] ≤10; `avgRating` number? 0–10 (1 decimal, global de comunidad); `creator` string? ≤120 (autor/director/studio/desarrollador); `synopsis` string? ≤2000; `metadata` MediaMetadata (DB-102); `seed` boolean (true ⇔ procede de API-03); `createdAt`/`updatedAt` timestamp | Doc id determinista ⇒ seed idempotente |
| DB-102 | `MediaMetadata` (union discriminada por `mediaType`) | `SERIES/ANIME`: `{ kind:"episodes", totalEpisodes? number≥1, currentAvailable? number≥1 }`; `MANGA/BOOK`: `{ kind:"pages", totalChapters? number≥1, totalPages? number≥0 }`; `AUDIOBOOK`: `{ kind:"duration", durationMinutes number≥0 }`; `MOVIE`: `{ kind:"duration", durationMinutes number≥0 }`; `GAME`: `{ kind:"platforms", platforms string[]≤8, totalHours? number≥0 }` | Un solo objeto; `kind` deriva de `mediaType` |
| DB-103 | `Entry` (`users/{uid}/entries/{mediaId}`) | `mediaId` string (doc id, ref a `catalog`); `status` EntryStatus; `score` number? entero 1–10; `review` string? ≤500; `progress` `{ current number≥0, total number≥0 }?` con **unidad según `metadata.kind`** (DB-102): `episodes` ⇒ episodios; `pages` ⇒ capítulos si `totalChapters` existe, si no páginas; `duration` ⇒ minutos consumidos; `platforms` ⇒ horas jugadas. `current ≤ total` si `total` existe; `updatedAt` timestamp; `createdAt` timestamp | Borrado de `catalog` no borra la entry (se muestra `catalogMissing`) |
| DB-104 | `Collection` (`users/{uid}/collections/{collectionId}`) | `name` string 1–60; `description` string? ≤300; `itemIds` string[] ≤50 (ids de `catalog`); `updatedAt`/`createdAt` timestamp | Sin duplicados en `itemIds`; ≤20 colecciones por usuario (validación, no regla) |

## 2. Índices compuestos necesarios

| ID | Colección | Campos | Consulta que lo exige |
|---|---|---|---|
| DB-110 | `catalog` | `mediaType` ASC, `titleNormalized` ASC | Catálogo paginado por tipo ordenado por título |
| DB-111 | `catalog` | `mediaType` ASC, `avgRating` DESC | Orden "mejor valorados" por tipo |
| DB-112 | `catalog` | `mediaType` ASC, `releaseYear` DESC | Orden "más recientes" por tipo |
| DB-113 | `catalog` | `titleNormalized` ASC | Búsqueda por prefijo (`>= term < term\uffff`) sin tipo |
| DB-114 | `users/{uid}/entries` | `updatedAt` DESC | Actividad reciente / listado por defecto |
| DB-115 | `users/{uid}/entries` | `status` ASC, `updatedAt` DESC | Filtro por estado |
| DB-116 | `users/{uid}/entries` | `score` DESC, `updatedAt` DESC | Afiliados (`score >= 8`) y media de notas |
| DB-117 | `users/{uid}/collections` | `updatedAt` DESC | Listado de colecciones |

> Índices 114–117 por subcolección: Firestore los define con `collectionGroup` o por colección simple (`entries`); declarar en `firebase.json` → `firestore.indexes`.

## 3. Reglas de seguridad (SEC-*)

| ID | Regla |
|---|---|
| SEC-01 | `users/{uid}/**` (entries, collections, perfil): `allow read, write: if request.auth != null && request.auth.uid == uid` — **sin acceso cruzado entre usuarios**. |
| SEC-02 | `catalog/**`: `allow read: if request.auth != null && isAllowedUser()` (allowlist actual); `allow write: if false` para clientes — solo seed/admin por consola o Admin SDK. |
| SEC-03 | Validación en reglas para `entries`: `status` en enum, `score` entre 1 y 10 (si existe), `review` longitud ≤500; para `collections`: `name` 1–60, `itemIds` ≤50. |
| SEC-04 | **Convivencia (decidida): AND combinado.** Toda operación sobre `users/{uid}/**` exige `request.auth != null && isAllowedUser() && request.auth.uid == uid`: solo usuarios de la allowlist acceden a sus propios datos. La allowlist de la spec 001 es la puerta global; `SEC-01` añade owner-only dentro de ella. Publicación manual en Firebase console (README). |

Esqueleto (referencia, no se implementa aún):

```
match /catalog/{mediaId} { allow read: if isAllowedUser(); allow write: if false; }
match /users/{uid} {
  allow read, write: if isAllowedUser() && request.auth.uid == uid;
  match /entries/{mediaId} { allow read, write: if isAllowedUser() && request.auth.uid == uid
    && (!('score' in request.resource.data) || request.resource.data.score is int
        && request.resource.data.score >= 1 && request.resource.data.score <= 10); }
  match /collections/{id} { allow read, write: if isAllowedUser() && request.auth.uid == uid; }
}
```

## 4. Validaciones (runtime, parte pura)

| ID | Validador | Regla |
|---|---|---|
| DB-120 | `validateMediaItem(input)` | `title` obligatorio 1–200; `mediaType` ∈ 7 tipos; `releaseYear` 1888–2100; `genres` ≤10; `avgRating` 0–10; `metadata.kind` coherente con `mediaType` (DB-102). |
| DB-121 | `normalizeTitle(title)` | `trim` → `toLowerCase()` → quitar acentos (`NFD` + `/\p{Diacritic}/gu`) → colapsar espacios. Determinista: misma entrada ⇒ misma salida. |
| DB-122 | `validateEntry(input)` | `status` ∈ enum; `score` entero 1–10 o `null`; `review` ≤500; `progress.current ≥ 0` y `≤ progress.total` si `total` existe; **unidad de `progress` coherente con `metadata.kind`** (tabla DB-103). |
| DB-123 | `validateCollection(input)` | `name` 1–60; `description` ≤300; `itemIds` sin duplicados y ≤50. |

## 5. Criterios de aceptación (BDD)

| ID | Given | When | Then |
|---|---|---|---|
| AC-100 (SEC-01) | Usuario A autenticado | Intenta leer/escribir `users/{B}/entries/*` | Firestore rechaza con `permission_denied`; A solo accede a `users/{A}/**`. |
| AC-101 (SEC-02) | Usuario autenticado | Intenta `setDoc` sobre `catalog/{id}` | Rechazado (`write: false`); lectura permitida si está en allowlist. |
| AC-102 (DB-121) | Título "El Último Signo  (2020)" | Se calcula `titleNormalized` | Resultado `"el ultimo signo 2020"`; repetir ⇒ idéntico. |
| AC-103 (DB-122) | Entry con `score: 11` | Validación | Inválido con mensaje "La puntuación debe estar entre 1 y 10". |
| AC-104 (DB-102) | `mediaType: "AUDIOBOOK"` con `metadata.kind: "duration"` | Validación | Válido; con `kind: "episodes"` ⇒ inválido (coherencia exigida). |
