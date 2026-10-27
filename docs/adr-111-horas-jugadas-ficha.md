# ADR-111: Total played hours on the video game card

## Status
Accepted

## Date
2026-10-26

## Context
The user asked for the video game detail to show how many hours have
been played. The web app already records sessions (`playLog`) with
optional hours, and Steam can provide a total (`steamPlaytimeHours`,
backfill from ADR-107/108) when there are no recorded sessions.

## Decision
Pure helper `totalPlayHours(item)` in `js/game-log.js`:

- **Sum of playLog** (source of truth), rounded to 1 decimal, ignoring
  sessions without hours (session in progress, hours null).
- If there is no session with hours, **uses `steamPlaytimeHours`**.
- Returns null when nothing is computable and the line is not painted.

The card shows it below the title: «X h jugadas» [X h played]
(`steamHoursLabel`, es-ES format with 1 decimal).

## Consequences
- Steam hours act as a provisional value until the user records
  sessions; with sessions, the latter always win.
- 5 new tests in `tests/game-hours.test.js`.
