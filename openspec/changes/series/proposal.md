# Propuesta — Cambio «series» (Series)

## 1. Por qué

El cambio `movies` validó el patrón de categoría completa (cliente TMDB
modular, repositorio por usuario, estado puro + vista orquestadora, reglas
owner-only e índices compuestos). **Series** es la segunda categoría funcional
y el primer caso con **seguimiento jerárquico**: la unidad de consumo es el
**episodio**, no la obra.

- **Gestión personal**: estado, favoritos a nivel de serie, progreso global
  (`currentSeason`/`currentEpisode`/`watchedEpisodesCount`), revisionados,
  valoración y reseña con flag de spoilers, etiquetas y colecciones propias.
- **Seguimiento por capítulo**: subcolección `episodes` con visto, favorito,
  puntuación y comentario individual, sin inflar el documento padre.
- **Exploración de catálogo**: TMDB API v3 (rama TV) con `language=es-ES`,
  detalle de temporada para listar episodios, y alta manual sin conexión.
- **Vistas y estadísticas**: 3 pestañas, filtros combinables, 7 claves de
  orden y barra de estadísticas rápidas sobre el shell existente.

Todo con la misma arquitectura ya aprobada: sin frameworks nuevos, sin build
step y con la UI visible en español.

## 2. Alcance

### 2.1 Incluido

1. **Cliente TMDB TV** `js/series/tmdbTvClient.js`: búsqueda por título/año
   (`search/tv`), 4 listas de exploración (`trending/tv/week`, `tv/popular`,
   `tv/top_rated`, `tv/on_the_air`), ficha
   (`tv/{id}?append_to_response=credits,videos,watch/providers`), detalle de
   temporada (`tv/{id}/season/{n}`) y helpers de imagen (`w500`, `w1280`,
   `w300` para `still_path`) y tráiler YouTube. Reutiliza `TMDB_API_KEY` de
   `js/config.js` (decisión D-M01 ya adoptada).
2. **Alta manual** sin conexión o cuando la serie no exista en TMDB.
3. **Metadatos completos** en tarjeta y ficha: poster, backdrop, título es y
   original, `first_air_date`, `number_of_seasons`/`number_of_episodes`,
   estado de emisión («En emisión»/«Finalizada»/«Cancelada»), cadenas
   (`networks`), géneros, sinopsis, creadores/reparto, tráiler y
   `vote_average`/`vote_count`.
4. **Repositorio** `js/series/seriesRepository.js` sobre
   `users/{uid}/series/{seriesId}`, subcolección
   `users/{uid}/series/{seriesId}/episodes/{episodeKey}` (clave `S01E01`) y
   `users/{uid}/series_collections/{collectionId}`, con caché de metadatos en
   el propio documento de la serie.
5. **Seguimiento de serie**: estados `watchlist|watching|watched|dropped`,
   `isFavorite`, progreso global, barra `vistos / total`, botón rápido «+1
   Episodio», `rewatchCount` con `watchDates`, `userRating` 0–10 con medios
   puntos (independiente de `tmdbRating`), `userReview`, `tags` y
   `hasSpoilers`.
6. **Seguimiento por capítulo**: `watched`, `watchedAt`, `isFavorite`,
   `userRating`, `userReview`, `hasSpoilers`; selector de temporada, acción
   masiva de temporada, filtros «Todos los capítulos»/«Solo favoritos»/«Con
   comentario» e indicadores visibles en cada fila.
7. **Colecciones** propias multi-asignación (`collectionIds: string[]`) con
   filtrado de biblioteca por colección.
8. **Vistas**: pestañas «Explorar catálogo» / «Mi biblioteca» / «Mis
   colecciones», búsqueda instantánea, filtros combinables (estado, género,
   colección, rango de puntuación), 7 claves de orden y barra de
   estadísticas rápidas.
9. **Estado y lógica** `js/series/seriesState.js` (funciones puras de filtro,
   orden, estadísticas, progreso y etiquetas) y **vista**
   `js/series/seriesView.js`.
10. **Seguridad e índices**: `firestore.rules` con reglas limpias owner-only
    (sin validaciones de campos) para `series` (wildcard que cubre `episodes`)
    y `series_collections`, más los índices compuestos necesarios en
    `firestore.indexes.json`.

### 2.2 Fuera de alcance

- Paginación del catálogo (solo página 1 de cada lista; sin «Cargar más»).
- Ajustes de usuario para la clave TMDB (se reutiliza `TMDB_API_KEY`).
- Tests automatizados / Vitest (ver Q-S01; cambio dedicado posterior).
- Descarga offline, notificaciones de episodios nuevos, subcolecciones de
  temporadas, compartir entre usuarios, otras categorías (libros, juegos,
  anime) y recomendaciones.
- Edición de `specs/00-overview.md`: los deltas MODIFIED se aplican solo al
  aprobar/implementar el cambio.

## 3. Impacto en ficheros existentes

| Fichero | Cambio |
|---|---|
| `index.html` | MODIFICADO: entrada «Series» en `#app-nav`, esqueleto de `#series-section` con IDs estables, `<dialog id="series-detail">`, `<dialog id="series-episode-review">` y `<link>` a `css/series.css` |
| `js/app.js` | MODIFICADO: alternar la sección Series de forma excluyente con Películas y ocultar/mostrar `#app-empty` |
| `firestore.rules` | EXTENDIDO: `match /series/{document=**}` (cubre la subcolección `episodes`) + `match /series_collections/{id}`, ambos owner-only y **sin** validación de campos (SEC-S01/S02) |
| `firestore.indexes.json` | EXTENDIDO: índices compuestos de `series` (DB-S05) |
| `js/firebase.js` | SIN CAMBIOS (ya reexporta `Timestamp`, `writeBatch` y el resto de helpers) |
| `js/config.js` | SIN CAMBIOS (reutiliza `TMDB_API_KEY`) |
| `js/series/*` | NUEVOS: `tmdbTvClient.js`, `seriesRepository.js`, `seriesState.js`, `seriesView.js` |
| `css/series.css` | NUEVO: estilos de la sección |

## 4. Artefactos y convención de IDs

- `specs-delta.md`: requisitos ADDED/MODIFIED/REMOVED + contratos
  TypeScript/OpenAPI + criterios AC.
- `tasks.md`: micro-tareas de 1–2 ficheros, propiedad disjoint (un solo
  escritor por fichero), dependencias explícitas.
- Namespace de este cambio: `REQ-S*`, `API-S*`, `DB-S*`, `SEC-S*`, `UI-S*`,
  `ALG-S*`, `AC-S*`, `NFR-S*`, `D-S*`, `Q-S*`. Los requisitos MODIFIED
  conservan su ID base (`REQ-D2`, `REQ-D3`, `REQ-F2`).
- **Idioma**: código, ficheros y valores internos en inglés; UI visible y
  documentación explicativa en español (`es-ES`); UTF-8 sin BOM.

## 5. Criterios de éxito

- `AC-S01`–`AC-S32` verificables (BDD en `specs-delta.md`): catálogo TV con
  metadatos completos, alta manual sin red, progreso por episodio con
  transiciones automáticas de estado, capítulo con visto/favorito/nota/comentario,
  colecciones multi-asignación, filtros/orden/estadísticas correctos y reglas
  que deniegan accesos ajenos sin bloquear campos opcionales ni nulos.
- Cero imports rotos ni errores de consola; sin dependencias nuevas.

## 6. Riesgos

- **Cuota TMDB**: mitigada con caché de detalle (30 días, NFR-S04), caché de
  temporada en memoria por sesión y búsqueda con debounce 300 ms.
- **Docs de episodio perezosos + contadores**: `watchedEpisodesCount` y
  `favoriteEpisodesCount` viven en el documento padre y se recalculan junto
  al lote de episodios (D-S11); una escritura parcial queda corregida al
  siguiente lote (NFR-S06).
- **Clave expuesta en cliente**: aceptada por diseño (igual que en `movies`).
- **Publicación manual** de reglas e índices (convención existente): queda
  anotada en REQ-F2 MODIFIED; un olvido = permisos denegados en producción.
