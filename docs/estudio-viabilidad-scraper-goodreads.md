# Feasibility study: replacing Google Books / Open Library with a GoodReads scraper (issue #50)

## Date

2026-08-09

## Issue

#50 — «Realizar un estudio para comprobar si sería factible sustituir el uso de
la API de Google Books u OpenLibrary por un scraper de la web GoodReads. Este
scraper debe cumplir todos los términos y condiciones de GoodReads y respetar
las reglas indicadas en el archivo robots.txt. Así como no sobrecargar los
servidores objetivos.» [Carry out a study to check whether it would be feasible
to replace the use of the Google Books or OpenLibrary API with a scraper of the
GoodReads website. This scraper must comply with all GoodReads terms and
conditions and respect the rules stated in the robots.txt file, as well as not
overload the target servers.] —
https://github.com/gonzalitojh/personal-tracker/issues/50

## Status

Research study finished. No implementation: this document contributes no code
to the application.

---

## 1. Executive summary

**Verdict: NOT feasible** to replace Google Books / Open Library with a
GoodReads scraper in this application, neither as primary source nor as
fallback, under the conditions in which the app is built today (100 %
client-side static web app, no backend of its own, deployed on Firebase
Hosting).

The evidence gathered on 2026-08-09 points in four mutually reinforcing
directions:

1. **Legal and contractual (blocking)**: GoodReads' Terms of Use (reviewed
   2021-04-28) expressly prohibit «any use of data mining, robots, or similar
   data gathering and extraction tools» (section 1), and `robots.txt`
   **prohibits `/search`**, which is precisely the main use case of the app's
   search. Although the *hiQ v. LinkedIn* precedent (9th Circuit, 2022) made
   clear that the CFAA does not shield operators from scraping of public
   data, the same case demonstrated that **breaching the terms of service
   does give rise to a breach-of-contract lawsuit** (and settlements with
   damages): that is exactly what a GoodReads scraper would do.

2. **Technical (blocking on the current architecture)**: GoodReads does not
   allow access from the client browser: the real responses **include no CORS
   header** (`Access-Control-Allow-Origin` absent, verified with curl), the
   `/search` route is protected by an **AWS WAF challenge** that returns
   `HTTP 202` with an empty body to clients that do not run its JavaScript
   (verified with curl and by several independent sources in 2026), and the
   content is rendered with React/JS, so a **server with a headless browser**
   (Playwright/Puppeteer) and an IP with good reputation would be needed. The
   app has no backend of its own and Firebase Cloud Functions would use
   shared data-center IP ranges, with a real risk of blocking.

3. **Load and reliability**: a scraper would multiply requests per query by
   ~3-5× (WAF challenge of 2-4 exchanges + 1 GET to /search; section 6.2)
   and the flow of adding 5 books from a search by ~8-15× (from ~1 to ≈8-15
   requests) versus the current path (one HTTP request per query to Google
   Books), and would require courtesy measures of 3-8 s between requests;
   moreover, GoodReads' HTML changes without notice (React with obfuscated
   classes; the community's reference scraper,
   `maria-antoniak/goodreads-scraper`, is abandoned and does not work).
   Maintenance would be continuous and the risk of IP blocking, real.

4. **Marginal value**: every field the app uses (title, author, year, pages,
   multiple covers, synopsis) is already provided by Google Books (primary)
   and Open Library (fallback + synopsis on demand). GoodReads would only add
   community ratings and reviews, fields the app does not use nor has
   requested.

The recommended alternative is to **keep the status quo** (Google Books + Open
Library), which is free, works from the browser, has CORS enabled and requires
no infrastructure (section 8).

---

## 2. Scope and methodology

**Nature of the study**: this document is a feasibility investigation, not an
implementation. No scraper code has been written nor will be written in the
context of this issue. Furthermore, **this is not legal advice**: the
analysis in section 4 summarizes public documents and court precedents to
inform the project's decision; before any real use of the data, consulting a
legal professional competent in the applicable jurisdiction would be
advisable.

**Methodology**:

1. **Point-in-time snapshot**: all evidence was collected on **2026-08-09**.
   URLs, consultation dates and verifications of each source are in section 9
   (References and sources). This study describes the state of things on that
   date; GoodReads and third-party APIs may change afterwards.
2. **Live primary sources** (2026-08-09):
   - `https://www.goodreads.com/robots.txt` — read literally.
   - `https://www.goodreads.com/about/terms` — Terms of Use, read literally
     (section 4.1 with quotes).
   - `https://www.goodreads.com/about/privacy` — Privacy Policy
     (section 4.2).
   - Courtesy HTTP requests with `curl` to `goodreads.com` to verify CORS
     and anti-bot (sections 5.1 and 5.2, with verbatim evidence in the annex
     and section 9). Only a few spaced requests were made; none was mass
     scraping.
3. **Documentary research** (websearch): 2026 state of the official GoodReads
   API, legal scraping precedents (hiQ v. LinkedIn), stability of GoodReads'
   HTML for scraping, and alternative book metadata APIs active in 2026.
4. **Cross-check with the app's code**: `js/api-books.js`,
   `js/config.js` (the Google Books key is not transcribed in any document
   or commit), `js/global-search.js` (external cache) and ADR-002,
   ADR-045 and ADR-056 were read to describe the current data contract
   precisely (section 3).

**Limitations** (detailed in section 9): traffic volume (users × searches)
cannot be measured from this environment and every figure about it is an
**estimate** marked as such; the state of the Google Books API quotas comes
from third-party sources, not verified in this study; and third-party
experiences with GoodReads' anti-bot are documentary (other people's
ingests between 2024 and 2026), not own tests at scale.

---

## 3. Current app context

### 3.1 Architecture

The app is a **100 % client-side static web app**: vanilla JavaScript, data in
Firestore, hosted on Firebase Hosting, with no backend or proxy of its own.
All third-party API consumption happens from the user's browser via
`fetch()`. Any new data source must be able to answer real CORS requests from
a foreign origin (Firebase Hosting domain) or would require introducing
infrastructure (the app has none; see section 5.4).

### 3.2 Book search today (`js/api-books.js`)

Flow documented in ADR-002 (book search with Google Books), ADR-045
(search unification) and ADR-056 (re-search and cover fallback):

1. **Google Books API is the primary source**
   (`https://www.googleapis.com/books/v1/volumes`, with `langRestrict=es` and
   the key from `js/config.js`): `searchGoogleBooksResults()` requests 20
   volumes per page and **groups by work** (normalized title+author) in
   `groupBooksByWork()`, merging covers (`allCovers[]`) and synopses
   (`allDescriptions[]`) of all editions and counting `editionsCount`.
   The 503 fallback uses `fetchWithRetry()` (2 retries).
2. **Open Library is the fallback**
   (`https://openlibrary.org/search.json`, `lang=es`):
   `searchOpenLibrary()` returns one result per work with its cover, and
   `getOpenLibraryDescription()` requests the synopsis **on demand** (only
   when adding the book, not during the search).
3. **Unified entry point**: `searchBooks()` tries Google Books and only if it
   fails or finds nothing tries Open Library. Since ADR-045, `searchExternal()`
   in `js/search.js` always calls with `spanishOnly = true` and the dropdown
   trims to 5 results per group.
4. **Cache**: `json/global-search.js` keeps `externalCache[group] =
   { query, items, source }` in memory **only while the dropdown is open**;
   it is invalidated on close (`closeGlobalSearch()`). There is no persistent
   cache: every new search implies real API calls (identified in ADR-045 as
   an accepted cost).

### 3.3 Fields the app uses from a book

| Field | Where it comes from today | Use in the app |
|---|---|---|
| **Title** (+ subtitle) | `volumeInfo.title/subtitle` (GB), `title` (OL) | Lists, card detail, grouping by title |
| **Author(s)** | `volumeInfo.authors[]` (GB), `author_name[]` (OL) | Lists, card detail, grouping by title+author, search by author |
| **Year** | `publishedDate` → first 4 digits (GB), `first_publish_year` (OL) | Card and card detail metadata |
| **Pages** | `volumeInfo.pageCount` (GB); OL does not provide it (`null`) | Book card detail |
| **Cover(s)** | `volumeInfo.imageLinks.thumbnail` per edition → `allCovers[]` (GB); `cover_i` → OL cover service URL | Card, card detail, cover picker when adding (ADR-002) |
| **Synopsis** | `volumeInfo.description` → `allDescriptions[]` (GB); `getOpenLibraryDescription()` on demand (OL) | Card detail, synopsis picker when adding (ADR-002) |
| **External id** | GB `id` / OL `key` (work) | «Already added» detection by `externalId` |

GoodReads would have to cover **exactly these six fields** (title, author,
year, pages, covers, synopsis) to replace the current sources, with the
caveat that the app values being able to offer **several covers and several
synopses per work** (edition group) and **Spanish language filtering**
(`langRestrict=es` in GB; `lang=es` + edition language check in OL).
---

## 4. Legal and compliance analysis

### 4.1 GoodReads Terms of Use (ToS)

Source: `https://www.goodreads.com/about/terms`, consulted 2026-08-09.
The document itself states that «This Agreement was last revised on April 28,
2021». GoodReads is an Amazon subsidiary («Goodreads LLC ... is a
subsidiary of Amazon.com, Inc.», according to its Privacy Policy, section
4.2). The ToS incorporate by reference GoodReads' Privacy Policy,
the Amazon.com conditions of use and the other rules published on the site.

Clauses relevant to a scraper, **quoted verbatim**:

1. **Express prohibition of scraping/automated extraction** (section 1,
   «Use of Our Service»):

   > Subject to your compliance with this Agreement and your payment of any
   > applicable fees, we grant you a limited, non-exclusive, non-transferable,
   > non-sublicensable license to access and make personal and non-commercial
   > use of the Service. This license does not include any resale or
   > commercial use of any part of the Service, or its contents; **any
   > collection and use of any book listings, descriptions, reviews or other
   > material included in the Service**; any derivative use of any part of the
   > Service or its contents; any downloading, copying, or other use of
   > account information for the benefit of any third party; **or any use of
   > data mining, robots, or similar data gathering and extraction tools**.

2. **Prohibition of exploitation without written consent** (section 1):

   > No part of the Service may be reproduced, duplicated, copied, sold,
   > resold, visited, or otherwise exploited for any commercial purpose
   > without our express written consent.

3. **License termination and unilateral termination** (section 1):

   > The licenses granted by us terminate if you do not comply with this
   > Agreement. [...] Goodreads may permanently or temporarily terminate,
   > suspend, or otherwise refuse to permit your access to the Service without
   > notice and liability for any reason, including if in Goodreads' sole
   > determination you violate any provision of this Agreement, or for no
   > reason.

4. **Property rights over the content** (section 4, «Our Proprietary
   Rights»):

   > Use of the Goodreads Content or materials on the Service for any purpose
   > not expressly permitted by this Agreement is strictly prohibited.

5. **User-generated content** (section 2, «User Content»): reviews and other
   content published by members are user content; by publishing them they
   grant a license **to GoodReads** (section 3), not to third parties. A
   synopsis published by a publisher is also third-party content distributed
   by GoodReads: its extraction and automated reuse are not authorized by
   these terms.

**Applied reading for the project**: searching GoodReads by title/author and
extracting records (title, author, year, pages, covers, synopsis) to feed the
app's catalog constitutes, in the document's own terms, «collection and use of
book listings, descriptions, reviews or other material», precisely what the
license does **not** include, and fits the definition of «data mining,
robots, or similar data gathering and extraction tools». No use of the app
(personal, non-profit) has GoodReads' written consent.

### 4.2 Privacy Policy

Source: `https://www.goodreads.com/about/privacy`, consulted 2026-08-09.
Last updated: June 27, 2023.

> «Goodreads LLC (together with its affiliates, "Goodreads," "we," or "us")
> knows that you care how information about you is used and shared [...]
> Goodreads LLC is a subsidiary of Amazon.com, Inc. ("Amazon"). The
> information we collect is subject to the Amazon Privacy Notice, except as
> otherwise stated in this notice.»

The policy regulates service users' personal data, not automated access to
the catalog. For the purposes of this study it adds no scraping-specific
restrictions beyond those already in the ToS; it does confirm two relevant
facts:

- GoodReads belongs to Amazon, and its site is served through
  **CloudFront/AWS WAF** (technical evidence in 5.2), which explains the
  observed anti-bot behavior.
- Published content (reviews, comments) is made public through the service,
  but its automated extraction remains subject to the ToS (4.1).

### 4.3 robots.txt (consulted live on 2026-08-09)

Source: `https://www.goodreads.com/robots.txt` (full text in the annex).
The file lists specific agents (bingbot, GPTBot, CCBot, EtaoSpider,
AmazonAdBot, facebookexternalhit, Mediapartners-Google) and a generic
`User-agent: *` group. Only **bingbot** has `Crawl-delay: 5`; the generic
group declares no crawl-delay. GPTBot and CCBot are blocked entirely
(`Disallow: /`). There are 16 published sitemaps (References section).

Routes relevant to the app's use case:

| Route | Use for this app | robots.txt (`User-agent: *`) | Textual line (verbatim) |
|---|---|---|---|
| `/search` | **Search by title/author — the main use case of the search** | **PROHIBITED** | `Disallow: /search` |
| `/book/show/` | Book detail (title, author, year, pages, synopsis, cover) | Allowed (no rule appears) | — |
| `/author/show/` | Author detail | Allowed (no rule appears) | — |
| `/work/editions` | All editions of a work (equivalent to `groupBooksByWork`: several covers/synopses) | Allowed (explicit rule) | `Allow: /work/editions` |
| `/work/quotes` | Work quotes | Allowed (explicit rule) | `Allow: /work/quotes` |
| `/work` | Any other route under `/work` | PROHIBITED | `Disallow: /work` |
| `/api` | Official API (defunct; see 4.4 and 7.a) | PROHIBITED | `Disallow: /api` |
| `/book/reviews/` | Book reviews | PROHIBITED | `Disallow: /book/reviews/` |
| `/review/show` | Individual review | PROHIBITED | `Disallow: /review/show` |
| `/review/list*` | Review listings | PROHIBITED | `Disallow: /review/list`, `Disallow: /review/list_rss` |
| `/shelf/user_shelves` | A user's shelves | PROHIBITED | `Disallow: /shelf/user_shelves` |
| `/user/year_in_books` | User annual summary | PROHIBITED | `Disallow: /user/year_in_books` |
| `/ebooks`, `/videos/`, `/tooltips`, `/track`, `/admin` | Other areas | PROHIBITED | `Disallow: /ebooks` etc. |
| `/book/auto_complete` (autocomplete JSON) | Title suggestions | Allowed (no rule appears) | — |
| `/` (root, general navigation) | — | Allowed (not blocked; no `Disallow: /` for `*`) | — |

Note on precedence: in robots.txt, when rules coexist, the most specific one
applies (the one with the longest prefix). That is why `Allow: /work/editions`
prevails over `Disallow: /work` only for that specific subpath.

**robots.txt conclusion**: search (`/search`) —which is exactly what the
issue proposes to replace— is **expressly prohibited** for any crawler. The
rest of the catalog (book, author, editions records) is not blocked by
robots.txt, but remains subject to the ToS (4.1): robots.txt and ToS are two
independent layers (see 4.5).

### 4.4 General legal context (no legal advice)

The most relevant US precedent for scraping public websites is
**hiQ Labs, Inc. v. LinkedIn Corp.**:

- **CFAA**: the 9th Circuit (three times, 2017, 2019 and 2022) held that
  accessing **public** data on a website is not «access without
  authorization» under the Computer Fraud and Abuse Act: the Van Buren
  doctrine is "gates-up-or-down" and, if the site requires no credentials,
  the gate is up. Furthermore, the 9th Circuit itself (Facebook v. Power
  Ventures) noted that «a violation of the terms of use, on its own, cannot
  support a finding of liability under the CFAA».
- **Claims that did succeed**: LinkedIn won at first instance (November
  2022) the claim for **breach of contract** (its User Agreement prohibited
  automated scraping), and in December 2022 the parties reached a
  confidential settlement: hiQ committed to stop scraping, paid $500,000 and
  accepted liability for trespass to chattels and misappropriation. The
  settlement has no precedential value, but it does signal: **violating a
  site's terms while scraping is a viable claim path** (breach of contract,
  civil torts), regardless of the CFAA not applying to public data.
- **Copyright**: publisher synopses and user reviews are protected works.
  GoodReads' ToS transfer no license over that content to third parties
  (section 4.1, point 5).
- **Jurisdiction**: GoodReads is a US company (San Francisco, CA) and its
  terms are governed by the laws applicable to Amazon; the app has users in
  Spain, so EU rules could also apply (e.g. database protection in certain
  cases). This is offered for information only: **this document is not legal
  advice**.

### 4.5 Conclusion: robots.txt ≠ ToS

- **robots.txt** is a technical signal (an informal courtesy protocol for
  crawlers) published by the server; GoodReads additionally enforces it with
  real technical measures (AWS WAF, section 5.2). Complying with it is good
  practice but grants no right: it is a directive, not a contract.
- **The ToS** are a (adhesion) contract accepted upon accessing or using the
  service, with or without an account, and they **prohibit** automated data
  extraction expressly (4.1).
- Therefore: even if a route is «allowed» in robots.txt (e.g.
  `/book/show/`), scraping it still breaches the ToS; and even if a route is
  prohibited in robots.txt but with no technical backing (not the case of
  `/search`, which does have technical backing), crawling it would also
  breach the ToS. **Complying with robots.txt is a necessary but not
  sufficient condition for a scraper to be "legal" in the contractual
  sense.**

---

## 5. Technical feasibility in this app

### 5.1 CORS: empirical evidence

The app is 100 % client-side and consumes the APIs with `fetch()` from the
browser, so **any** candidate source must return CORS headers
(`Access-Control-Allow-Origin`) for the Firebase Hosting origin. Google Books
and Open Library return them (and that is why they work today). With
GoodReads the following courtesy test was done (one HEAD request, on
2026-08-09), simulating the browser's preflight/real request:

```
$ curl -sI -H "Origin: https://example.local" \
    -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
    "https://www.goodreads.com/search?q=test"
HTTP 200 | time 0.8s
```

Relevant response headers (filtered):

```
content-type: text/html; charset=utf-8
server: Server
via: 1.1 ...cloudfront.net (CloudFront)
x-content-type-options: nosniff
```

**No `Access-Control-Allow-Origin` header appears.** Without it, the browser
blocks reading the response and the OPTIONS preflight request would not be
authorized. **Result: from the user's browser, a GoodReads scraper is
infeasible due to CORS**, even ignoring the other obstacles. (Note that some
AWS WAF intermediary may emit `access-control-allow-origin: *` on the empty
challenge responses —observed in third-party sources in 2026—, but that is
useless: it is the anti-bot challenge stub, not the content.)

### 5.2 Anti-bot: response with and without browser User-Agent

Courtesy tests done on 2026-08-09 (a few requests, spaced):

| Request | Result | Reading |
|---|---|---|
| `GET https://www.goodreads.com/` with Chrome UA | **HTTP 200**, ~55 KB of real HTML (title: «Goodreads \| Meet your next favorite book») | The homepage responds to real browsers |
| `GET https://www.goodreads.com/` **without** User-Agent | **HTTP 202, 0 bytes** | Anti-bot: robot-looking requests get an empty body |
| `GET https://www.goodreads.com/search?q=…` with Chrome UA | **HTTP 202, 0 bytes** | **Search is behind a challenge** even with a browser UA |
| `HEAD https://www.goodreads.com/search?q=test` with Chrome UA | HTTP 200 (no CORS headers) | The challenge triggers on full GETs; HEAD passes (point observation) |

The pattern matches what independent sources confirm between 2024
and 2026 (section 9): GoodReads serves through **CloudFront + AWS WAF**, and
the `/search` route is «gated»: it returns **HTTP 202 with an empty body**
and header `x-amzn-waf-action: challenge` (verified by the `bookcover-api`
project incident, GitHub issue #47, May 2026, and by documentary tests of
2026-05-18). The challenge requires running the challenge's JavaScript
(`challenge.js` hosted on `awswaf.com`) to obtain a cookie and redo the
request: **impossible from a `fetch()` of a static site**, and practically
impossible from simple scripts without a headless browser.

Additionally, the real content (React, section 5.3) is rendered client-side:
even if the challenge were passed, the initial HTML of the records is «a
shell» that contains neither the reviews nor much of the metadata without
running JS.

### 5.3 HTML/DOM stability for scraping (documentary research)

Documented community experience (2024-2026, sources in section 9):

- GoodReads migrated to a **React** frontend with **obfuscated** CSS classes
  that **change without notice**: «Goodreads periodically changes HTML class
  names and page structure»; class-based selectors break frequently. The
  reference scraper `maria-antoniak/goodreads-scraper` (GitHub) carries the
  permanent notice «unmaintained and no longer functioning».
- The most stable parts are the embedded **JSON-LD** (schema.org `Book`) and
  the `data-testid` attributes, but even `data-testid` is not a contract:
  «the `RatingStars` and `ReviewCard` markers, the `data-testid` attributes,
  and the section wrappers change without notice».
- Reviews/ratings load asynchronously and behind a «Show more» button;
  without running JS they do not appear.
- Shelves and lists **pagination** requires a session/cookies
  (`_session_id2`); without it, some routes silently return page 1 repeated.

Conclusion: any GoodReads scraper would require **continuous maintenance** of
selectors and periodic testing; it is a fragile asset, not a stable data
contract.

### 5.4 Required infrastructure vs. static app with no backend

For GoodReads to replace or back up Google Books/Open Library, at minimum:

1. **An own backend/proxy** that: (a) runs the AWS WAF challenge,
   (b) renders the HTML with a headless browser (Playwright/Puppeteer),
   (c) extracts the fields, and (d) re-exposes the result to the frontend
   with CORS headers. The app **has no backend** — it is static on Firebase
   Hosting (section 3.1) —, so this would break the current architecture.
2. **An IP with good reputation**: data-center IPs (including those in the
   shared ranges of cloud functions) are flagged; 2026 scraping guides
   recommend **residential proxies** to keep access, with an associated cost
   (commercial scrape services or IP pools; see 7.d). Without them, the risk
   of blocking/rate-limit (403 or challenges) after a few dozen requests is
   high (sources: section 9).
3. **Cost**: any path that actually works (cloud functions + headless
   browser + residential proxies, or commercial scraping APIs, e.g. on the
   order of dollars per thousand results —unverified estimate—) introduces
   recurring cost where today the per-search cost is zero.

The alternative of not using a backend —a direct browser fetch— is rejected
by CORS (5.1) and by the WAF challenge (5.2): **no viable pure-client
implementation exists**.

### 5.5 Metadata comparison table: GoodReads vs Google Books vs Open Library

Real fields the app uses (section 3.3) and how each source would cover them.
GoodReads is evaluated as a scraped source (book page + search; there is no
public API, section 7.a):

| Field the app uses | Google Books (today: primary) | Open Library (today: fallback) | GoodReads (hypothetical scrape) |
|---|---|---|---|
| Title (+subtitle) | ✅ `volumeInfo.title/subtitle` | ✅ `title` | ✅ on the record (JSON-LD/Apollo); the `/search` search is prohibited by robots and gated by WAF |
| Author(s) | ✅ `authors[]` | ✅ `author_name[]` | ✅ on the record and author page (`/author/show/`, allowed by robots) |
| Year | ✅ `publishedDate` (YYYY) | ✅ `first_publish_year` | ✅ `publicationYear` on the record (JSON-LD) |
| Pages | ✅ `pageCount` (per edition) | ❌ not provided (`null`) | ✅ on the edition record |
| **Multiple covers per work** | ✅ several per group (thumbnails of each edition) | ⚠️ 1 per work (`cover_i`) | ⚠️ 1-2 per edition; several works in `/work/editions` (allowed by robots, but 1 extra request per work) |
| Synopsis | ✅ `description` (per edition) | ⚠️ on demand (`/works/X.json`), often absent | ✅ on the record (publisher content; its extraction clashes with ToS 4.1) |
| Spanish language filter | ✅ `langRestrict=es` + `language` | ✅ `lang=es` + edition language | ❌ no reliable language filter in search/records |
| Unused extras (rating, reviews, genres) | ❌ | ❌ | ✅ it would provide them (not needed by the app) |

### 5.6 What GoodReads would add that is not covered today

Analyzing field by field (5.5): **none of the six fields the app uses is
orphaned**. Google Books already gives multiple covers and synopses per work
(ADR-002 grouping), and Open Library covers the fallback and the synopsis on
demand. GoodReads would only add:

- **Average rating and number of ratings** per book (goodreads.com is the
  social reference for books in the English-speaking world).
- **Community reviews** (not used by the app; and with their own copyright
  and privacy problems for reuse).
- **Genres/tags** and community lists (functionality not requested).
- **More covers per edition** in some cases (already covered by GB).

Issue #50 does not request any of those capabilities: the app wants to search
a book by title/author, see several covers/synopses and add it. GoodReads,
therefore, **solves no current gap**.

### 5.7 Partial scenarios

Even restricting the scraper to a supporting role, the legal and technical
obstacles (4.1, 5.1, 5.2) remain intact, and the benefit shrinks:

- **(a) GoodReads only as fallback** (when Google Books fails): today the
  fallback is Open Library, which does work from the browser and has CORS.
  Replacing it with GoodReads would not improve the covered fields (5.5) and
  would add 100 % of the infrastructure cost (5.4).
- **(b) GoodReads only to enrich one field** (e.g. synopsis when GB and OL
  have none): the cases where both lack a synopsis and GoodReads has one are
  a small subset (unmeasured estimate), and the infrastructure cost is the
  same. The synopsis is moreover publisher content: its extraction is the
  part most visibly affected by the ToS (4.1) and by copyright (4.4).
- **(c) GoodReads only for edition covers** (`/work/editions`, the only
  route «allowed» by robots and WAF-free according to 2026 sources): it
  would fill a gap that Google Books already fills today by grouping by work
  (ADR-002); even so it would require backend + headless browser and would
  still breach the ToS.

**Technical conclusion**: no partial scenario is worth it: either the
architecture and the contract are violated for a null/marginal benefit, or it
is not done. Section 8 formalizes the recommendation.

---

## 6. Load and ethics

### 6.1 Current numerical load model

The app is for personal use (tracking of one user's movies/series/books and
later their friends/feed; see ADR-045/048). There is no telemetry measuring
real traffic from this environment, so **all volume figures are estimates**
of order of magnitude for design discussion:

| Variable | Estimated value | Observation |
|---|---|---|
| Requests per query (GB / OL) | **1** (GB) + 0-1 extra (OL only on failure) | `searchBooks()` (js/api-books.js): one call per page; the dropdown only requests page 1 |
| Queries per search session (includes corrections, group changes, re-search while typing — ADR-056) | **3-6** | 200 ms debounce + anti-duplicate guards (`sameQueryInFlight`/`cachedForQuery`/`erroredForQuery`) |
| Sessions per user and day | **10-20** (estimate) | Searching to add a new book usually takes 1-3 sessions; 10-20 covers high activity |
| Active users | **10-100** (estimate) | Personal app + friends; no verifiable metrics |
| **Google Books requests per day** | ≈ 1 × (3-6) × (10-20) × (10-100) → **≈ 300-12,000/day** (estimate) | With in-memory cache only while the dropdown is open (`externalCache` in js/global-search.js); no persistent cache |
| Refresh frequency | Only when the user searches | No periodic catalog refresh (the manual, section 15, documents what refreshes on its own) |

Google Books offers a generous free quota (on the order of thousands of
requests per day per project according to third-party sources —not verified
in this study—); Open Library asks for good use of its public APIs and for
them to be dedicated to real-time search, which is the current use (section
7.d).

### 6.2 Numerical model with a GoodReads scraper (hypothetical)

If, ignoring the blockers of 4.1 and 5, one wanted to build the scraper, the
cost per interaction would be several times higher:

| Interaction | Requests/actions with GoodReads | Requests/actions today (GB/OL) |
|---|---|---|
| Search a query | 1 WAF challenge (2-4 HTTP exchanges: challenge + cookie + re-request)** + 1 GET to /search (if the WAF were passed, which robots prohibits) + running the challenge JS | 1 GET to Google Books |
| View a result's record (to gather covers/synopsis/pages) | 1 GET per record `/book/show/{id}` (headless browser render) or another for `/work/editions` | 0 (GB returns everything in the same search) |
| Add 5 books from a search | ≈ **8-15 requests**, computed as: search = WAF challenge (2-4 exchanges) + 1 GET to /search → **3-5**; + 1 × 5 records → **8-10**; + 0-5 editions → **8-15** (the /search GET is on top of the challenge's 2-4 exchanges) | 1 |
| Recommended courtesy between requests | 3-8 s (third-party sources; robots.txt only sets a 5 s crawl-delay for bingbot) | Not applicable (quota API) |
| Blocking risk | 403/challenge after ~20-30 fast requests from one IP; blocks of hours (third-party sources) | Not applicable (quota) |

Result: the scraper would **multiply the requests by ~8-15×** needed to add
the same books (from 1 to ≈8-15; explicit arithmetic in the row above), would
require a headless browser on a
server and a stable IP/with proxies, and its courtesy cost (3-8 s between
requests) would turn an instant search into a process of tens of seconds. All
of that to cover fields already covered (5.5).

### 6.3 Existing cache and courtesy measure

- **Current cache**: `externalCache` in `js/global-search.js` keeps per
  group `{ query, items, source }` while the dropdown is open and is
  invalidated on close (ADR-045/056). It is a UI anti-duplicate cache, not a
  mechanism to reduce third-party server load: there is no persistent cache
  (there is no backend to store it; and a per-user local cache would
  multiply storage consumption with little hope of hits).
- **Courtesy measures** for any remote source (those already followed with
  GB/OL and that would be followed with a hypothetical scraper): debounce on
  typing (200 ms), no re-firing of duplicate or in-flight queries (guards of
  ADR-056), cap of 5 results in the dropdown, no automatic pagination, no
  prefetch of records — enrichment is bounded and non-blocking
  (`enrichSearchItem`, ADR-045);   and as technical courtesy toward the provider: retries with backoff
  on 5xx errors (`fetchWithRetry` in api-books.js) instead of hammering.
- With GoodReads, moreover, the scraper itself would have to respect the
  `Crawl-
  delay` the site publishes (today only bingbot: 5 s) and, above all, the
  routes prohibited in robots.txt (4.3): **courtesy does not turn an
  extraction the terms prohibit into a legitimate one** (4.5).

### 6.4 Ethics and «do not overload»

The issue's requirement «do not overload the target servers» is interpreted
and fulfilled as follows:

1. Today it is fulfilled at the root: the app only queries official quota'd
   APIs with debounce/guards.
2. A GoodReads scraper, even if it honored robots.txt and delays (which it
   already cannot, because the main use case, `/search`, is prohibited),
   would operate against someone else's infrastructure designed for human
   browsers, with anti-bot challenges: every search session of the app would
   consume CloudFront/WAF/bus-reder resources not consumed today.
3. The ethical path to obtaining GoodReads data would be **asking for
   consent/official use** (the API is closed to new keys, 7.a) or using
   licensed sources; neither fits an app with no backend and no budget.

---

## 7. Evaluated alternatives

### (a) Official GoodReads API — 2026 state

**Dead for new projects and in the process of being dismantled:**

- **December 2020**: GoodReads stops issuing new developer keys for its
  public API and announces the retirement of the tools («As of
  December 8th 2020, Goodreads is no longer issuing new developer keys for
  our public developer API and plans to retire these tools» — official help
  page, consulted 2026-08-09). Keys inactive for > 30 days were deactivated.
- **Mid-2022**: with existing keys, the API was «crippled»: it stopped
  returning publication year and page count (documented testimony of
  Brandur, section 9); reviews remained.
- **2025-2026**: an official forum thread (2025-12-19) reports **403** when
  calling the API with a historical key: «Has it finally gone away?». The
  API documentation (`www.goodreads.com/api`) is no longer accessible, and
  the XML/legacy endpoints return 404 or error pages (third-party
  verification, 2026-05-18).
- API v2 never turned GoodReads into a comparable metadata provider: it
  offered XML with OAuth (book records by ID/ISBN, user shelves, reviews,
  authors, and a basic `search.index.xml`), aimed at community clients, not
  catalogs.

**Conclusion**: the official API is not a viable alternative in 2026; it is
not even an alternative for the future (there is no public plan to reopen
it).

### (b) Keep Google Books + Open Library (status quo)

- Google Books: active, free at the estimated volume, with CORS, language
  tag and work grouping already implemented (ADR-002). Google Books listed
  «GoodReads» among its integrations on its developers page (consulted
  2026-08-09).
- Open Library: active, free, CORS, JSON API/monthly dumps. Its
  documentation (2026) explicitly asks not to use it as a large-scale «data
  backend» — the app uses it as an occasional on-demand fallback, a use
  consistent with its spirit: «Open Library's APIs exist to support the open
  book ecosystem… they are not intended to serve as a data backend for
  third-party services».
- Advantages: zero cost, zero selector maintenance, zero new infrastructure,
  stable data contract (JSON with schema), no legal friction.

### (c) Open Library as the only source

Technically possible (the app already knows how to search it), but it would
**degrade the UX**: OL provides no pages in the search, rarely synopses in
the search result (the app requests them on demand), and only one cover per
work; title+author matching would be poorer and «already added» detection
weaker. Rejected: GB solves exactly those gaps (ADR-002 documents why the
source order was inverted long ago).

### (d) Alternative book metadata APIs active in 2026

| API | 2026 state (verified 2026-08-09) | Cost | Fitness for the app |
|---|---|---|---|
| **Google Books** | Active; free quota (not quantitatively verified in this study) | Free | Already in use (primary) |
| **Open Library** | Active; asks for civic use (no «bulk backend») | Free | Already in use (fallback) |
| **ISBNdb** | Active (108-110M titles); paid plans $14.99-299.99/month; rate limit 1-5 req/s depending on plan | Paid | ISBN metadata, no search by European title/language; adds nothing over GB |
| **WorldCat (OCLC)** | Active but access restricted to libraries | Restricted | Not fit |
| **LibraryThing (ThingISBN)** | Covers API disabled due to abuse (third-party source); ThingISBN with limitations | Free (diminished) | Unreliable |
| **Amazon PA-API (Product Advertising)** | Active only for Amazon associates (affiliation) | Commission-based | Changes the app's model and does not cover synopses/editions |
| **Bookshare** | Active, accessibility scope | Niche | Niche |
| **GoodReads search by scrape** | Blocked: WAF + robots (sections 4-5) | — | ❌ |

No open, free alternative to GB+OL covers the app's six fields better than
the current combination; the paid ones do not add the missing fields (none is
missing, 5.6).

### (e) Selective enrichment (future)

If one day the app wanted «community rating» or «reviews» —the only thing
GoodReads would really add (5.6)—, the compliant paths would be: licensed
data sources (e.g. commercial metadata providers with reviews), or an
official affiliate widget/link that does not extract data. That is not the
scope of issue #50, which asks to replace book search, not to add ratings; if
it were raised, it would be a new issue with its own legal/contractual
analysis.

---

## 8. Final recommendation

**Verdict: NOT feasible** to replace Google Books / Open Library with a
GoodReads scraper in this application (neither as primary source nor as
fallback), under the issue's own constraint of «complying with all GoodReads
terms and conditions and respecting … robots.txt». The study did not start
from a foregone conclusion; the evidence gathered on
2026-08-09 (sections 4, 5, 6 and 7) converges on it from four independent
fronts.

### Main arguments

1. **Double legal/contractual block**. GoodReads' ToS verbatim prohibit
   «data mining, robots, or similar data gathering and extraction tools» and
   the collection of «book listings, descriptions, reviews» (section 1;
   quotes in 4.1); and `robots.txt` prohibits `/search`
   (`Disallow: /search`), which is the use case the issue wants to replace
   (4.3). The hiQ v. LinkedIn precedent (9th Cir., 2022) shows
   that although the CFAA does not cover scraping of public data, the
   **breach of contract** path for violating a site's conditions is
   real and has already ended in convictions/settlements with damages (4.4).
   A scraper compliant with the issue would be, by definition, a violation
   of both layers: there is no way to comply with the constraint and scrape
   at the same time.

2. **Technical block on the current architecture (100 % static client)**.
   GoodReads cannot be queried from the browser: no CORS headers on the real
   responses (5.1), with the search behind an AWS WAF challenge that returns
   an empty 202 to requests that do not run its JS (5.2, replicated with
   curl and confirmed by third parties in 2026), and with content rendered
   by React that requires a headless browser (5.3). Setting up a proxy
   server (Firebase Functions or other) with a headless browser and an IP
   with reputation/residential proxies breaks the app's no-backend design,
   introduces recurring cost and keeps the blocking risk (5.4).

3. **Disproportionate load and null benefit**. The load model (6.2)
   estimates that adding the same books would cost ≈8-15 requests versus 1
   today, with courtesies of 3-8 s between requests and a 403/blocking risk
   after a few dozen requests; and the metadata comparison (5.5-5.6)
   shows that GoodReads adds **no** field the app uses (title, author, year,
   pages, multiple covers, synopsis, language): everything is covered by
   Google Books (+ Open Library as fallback). The only things exclusive to
   GoodReads (ratings, reviews, genres) are not used by the app.

### Recommended alternative

- **Keep the status quo**: Google Books as primary source with work grouping
  and Open Library as fallback (+ synopsis on demand), as documented by
  ADR-002/045/056. It is free, stable, requires no infrastructure and has no
  legal friction (alternative (b) of section 7).
- **Monitoring**: at no cost, watch the two fronts documented in this study:
  (i) Open Library's unwillingness to be used as a «data backend» — the app
  already uses a consistent occasional-fallback pattern;
  (ii) if community ratings/reviews were wanted in the future (the only
  exclusive value of GoodReads), raise it as a new issue with licensed
  sources or official integration (7.e), never with scraping.
- If one day Google Books broke permanently, the natural migration is Open
  Library as the only source (7.c), with the known and documented UX
  degradation; not a scraper.

---

## 9. References and sources

All URLs were consulted on **2026-08-09**. What was verified on each one is
indicated.

### Primary sources (live, 2026-08-09)

| URL | What was verified |
|---|---|
| `https://www.goodreads.com/robots.txt` | Full read: rules for `User-agent: *`, `bingbot` (Crawl-delay: 5), GPTBot/CCBot blocked, `Allow: /work/editions`, `Allow: /work/quotes`, `Disallow: /search`, `/api`, `/work`, `/book/reviews/`, `/review/show`, `/review/list`, etc.; 16 sitemaps (see annex) |
| `https://www.goodreads.com/about/terms` | ToS «last revised on April 28, 2021»; quotes from sections 1 (limited license; prohibition of data mining/robots/extraction; termination without notice) and 4 (property rights; unpermitted use strictly prohibited) |
| `https://www.goodreads.com/about/privacy` | Privacy Policy «Last updated: June 27, 2023»; GoodReads an Amazon subsidiary; referral to the Amazon Privacy Notice; public user content via the service |
| `https://www.goodreads.com/` + `/search?q=…` (curl) | CORS and anti-bot evidence of 2026-08-09 (annex): 200 with real HTML on the homepage with a browser UA; 202/0 bytes without UA and on `/search`; no `Access-Control-Allow-Origin`; `via: CloudFront` |

### Documentary sources (websearch, consulted 2026-08-09)

| URL | What was verified |
|---|---|
| `https://help.goodreads.com/s/article/Why-is-Goodreads-limiting-API-usage` | Official support statement: since Dec 2020 no new public API keys are issued and retiring the current version is planned |
| `https://www.goodreads.com/topic/show/21788520-api-deprecation` | Official forum (Dec 2020): deprecation banner; keys deactivated after 30 days of inactivity; no retirement of active endpoints announced |
| `https://www.goodreads.com/topic/show/23306370-api-down` | Official forum (2025-12-19): user with a historical key gets **403**; «Has it finally gone away?» |
| `https://brandur.org/atoms/gq7cdyc` | Testimony: around mid-2022 the API stopped returning publication year and pages; reviews still available; the author abandoned the sync |
| `https://law.justia.com/cases/federal/appellate-courts/ca9/17-16783/17-16783-2022-04-18.html` | 9th Circuit (2022-04-18): CFAA «gates-up-or-down» (Van Buren); scraping public data is not «unauthorized» access |
| `https://www.morganlewis.com/blogs/sourcingatmorganlewis/2022/12/linkedin-v-hiq-landmark-data-scraping-suit-provides-guidance-to-data-scrapers-and-web-operators` | hiQ v. LinkedIn outcome (Dec 2022): breach-of-contract judgment against hiQ, confidential settlement with $500,000 and permanent injunction; trespass and misappropriation |
| `https://calawyers.org/privacy-law/ninth-circuit-holds-data-scraping-is-legal-in-hiq-v-linkedin/` | Context: after hiQ/Van Buren the CFAA does not protect operators; contractual and tort paths remain |
| `https://github.com/w3slley/bookcover-api/issues/47` | Incident (May 2026): `/search` returns an empty `HTTP 202` with header `x-amzn-waf-action: challenge` via CloudFront; the author attributes it to the recently introduced WAF |
| `https://browse.sh/skills/goodreads.com/find-book-nycdz1.md` | Technical guide (verification 2026-05-18): `/search?q=` gated by AWS WAF (202 with `window.gokuProps` + `challenge.js`); `/book/show/`, `/author/show/`, `/work/editions/` and `/book/auto_complete` without WAF; API retired Dec 2020 (endpoints 404); no rate-limit at ≤5 req/s, challenges above that |
| `https://thunderbit.com/blog/scrape-goodreads-with-python` | Guide (2026-04-16): React frontend, stable JSON-LD, classes that change, `robots.txt` with `/search` blocked and `/book/show/` not blocked, delays 3-8 s, 403 after fast requests, `_session_id2` cookie for pagination |
| `https://automatio.ai/how-to-scrape/goodreads` | Guide (2026-02-13): Cloudflare/DataDome/reCAPTCHA on aggressive flows, unstable React selectors, residential proxies recommended |
| `https://crawlbase.com/blog/scrape-goodreads-ratings-and-comments/` | Blog (2024-10-01): JS render needed; «Goodreads is client-side rendered»; ToS/robots.txt as limits; official API effectively retired |
| `https://dev.to/agenthustler/how-to-scrape-goodreads-in-2026-books-reviews-author-profiles-and-ratings-15e` | Guide (2026-03-26): JSON-LD as stable source; rate limiting 1-3 s; residential proxies; respect robots.txt |
| `https://openlibrary.org/developers/api` | Living Open Library documentation: APIs «not intended to serve as a data backend for third-party services»; monthly dumps for volume; CORS |
| `https://developers.google.com/books` | Google Books API active and documented (search by `q`, `langRestrict`, `maxResults`) |
| `https://isbndb.com/blog/book-api/` and `https://bookscouter.com/blog/book-databases/` | 2026 state of alternatives: ISBNdb (paid, $14.99-299.99/month, 108-110M titles), WorldCat (restricted), LibraryThing (covers API disabled due to abuse), Amazon PA-API (affiliates only) |
| `https://apileague.com/articles/book-apis/` | Overview of 2026 book APIs; mentions of Google Books free quotas (amount not verified in this study) |
| `https://www.goodreads.com/api`, `http://goodreads.readthedocs.io` and wrappers (github.com/Ricoledan/goodreads-api-client, baahrens/goodreads-api-node) | Historical reference of API v2 (XML/OAuth; methods like `search.index.xml`, `book.show`, shelves, reviews) to document state 4.1/7.a |

### Annex — curl evidence (verbatim, 2026-08-09)

Courtesy requests (6 in total, spaced; none of mass scraping):

```
# 1) HEAD /search with browser UA and simulated Origin → CORS absent
$ curl -sI -H "Origin: https://example.local" \
    -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
    "https://www.goodreads.com/search?q=test"
HTTP 200 | time 0.817134s
# Headers (filtered):
#   content-type: text/html; charset=utf-8
#   server: Server
#   via: 1.1 <id>.cloudfront.net (CloudFront)
#   x-content-type-options: nosniff
#   (no Access-Control-Allow-Origin header)

# 2) HEAD /search without User-Agent → 200 (HEAD passes the challenge)
$ curl -sI -H "Origin: https://example.local" "https://www.goodreads.com/search?q=test"
HTTP 200 | time 0.944270s

# 3) GET / with browser UA → 200 with real HTML (~55 KB)
$ curl -s "https://www.goodreads.com/" \
    -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
    -o /dev/null -w "HTTP %{http_code} | %{size_download} bytes"
HTTP 200 | 56155 bytes

# 4) GET / without User-Agent → empty 202 (anti-bot)
$ curl -s "https://www.goodreads.com/" -o /dev/null -w "HTTP %{http_code} | %{size_download} bytes"
HTTP 202 | 0 bytes

# 5) GET /search with browser UA → empty 202 (WAF challenge on search)
$ curl -s "https://www.goodreads.com/search?q=cien%20a%C3%B1os%20de%20soledad" \
    -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
    -o /dev/null -w "HTTP %{http_code} | %{size_download} bytes"
HTTP 202 | 0 bytes

# 6) HEAD /search with UA → infrastructure confirmation (CloudFront)
$ curl -sI "https://www.goodreads.com/search?q=test" \
    -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
    -D - -o /dev/null | grep -iE "HTTP/|server|via"
HTTP/2 200
server: Server
via: 1.1 <id>.cloudfront.net (CloudFront)
```

### Annex — GoodReads robots.txt (key excerpts, verbatim, 2026-08-09)

```
User-agent: bingbot
Crawl-delay: 5

User-agent: GPTBot
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: *
Allow: /work/editions
Allow: /work/quotes
Disallow: /about/team_member/
Disallow: /admin
Disallow: /api
Disallow: /blog/list_rss
Disallow: /book/reviews/
Disallow: /book_link/follow/
Disallow: /buy_buttons/
Disallow: /ebooks
Disallow: /friend/add_as_friend
Disallow: /home/index_rss
Disallow: /oggiPlayerLoader.htm
Disallow: /photo/group/
Disallow: /quotes/list_rss
Disallow: /review/list
Disallow: /review/list_rss
Disallow: /review/rate
Disallow: /review/show
Disallow: /search
Disallow: /shelf/user_shelves
Disallow: /tooltips
Disallow: /track
Disallow: /trivia/answer
Disallow: /user/updates_rss
Disallow: /user/year_in_books
Disallow: /videos/
Disallow: /work
Disallow: /*reviewFilters

Sitemap: https://www.goodreads.com/siteindex.author.xml
Sitemap: https://www.goodreads.com/siteindex.index.xml
... (16 sitemaps in total)
```

---
