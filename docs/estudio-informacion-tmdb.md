# Study of the TMDB API information (issue #184)

## Date

2026-08-10

## Issue

#184 — «Estudio información TMDB» [TMDB information study]: carry out a study,
without implementing anything, of all the information that can be extracted
from the TMDB API, organized by sections, to know how far the idea of building
a kind of _IMDB_ or _TMDB_ inside the web app can go: querying much more
information about movies, series, actors, directors, etc.
https://github.com/gonzalitojh/Registro-personal/issues/184

## Status

Study finished, **no implementation**: this document does not contribute or
propose any code to the application (acceptance criterion no. 7: nothing is
implemented; no file outside `docs/` and `tasks/` is modified).

---

## 1. Executive summary

**Verdict: it is technically feasible to build a "kind of IMDB/TMDB" inside
the current web app —100 % client, no backend— because practically all the
information TMDB offers (movies, series, people, credits, collections, watch
providers, images, videos, translations, external IDs, etc.) can be queried
from the browser with the single API key already integrated and CORS
enabled.** No new infrastructure is needed for 95 % of the data; only a proxy
(pattern already proven with IGDB, ADR-067) would be needed if the number of
users grew to hit the shared rate limit (~40 req/s per key, shared among all
users).

The full catalog is detailed in section 4: ~21 sections of the v3 API cover
everything from the movie technical sheet (budget, revenue, production
companies, languages) to actor and director biographies, complete
filmographies, editorial lists (trending, popular, upcoming), image
galleries, videos, per-country certifications, streaming platforms,
thematic keywords, companies and networks, reviews, user lists and
translations into dozens of languages. Today the app already consumes 9 of
those endpoints (section 3); the rest is expandable **on demand with cache**,
following the existing patterns (24 h in-memory cache + service worker
`networkFirst` + Firestore snapshots from ADR-021), without touching the
data model.

**Phased scope recommendation** (for future issues, section 8), from highest
to lowest value/effort:

1. **Phase 1 — People and filmography** (`person/{id}`, `combined_credits`,
   `movie/{id}/credits` already partially used): actor/director cards with
   biography, photo and «see more from this actor/director». It is the most
   visible step toward an "own IMDB" and costs 1-3 calls per card opening.
2. **Phase 2 — Discovery** (`discover/movie|tv`, `trending/*`,
   `movie/popular|now_playing|upcoming|top_rated`): trending, upcoming,
   "most watched" and advanced exploration sections with no custom logic.
3. **Phase 3 — Card richness** (images, videos, certifications, release
   dates by country, keywords): galleries, additional trailers and complete
   technical data.
4. **Phase 4 — External integration** (`external_ids`, `find`,
   `configuration`): deep links to IMDb/Wikipedia, import by external ID and
   removing hardcoded image sizes.
5. **Out of scope**: TMDB reviews and user lists (the app already has its
   own rating and lists), TMDB authentication/accounts (v3 and v4) and the
   changes changelog (only as a future note for the daily refresh).

**Limits that condition everything** (section 6): free use is **non
commercial** only, with **mandatory attribution** (already fulfilled in the
footer); **API data cache ≤ 6 months** (Firestore snapshots are the coherent
mechanism); **soft rate limit of ~40 req/s per key**, shared by all users
(which is why cache and low call volume are critical); no SLA; training
ML/AI models with the data is forbidden.

At-a-glance table (detail in sections 4 and 5):

| TMDB section | Representative endpoints | Usable today in client? | IMDB-type value |
|---|---|---|---|
| Movies (card detail) | `movie/{id}` | ✅ Yes (already used) | Technical, financial data, production companies, languages |
| Series and episodes | `tv/{id}`, `tv/{id}/season/{n}/episode/{m}` | ✅ Yes (partial) | Series card, episodes, certifications, networks |
| People | `person/{id}`, `person/popular` | ✅ Yes | Actor/director biography |
| Credits and cast | `movie|tv/{id}/credits`, `person/{id}/combined_credits` | ✅ Yes (partial) | Full cast, filmography, person↔work graph |
| Search | `search/movie|tv|person|multi|collection|company|keyword` | ✅ Yes (partial) | Global multi-type search |
| Discover | `discover/movie|tv` | ✅ Yes | Advanced exploration with 30+ filters |
| Trending and lists | `trending/*`, `movie/popular|now_playing|upcoming|top_rated`, `tv/*` | ✅ Yes | Automatic editorial sections |
| Collections and sagas | `collection/{id}` | ✅ Yes (already used) | Complete sagas |
| Genres and keywords | `genre/*/list`, `keyword/{id}` | ✅ Yes | Thematic navigation |
| Companies and networks | `company/{id}`, `network/{id}` | ✅ Yes | Studio/network filmographies |
| Watch providers | `movie|tv/{id}/watch/providers`, `watch/providers/*` | ✅ Yes (partial) | «Where to watch» by platform and country |
| Images | `movie|tv|person/{id}/images` + CDN | ✅ Yes | Galleries and backdrops with no rate limit |
| Videos | `movie|tv/{id}/videos` (+ season/episode) | ✅ Yes (partial) | Trailers and extras |
| Translations | `*/{id}/translations` | ✅ Yes | Multilanguage |
| External IDs and find | `*/{id}/external_ids`, `find/{id}` | ✅ Yes | Deep links and import by ID |
| Reviews and lists | `movie|tv/{id}/reviews`, `list/{id}` | ✅ Yes | Marginal value (own UGC) |
| Changes/changelog | `movie|tv|person/changes` | ✅ Yes | Future sync |
| Configuration | `configuration` (+ countries/jobs/tz/languages) | ✅ Yes | Dynamic API data |
| Authentication/accounts | `authentication/*`, `account/*`, v4 `4/account` | ⚠️ With session management | **Not recommended**: own UGC |
| API v3 vs v4 | `3/*` vs `4/*` | ✅ v3 | Decision: keep v3 |

---

## 2. Scope and methodology

**What is studied**: all the information that can be extracted from the TMDB
API, organized by sections (endpoints, the data they return and their
usefulness for an IMDB/TMDB-type web app), and the feasibility of building
that experience on the app's current architecture (100 % client, Firebase
Hosting, vanilla JS, no backend). It also evaluates what would require new
infrastructure and what the limits are (rate limits, costs, terms of use,
CORS).

**What is NOT studied/done**: nothing is implemented. No code file is
touched (`js/`, `css/`, `index.html`, `service-worker.js`,
`firestore.rules`, `cloudflare/`, `config`). This document cites real paths
and lines of the current state only as evidence.

**Methodology**:

1. **Primary TMDB sources** (consulted 2026-08-10):
   - Official v3 API documentation: `developer.themoviedb.org`
     (`llms.txt` index, «Getting Started», «FAQ», «Rate Limiting»,
     «Append To Response», and the OpenAPI v3 catalog with the 21
     endpoint sections/tags).
   - API terms of use: `themoviedb.org/documentation/api/terms-of-use`
     (version of 2023-10-20, read literally).
   - Logos and attribution page: `themoviedb.org/about/logos-attribution`.
2. **Courtesy empirical verification** (2026-08-10, no scraping): one `curl`
   request to `https://api.themoviedb.org/3/configuration` with an `Origin`
   header to confirm CORS (`access-control-allow-origin: *`) and the
   availability of the public endpoint. No other call was made and the
   app's key was not used.
3. **Cross-check with the app's real code**: inventory of the TMDB
   endpoints already used in `js/api-movies.js` (section 3), the existing
   caches (24 h memory and service worker `networkFirst`), the current TMDB
   consumption (~410 calls/day from the storage study baseline,
   ADR-073) and the attribution already present in the `index.html` footer.
4. **Section-by-section analysis** (section 4): for each of the ~21 API
   sections the main endpoints, the data they return and their potential
   usefulness are listed, with a feasibility classification on the current
   architecture (A/B categories of section 5).

**Study limitations**: a point-in-time snapshot of the API as of 2026-08-10.
TMDB can change endpoints, limits or terms without notice (as its own
documentation states); the cited fields are based on the official
documentation and on the real usage already verified in the app, not on a
field-by-field inventory of every response (that will be done in the
implementation issues of each phase). Load figures are estimates with the
assumptions of section 6.

---

## 3. Current app context (TMDB usage today)

The app is **100 % client**: Firebase Hosting, vanilla JS (ES modules), PWA
with service worker, data in Firestore
(`users/{uid}/movies|series|books|games`), no backend of its own except the
IGDB proxy (ADR-067). Movies and series use TMDB from the start (ADR-006
collections/sagas, ADR-007 service worker, ADR-021 daily refresh, ADR-056
search). All TMDB access lives in `js/api-movies.js`.

### 3.1 TMDB endpoints already used (9 distinct calls)

| Function | Endpoint | Frequency | Data extracted |
|---|---|---|---|
| `searchMovies` | `GET /3/search/movie` | search | `id`, `title`, `year`, `poster_path`, `overview` |
| `searchTv` | `GET /3/search/tv` | search | same for series |
| `getMovieDetails` | `GET /3/movie/{id}?append_to_response=credits,videos` | at registration | runtime, synopsis, genres, cast (5), director, date, rating, trailer, collection |
| `getTvExtraDetails` | `GET /3/tv/{id}?append_to_response=credits,videos` | at registration | episode runtime, synopsis, genres, cast (5), creators, status, `next_episode_to_air`, per-season dates |
| `getTvSeasonsMeta` | `GET /3/tv/{id}` | live | seasons (number, name, episodes, date) |
| `getSeasonEpisodes` | `GET /3/tv/{id}/season/{n}` | on demand | episodes (number, name, date, rating) |
| `getCollectionDetails` | `GET /3/collection/{id}` | on demand | saga parts (ADR-006) |
| `getWatchProviders` | `GET /3/movie|tv/{id}/watch/providers` | on demand | ES platforms (flatrate/rent/buy) |
| `getSimilarMovies`/`getSimilarTv` | `GET /3/movie|tv/{id}/similar` | on demand | similar content |

The key is sent as `api_key` in the query string from `js/config.js`
(`TMDB_API_KEY`), a pattern the official documentation supports for
non-commercial use and which is already exposed in the client by design (it
is not a real secret, same as the Google Books/Open Library keys).

### 3.2 Current caches and consumption

- **24 h in-memory cache** for watch providers and season episodes
  (`providersCache`/`getCached`, `js/api-movies.js:227-243`).
- **Service worker**: `networkFirst` for `api.themoviedb.org` and
  `cacheFirst` for `image.tmdb.org` (`service-worker.js:288` and `:307`).
- **Firestore snapshots**: at registration the enriched snapshot is
  persisted and the daily refresh (ADR-021) re-queries the APIs with a
  truthy-only policy.
- **Consumption**: storage study baseline (ADR-073): **~410 TMDB
  calls/day/user** with the full coverage of the daily refresh. On-demand
  calls (providers, similar, episodes) are few per visit thanks to the 24 h
  cache.
- **Attribution**: already present in the `index.html:222` footer
  («Esta aplicación usa la API de TMDB pero no está respaldada ni certificada
  por TMDB» [This application uses the TMDB API but is not endorsed or
  certified by TMDB]), fulfilling TMDB's attribution requirement.

### 3.3 What «building an IMDB/TMDB» implies on top of this

Today the card detail already shows a subset of the TMDB information (basic
data + cast of 5 + director + trailer + platforms + similar). The issue's
idea is to **expand the queryable information** toward what IMDB/TMDB
offers: people biographies and filmographies, complete technical data,
galleries, editorial lists, advanced exploration, etc. Section 4 catalogs
**everything** TMDB can provide; section 5 evaluates where it fits in the
current architecture.

---

## 4. Catalog of TMDB information by sections

Source: official OpenAPI of the v3 API (~21 endpoint sections) +
documentation of each endpoint. For each section: **endpoints**, **main
data** and **usefulness for an IMDB/TMDB-type web app**. Endpoints already
used by the app are marked with 🟢; partially used ones with 🟡.

### 4.1 Movies — card detail and extended data

**Endpoints**: `GET /3/movie/{id}` 🟡 (already used without the full
`append_to_response`).

**Data**: besides what is already used (title, synopsis, runtime, genres,
date, rating, collection), the full detail includes: `budget`,
`revenue`, `homepage`, `imdb_id`, `original_title`, `original_language`,
`tagline`, `status` (rumored/in production/released), `adult`, `popularity`,
`production_companies` (with logo), `production_countries`,
`spoken_languages`, `belongs_to_collection`.

**Usefulness**: IMDb-style movie technical sheet (financial data, production
companies, languages, tagline, status). With `append_to_response`, dozens of
sub-endpoints can be combined (credits, videos, images, keywords,
recommendations, similar, external IDs, translations, release dates,
watch providers…) in **a single HTTP call** (see section 4.21), which makes
«enriching the card detail» cheap in calls.

### 4.2 Series, seasons and episodes

**Endpoints**: `GET /3/tv/{id}` 🟡 (partial), `tv/{id}/season/{n}` 🟡
(partial), `tv/{id}/season/{n}/episode/{m}`, `tv/{id}/aggregate_credits`,
`tv/{id}/content_ratings`, `tv/{id}/episode_groups`, `tv/{id}/screened_theatrically`,
`tv/{id}/external_ids`, and per-season and per-episode sub-endpoints
(`credits`, `videos`, `images`, `translations`, `external_ids`,
`watch/providers`). (The `networks` field with the channels comes inside the
`tv/{id}` detail itself.)

**Data**: `number_of_seasons`, `number_of_episodes`, `networks`,
`origin_country`, `last_episode_to_air`, `status`, `episode_run_time`,
`created_by`, `next_episode_to_air` (already used). Per episode: name,
number, air date, rating, still (frame), guests, crew. Additionally: cast
**aggregated by character** (`aggregate_credits`, key for long series),
per-country certifications (`content_ratings`), alternative episode groups
(`episode_groups`, e.g. "watch order" Star Wars-style), and whether the
series premiered theatrically (`screened_theatrically`).

**Usefulness**: complete IMDb-style series card (network, country, number of
seasons/episodes), **individual episode** detail with frame and guest cast,
«correct watch order» (episode groups), recommended age by country
(certifications) and theatrical premiere detection.

### 4.3 People (actors, directors, writers…)

**Endpoints**: `GET /3/person/{id}`, `person/popular`, `person/{id}/translations`,
`person/{id}/tagged_images`, `person/{id}/external_ids`, `person/changes`,
`person/{id}/images`, `person/{id}/movie_credits`, `person/{id}/tv_credits`,
`person/{id}/combined_credits`.

**Data**: `birthday`, `deathday`, `place_of_birth`, `biography`,
`known_for_department` (Acting/Directing/Writing…), `also_known_as`,
`popularity`, `profile_path` (photo), gender (1/2), `imdb_id` and social
networks (external IDs). `combined_credits` returns the **entire
filmography** (movies + series) with character/job per work.

**Usefulness**: **IMDb-style actor/director page**: photo, biography, public
personal data, complete clickable filmography and "known for" (most popular
works). It is the piece that brings the web app closest to an "own IMDB" and
is 100 % navigable from the credits already shown in the card detail (only
the `person_id` needs linking, which already arrives in `credits`).

### 4.4 Credits and cast (person ↔ work graph)

**Endpoints**: `GET /3/movie/{id}/credits` 🟢 (via append), `tv/{id}/credits`,
`tv/{id}/season/{n}/credits`, `tv/{id}/season/{n}/episode/{m}/credits`,
`tv/{id}/aggregate_credits`, `person/{id}/combined_credits`,
`person/{id}/movie_credits`, `person/{id}/tv_credits`, `credit/{id}`.

**Data**: cast with `character`, `order`, `cast_id`, `credit_id` and
`profile_path` per person; crew with `job` (Director, Producer, Writer,
Composer…); per-season/per-episode credits; individual credit
(`credit/{id}`) linking work+person+jobs.

**Usefulness**: bidirectional navigation «see more from this
actor/director», full cast expandable (today the card detail shows only 5),
billing order, and the collaboration graph (actor ↔ director ↔ work) which
is the basis of IMDB navigation.

### 4.5 Search

**Endpoints**: `GET /3/search/movie` 🟢, `search/tv` 🟢, `search/person`,
`search/multi` (movies+series+people in a single call),
`search/collection`, `search/company`, `search/keyword`. Parameters:
`query`, `language`, `region`, `year`, `include_adult`, `page`.

**Data**: paginated results (`page`, `total_pages`, `total_results`) with
the card fields of each type (id, title, year, poster, synopsis, rating,
`profile_path` for people).

**Usefulness**: global multi-type search (one call to see movies, series
**and people** matching the search — today the app's search only looks up
movies and series separately), and search of sagas, studios and keywords
(for autocomplete/disambiguation).

### 4.6 Discover (advanced exploration)

**Endpoints**: `GET /3/discover/movie`, `discover/tv`.

**Data**: paginated lists of movies/series filtered by **30+ combinable
criteria**: `with_genres`, `with_people`, `with_watch_providers`,
`with_companies`, `with_keywords`, `vote_average.gte/lte`, `vote_count.gte`,
`release_date.gte/lte`, `first_air_date.*`, `with_original_language`,
`with_runtime.gte/lte`, `region`, `sort_by` (popularity, revenue,
vote_average, release_date…), `certification`, `with_networks`,
`with_origin_country`.

**Data**: same as search (paginated cards).

**Usefulness**: the equivalent of IMDb's **Advanced Search**: «Spanish
horror movies from the 80s sorted by rating», «HBO series rated > 8»,
«Christopher Nolan movies streaming free (flatrate)». All the filtering is
done by TMDB: the app only paints results. Combinable with
`with_watch_providers` to filter by platform (Netflix/Prime…).

### 4.7 Trending and editorial lists

**Endpoints**: `GET /3/trending/all|movie|tv|person/{day|week}`,
`movie/now_playing`, `movie/popular`, `movie/top_rated`, `movie/upcoming`,
`tv/popular`, `tv/top_rated`, `tv/airing_today`, `tv/on_the_air`.

**Data**: curated lists automatically updated by TMDB (daily/weekly trends
by type, now playing in theaters, popular, top rated, upcoming releases,
airing today/on the air), with the card fields.

**Usefulness**: «Trending», «Most watched», «Top rated», «Upcoming releases»
and «On the air» sections **with zero custom logic** (no aggregation, no
ranking): one call per section. `trending/person` also gives the rising
actors.

### 4.8 Collections and sagas

**Endpoints**: `GET /3/collection/{id}` 🟢 (already used),
`collection/{id}/images`, `collection/{id}/translations`.

**Data**: name, synopsis, poster, backdrops and **all the parts** of the
saga sorted chronologically (already used for «Add rest of the saga»,
ADR-006). `images` adds the saga gallery; `translations` the translated
titles.

**Usefulness**: expanding the current saga card with an image gallery,
collection synopsis and navigation through the parts (the skeleton already
exists).

### 4.9 Genres and keywords

**Endpoints**: `GET /3/genre/movie/list`, `genre/tv/list`, `keyword/{id}`,
`keyword/{id}/movies`, `movie/{id}/keywords`, `tv/{id}/keywords`.

**Data**: genre lists per type (id+name, localizable via `language`),
keywords (themes/subjects) per title —e.g. "time travel", "based on novel"—
and movies associated with a keyword.

**Usefulness**: genre navigation (chips/selectors), genre page ("all
science fiction movies"), and «related themes» in the card detail — the
equivalent of IMDb's keywords. Keywords also feed Discover
(`with_keywords`).

### 4.10 Companies and networks

**Endpoints**: `GET /3/company/{id}`, `company/{id}/images`,
`company/{id}/alternative_names`, `network/{id}`, `network/{id}/images`,
`network/{id}/alternative_names`. (A production company's filmography has no
dedicated endpoint: it is obtained via `discover/movie?with_companies={id}`,
section 4.6.)

**Data**: production companies/studios (name, logo, headquarters,
description, produced movies) and TV networks (Netflix, HBO, AMC… with
their catalog).

**Usefulness**: «Movies from this studio» (Marvel, A24, Studio Ghibli…)
and «Series from this network» — thematic navigation by origin, clickable
from the card detail's `production_companies`/`networks`.

### 4.11 Watch providers (where to watch)

**Endpoints**: `GET /3/movie|tv/{id}/watch/providers` 🟢 (ES),
`watch/providers/movie|tv` (global platform index), `watch/providers/regions`.

**Data**: per title and country: `flatrate` (streaming included), `rent`,
`buy` with name, logo and `display_priority`; plus the justwatch `link`.
The global index lists all platforms by country.

**Usefulness**: expanding the current «where to watch» with navigation by
platform («everything on Prime» via Discover `with_watch_providers`),
country selector (today fixed to ES) and platform logos in the card detail.

### 4.12 Images

**Endpoints**: `GET /3/movie|tv|person|collection/{id}/images` (+ season,
episode), CDN `image.tmdb.org` 🟢 (posters) with sizes from
`configuration`.

**Data**: posters, backdrops, logos and stills, each with `aspect_ratio`,
`language` and `file_path` per size (w92 → w500 → original).

**Usefulness**: image galleries in the card detail, backdrops for section
headers, people portraits and episode frames. The CDN is **not subject to
the rate limit** and allows aggressive caching (`cacheFirst` already in the
SW) — it is the cheapest resource to expand.

### 4.13 Videos

**Endpoints**: `GET /3/movie|tv/{id}/videos` 🟢 (trailer via append),
`tv/{id}/season/{n}/videos`, `tv/{id}/season/{n}/episode/{m}/videos`.

**Data**: video list with `site` (YouTube/Vimeo), `type` (Trailer, Teaser,
Featurette, Behind the Scenes, Bloopers, Opening Credits…), `name`,
`key`, `official`, `size` and `published_at`.

**Usefulness**: video gallery beyond the main trailer already used (teasers,
making-of, bloopers), videos per season and per episode. Cost: 1 call per
card detail with `append_to_response`.

### 4.14 Translations and languages

**Endpoints**: `GET /3/movie|tv|person|collection/{id}/translations`,
`tv/{id}/season/{n}/translations`, `tv/{id}/season/{n}/episode/{m}/translations`.

**Data**: titles, synopses and data localized into dozens of languages
(the app works pinned to `es-ES` today).

**Usefulness**: future multilanguage support of the card detail and of the
searches («see the original title vs. the Spanish one»), and per-item
language selection for users who consume content in other languages.

### 4.15 External IDs and external integration

**Endpoints**: `GET /3/movie|tv|person/{id}/external_ids` (+ season,
episode), `find/{external_id}?external_source=imdb_id|tvdb_id|freebase_mid|freebase_id|tvrage_id|wikidata_id|facebook_id|instagram_id|twitter_id`.

**Data**: `imdb_id`, `tvdb_id`, `wikidata_id`, social network IDs; and the
reverse resolution (given an external ID, obtain the TMDB id).

**Usefulness**: **deep links to IMDb/Wikipedia** from the card detail («see
on IMDb»), importing a title by pasting its IMDb id (reverse search), and
linking actors' social networks. It is the piece that connects the web app
with the IMDb ecosystem.

### 4.16 Reviews and user lists

**Endpoints**: `GET /3/movie/{id}/reviews`, `tv/{id}/reviews`, `review/{id}`,
`list/{id}`, `movie|tv/{id}/lists`.

**Data**: TMDB user reviews (author, content, rating) and public lists
curated by users.

**Usefulness**: **marginal value**: the app already has its own rating and
community list systems (rating and own-list ADRs); TMDB's UGC in Spanish is
scarce and adds no differential value. Only `list/{id}` could be
interesting as "curated lists of the TMDB community", but it adds navigation
complexity for little value. It is recommended not to include it in the
scope.

### 4.17 Changes / changelog

**Endpoints**: `GET /3/movie|tv|person/changes` (with
`start_date`/`end_date`), `movie|tv|person/{id}/changes`.

**Data**: per-title change log (date and change type) for incremental
synchronization.

**Usefulness**: future for the daily refresh (ADR-021): instead of
re-querying everything, query only what changed. Today the snapshot with the
truthy-only policy already covers the use case; documented as a **future
note**, not a current need.

### 4.18 API configuration

**Endpoints**: `GET /3/configuration` (verified with curl, HTTP 200 with
key), `configuration/countries`, `configuration/jobs`, `configuration/timezones`,
`configuration/languages`, `configuration/primary_translations`.

**Data**: image CDN base URLs and available sizes; country lists (code,
English, Spanish), crew jobs (Director, Producer…), time zones, supported
languages and primary translations.

**Usefulness**: **removing hardcoded sizes** (`w342`, `w185`, `w92` in
`js/api-movies.js`) by querying the configuration dynamically, feeding
country/language selectors, and translating crew jobs to Spanish. Cost: 1
call cacheable for months (it is a static endpoint).

### 4.19 Authentication and accounts (v3 and v4)

**Endpoints**: v3: `authentication/guest_session/new`,
`authentication/token/new`, `authentication/session/new`,
`account/{account_id}`, `account/{account_id}/rated|favorite|watchlist`,
`account/{account_id}/lists`;
v4: `4/auth/request_token`, `4/auth/access_token`, `4/account`,
`4/list`, `4/list/{id}` (create/edit own lists).

**Data**: guest sessions, user sessions, a TMDB account's ratings/favorites/
watchlists, and own lists (v4).

**Usefulness**: **not recommended**. The app has its own rating, lists,
favorites and watchlist system (own social features with Firestore).
Integrating TMDB accounts would add OAuth, session management and concept
duplication with no differential value. The only potentially attractive
exception is `4/list` (own lists), but it requires full OAuth
authentication — rejected on cost/benefit.

### 4.20 API v3 vs v4

**v3**: authentication by `api_key` in query string (the one used today);
free non-commercial access; CORS enabled; the whole information catalog.

**v4**: authentication by **Access Token** (`Authorization: Bearer`) —
mandatory for account operations (lists, favorites, ratings) and
recommended by TMDB for new integrations; same data catalog; CORS also
enabled.

**Decision for the web app**: **keep v3**. In a public client the key is
already visible by design (it is not a secret), so v4 adds no real security
for reading and forces managing an additional token with no functional
benefit. v4 would only be worth it for the lists/accounts (section 4.19),
which are rejected. There are no v4-exclusive data endpoints the web app
needs.

### 4.21 `append_to_response`: combining calls

Although it is not a data "section", it is the **most important lever** for
the issue's goal: `movie`, `tv`, `season`, `episode` and `person` accept
`append_to_response` with a comma-separated list (up to dozens of
sub-endpoints: `credits,videos,images,keywords,reviews,external_ids,
release_dates,watch/providers,translations,similar,recommendations,
content_ratings,aggregate_credits…`), so that **a single HTTP call returns
the whole enriched card detail**. The app already uses this mechanism
(`getMovieDetails`/`getTvExtraDetails`). Implication: enriching the
IMDB-type card detail costs **1 call per opening** (with cache), not N
calls.

---

## 5. Technical feasibility on the current architecture

Classification in two categories according to the resources each section of
the catalog would require on the current web app (100 % client, no backend,
service worker):

### Category A — Feasible today in the client (CORS + public GET + `api_key`)

**All the information of sections 4.1-4.18 and 4.21 falls into this
category** — practically the entire API. Verified reasons:

1. **CORS enabled** for all origins (verified empirically with `curl` to
   `api.themoviedb.org` on 2026-08-10: `access-control-allow-origin: *`).
   The browser can query TMDB directly, as it already does today.
2. **Authentication by `api_key` in query string** (v3): supported by the
   official documentation for non-commercial use; the key is already in the
   client (`js/config.js`) and exposed by design (same as Google
   Books/Open Library). In a public client it is not a secret; TMDB
   ratifies its v3 scheme precisely for this type of integration.
3. **Existing consumption patterns**: 24 h in-memory cache
   (`providersCache`), `networkFirst` for the API and `cacheFirst` for the
   image CDN in the service worker, Firestore snapshots with daily refresh
   (ADR-021). Expanding sections = adding functions in `js/api-movies.js`
   following these patterns; there is no architectural change.
4. **Marginal call cost**: with `append_to_response` (4.21), an
   IMDB-type enriched card detail costs **1 call**; editorial lists and
   discover, 1 call per section; images and videos go through the CDN with
   no rate limit. On top of the ADR-073 baseline of ~410 TMDB calls/day, a
   typical phase adds on the order of 1-5 calls per card opening, amortized
   by the existing caches.

### Category B — Requires new infrastructure (proxy or backend)

Only two scenarios would need it, **neither urgent today**:

1. **User scaling**: the rate limit (~40 req/s, section 6.1) is **per key**,
   not per IP: all app users share the same key and the cap is hit jointly.
   With few users and cache, there is no risk (current consumption is ~410
   calls/day ≈ 0.005 req/s on average, orders of magnitude below the cap).
   If the web app grew to dozens of simultaneous active users, the way
   would be the **Cloudflare Worker proxy pattern already proven with
   IGDB** (ADR-067): server-side cache, request aggregation and key
   hiding — without changing the app's architecture.
2. **TMDB account features** (4.19): OAuth and session management require a
   backend (the v4 token flow requires storing credentials). **Rejected**
   for adding no value over the app's own system.

**Feasibility conclusion**: **the issue's idea is feasible** on the current
architecture for practically all TMDB information, with **zero**
infrastructure cost, as long as the current consumption model is respected
(low volume + cache + on demand). The proxy would only be a later scaling
phase, and the pattern is already proven.

---

## 6. Limits: rate limits, costs and terms of use

### 6.1 Rate limits (official documentation, consulted 2026-08-10)

- The legacy limit of **40 requests/10 s was disabled on 2019-12-16**.
- There is a **soft upper limit of ~40 requests/second per key** to
  mitigate massive scraping. **It can change at any time** without notice
  (official statement).
- On a `429`, the documentation asks to **respect it** (stop requesting);
  the app must treat `429` as a back-off case and serve cache. TMDB offers
  no SLA (official FAQ); its status is published at
  `status.themoviedb.org`.
- Design implication: consumption must be **low volume + cache + on
  demand**, exactly the current model. No massive per-user aggregation
  (e.g. re-querying the full card detail of every item on every visit) —
  Firestore snapshots already exist for that.

### 6.2 Costs

- **Free for non-commercial use** with attribution (official FAQ). The app
  is personal/non-commercial → cost 0 €.
- **Commercial use requires a written agreement** with TMDB (fees). If the
  web app ever monetized, it would have to migrate to the commercial API
  (not the case).
- **Forbidden** (terms of use, section 1.C): training ML/AI models with the
  data, using them for chatbots/LLMs, aggregating them for resale, using
  them as hosting for advertising images, or making API derivatives.

### 6.3 Terms of use (text read at `themoviedb.org/documentation/api/terms-of-use`, version 2023-10-20)

- **Mandatory attribution**: approved TMDB logo + notice «This product
  uses the TMDB API but is not endorsed or certified by TMDB» **in the
  About/Credits section of the application**. The app already complies
  (footer of `index.html:222`, with the textual notice in Spanish). For new
  sections showing TMDB data nothing more would be needed, but it would be
  advisable to add the **approved logo** to the settings/about page if usage
  is expanded.
- **Maximum 6-month cache** of API data: the Firestore snapshots
  (ADR-021/073) are the coherent mechanism; the daily refresh renews within
  the margin. Do not cache API data in the service worker for more than 6
  months (the **CDN images are not subject to this limit** — the
  documentation only limits "information", and the CDN is used with
  `cacheFirst`).
- **Unilateral suspension**: TMDB can change, suspend or discontinue any
  aspect of the API at any time. Risk mitigated by the local snapshots (the
  app keeps the data even if TMDB goes down).

### 6.4 Load estimate per proposed phase

On the baseline of ~410 TMDB calls/day/user (ADR-073), each phase adds calls
**only when the user opens the feature** (nothing in the daily refresh):

| Phase | Typical additional call | Estimate per active user |
|---|---|---|
| P1 People/filmography | `person/{id}` + `combined_credits` (1-2 per person opening) | +5-15/day |
| P2 Discover/trending | 1 call per visited section | +3-10/day |
| P3 Images/videos/certifications | CDN (no rate limit) + 1 `append_to_response` | +1-3/day |
| P4 External IDs/configuration | 1 long-cacheable call | +0-2/day |

Estimated total **+10-30 calls/day** under intensive use (≈ +2-7 % over the
baseline), well below any limit and amortizable by the caches.

---

## 7. Evaluated alternatives

1. **Keep the status quo** (only 9 endpoints, basic card detail): does not
   satisfy the issue's idea; rejected for not delivering the requested IMDB
   value.
2. **Mandatory proxy/backend from the start**: oversized; all the category A
   information works today in the client with no infrastructure. Rejected
   except as a scaling phase (ADR-067 pattern).
3. **Migrate to API v4 with Access Token**: brings no new data for the web
   app, forces managing a token with no benefit in a public client (4.20).
   Rejected; v3 is kept.
4. **Integrate TMDB accounts/lists/reviews** (4.16, 4.19): duplicates the
   app's own rating/list system and requires OAuth. Rejected on
   cost/benefit.
5. **Phased expansion in the client (chosen option)**: leverage the
   existing patterns to enrich the web app incrementally, with caches and
   low volume as the guarantee against the limits.

---

## 8. Final recommendation (scope for future issues)

**Yes, it is viable to build a "kind of IMDB/TMDB" inside the web app**
without architectural changes: TMDB offers all the necessary information and
the app can consume it from the client with its current model. To avoid
oversizing, a **phased scope** is recommended, each phase as a separate
implementation issue (ordered by value/effort):

- **Phase 1 — People and filmography** (sections 4.3, 4.4): actor/director
  page (biography, photo, personal data) and complete filmography navigable
  from the card detail's credits. Maximum visual impact toward an "own
  IMDB", minimum cost (1-2 calls per opening, person_id already available).
  Linked with the `cast` already shown.
- **Phase 2 — Discovery** (4.6, 4.7): Trending/Upcoming/Popular/Top Rated
  sections and advanced exploration with Discover (genre, year, platform,
  rating). Zero custom ranking logic.
- **Phase 3 — Card richness** (4.2, 4.12, 4.13): image galleries,
  additional videos, per-country certifications and release dates by
  country; individual episode detail with frame and guest cast.
- **Phase 4 — External integration** (4.15, 4.18): «see on IMDb/Wikipedia»,
  import by external ID with `find`, and dynamic configuration (image sizes
  and crew job translations).
- **Out of scope** (documented to avoid re-evaluating it): TMDB reviews and
  user lists (4.16), authentication/accounts (4.19), v4 (4.20),
  changes/changelog (4.17 — only a future note for the ADR-021 refresh).

Each phase must respect the project rules (user manual, themes,
responsiveness) when it touches the UI, and the conditions of section 6
(attribution, cache ≤ 6 months, low volume + cache).

---

## 9. References and sources

Consulted on 2026-08-10:

- Official v3 API documentation (index, Getting Started, FAQ, Rate
  Limiting, Append To Response): https://developer.themoviedb.org/docs
- OpenAPI catalog of the v3 API (endpoint sections): https://developer.themoviedb.org/openapi/tmdb-api.json
- API terms of use (v. 2023-10-20): https://www.themoviedb.org/documentation/api/terms-of-use
- FAQ (SLA, costs, attribution): https://developer.themoviedb.org/docs/faq
- Logos and attribution: https://www.themoviedb.org/about/logos-attribution
- Service status: https://status.themoviedb.org
- Real app code: `js/api-movies.js`, `js/config.js`,
  `service-worker.js`, `index.html` (lines cited in the text).
- Previous in-house studies (format and load baseline): ADR-065
  (GoodReads scraper), ADR-067 (video game APIs), ADR-073 (minimum
  storage study, ~410 TMDB calls/day).

---

## Annex A. Summary endpoint table

| Endpoint | Method | Section | Used today? | IMDB-type value | Category |
|---|---|---|---|---|---|
| `/3/movie/{id}` | GET | 4.1 | 🟡 | Full technical sheet | A |
| `/3/tv/{id}` | GET | 4.2 | 🟡 | Complete series detail | A |
| `/3/tv/{id}/season/{n}` | GET | 4.2 | 🟡 | Season and episodes | A |
| `/3/tv/{id}/season/{n}/episode/{m}` | GET | 4.2 | no | Episode detail | A |
| `/3/tv/{id}/aggregate_credits` | GET | 4.2/4.4 | no | Cast by character | A |
| `/3/tv/{id}/content_ratings` | GET | 4.2 | no | Recommended age by country | A |
| `/3/tv/{id}/episode_groups` | GET | 4.2 | no | Watch order | A |
| `/3/person/{id}` | GET | 4.3 | no | Person biography | A |
| `/3/person/popular` | GET | 4.3/4.7 | no | Popular actors | A |
| `/3/person/{id}/combined_credits` | GET | 4.3/4.4 | no | Complete filmography | A |
| `/3/movie|tv/{id}/credits` | GET | 4.4 | 🟢 (append) | Full cast and crew | A |
| `/3/movie|tv/{id}/similar` | GET | 4.4 | 🟢 | Similar content | A |
| `/3/search/movie` | GET | 4.5 | 🟢 | Movie search | A |
| `/3/search/tv` | GET | 4.5 | 🟢 | Series search | A |
| `/3/search/person` | GET | 4.5 | no | People search | A |
| `/3/search/multi` | GET | 4.5 | no | Unified search | A |
| `/3/discover/movie` | GET | 4.6 | no | Advanced exploration | A |
| `/3/discover/tv` | GET | 4.6 | no | Advanced exploration | A |
| `/3/trending/{all\|movie\|tv\|person}/{day\|week}` | GET | 4.7 | no | Trending | A |
| `/3/movie/{now_playing\|popular\|top_rated\|upcoming}` | GET | 4.7 | no | Editorial lists | A |
| `/3/tv/{popular\|top_rated\|airing_today\|on_the_air}` | GET | 4.7 | no | Editorial lists | A |
| `/3/collection/{id}` | GET | 4.8 | 🟢 | Complete sagas | A |
| `/3/genre/movie\|tv/list` | GET | 4.9 | no | Genres | A |
| `/3/movie\|tv/{id}/keywords` | GET | 4.9 | no | Work themes | A |
| `/3/company/{id}` | GET | 4.10 | no | Production companies (filmography via `discover?with_companies`) | A |
| `/3/network/{id}` | GET | 4.10 | no | Networks and catalog | A |
| `/3/movie\|tv/{id}/watch/providers` | GET | 4.11 | 🟢 | Where to watch (ES) | A |
| `/3/watch/providers/movie\|tv` | GET | 4.11 | no | Platform index | A |
| `/3/movie\|tv\|person/{id}/images` | GET | 4.12 | no | Galleries | A |
| `/3/movie\|tv/{id}/videos` | GET | 4.13 | 🟢 (append) | Trailers and extras | A |
| `/3/movie\|tv\|person/{id}/translations` | GET | 4.14 | no | Multilanguage | A |
| `/3/movie\|tv\|person/{id}/external_ids` | GET | 4.15 | no | External deep links | A |
| `/3/find/{external_id}` | GET | 4.15 | no | Import by external ID | A |
| `/3/movie\|tv/{id}/reviews` | GET | 4.16 | no | TMDB reviews | A (low value) |
| `/3/list/{id}` | GET | 4.16 | no | Curated lists | A (low value) |
| `/3/movie\|tv\|person/changes` | GET | 4.17 | no | Changelog (future) | A (note) |
| `/3/configuration` (+ countries/jobs/tz/languages) | GET | 4.18 | no | Dynamic data | A |
| `/3/authentication/*`, `/3/account/*` | GET | 4.19 | no | TMDB accounts | B (rejected) |
| `/4/account`, `/4/list` | GET/POST | 4.19 | no | v4 accounts/lists | B (rejected) |

Legend: 🟢 already used by the app · 🟡 partially used · A = feasible in the
client today · B = requires infrastructure (rejected on cost/benefit).

