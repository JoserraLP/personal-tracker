# ADR-015: Friend activity feed

## Status
Accepted

## Context
The application already had a "Friends" section where it was possible to
view the profile, statistics and detailed library of each friend (movies,
series and books individually). However, there was no consolidated,
chronological view that allowed the user to quickly find out what their
friends are doing: which movies they watched, which series they started or
completed, and which books they are reading or finished.

To obtain this information, the user had to manually open each friend's
profile and browse their library, which was tedious and prevented having
an overview of recent activity. In addition, the application already had
an "Actividad de amigos" notification toggle in the settings, but the
corresponding feed showing this activity did not exist.

## Decision
Implement a **friend activity feed** that aggregates the recent actions of
all the user's friends, ordered chronologically from most recent to oldest,
and shows it in a new "Actividad" section inside the profile view.

### Feed architecture

A new standalone module (`js/activity-feed.js`) generates activity events
from the existing data of each friend (movies, series and books). The feed
is **generated exclusively on the client side**: no new collections are
created in Firestore and no events are persisted. Each time the user
accesses the activity tab, the current data of all friends is read and the
feed is rebuilt in real time.

### Data flow

```
Usuario hace clic en pestaña "Actividad"
  → profile.js: loadActivityFeed()
    → Gets the profiles of all the
      users
    → Filters to exclude the current user
    → For each friend, loads in parallel: movies, series, books
    → activity-feed.js: buildGlobalFeed(friendsData)
      → Per friend: buildFriendFeed(name, movies, series, books)
        → Generates events according to each category's content
      → Combines and sorts by desc date
    → ui.js: renderActivityFeed(container, events, onItemClick)
      → Groups the events by date ("Hoy", "Ayer", "DD de Mes, AAAA")
      → Renders cards with a cover, a name, an action and a title
      → Each event is clickable → a read-only modal
```

### Detected event types

| Event                    | Constant              | Label                  | Trigger condition                                        |
|--------------------------|-----------------------|------------------------|----------------------------------------------------------|
| Movie watched            | `MOVIE_WATCHED`       | "Vio la película"      | Entry in `watchLog`, or `status === "completado"`        |
| Series started           | `SERIES_STARTED`      | "Empezó la serie"      | A single episode with a date (series not completed)      |
| Series completed         | `SERIES_COMPLETED`    | "Completó la serie"    | `status === "completado"` (from watched or lastWatchedAt)|
| Episodes watched         | `SERIES_EPISODES`     | "Vio episodios de"     | Multiple episodes with dates (ongoing series)            |
| Book started             | `BOOK_STARTED`        | "Está leyendo"         | Entry in `readLog` with `startedAt` and no `finishedAt`  |
| Book finished            | `BOOK_FINISHED`       | "Terminó de leer"      | Entry in `readLog` with `finishedAt`                     |

### Additional events (series)

The module also processes the series re-watches history (`history`),
generating additional `SERIES_STARTED` and `SERIES_COMPLETED` events for
each re-watch recorded. In addition, if a series is marked as completed
but has no individually marked episodes, `lastWatchedAt` or `updatedAt`
is used as the reference date.

### UI integration

- **New "Actividad" tab** in the profile sub-tab bar (alongside
  Statistics, Friends, Data and Settings).
- **Container** `#profile-section-activity` with a loading area
  (`#activity-feed-loading`) and an events container
  (`#activity-feed-container`).
- **Empty states**: message "Todavía no hay actividad reciente de tus
  amigos." when there are no events, and "No se pudo cargar la actividad
  de amigos." in case of error.
- **Date grouping**: events are grouped under headers "Hoy", "Ayer" or
  the full date (e.g. "15 de Julio, 2026").
- **Each event shows**: content cover, friend name (in bold), action
  performed, content title (in italics) and a representative icon. When
  clicked, a read-only modal opens with the item's details.
- **Parallel loading**: each friend's data is fetched with `Promise.all`,
  minimizing waiting time.

### Technical implementation

- **New module**: `js/activity-feed.js` (233 lines) with two main exports:
  - `buildFriendFeed(friendName, movies, series, books)` → events for a
    friend.
  - `buildGlobalFeed(friendsData)` → events combined and sorted globally.
- **Internal helper**: `maybePushDateEvent(events, date, type, label,
  friendName, item, detail)` which validates and converts dates (supports
  ISO strings, Firestore Timestamp with `.toDate()`, and objects with
  `.seconds`) before adding the event.
- **Icons per type**: defined in `ui.js` with `eventIcon()`: 🎬 (movie),
  📺 (series), 🏁 (completed series), 📖 (reading), 📚 (finished).
- **Date logic**: the `formatDateLabel()` function produces "Hoy", "Ayer"
  or "DD de Mes, AAAA" labels to visually group events.

## Alternatives considered

- **Feed persisted in Firestore**: Storing events in an
  `/activity/{eventId}` collection each time a user performs an action.
  Rejected because:
  - It requires additional writes on every user action, increasing the
    cost of Firestore.
  - Existing events would not have this record, so they would also have to
    be migrated or generated client-side.
  - Added complexity to maintain consistency (e.g. undone actions, date
    edits).
- **Push notifications as feed**: Using the existing notification system
  to double as a historical feed. Rejected because notifications have a
  different purpose (one-off alerts, not a complete chronological log).

## Consequences

### Positive
- Users can see at a glance the recent activity of all their friends,
  ordered chronologically.
- No changes to the Firestore data model or security rules are required.
- Reuses the existing friend data loading system and the read-only modal,
  minimizing new code.
- Events are always generated with the most up-to-date data (no
  synchronization lag).
- Parallel loading of each friend's data offers acceptable performance
  even with several friends.

### Negative
- The feed is generated entirely on the client each time the tab is
  accessed, which can be slow for users with many friends and large
  libraries. There is no cache or pagination.
- No support for "infinite loading" or "see more": all events are
  rendered at once, which could degrade on-screen performance with many
  events.
- Events disappear if the friend deletes or modifies the item (by design,
  since it is generated in real time), but this can be confusing if an
  event disappears from the feed without warning.
- Dependency on friend data having well-formed dates: undated events are
  silently omitted.
- Friend names are resolved from the profile at load time; if a friend
  changes their name, earlier events will appear with the new name.

### Neutral
- The feed includes the current user if they appear in the profile list
  (filtered by UID, not by an explicit friendship relation, since the app
  does not implement a formal friendship system — all registered users
  are visible to each other).
- Series events have a more complex treatment than movie and book events
  due to the episodic nature of the progress.

## Created/modified files
- `js/activity-feed.js` — New feed generation module (233 lines).
- `js/profile.js` — Integration: new "Actividad" tab, `loadActivityFeed()`
  function, import of `buildGlobalFeed`.
- `js/ui.js` — Added `renderActivityFeed()`, `formatDateLabel()`,
  `eventIcon()` and constant `PLACEHOLDER_COVER_SMALL`.
- `index.html` — Added `#profile-section-activity` with the feed container
  and loading state.
- `css/styles.css` — Added styles for `.activity-feed`, `.activity-group`,
  `.activity-event` and their variants.
