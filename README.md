# Personal Tracker [My Tracker]

Personal tracker (and now also shared among friends) of movies, series and
books, to replace TV Time. Static web app (HTML + CSS + JS with native
modules, no build or frameworks), hosted for free on GitHub Pages, with
Firebase as the multi-user database.

```
mi-registro/
├── index.html               ← skeleton: header, login, modal, profile
├── manifest.json             (yours, not touched by this project)
├── resources/
│   └── icon.png            ← your icon (already in place)
├── ocio/                    ← "ocio" [leisure] section: movies, series and books
│   ├── series.html          content of the Series tab
│   ├── peliculas.html       content of the Movies tab
│   ├── libros.html          content of the Books tab
│   └── ocio.css             styles specific to this section
├── css/
│   └── styles.css          ← skeleton styles (shared)
├── js/
│   ├── config.js           ← Firebase/TMDB/Books keys (fill in)
│   ├── firebase.js          Firebase initialization
│   ├── http.js               fetch with retry (TMDB, Open Library)
│   ├── api-movies.js        search, seasons/episodes and extended data on TMDB
│   ├── api-books.js         search on Open Library / Google Books
│   ├── dates.js              date utilities
│   ├── constants.js          shared constants (STATUS_LABELS, TYPE_BY_GROUP)
│   ├── sorting.js            sorting and comparison functions
│   ├── tv-progress.js       watched episodes (with per-episode rating), rewatches
│   ├── watch-log.js          watch history (movies)
│   ├── reading-log.js        reading history (books)
│   ├── db.js                 Firestore read/write, profiles, friends
│   ├── ui.js                  DOM rendering
│   ├── search.js              search and item registration
│   ├── modal-handlers.js      opening and management of modals
│   ├── quick-actions.js       quick actions (mark watched/next)
│   ├── daily-check.js         daily release check
│   ├── notifications-setup.js notifications wiring
│   ├── sidebar.js            navigation sidebar (drawer)
│   ├── profile.js             profile, statistics and friends
│   └── app.js                 entry point and orchestrator
├── docs/
│   └── adr-001-code-cleanup-refactoring.md
├── firestore.rules         ← security rules (the allowed emails live here)
└── README.md
```

## How the HTML/CSS is organized

It is still **a single page** (one URL, no reloads when switching tabs):
`index.html` brings the skeleton —header, tabs, login screen, modal,
profile— and inside each tab's `<section>` there is only a
`data-ocio-src="ocio/....html"`. On load, `app.js` requests those three
files with `fetch()` and injects them in place before connecting the
rest of the app. Nothing changes for whoever uses it; for you, the
code of each tab lives in its own file inside `ocio/`.

The CSS follows the same idea: `css/styles.css` has the color and
typography tokens and everything that is "skeleton" (login, header, empty
modal, profile, notifications); `ocio/ocio.css` has everything specific to
movies/series/books (search, cards, seasons, forms...).
Both are always loaded together, so the color variables defined
in one are available in the other without anything special.

If in the future you add another section (non-leisure), it would be a sibling
folder of `ocio/` with its own structure (`.html` per tab + its `.css`),
hooked to the same skeleton.

## How the JavaScript is organized

The JS code follows a pattern of **orchestrator + specialized modules**:

- **`app.js`** is the entry point and orchestrator: it manages the global
  state, the Firestore subscriptions, the filters/sorting and connects the
  specialized modules.
- Each specialized module (`search.js`, `modal-handlers.js`, `profile.js`,
  etc.) receives a `ctx` object with functions to access the state and the
  dependencies, which makes all dependencies explicit and avoids circular
  imports.
- `constants.js` and `sorting.js` contain pure logic reusable by
  several modules.
- `ui.js` keeps centralizing all DOM rendering.

To see the refactoring details, check `docs/adr-001-code-cleanup-refactoring.md`.

> **Important for testing locally:** since `app.js` now uses
> `fetch()` to bring those files, opening `index.html` directly
> by double-clicking (the `file://` protocol) **no longer works at
> all** — browsers block `fetch()` of local files for
> security. Always test from a local server
> (`python3 -m http.server` in the project folder) or directly
> from your GitHub Pages URL.

## How access works (read carefully, it is the most delicate part)

This is no longer a single-user app: **any email on your guest list can
register** (entering for the first time creates their account
automatically) and, once inside, **all registered users are considered
"friends" of each other** — each one sees and edits only their own stuff,
but can view (not edit) anyone else's tracking from the
"Friends" section of the profile.

Who can enter is controlled in **a single place**: the
`isAllowedUser()` rule of **`firestore.rules`** (issue #195). There used to
be also `js/allowed-emails.js`, an array in the browser that warned on the
spot if the email was not on the list; it was removed because it duplicated
the list and desynchronized from the rules. Now the web app itself asks
Firestore when signing in: if the rules reject the user, they are
warned (*«Tu correo no está en la lista de invitados. Pide que te
añadan.»* [Your email is not on the guest list. Ask to be added.]) and
logged out.

**Every time you add or remove a friend, edit the email list inside
`isAllowedUser()` in `firestore.rules`** and paste the whole file again
into the Firebase console → Firestore Database → Rules → Publish.
That is the only place where the emails are kept; there is no other
file to touch.

Inside Firestore, each user has their own collections:
`users/{uid}/movies`, `/series`, `/books` (visible to any other
authorized user, with read-only permission) and `/notifications`
(private, nobody else sees it). The `users/{uid}` document itself stores the
profile (name, photo, email) used for the friends list.

> **Security note:** the email list determines who can
> register and use the app, but technically anyone with a Google
> account can *try* to sign in (Firebase cannot prevent that).
> What really matters is that, if their email is not on the rules list, they
> get no access to any data — not even their own, let alone
> anyone else's.

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and
   create a new project (free, "Spark" plan).
2. **Authentication** → "Sign-in method" tab → enable **Google**.
3. **Firestore Database** → "Create database" → production mode → choose
   a region (for example `eur3` if you are in Spain).
4. **Project settings** (gear icon) → scroll down to "Your
   apps" → add a **Web** app (`</>`) → copy the `firebaseConfig` object
   it shows you.

## 2. Fill in `js/config.js`

- In `js/config.js`: paste the `firebaseConfig` from the previous step and your
  TMDB key (next step).

## 3. Firestore security rules

In the Firebase console → Firestore Database → "Rules" tab, paste the
content of `firestore.rules` **replacing the sample emails in
`isAllowedUser()` with yours** (add as many as you want, it is an
array) and publish. This list is the single source of truth of who can
enter: to add or remove a friend, edit it and publish again.

## 4. TMDB API key (movies and series)

1. Create a free account on [themoviedb.org](https://www.themoviedb.org).
2. Account settings → API → request a "Developer" type key.
   It is free for non-commercial use.
3. Copy the "API Key (v3 auth)" into `TMDB_API_KEY` inside `js/config.js`.

> IMDb offers no affordable public API nor awards data; that is why TMDB is
> used, free and with a very similar catalog.

## 5. Google Books key (optional)

Book search uses **Open Library as the primary source** (it groups
by work, not by edition, and needs no key) and Google Books only as
fallback. If you want your own key for that fallback, follow the
domain-restriction process explained below in «Troubleshooting».

## 6. Upload to GitHub and enable Pages

1. Create a new repository on GitHub (public, mandatory on the free
   plan) and upload the whole content of this folder, including your
   `resources/icon.png`.
2. Settings → Pages → Source: **"GitHub Actions"** → Save. If your web
   app was already published with the old mode ("Deploy from a branch"), the
   first workflow deployment tries to migrate it automatically; if
   the automatic migration fails, do the Source change manually and
   save. Also, the `github-pages` environment must allow deploying to
   **all branches** (Settings → Environments → `github-pages` →
   "Deployment branches" → pattern `**/*`, which covers any hierarchy).
   Without that pattern, deployments from branches like `feature/...` are
   rejected with an "environment protection rules" error.
3. The `.github/workflows/deploy-pages.yml` workflow deploys **only the
   `main` branch on every push/merge to `main`** (ADR-106): the web app
   published at `https://your-user.github.io/repo-name/` is always the
   latest version merged into `main`. The other branches (dev and
   features) are NOT published: they only deploy locally for testing.
4. To **re-deploy manually**: Actions tab →
   `deploy-pages` → "Run workflow".
6. **(Optional) Automatic issue resolution** — the
   `.github/workflows/auto-resolve-issues.yml` workflow launches an
   OpenCode session (agent `sdd-master`, model DeepSeek V4 Flash Free, max
   variant) that automatically resolves the highest-priority issue in the
   backlog (issues with the `ai` label in `status: todo`, priority → type →
   age; never `needs-info`/`blocked` issues or those blocked by another
   unresolved one).
   It triggers when a new issue is created, when commenting on an in-progress
   issue (iteration) or with a manual trigger from the Actions tab —
   **it no longer triggers on PR merges**. If there are no issues left, the
   workflow finishes without launching a session ("server off").
   After each successful session the Pages deployment is automatically
   relaunched (`deploy-pages`), so the `main` version gets published even
   though the push is done by the action with the bot token.
   It requires the
   workflow to be on the default branch (`main`): it activates in
   production after the `dev` → `main` promotion. Manual test from the
   Actions tab → `auto-resolve-issues` → "Run workflow" (with
   `dry_run` to see the selection without launching the session). If a
   session fails mid-run (e.g. due to the free model's token limit), the
   progress is saved automatically to a `wip/issue-N` branch, is restored on
   the next attempt and the workflow is
   **automatically relaunched on the same issue** (up to 2 retries,
   commenting each failure on the issue — all comments, PRs and
   label changes of the session and of the failure steps are published by
   `github-actions[bot]` (never your user), so they do not trigger the
   workflow again—; once retries are exhausted, the issue
   returns to the queue with a comment). You can **queue several
   runs** of the workflow (e.g. N open issues in a row): the
   runs wait in queue and are processed in order, one session at a time,
   without canceling the queued ones (previously only 1 could run + 1 in
   queue and the rest were canceled). **False success** is also detected: if
   the session ends with the issue still in `status: in-progress` (the model
   emitted its final answer before completing the flow), it is treated as
   another failure and the workflow saves the WIP progress and relaunches
   automatically.

## 7. Authorize your domain in Firebase

Authentication → Settings → "Authorized domains" → add
`your-user.github.io`. Without this step, the Google login fails with a
domain-not-authorized error. `localhost` is already authorized by
default for when you test locally.

## 8. How to use it

Opening the app puts you directly in **Series, filtered by "Viendo"
[Watching], in list view** — designed for the most common use.

- **Grid / list view**, with quick action (big button or
  swipe on mobile) to mark watched/next episode/advance reading.
- **Movies**: Pending/Watched, with watch history (rewatches
  included) and a warning if you try to mark it watched before its release.
- **Series**: episode by episode, with editable date, and now also
  **individual rating per episode** (appears below each episode
  already marked as watched). "Watch it again from the beginning" archives
  the watch in a history without losing the previous one.
- **Books**: start/finish reading with date, re-reads with history.
- **Standby / Abandoned** (series and books), **edit information**, **manual
  registration** (with episode count for manual series), **search your own
  list**, **more results with "Cargar más" [Load more]**, **pastel colors by
  status**, **extended information** (runtime, genre, director/creators,
  cast, synopsis), and a **"Solo en español" [Only in Spanish]** checkbox in
  the book search (on by default): unchecked, Spanish results
  simply appear first; checked, the ones Open Library confirms in another
  language are discarded outright (those lacking that data are not
  discarded, to avoid losing results for lack of metadata) — all
  of this already explained in previous versions of this README, it keeps
  working the same.
- **Notifications** (🔔): warns about releases and new episodes, once a
  day. That same daily check **also fills in missing information**
  (synopsis, cast, director, release date...) on any card that had it
  incomplete — useful both for what you added before the app collected
  those fields and for series in production that do not have everything
  published on TMDB yet: as soon as TMDB updates it, your card completes
  itself the next day.
- **Profile**: tapping your photo opens it with two sections:
  - **Estadísticas** [Statistics]: summary (movies watched, episodes,
    series completed, books read) with an Always/Year/Month selector and two charts.
  - **Amigos** [Friends]: list of all registered users; tapping one shows
    their full tracking in read-only mode (without personal notes, those
    are always private).

## Troubleshooting

**Error 503 "Service temporarily unavailable" when searching books** — a
sporadic server failure, not your fault. The app retries on its own; if it
persists, wait a few seconds.

**Error 403 "referrer blocked" when searching books** — it only affects the
Google Books fallback. It happens if you restricted that key by domain and
test from `file://` on your disk instead of from GitHub Pages or a
local server (`python3 -m http.server`, adding
`http://localhost:PORT/*` to the allowed referrers in the Google Cloud
Console).

**A friend cannot enter even though I added them** — check that their email is
on the `isAllowedUser()` list of `firestore.rules` and that you have
published the rules again in the Firebase console (changes to the
repository file are not applied to the database by themselves). There is no
other place to keep emails.

## Limits to keep in mind

- Firebase Spark (free): 50,000 reads/day and 1 GiB of storage —
  more than enough for a small group of friends.
- TMDB: free use is non-commercial only, with attribution (footer).
- The daily check makes one request to TMDB for each active movie or series
  that still has incomplete data or a pending release, and one to Open
  Library for each book without a synopsis — once filled, they stop being
  queried, so request usage drops on its own over time.
