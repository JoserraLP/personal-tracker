# ADR-104: Importing the full history from TV Time

## Status
Accepted

## Date
2026-10-23

## Context

The app allows tracking series/movies manually, but not importing prior
history from another tracking app. TV Time allows exporting the full
history as a JSON file: a list of series, each with seasons and
episodes, rewatch counters and last-watched dates (`watched_at`), plus
the tracking status (`status`: up_to_date / continuing / stopped /
not_started_yet), favorite and ids (TVDB only in this export).

The export does NOT bring TMDB ids or covers, so imported series cannot
be enriched with the external catalog or hooked to airing data (next
episode date, release notices) without adding on-demand enrichment. The
alternative (searching each title in TMDB during the import and
registering it as a normal series with externalId) would be an import of
hundreds of series: slow, with rate limits and title failures that
completed the import half-way. It is not deterministic either: a partial
import leaves series and cards half-done.

## Decision

New feature in **Ajustes → Datos → Importar desde TV Time**
[Settings → Data → Import from TV Time]:

- PURE module **js/tvtime-import.js**, with exported functions and
  unit-tested (tests/tvtime-import.test.js):
  - `tvTimeDateToIso`, `statusFromTvTime`, `tvTimeSeasonsMeta`,
    `tvTimeWatchedMap`, `tvTimeNextEpisode`, `buildTvTimeItem`,
    `parseTvTimeExport`.
- Mapping:
  - Status: up_to_date → completado [completed] (if everything watched)
    / en_curso [in progress]; continuing → en_curso (or pendiente
    [pending]); stopped → abandonado [abandoned] (or pendiente); others
    → pendiente.
  - Watched episodes → `watched` (canonical shape of `js/tv-progress.js`:
    `{ season: { episode: { date, rating, times } } }`), with the date
    from the file and `times = rewatch_count + watched_count` (min. 1).
  - `nextEpisode` = first unwatched episode; if none is left: status
    forced to completado, `timesCompleted = 1` and "nextEpisode" null
    (the app treats it as a completed series, never "unreleased").
  - `seasonsMeta` derived from the file itself (non-special seasons,
    sorted).
  - `manual: true` and `externalId: null`: the card does not search
    TMDB; series stay out of the "unreleased" flow (which depends on
    TMDB dates). They are editable cards of the manual series flow.
- UI flow: file picker (.json file) → parse → summary in the confirm
  (importable series, watched episodes, skipped entries, warning about
  possible duplicates) → sequential registration
  `ctx.addItem(uid, "tv", item)`, with a final result toast (errors
  counted in the console).
- Exclusions documented in the manual too: season 0 (specials),
  favorites (`is_favorite`, the app has no such data).

## Consequences

- Recovering your history is a single step: reliable and with no API
  cost.
- The data invariant is kept: canonical `watched` shape, no read-only
  fields, no enrichment (on-demand only if the item has externalId,
  which here is null).
- Known risk: reimporting duplicates the series; the confirm warns
  about it.
- If the file has episodes with a dateless watched_at (null), they are
  imported with `date: null` and cover marked episodes for which TV
  Time saved no date (they do not count dates for first/last activity).
