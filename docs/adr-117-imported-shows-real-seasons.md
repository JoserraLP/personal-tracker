# ADR-117: Imported shows keep the real season list

## State
Accepted

## Date
2026-10-27

## Context
The user reported that shows imported from TV Time only showed ONE
season in the detail view even when the source has more. Investigation:

- The TV Time import (ADR-104) correctly builds `seasonsMeta` with ALL
  the non-special seasons of the file (`tvTimeSeasonsMeta`) and stores
  it in the document via `addItem` (verified: the drafts keep the
  field).
- BUT `getSeasonsMetaFor()` (js/quick-actions.js) returned for EVERY
  manual item a hardcoded fake list: one season ("Temporada 1") with
  `manualEpisodeCount || 10` episodes — completely ignoring the
  imported `seasonsMeta`. That is why every imported show collapsed
  to a single 10-episode season in the detail modal.
- Also `onExpandSeason` (js/modal-handlers.js) built the fallback
  episode list from `seasonsMeta[0]` regardless of the expanded season.

## Decision
1. `getSeasonsMetaFor`: for manual items, return `item.seasonsMeta`
   when it exists and is non-empty (the imported real list); keep the
   single-season fallback only for shows created manually in the app
   (no source data).
2. `onExpandSeason`: resolve the fallback episode list with the meta
   OF THE EXPANDED SEASON (`seasonsMeta.find(s => s.seasonNumber ===
   seasonNumber)`), not always the first.

## Consequences
- Imported shows show all their seasons and the marking works per
  season; no data migration needed (the field was already stored).
- Manual-created shows (no `seasonsMeta`) keep the previous behavior.
- Manual episode episodes continue to be generic ("Episode N"): the TV
  Time export does not carry names (out of scope).
