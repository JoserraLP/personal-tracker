# ADR-104: Importación del historial completo desde TV Time

## Estado
Aceptado

## Fecha
2026-10-23

## Contexto

La app permite llevar el registro de series/películas manualmente, pero
no importar el historial previo de otra aplicación de tracking. TV Time
permite exportar el historial completo en un archivo JSON: lista de
series, cada una con temporadas y episodios, contadores de revisionados
y fechas de último visionado (`watched_at`), además del estado del
seguimiento (`status`: up_to_date / continuing / stopped /
not_started_yet), favorito y ids (solo TVDB en este export).

El export NO trae ids de TMDB ni covers, así que las series importadas
no pueden enriquecerse con el catálogo externo ni engancharse a datos
de emisión (fecha del próximo episodio, avisos de estreno) sin
incorporar un enriquecimiento bajo demanda. La alternativa (buscar
cada título en TMDB durante la importación y darlo de alta como serie
normal con externalId) era una importación de cientos de series:
lenta, con rate limits y con fallos de título que completaban la
importación a medias. Tampoco es determinista: una importación parcial
deja series y fichas a medias.

## Decisión

Nueva funcionalidad en **Ajustes → Datos → Importar desde TV Time**:

- Módulo **js/tvtime-import.js** PURO, con funciones exportadas y
  testeado unitariamente (tests/tvtime-import.test.js):
  - `tvTimeDateToIso`, `statusFromTvTime`, `tvTimeSeasonsMeta`,
    `tvTimeWatchedMap`, `tvTimeNextEpisode`, `buildTvTimeItem`,
    `parseTvTimeExport`.
- Mapeo:
  - Estado: up_to_date → completado (si todo visto) / en_curso;
    continuing → en_curso (o pendiente); stopped → abandonado (o
    pendiente); demás → pendiente.
  - Episodes vistos → `watched` (forma canónica de `js/tv-progress.js`:
    `{ temporada: { episodio: { date, rating, times } } }`), con la
    fecha del archivo y `times = rewatch_count + watched_count` (mín. 1).
  - `nextEpisode` = primer episodio no visto; si ya no queda ninguno:
    status forzado a completado, `timesCompleted = 1` y "nextEpisode"
    null (la app lo trata como serie completa, nunca "sin estrenar").
  - `seasonsMeta` derivada del propio fichero (temporadas no especiales
    ordenadas).
  - `manual: true` y `externalId: null`: la ficha no busca en TMDB; las
    series quedan fuera del flujo "sin estrenar" (que depende de fechas
    de TMDB). Son fichas editables del flujo de series manuales.
- Flujo UI: file picker (fichero .json) → parseo → resumen en el
  confirm (series importables, episodios vistos, entradas saltadas,
  aviso de duplicados posibles) → alta secuencial
  `ctx.addItem(uid, "tv", item)`, con toast final de resultado
  (errores contados en consola).
- Exclusiones documentadas también en el manual: temporada 0
  (especiales), favoritos (`is_favorite`, la app no tiene ese dato).

## Consecuencias

- Recuperar tu historial es un solo paso: confiable y sin coste de API.
- Se mantiene la invariante de datos: forma canónica `watched`, sin
  campos read-only, sin enriquecimiento (bajo demanda solo si el ítem
  tiene externalId, que aquí es null).
- Riesgo conocido: reimportar duplica las series; el confirm lo avisa.
- Si en el fichero hay episodios con watched_at sin fecha (null), se
  importan con `date: null` y cubren episodios marcados a los que TV
  Time no les guardó fecha (no cuentan fechas para primera/última
  actividad).
