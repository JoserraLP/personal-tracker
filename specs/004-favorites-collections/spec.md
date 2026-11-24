# Spec 004: Favoritos y colecciones personalizadas

## 1. Feature Target & Git Context
- **Target Branch:** `dev`
- **Feature Branch:** `feat/004-favorites-collections`
- **Scope:** nuevo bloque sobre el catálogo (spec 002) y el dashboard (spec 003); solo tras login (spec 001).

## 2. Vision and scope
- Goal: marcar como favorito cualquier ítem (y capítulos/episodios sueltos con datos propios), verlos en una pestaña global «Favoritos» y en un bloque del dashboard; además crear colecciones personalizadas (p. ej. «Terror», «Comedia») y añadir cualquier ítem a una o varias.
- Users: único propietario autenticado.
- Out of scope: compartir colecciones, recomendaciones, sincronización con streaming, offline completo.

## 3. Requirements
| ID | Requirement | Priority |
|---|---|---|
| REQ-001 | Marcar/desmarcar como favorito cualquier ítem del catálogo (toggle). | must |
| REQ-002 | Crear favoritos de capítulo/episodio suelto con título, notas, valoración y contador de visionados. | must |
| REQ-003 | Pestaña global «Favoritos» que lista ítems y capítulos favoritos. | must |
| REQ-004 | Icono de corazón en tarjeta y ficha modal para alternar favorito. | must |
| REQ-005 | Bloque «Favoritos» en el dashboard (contador + accesos rápidos). | should |
| REQ-006 | Crear, editar y borrar colecciones personalizadas (nombre 1-60, descripción ≤300, color hex o nombre corto). | must |
| REQ-007 | Añadir/quitar cualquier ítem (y capítulo favorito) a una o varias colecciones. | must |
| REQ-008 | Pestaña «Colecciones» con listado y vista de contenido de cada colección. | must |
| REQ-010 | Responsive (móvil) y tema oscuro (variables existentes). | must |
| REQ-011 | Acceso solo tras login (spec 001). | must |
| REQ-012 | Paginación por cursor en vistas con >200 elementos. | should |

## 4. Contracts

### 4.1 Data (Firestore)
Extiende CatalogItem (spec 002, DB-001) y añade entidades nuevas. Todas owner-only.

| ID | Entidad | Campos (tipo, restricciones) | Relaciones |
|---|---|---|---|
| DB-001 | CatalogItem (spec 002) | + `isFavorite` boolean (default false); + `collectionIds` string[] (≤20, cada id de colección existente) | — |
| DB-002 | FavoriteChapter | `id` string (doc); `parentMediaType` enum (series, anime, book, podcast); `parentItemId` string (req); `season` number? (≥1); `episode` number? (≥1); `title` string (req, 1-200); `notes` string? (≤500); `rating` number? (1-10, entero); `watchCount` number? (≥0, default 0); `isFavorite` boolean (default true); `collectionIds` string[] (≤20); `createdAt`, `updatedAt` timestamp | pertenece a CatalogItem padre. Capítulo favorito no se «desmarca»: borrarlo elimina el favorito. |
| DB-003 | UserCollection | `id` string (doc); `name` string (req, 1-60); `description` string? (≤300); `color` string? (hex `#RRGGBB` únicamente); `createdAt`, `updatedAt` timestamp | agrupa ítems/chapters por `collectionIds` |

Colecciones Firestore: `users/{uid}/chapters/{chapterId}`, `users/{uid}/collections/{collectionId}`. Ítems existentes (`movies`, `series`, etc.) reciben los campos nuevos por migración perezosa (ausente → default).

Reglas: `chapters` y `collections` owner-only read+write (igual que el resto). Sin cambios en las reglas de ítems (ya owner-only, spec 002). Validación bloquea: `parentItemId` inexistente, título vacío/>200, rating fuera de 1-10, `collectionIds` con >20 o id inexistente, `name` vacío/>60, `color` inválido, `notes` >500, `description` >300; error de escritura (offline/permisos) muestra mensaje inline con reintento.

### 4.2 UI
| ID | Pantalla | Componentes | API usada |
|---|---|---|---|
| UI-001 | Pestaña «Favoritos» (global) | `FavoritesView`, `FavoriteCard`, `FavoriteChapterCard` | Firestore |
| UI-002 | Pestaña «Colecciones» | `CollectionsView`, `CollectionCard`, `CollectionDetail`, `CollectionForm` | Firestore |
| UI-003 | HeartToggle en tarjeta y modal | `HeartButton` | Firestore (update `isFavorite`) |
| UI-004 | Bloque «Favoritos» en Dashboard | `FavoritesBlock` (contador + atajos) | Firestore |
| UI-005 | Añadir a colección | `CollectionPicker` (modal/popover) | Firestore |

## 5. Acceptance criteria (BDD)
- AC-001 (REQ-001): Given un ítem del catálogo, When pulsa el corazón, Then `isFavorite` se alterna y la tarjeta/ficha reflejan el estado.
- AC-002 (REQ-002): Given un capítulo suelto, When se crea con título (y notas/valoración/visionados opcionales), Then se persiste vinculado al ítem padre y aparece en Favoritos.
- AC-003 (REQ-003): Given la pestaña «Favoritos», When hay favoritos, Then lista ítems y capítulos favoritos con acceso a su ficha.
- AC-004 (REQ-004): Given una tarjeta o la ficha modal, When se pulsa el corazón, Then el estado se actualiza y se propaga a la lista y al dashboard.
- AC-005 (REQ-005): Given el dashboard, When hay favoritos, Then muestra contador y atajos a los 5 favoritos más recientes (por `updatedAt` desc; si empate, por `createdAt` desc).
- AC-006 (REQ-006): Given el usuario, When crea/edita/borra una colección con nombre 1-60 y color válido, Then se persiste y la lista se actualiza; When nombre vacío o >60 o color inválido, Then se bloquea con mensaje inline.
- AC-007 (REQ-007): Given un ítem o capítulo, When se añade a una colección, Then `collectionIds` se actualiza y aparece en la vista de la colección; When se quita, Then desaparece y `collectionIds` se actualiza.
- AC-008 (REQ-008): Given la pestaña «Colecciones», When selecciona una colección, Then muestra sus ítems/capítulos.
- AC-009 (REQ-006): Given una colección, When se borra, Then se desvincula de todos los ítems/capítulos (sin borrarlos) y desaparece del listado; si falla algún documento, se reporta y se reintenta.
- AC-010 (REQ-010): Given viewport móvil, When se usan Favoritos y Colecciones, Then se adaptan sin scroll horizontal.
- AC-011 (REQ-011): Given usuario no autenticado, When intenta acceder, Then redirige a login (spec 001).
- AC-012 (REQ-012): Given una vista con >200 elementos, When se carga, Then se pagina por cursor sin duplicados.
- AC-014 (REQ-002): Given un capítulo favorito, When se borra, Then desaparece de Favoritos y no afecta al ítem padre.

## 6. Non-functional
- Privacidad: `chapters` y `collections` owner-only (lectura y escritura), igual que el resto.
- Rendimiento: listas hasta 200 ítems por vista sin paginación; a partir de ahí cursor.
- Accesibilidad: corazón con `aria-pressed` y etiqueta; modales con foco atrapado y Escape.
- Responsive: breakpoints existentes (≤640px); tema oscuro con variables CSS.

## 7. Decisions and open questions
- D-001: favorito de ítem = flag `isFavorite` en CatalogItem (no colección aparte) para simplicidad y migración perezosa.
- D-002: capítulos favoritos son entidad propia (`FavoriteChapter`) con datos propios, vinculada al padre.
- D-003: colecciones personalizadas referencian ítems por `collectionIds` embebido en el ítem/capítulo (evita tabla de unión).
- D-004: al borrar una colección solo se desvincula (no se borran ítems).
- D-005: pestañas globales «Favoritos» y «Colecciones» se añaden antes de las pestañas por tipo.
- D-006: capítulo favorito registra `watchCount` propio; no tiene sesiones propias (reutiliza las del padre).
- D-007: el dashboard incluye bloque de Favoritos (contador + atajos), no de Colecciones.
- Q-001: resuelto (D-007).
- Q-002: resuelto (D-006).

## 8. Execution matrix
| Task ID | Role | Component | Spec Reference | Status |
|---|---|---|---|---|
| T1 | Spec Architect | `spec.md` | §1-7 | done |
| T2 | Tech Lead | `firestore.rules` (chapters + collections owner-only) | §4.1 | todo |
| T3 | Junior Dev 2 (Backend) | `js/catalog.js` (isFavorite, collectionIds, FavoriteChapter, UserCollection, CRUD) | §4.1, DB-001..DB-003 | todo |
| T4 | Junior Dev 1 (Frontend) | `index.html`, `css/app.css`, `js/app.js` (pestañas Favoritos/Colecciones, corazón, CollectionPicker, CollectionForm) | §4.2, UI-001..UI-005 | todo |
| T5 | Junior Dev 1 (Frontend) | dashboard (bloque Favoritos) | §4.2, UI-004 | todo |
| T6 | QA & Test Engineer | tests unitarios (favoritos, colecciones, validación) | REQ-001..REQ-009, AC-001..AC-009 | todo |
| T7 | DevOps & Release | PR, merge a `dev` | todos | todo |
| T8 | Reviewer | auditoría contra spec | todos | todo |
