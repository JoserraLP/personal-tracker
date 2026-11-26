# Propuesta — Cambio «movies» (Películas)

## 1. Por qué

El núcleo base (`specs/00-overview.md`) solo aporta login con Google, allowlist,
barra superior y un área principal vacía. No existe ninguna categoría funcional.
Este cambio introduce **Películas** como primera categoría completa:

- Gestión personal (estado, favoritos, rewatch, valoración, reseña, etiquetas,
  colecciones) persistida en Cloud Firestore por usuario.
- Exploración de catálogo externo contra **TMDB API v3** con degradación
  elegante si falta la clave o la red falla, más alta manual como vía alternativa.
- Estadísticas rápidas y vistas filtrables/ordenables, sobre el shell existente
  sin frameworks nuevos.

Todo el aprendizaje de este cambio (repositorio modular, vista por módulos,
reglas/índices por subcolección) sirve de patrón para las categorías futuras.

## 2. Alcance

### 2.1 Incluido

1. **Cliente TMDB** `js/movies/tmdbClient.js`: búsqueda por título/año, cuatro
   listas de exploración, ficha con `append_to_response=credits,videos,watch/providers`,
   `language=es-ES`, URLs de imagen (`w500`/`w1280`) y tráiler YouTube.
2. **Alta manual** sin conexión o sin resultados en TMDB.
3. **Repositorio** `js/movies/moviesRepository.js` sobre
   `users/{uid}/movies/{movieId}` y `users/{uid}/movie_collections/{collectionId}`,
   con caché de metadatos en el propio documento.
4. **Seguimiento**: estados `watchlist|watching|watched|dropped`, favoritos,
   contador `watchCount` (+1/−1/manual) con historial `watchDates`, `userRating`
   0–10 con medios puntos, `userReview`, `tags`, `hasSpoilers`.
5. **Colecciones** propias multi-asignación (`collectionIds: string[]`).
6. **Vistas**: pestañas «Explorar catálogo» / «Mi biblioteca» / «Mis colecciones»,
   búsqueda instantánea, filtros combinables, 7 claves de orden y barra de
   estadísticas rápidas.
7. **Seguridad e índices**: extensiones de `firestore.rules` y
   `firestore.indexes.json` para las dos subcolecciones.
8. **Estado y lógica** `js/movies/moviesState.js` (funciones puras de filtro,
   orden, estadísticas y etiquetas) y **vista** `js/movies/moviesView.js`.

### 2.2 Fuera de alcance

- Paginación del catálogo (solo página 1 de cada lista; sin «Cargar más»).
- Ajustes de usuario en Firestore para la clave TMDB: se reutiliza
  `TMDB_API_KEY` de `js/config.js` (ya existe; decisión D-M01).
- Tests automatizados / Vitest (ver Q-M01; cambio dedicado posterior).
- Otras categorías (series, libros, juegos, anime), recomendaciones, compartir
  entre usuarios, caché offline de imágenes, service worker específico.
- Edición de `specs/00-overview.md`: los deltas MODIFIED se aplican solo al
  aprobar/implementar el cambio.

## 3. Impacto en ficheros existentes

| Fichero | Cambio |
|---|---|
| `index.html` | MODIFICADO: entrada «Películas» en `#app-nav`, esqueleto de `#movies-section` con IDs estables y `<link>` a `css/movies.css` |
| `js/app.js` | MODIFICADO: alternar la sección y ocultar/mostrar `#app-empty` |
| `js/firebase.js` | MODIFICADO: reexportar `Timestamp` y `writeBatch` (previsto por REQ-F1 para «los helpers que necesiten los módulos futuros») |
| `firestore.rules` | EXTENDIDO: `movie_collections` owner-only + `isValidMovieDoc` en el match `movies` existente |
| `firestore.indexes.json` | EXTENDIDO: índices compuestos de `movies` (DB-M04) |
| `js/config.js` | SIN CAMBIOS (reutiliza `TMDB_API_KEY`) |
| `js/movies/*` | NUEVOS: `tmdbClient.js`, `moviesRepository.js`, `moviesState.js`, `moviesView.js` |
| `css/movies.css` | NUEVO: estilos de la sección |

## 4. Artefactos y convención de IDs

- `specs-delta.md`: requisitos ADDED/MODIFIED/REMOVED + contratos TypeScript/OpenAPI + criterios AC.
- `tasks.md`: 14 micro-tareas (1–2 ficheros, propiedad disjoint, dependencias explícitas).
- Namespace de IDs de este cambio: `REQ-M*`, `API-M*`, `DB-M*`, `SEC-M*`,
  `UI-M*`, `ALG-M*`, `AC-M*`, `D-M*`, `Q-M*`. Los requisitos MODIFIED conservan
  el ID base (`REQ-D2`, `REQ-D3`, `REQ-F2`).
- **Idioma**: código, ficheros y valores internos en inglés; UI visible y
  documentación explicativa en español (`es-ES`); UTF-8 sin BOM.

## 5. Criterios de éxito

- `AC-M01`–`AC-M27` verificables (BDD en `specs-delta.md`): catálogo TMDB con
  metadatos completos, alta manual sin red, seguimiento con rewatch y fechas,
  colecciones multi-asignación, filtros/orden/estadísticas correctos, reglas de
  Firestore que deniegan accesos ajenos y escrituras inválidas.
- Cero imports rotos ni errores de consola; sin dependencias nuevas.

## 6. Riesgos

- **Cuota TMDB**: mitigada con caché de detalle (`detailCachedAt`, 30 días,
  NFR-M04) y búsqueda con debounce.
- **Clave expuesta en cliente**: aceptada por diseño (coherente con la nota de
  `js/config.js`; la protección real son las reglas de Firestore).
- **Publicación manual** de reglas e índices (convención existente): queda
  anotada en REQ-F2 MODIFIED; un olvido = permisos denegados en producción.
