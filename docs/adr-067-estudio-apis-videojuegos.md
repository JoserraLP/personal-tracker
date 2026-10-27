# ADR-067: Video game APIs study — IGDB with a Cloudflare Worker proxy is adopted (issue #47)

## Status
Accepted (reviewed: 2026-08-10 — RAWG down, replaced by IGDB; review 2: proxy deployment)

## Date
2026-08-09 (reviews 2026-08-10)

## Context

Issue #47 asks to **add a video games tab** to the web with the
same features as the series, movies and books tabs
(catalog search, manual creation, statuses, filters, sorting, detail
profile, rating, notes, edit and delete) and, as a first step, to **choose
the video game catalog API** that feeds it: the comparative
study of candidates and the justification of the choice must be documented
alongside the implementation.

The app is **100 % client** (Firebase Hosting, vanilla JS, no backend nor
proxy of its own, with a service worker): any data source must be queryable
from the browser (CORS) or through a **minimal proxy** if
the API requires it. Movies and series use **TMDB** (key in the query
string, `networkFirst` for `api.themoviedb.org` and `cacheFirst` for
`image.tmdb.org` in the service worker, ADR-006 and ADR-007); books use
**Google Books + Open Library** (ADR-002, ADR-045, ADR-056 and ADR-065).

**Review (2026-08-10)**: the first version of this study chose
**RAWG** as the catalog and the tab's implementation (branch
`feat/issue-47-pestana-videojuegos`) was published for review (PR #166). Before
merging, the user reported (a comment on issue #47) that **RAWG has
stopped giving support and is down**: the API key cannot be obtained. It is
independently verified: public monitoring of rawg.io showing
**0 % availability in the last 30 days** (constant incidents
in July and August 2026, responses timing out), impossibility of
registering to get the key and testimonies of the API's closure. The
implementation **is reconsidered and migrated** to IGDB with a
Cloudflare Worker proxy, per the updated study documented in this ADR.

**Review 2 (2026-08-10) — lessons from the proxy's first real
deployment**: the user followed the README on their PC and reported (a
comment on issue #47) that step 4 failed with an SSL/TLS error (the classic Windows TLS error message
«no se puede crear un canal seguro SSL/TLS»), that the browser showed an insecure connection and
that they did not know whether to configure it elsewhere nor whether
to commit and push. Independent verification of the diagnosis:

- The URL the user put in `js/config.js`
  (`https://igdb-proxy.registro-personal.gonzalojh596.workers.dev`) **does
  not exist**: the TLS handshake fails (the `*.workers.dev` wildcard
  resolves, but the route is not provisioned). The real subdomain of their
  account is `gonzalojh596.workers.dev` and the Worker they deployed is called
  **`registro-personal`**, not `igdb-proxy`: they probably ran
  `wrangler init` (which creates `wrangler.jsonc` and touches the
  `.gitignore`) and `wrangler deploy` from another folder or with that
  configuration, so the Worker's name is not the one fixed by
  `wrangler.toml`.
- That deployed Worker is additionally **behind Cloudflare Access / Zero
  Trust** (its URL redirects to a login page
  `gonzalojh596.cloudflareaccess.com`): a public proxy cannot be
  behind session-gated access — that is why «the browser shows
  nothing».
- The SSL/TLS error on Windows is PowerShell's `curl` (an alias of
  `Invoke-WebRequest`, TLS 1.0 by default) failing against Cloudflare
  (which requires TLS 1.2+), or the nonexistent URL; the solution is
  `curl.exe` or the browser.

This review's decisions:

1. **A verification `GET /` on the Worker** (`{"ok": true,
   "service": "igdb-proxy", "secretsConfigured": …}`): it allows
   testing the deployment from the browser without secrets or POST, distinguishing
   "Worker well deployed" from "secrets missing"; if a login page is
   seen, the problem is Cloudflare Access.
2. **Hardened README** (`cloudflare/igdb-proxy/README.md`): section 0
   with "where it runs" (your PC, in `cloudflare/igdb-proxy/`) and
   "what gets pushed to GitHub" (only `js/config.js`; never
   `wrangler.jsonc` nor the `.gitignore` changes); a warning not to run
   `wrangler init`; a check that the URL printed by `wrangler deploy` is
   the one to use and that the Worker is public (without Cloudflare
   Access); testing via browser and `curl.exe` on Windows; an expanded
   troubleshooting table (SSL/TLS handshake, 404/error 1042, the Cloudflare
   Access login page).
3. **`IGDB_PROXY_URL` returns to the empty placeholder** in
   `js/config.js`: the URL committed by the user does not exist (a
   verified failed TLS handshake) and would break the video games
   search with a connection error instead of the designed notice
   («Falta IGDB_PROXY_URL…»). The designed notice is the honest state
   until the real deployment works.
4. **User manual §19** expanded with the «No se pudo conectar con
   IGDB…» case (wrong URL or a Worker behind Cloudflare Access).

Related issue: #47 — https://github.com/gonzalitojh/Registro-personal/issues/47

## Decision

**Adopt IGDB (Twitch) as the sole source of the video games catalog**,
queried through our own **Cloudflare Worker** acting as a secure
proxy: it holds the Client ID and Client Secret as encrypted
Cloudflare secrets, fetches the OAuth token server-side and forwards
the requests to `https://api.igdb.com/v4/*` adding CORS. The web only
knows the **Worker's public URL** (`IGDB_PROXY_URL` in `js/config.js`),
never the secrets.

### Comparative study of candidates (reviewed)

#### RAWG — discarded (down)

- It was the initial choice (v1 of this ADR): REST GET with a key in
  the query string, CORS enabled, a catalog of ~500 000 games with
  Metacritic, ESRB, developers and a 0–5 community score.
- **Current state (verified 2026-08-10)**: the API **is no longer
  operative** — it does not respond (timeouts), it has had **weeks of
  continuous incidents** (0 % availability in 30 days per public
  monitoring) and **a key cannot be obtained** (registration does not
  work). The user could not get the API key and confirms the outage.
- Consequence: not viable as the app's dependency.

#### TheGamesDB (TGDB) — discarded

- Free with an accessible API key (registration in its forum).
- **CORS: NO** (empirically verified on 2026-08-10): the responses of
  `api.thegamesdb.net` do not include `Access-Control-Allow-Origin`
  (neither on the OPTIONS preflight nor on the GETs). **It also
  requires a proxy**, so it does not offer the expected
  "no infrastructure" advantage.
- **No community ratings**: the data model exposes neither user nor
  critic scores (only age ratings like «E - Everyone»). The user
  confirms and misses it.
- Limited metadata: no Metacritic, no community score, no
  runtime, covers via its own CDN.
- Since it needs a proxy anyway (CORS) and offers **fewer data than
  IGDB**, it provides no advantage over the chosen option.

#### IGDB (Twitch) — selected

- **The most complete video game database**: the community score
  (`total_rating` / `aggregated_rating`, a 0–100 scale normalized to 0–10
  in the app), genres, platforms, developers and publishers (via
  `involved_companies`), ESRB/PEGI age ratings, covers on a
  CDN (`images.igdb.com`), synopses, dates, etc.
- **Free for non-commercial use** (Twitch's developer agreement);
  a limit of **4 requests per second**, more than enough for personal
  use.
- **It requires a server**: it has no CORS and the Client Secret is a
  password-like credential that **cannot be exposed in a SPA** (besides
  violating the Twitch agreement). The standard solution is a **minimal
  proxy** holding the secrets — here a **Cloudflare Worker** (free
  plan, no server to maintain, with encrypted secrets).

#### Other candidates briefly evaluated — discarded

- **GiantBomb**: requires an API key, limited CORS from the browser and
  fewer data than IGDB.
- **FreeToGame**: only *free-to-play* games; it cannot serve as a general
  catalog.
- **Steam Web API**: only Steam's catalog, requires a key and has limited
  data (no normalized covers or community score).
- **CheapShark**: only deals/prices; not a catalog.

### Integration pattern

- **Cloudflare Worker** in `cloudflare/igdb-proxy/` (`worker.js` +
  `wrangler.toml` + a `README.md` with the step-by-step): it fetches
  Twitch's OAuth token (the `client_credentials` flow), caches it with its
  expiry and forwards `POST /v4/*` to `api.igdb.com` with the headers
  `Client-ID` and `Authorization: Bearer`, adding CORS. The allowed
  origin can be optionally restricted with the `ALLOWED_ORIGIN` secret.
- The Worker's URL is configured in **`js/config.js`** as
  `IGDB_PROXY_URL` (an empty placeholder by default; the user obtains it
  when deploying the Worker). The secrets (`TWITCH_CLIENT_ID`,
  `TWITCH_CLIENT_SECRET`) live only in Cloudflare (`wrangler secret
  put`),
  never in the repository nor the browser.
- Search and expanded data in **`js/api-games.js`** (`searchGames` with
  `limit`/`offset` pagination and `getGameDetails`), using IGDB's
  Apicalypse query language.
- Service worker: **`cacheFirst` for `images.igdb.com`** (covers); the
  IGDB API goes through the proxy with POST and is not cached.
- If the proxy's URL is missing, the search **fails with a clear
  notice**
  («Falta IGDB_PROXY_URL en js/config.js (ver
  cloudflare/igdb-proxy/README.md)»), and an **HTTP 401/403 is
  distinguished** from the rest of the network errors («IGDB rechazó la
  petición. Revisa las credenciales del proxy…»).

## Consequences

### Positive

- **The highest-quality catalog available**: IGDB has a community
  score (0–10, like TMDB), genres, platforms,
  developers/ publishers, ESRB and covers — everything RAWG offered
  except Metacritic and average runtime.
- **Secrets safe**: Twitch's Client Secret never reaches the
  browser; the Worker holds them encrypted (Cloudflare secrets).
- **Minimal and free proxy**: Cloudflare Workers has a free plan; there is
  no server to maintain nor recurring cost; the app stays
  static.
- **Explicit error handling**: unconfigured proxy, rejected
  credentials and network error are distinguished (same as with
  RAWG).

### Negative / Risks

- **Minimal new infrastructure**: whoever administers the web must
  deploy the Worker and configure the secrets once (steps in
  `cloudflare/igdb-proxy/README.md`). Without that deployment, the video
  games search does not work (with a clear notice).
- **A Twitch account is needed**: IGDB is managed through
  dev.twitch.tv (free, requires an account).
- **No Metacritic nor average runtime**: IGDB does not expose those
  fields; the profile shows platforms, developers, publishers, ESRB,
  synopses and the community score.
- **Request limit**: 4 req/s (non-commercial use); enough for
  personal use.
- **Worker dependence**: if the Worker fails (secrets, Cloudflare
  limits), the search degrades; the rest of the app is
  unaffected.

### Neutral

- **Attribution**: the credit «Datos de videojuegos vía IGDB
  (igdb.com)» is kept in `index.html`'s footer and in
  `ocio/videojuegos.html`.
- **New Firestore collection**: games are stored in
  `users/{uid}/games` (covered by `firestore.rules`) and are included in the
  backup, like the other types.
- **No data migration**: there was no previous video game data in
  production (the PR had not merged when the decision was reviewed); IGDB's
  `externalId` field is what gets stored.
- **Score scale**: IGDB scores 0–100; the app normalizes it to **0–10**
  (like TMDB) and it is documented in the user manual (§10).

## Future work (out of issue #47's v1 scope)

These remain **explicitly out of scope** of this first version and will be
raised as independent issues if wanted:

- A video games tab in the **friends view** (`js/profile.js`).
- Video games' **activity / feed**.
- **Profile stats** (hours played, genres, platforms…).
- **Daily-check / notifications** for video games.
- **ICS export** of played release dates, etc.

## Rejected alternatives

- **RAWG**: rejected — the API is down and unsupported (verified
  2026-08-10); a key cannot be obtained.
- **TheGamesDB**: rejected — no CORS (it requires a proxy anyway) and no
  community ratings; fewer data than IGDB.
- **GiantBomb**: rejected — limited CORS and fewer metadata than
  IGDB.
- **FreeToGame**: rejected — free-to-play only.
- **Steam Web API**: rejected — Steam's catalog only and limited
  data.
- **CheapShark**: rejected — deals only, not a catalog.
- **Self-hosted proxy/backend (VPS, generic cloud function)**: the
  **Cloudflare Worker** is preferred for its free plan, minimal
  deployment and integrated encrypted secrets.

## Needed configuration (whoever administers the web)

Complete steps in `cloudflare/igdb-proxy/README.md`. Summary:

1. **Twitch**: create an application in dev.twitch.tv/console/apps (the
   *Application Integration* type), note the **Client ID** and
   generate the **Client Secret** (shown only once).
2. **Cloudflare**: a free account; `wrangler login`; `wrangler deploy`
   in `cloudflare/igdb-proxy/`. The Worker must deploy with the
   **`igdb-proxy`** name (from `wrangler.toml`), **public** (without
   Cloudflare Access/Zero Trust) and its exact URL (the one
   `wrangler deploy` prints) is what the web uses. Do not run
   `wrangler init` (it creates a `wrangler.jsonc` that may deploy the
   Worker with another name).
3. **Secrets**: `wrangler secret put TWITCH_CLIENT_ID`,
   `wrangler secret put TWITCH_CLIENT_SECRET` and (recommended)
   `wrangler secret put ALLOWED_ORIGIN` with the web's domain.
4. **App**: put the Worker's URL in `IGDB_PROXY_URL` of `js/config.js`
   (the only change that gets pushed to GitHub).

## Created/modified files

| File | Change |
|---------|--------|
| `docs/adr-067-estudio-apis-videojuegos.md` | **New**: this document (reviewed: RAWG → IGDB + proxy; review 2: lessons from the real deployment) |
| `cloudflare/igdb-proxy/worker.js`, `wrangler.toml`, `README.md` | **New**: the IGDB proxy (Cloudflare Worker) with deployment and configuration instructions (review 2: the verification `GET /` and the hardened README) |
| `js/api-games.js`, `js/config.js`, `service-worker.js`, `js/search.js`, `js/ui.js`, `js/modal-handlers.js`, `js/quick-actions.js`, `index.html`, `ocio/videojuegos.html`, `ocio/ocio.css` | **Existing**: the RAWG → IGDB migration (branch `feat/issue-47-pestana-videojuegos`) |
| `docs/manual-de-usuario.md` | **Existing**: §7.2, §8.1, §10, §16 and §19 updated (IGDB, the 0–10 scale, the proxy's notices) |
| `tasks/task-issue-47.json` | **Existing**: the definition of done (criterion "ADR documented with 'Related issue: #47'") that this ADR fulfills |

Related to: tasks/task-issue-47.json

Related issue: #47 — https://github.com/gonzalitojh/Registro-personal/issues/47
