# ADR-105: Lista de deseos («Compras») en Ocio

## Estado
Aceptado

## Fecha
2026-10-24

## Contexto

Además del registro de ocio y de la **lista de la compra recetaria**
(js/shopping-list.js, que se genera desde el menú semanal), hacía falta
una lista de cosas que comprar de uso libre: productos (física u
online) con su precio, descripción, enlace y foto, y el estado
comprado/no comprado. No es un medio de los cuatro (movie/tv/book/game):
es una lista personal propia.

Consideraciones:

- **Firestore**: el modelo de seguridad da lectura de ocio a todos los
  usuarios autorizados. La lista de compras es personal; se decide
  colección privada.
- **Identidad**: sin catálogo externo ni ids; el usuario mete lo que
  quiera, con URL/foto opcionales por URL (no se suben ficheros: la
  app no tiene almacenamiento de ficheros).
- **PWA/cache**: las partials de Ocio viven en ocio/*.html y el
  service worker las precachea con `?v=APP_VERSION`.

## Decisión

Nueva **pestaña «Compras» en la sección Ocio** (ADR-104→continuidad):
`#/ocio/compras`, con panel `panel-wishlist` y partial `ocio/compras.html`.

1. **Datos** — colección `users/{uid}/wishlist` con:
   `title` (obligatorio), `price` (number|null, €), `description`
   (texto opcional), `url` (URL del producto o null), `photoUrl`
   (URL de imagen o null), `purchased` (bool), `purchasedAt`
   (ISO la primera vez que se marca; null al desmarcar), `addedAt` y
   `updatedAt` (serverTimestamp).
2. **Reglas** — `match /wishlist/{itemId}: allow read, write: if
   isAllowedUser() && isOwner(userId)`: lista privada del dueño; NO se
   comparte como el ocio.
3. **db.js** — funciones al patrón del repo: `subscribeToWishlist`
   (snapshot con orderBy addedAt desc), `addWishlistItem`,
   `updateWishlistItem`, `deleteWishlistItem`.
4. **js/wishlist.js** — render de tarjetas en el partial (foto,
   título, precio formateado "12,50 €", descripción con recorte a 3
   líneas, URL), chips de filtro (Todas / Por comprar / Compradas),
   formulario de alta/edición en la ventana genérica `#item-modal`
   con **validación en cliente** (título obligatorio; precio numérico
   ≥ 0 con coma decimal aceptada; URLs validadas y normalizadas
   anteponiendo `https://` a dominios sin esquema) y confirmación
   antes de borrar.
5. **app.js** — la pestaña entra en el flujo lazy de paneles
   (PANEL_TO_GROUP/GROUP_CONFIG con `custom: true`): su suscripción
   usa `subscribeToWishlist` envuelta con `subscribeWithRetry`
   (ADR-057): el pintado va por la API propia `setWishlistItems`, no
   por `renderLibraryFor`; el wiring del botón «Añadir» y chips se
   hace al inyectar el partial.
6. **Visibilidad** — registro de secciones/pestañas (issue #97): la
   pestaña se puede ocultar/mostrar en Ajustes, visible por defecto.
7. **Temas y responsividad** — mismas convenciones que las tarjetas
   de Ocio (`--paper` superficie, `--ink` texto, variantes `-dark`
   para negro puro); rejilla auto-fill con `min()` y `overflow-wrap`
   para que nunca haya scroll horizontal ni texto cortado.

## Consecuencias

- La lista vive en el sidebar bajo Ocio y respeta la visibilidad
  configurada; los datos exportables (copia de seguridad) NO la
  incluyen aún (el backup cubre movies/series/books/games): la
  inclusión en backup/ICS queda para una iteración posterior.
- Título/foto/URL son texto libre cuidado con XSS: todo se escapa con
  `escapeHtml` en el render.
- Los precios no llevan símbolo almacenado: la UI es la que añade €.
