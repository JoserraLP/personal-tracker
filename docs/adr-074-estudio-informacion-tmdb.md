# ADR-074: TMDB API information study — building an "IMDB/TMDB" from the client is feasible, with a phased scope for future implementations (issue #184)

## Status
Accepted (a study decision: it defines the scope of future implementation
issues; this issue implements nothing).

## Date
2026-08-10

## Context

Issue #184 asks to **carry out a study, without implementing anything**, of all the
information that can be pulled from the TMDB API, organized by sections,
to learn how far the idea of building a kind of _IMDB_ or
_TMDB_ inside the web can go: querying much more information about movies,
series, actors, directors, etc. The issue does not pose a concrete
implementation but a **catalog of possibilities** allowing scope
decisions.

The starting point, verified against the real code and TMDB's
official documentation (the study's sections 3 and 4):

- A **100 % client architecture**: Firebase Hosting, vanilla JS, a PWA with
  a service worker, no backend of its own except IGDB's proxy (ADR-067).
  All TMDB access lives in `js/api-movies.js` with a
  key in the query string (`js/config.js`).
- **TMDB's current use**: 9 distinct calls already in production
  (movie/series search, details with `append_to_response=credits,videos`,
  seasons/episodes, collections/sagas
  ADR-006, watch providers ES, similar), with a
  24 h in-memory cache, `networkFirst` for the API and
  `cacheFirst` for the image CDN in the service
  worker (`service-worker.js:288` and `:307`) and Firestore snapshots with a
  daily refresh (ADR-021). Consumption baseline: **~410 TMDB
  calls/day/user**
  (the storage study, ADR-073).
- **Attribution already fulfilled**: a notice in the footer of
  `index.html:222`.
- **Empirical courtesy verification (2026-08-10)**: a `curl` to
  `api.themoviedb.org` confirms `access-control-allow-origin: *` → the
  API is queryable from the browser, as the
  app already does.

**Why the study was needed**: today's profile shows only a
subset of TMDB's information (basic data, a cast of 5,
director, trailer, platforms, similar). The issue asks **how far
one can go** without knowing what the API really offers; this study
catalogs the API v3's 21 sections

 (endpoints, data and utility), evaluates
the viability in the current architecture and proposes an ordered
scope.

The study is already **done and validated (QA PASS)**:
`docs/estudio-informacion-tmdb.md` (775 lines, TMDB's primary
sources consulted on 2026-08-10: the official docs, OpenAPI v3,
the terms of use of 2023-10-20 and FAQ; evidence contrasted against
the app's real code). Its verdict: **building an "IMDB/TMDB-like"
on the client is feasible** for practically all of TMDB's information, with no
new infrastructure. This ADR documents the decision/conclusion
retrospectively, as ADR-065, ADR-067 and ADR-073 did for their
studies, and fulfills `tasks/task-issue-184.json`'s definition of done
(«ADR documenting the study and its conclusion, with 'Related
issue: #184'»).

Related issue: #184 — https://github.com/gonzalitojh/Registro-personal/issues/184

## Decision

**The issue's idea is declared feasible and a phased scope is fixed
for future implementation issues — out of this issue's scope, which
implements nothing.** The decision's basis:

1. **Almost all the API is of category A (usable today on the
   client)**: the catalog's 21 sections (study section 4) except
   accounts/authentication are queried with a public GET +
   `api_key` + CORS enabled. No architectural change is needed: `js/api-movies.js` is
   extended following the existing patterns (the 24 h cache +
   `networkFirst` + on demand).
2. **`append_to_response` makes enrichment cheap**: an IMDB-like full
   profile costs 1 call per opening (section 4.21), not N. The editors'/discover lists cost 1
   call per section; the image CDN has no rate limit.
3. **Affordable limits** (section 6): a soft ~40 req/s **per
   key** rate limit (shared by all users) → the low-volume +
   cache + on-demand model is kept (the current consumption is
   ~0.005 req/s on average); the API data may be
   cached ≤ 6 months (the Firestore snapshots are
   coherent); free non-commercial with attribution (already
   fulfilled); the ML/AI use of the data is
   forbidden; no SLA.
4. **New infrastructure only if the user count scales**: if the
   joint rate limit were hit, the Cloudflare
   Worker proxy pattern already proven with IGDB (ADR-067)
   would apply. Not needed today.

### Recommended scope (for future issues, study section 8)

- **Phase 1 — People and filmography** (`person/{id}`,
  `combined_credits`, the already-used credits): actor/director
  profiles with a biography, photo, a navigable filmography and «see more from this
  actor/director». The maximum value/effort; the `person_id` already
  arrives in the profile's credits.
- **Phase 2 — Discovery** (`discover/movie|tv`, `trending/*`,
  `movie/popular|now_playing|upcoming|top_rated`, `tv/*`): trend/release/popular
  sections and advanced exploration (genre, year,
  platform, score) with no own logic.
- **Phase 3 — Profile richness** (images, videos, per-country
  certifications, per-country release dates, the episode's profile):
  galleries, additional
  trailers and full technical data.
- **Phase 4 — External integration** (`external_ids`, `find`,
  `configuration`): «see on IMDb/Wikipedia», import by external ID and
  dynamic configuration (image sizes, translations of jobs).
- **Out of scope**: reviews and TMDB users' lists (the app has its
  own UGC), v3 and v4 authentication/accounts (it duplicates our own
  system and requires OAuth), and the changes/changelog (only a
  future note for ADR-021's refresh).

## Rejected alternatives

- **Keeping the status quo** (9 endpoints): it does not
  satisfy the issue's idea; the study shows the expansion is cheap
  and risk-free.
- **A mandatory proxy/backend from the start**: oversized; all of the
  A category works on the client (CORS verified). A scaling-only
  phase.
- **Migrating to API v4 with an Access Token**: it adds no new data;
  on a public client the key is already visible, so
  v4 adds no security and adds token management
  (section 4.20).
- **Integrating TMDB's accounts/lists/reviews**: it duplicates our own
  ratings/lists and requires OAuth; a negative cost/benefit (sections
  4.16 and 4.19).

## Consequences

**Positive**:

- The web can approach an IMDB/TMDB-like experience **with no backend nor
  infrastructure cost**, reusing the already-proven patterns.
- `append_to_response` and the editorial lists minimize the new
  calls (+10-30/day estimated, the study's
  section 6.4).
- Each phase is an independent issue, deployable in isolation.

**Negative**:

- The per-key rate limit is shared: it requires keeping
  cache discipline and low volume; a user spike would require the
  proxy (ADR-067).
- Attribution must be kept and, if the use expands, adding
  the **approved logo** in the settings/about section would be
  advisable (today there is only the textual notice in the footer).
- TMDB may change terms/limits without
  notice; the local snapshots mitigate the dependence.

**Neutral**:

- The Firestore data model does not change (the data remain
  snapshots + on demand); the phases only add network consumption
  when opening each function.
- The user manual (AGENTS.md's rule 3) will be updated in each phase
  touching UI; this issue changes nothing visible → not
  applicable.

## Created/modified files

- `docs/estudio-informacion-tmdb.md` | **New**: the full study (775
  lines, QA PASS) whose conclusion this ADR documents.
- `docs/adr-074-estudio-informacion-tmdb.md` | **New**: this document.
- `tasks/task-issue-184.json` | **Updated**: status and the `pr` block when
  publishing the PR.

## Verification

- **QA PASS** against the task file's acceptance: a per-section catalog
  (21 sections + `append_to_response`),
  endpoints/data/utility per
  section, viability A/B categories, limits (rate limits,
  authentication, CORS, costs, terms), a conclusion with a scope
  recommendation, an ADR with
  `Related issue: #184`, **zero app code**
  (`git diff` only touches
  `docs/*.md` and `tasks/task-issue-184.json`).
- **Security scan**: no HIGH/MEDIUM findings; no key or
  credential is transcribed in the documents.
- **The project's rules**: rule 2 (responsiveness), rule 3 (the manual) and
  rule 4 (themes): **N/A** — there are no UI nor behavior
  changes.
