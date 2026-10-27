# ADR-014: Export of the release calendar to .ics format

## Status
Accepted

## Context
Users of "Personal Tracker" follow on-air series and have movies pending
release, but they have no simple way to track the dates of their upcoming
episodes and releases from their personal calendar (Google Calendar,
Apple Calendar, etc.).

The application already stores information about upcoming episodes
(`nextEpisodeToAir` fetched from TMDB) and movie release dates
(`releaseDate`), but this information is only visible within the web
interface. There was no mechanism to export these dates to a standard
calendar format.

## Decision
Implement a calendar export module in .ics format (iCalendar, RFC 5545),
accessible from the "Data" tab of the user's profile view.

### .ics file format
The generated file follows the iCalendar standard (RFC 5545) with the
following structure:

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Personal Tracker//ES
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
UID:mi-registro-{tipo}-{id}@registro-personal
DTSTART;VALUE=DATE:YYYYMMDD
SUMMARY:Nuevo episodio: {serie} T{temp}E{ep}
DESCRIPTION:...
TRANSP:TRANSPARENT
END:VEVENT
...
END:VCALENDAR
```

### Included events
1. **Upcoming series episodes**: All series that have a valid and future
   `nextEpisodeToAir.airDate` are included. The summary shows "Nuevo
   episodio: {título} T{temp}E{episodio}".
2. **Movie releases**: Movies with status "pending" or marked as
   `awaitingRelease` and with a future `releaseDate` are included. The
   summary shows "Estreno: {título}".

### Export strategy
1. The user clicks "Export calendar (.ics)" from the profile "Data" tab.
2. Events are collected from the data already loaded in memory
   (`ctx.getItemsByGroup("tv")` and `ctx.getItemsByGroup("movies")`).
3. Only items with future dates (greater than or equal to the current
   date) are filtered in.
4. The ICS content is generated following RFC 5545, with:
   - Escaping of special characters in TEXT values (\ , ; , \n)
   - Line folding (maximum 75 octets per line)
   - Dates in DATE format (YYYYMMDD) for all-day events
   - Stable UIDs based on the item's type and ID
5. It is downloaded via a temporary link (`Blob` + `URL.createObjectURL`)
   named `calendario-estrenos-{fecha}.ics`.

### Placement in the interface
The export button is located in the profile view, under the "Data" tab,
in a new standalone card after the JSON backup export and import cards.

### Architecture
```
js/export-ics.js     → New module with generateIcsString(),
                       collectUpcomingEvents(), downloadIcs()
                       and setupExportIcs()
js/profile.js        → Modified: imports and calls
                       setupExportIcs(ctx)
index.html           → Modified: adds data-card with
                       button #btn-export-ics in the data section
```

### Technical details
- **Date format**: `VALUE=DATE` (no time) is used because episode and
  release dates are dates without a specific time. This avoids timezone
  issues.
- **TRANSP:TRANSPARENT**: Marks events as transparent (they do not block
  time in the calendar), appropriate for releases and episodes.
- **No DTEND**: For single-day events with `VALUE=DATE`, the absence of
  DTEND implies a 1-day duration (RFC 5545 §3.6.1).
- **ICS escaping**: \ , ; , and line breaks are correctly escaped to avoid
  breaking the file structure.
- **Line folding**: Implements RFC 5545 folding (max. 75 octets) to comply
  with the standard.
- **No DTSTAMP**: Not included for simplicity; Google Calendar and Apple
  Calendar accept the file without this field.

### Rejected alternatives
- **Automatic periodic export**: There is no backend that can schedule
  tasks; depending on Firebase Functions adds complexity.
- **CSV format**: CSV formats are not directly importable into calendars;
  .ics is the universal standard.
- **Real-time synchronization (CalDAV)**: Would require a CalDAV server
  and additional authentication, out of scope for the application.
- **Selector of what to include (series/movies)**: For the initial version
  both types are included. A selection modal could be added in the future
  if users request it.
- **Reminders (VALARM)**: Not added because each calendar handles
  reminders differently; users can configure them from their calendar.

## Consequences

### Positive
- Users can import upcoming episodes and releases into their personal
  calendar with a single click.
- Being in standard .ics format, it works in any calendar application
  (Google Calendar, Apple Calendar, Outlook, etc.).
- No external APIs or additional permissions are required.
- The information is generated entirely client-side, without sending data
  to external servers.

### Negative
- There is no automatic synchronization: if the user adds new series or
  movies, they must export the file again.
- Events are generated as whole dates (day) without a specific time; the
  exact broadcast time of the episode is not known.
- If there are no upcoming episodes or releases, the button shows an
  informational toast but does not download any file.

### Neutral
- A new JS file of ~200 lines is added (`export-ics.js`).
- No CSS changes are required (it reuses existing styles `.data-card` and
  `.btn--accent-media`).
- The feature does not interfere with the existing JSON export/import.

## Created/modified files
- `js/export-ics.js` — New: module with generation and download of .ics
  files (~200 lines).
- `js/profile.js` — Modified: added import and call to
  `setupExportIcs(ctx)`.
- `index.html` — Modified: added card with export button
  `#btn-export-ics` in the `#profile-section-data` section.
