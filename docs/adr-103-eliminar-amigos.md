# ADR-103: Removal of the Friends section and the Activity feed

## Status
Accepted

## Date
2026-10-23

## Context

The web app had a full social flow: the **Friends** tab (and its profile
sub-section with read-only detail of each person's tracking), the
**Activity** tab (feed of what friends removed, `js/activity-feed.js`)
and the Profile search (it searched for friends). The personal tracker is
an individual use case and the interest was recovering lost history from
other apps (TV Time), not social features.

Removing them touches:

- `index.html`: the «Amigos» [Friends] item, the «Actividad» [Activity]
  item of the profile dropdown, the `friends`/`activity` subtabs, the
  `profile-section-friends` section (with its full detail), the
  `profile-section-activity` section, the «Actividad de amigos»
  [Friends' activity] toggle in Notifications and the search placeholder
  («...o amigos» [...or friends]).
- `js/profile.js`: functions `openFriendCard`, `loadFriendsList`,
  `openFriendByUid`, `openFriend`, `renderFriendTab`, `setFriendTab`,
  `setFriendFilter`, `loadActivityFeed` and their wiring.
- `js/ui.js`: `renderFriendsList`, `renderFriendTab` and
  `renderActivityFeed` (+ feed label date helpers).
- `js/activity-feed.js` (whole module) and the import of
  `item-details.js` in `ui.js` (it only served the friend read-only
  card).
- `js/router.js`: the `amigos`/`actividad` routes and deep links
  `#/perfil/amigos/<uid>`.
- `js/app.js`: the `getAllUserProfiles` import/context and `friendUid`.
- `js/global-search.js`: the «friends» group (data, render, highlight,
  avatars and profile cache).
- `js/settings.js`: the `friend_activity` preference and its toggle.

## Decision

The **entire social flow** is removed: the friends tab, the activity
feed and the friends search. The profile is left with two sections:
**Estadísticas** [Statistics] and **Ajustes** [Settings].

- The router tolerantly normalizes old routes (`#/perfil/amigos`,
  `#/perfil/actividad` and friends with uid) to the default route
  (`#/perfil` with `invalid: true`), so old URLs no longer break.
- The **data functions in db.js** (`getAllUserProfiles`,
  `subscribeToNotifications` and the rest of profile) are kept: they
  are UI-neutral and `subscribeToNotifications` still feeds the bell.
  Cleaning up the ones left dead is deferred to a refactor (ADR-001
  style).
- The **CSS classes** for friends/feed (`friend-*`, `activity-*`) stay
  for now: they affect nothing visible and removing them en masse risks
  breaking styles in use (the search groups share much of the CSS).
  Deferred cleanup.
- The saved `friend_activity` preference in old localStorage remains as
  tolerated dead data (the deep merge ignores leftover keys since there
  is no wiring).

## Consequences

- The Profile gains focus: Statistics and Settings, with no social
  shares.
- Fewer requests: opening no longer reads other people's profiles; the
  search no longer caches other people's profiles either.
- No user data is deleted: documents remain intact.
