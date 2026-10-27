# ADR-065: Feasibility study of the GoodReads scraper — not feasible, Google Books + Open Library is kept (issue #50)

## Status
Accepted

## Date
2026-08-09

## Context

Issue #50 asks to **evaluate whether it is feasible to replace the Google
Books API and/or Open Library with a scraper of the GoodReads website**,
with two explicit constraints: the hypothetical scraper must
**comply with all of GoodReads' terms and conditions and respect its
`robots.txt`**, and **must not overload the target servers**.

The starting point is a **100 % static client web** (Firebase Hosting, no
backend of its own): any data source must be queryable from the browser
(CORS enabled) or it would require new infrastructure. Today the books
search uses the **Google Books API as the primary source** (with smart
title+author grouping via `groupBooksByWork`) and **Open Library as the
fallback** (`searchOpenLibrary`) plus on-demand synopses
(`getOpenLibraryDescription`), an architecture documented in ADR-002,
ADR-045 and ADR-056.

The study is already **done and validated (QA PASS)**:
`docs/estudio-viabilidad-scraper-goodreads.md` (884 lines, evidence
gathered on 2026-08-09: `robots.txt` and ToS read verbatim, courtesy HTTP
requests with `curl`, documentary legal precedents and
contrast with `js/api-books.js`). Its verdict is **NOT feasible**, neither as
the primary source nor as the fallback, under the app's current
conditions. This ADR documents the decision retrospectively, like the
recent ADRs (ADR-059 to ADR-064), and fulfills
`tasks/task-issue-50.json`'s definition of done («ADR documentando la
decisión/conclusión del estudio»).

Related issue: #50 — https://github.com/gonzalitojh/Registro-personal/issues/50

## Decision

**Keep the status quo**: Google Books API as the primary source and
Open Library as the fallback (+ on-demand synopses), as ADR-002/045/056
document. **The GoodReads scraper is NOT adopted**, neither as the primary
source nor as the fallback. The study did not start from a
preconceived conclusion; the evidence converges on rejection from three
independent fronts:

### 1. Legal / contractual (blocker)

- **GoodReads' ToS** expressly forbid the use of «data mining,
  robots, or similar data gathering and extraction tools» and the collection
  of «book listings, descriptions, reviews» (section 1 of the terms,
  revised on 2021-04-28).
- **GoodReads' `robots.txt`** has `Disallow: /search`, which is
  **precisely the main use case** the issue wanted to replace
  (the global search's book search).
- The *hiQ v. LinkedIn* precedent (9th Circuit, 2022) shows that, although
  the CFAA does not protect operators against scraping public data,
  the **breach-of-contract** path by violating the
  site's conditions does lead to lawsuits and settlements with
  damages: exactly what a scraper compliant with the letter of GoodReads
  would do. **There is no way to comply with the issue's constraint and
  scrape at the same time.**

### 2. Technical / architecture (blocker for this app)

- GoodReads **does not allow access from the client browser**: the
  real responses **do not include a CORS header** (verified with
  `curl`), the `/search` search is protected by an **AWS WAF
  challenge** that returns `HTTP 202` with an empty body to clients that
  do not run its JS (verified with `curl` and confirmed by third
  parties), and the content renders with React, so a **server
  with a headless browser** (Playwright/Puppeteer) and an IP with a good
  reputation or residential proxies would be needed.
- Standing up such a proxy server (e.g. Firebase Cloud Functions) **breaks
  the app's no-backend design**, introduces **recurring cost**
  (instances, proxies, maintenance) and keeps the **blocking risk**
  (shared data-center IPs are suspicious to the anti-bot).

### 3. Disproportionate load and zero benefit

- **Load**: the study's model estimates **~3-5× requests per query**
  (a 2-4 exchange WAF challenge + 1 GET to `/search`) and **~8-15× when
  adding 5 books** from a search (from ~1 to ≈8-15 requests) vs the
  current path (one HTTP request per query to Google Books), with
  courtesies of **3-8 s between requests** and a risk of 403/blocking
  after a few dozen requests. Also, GoodReads' HTML changes without
  notice (the community's reference scraper is abandoned): constant
  maintenance.
- **Benefit**: GoodReads **covers none of the fields** the app uses
  (title, author, year, pages, multiple covers, synopsis, language); everything
  is already provided by Google Books (+ Open Library fallback). The only
  GoodReads-exclusive things (ratings, reviews, genres) are **not used
  by the app** nor requested by any issue.

### Documented follow-up (at no cost)

- Watch Open Library's mood about not being used as a "data backend": the
  app already uses a fitting occasional-fallback pattern.
- If **community ratings/reviews** were wanted in the future (the only
  GoodReads-exclusive value), raise it as a **new issue** with licensed
  sources or an official integration, never with scraping.
- If Google Books someday stops working permanently, the natural
  migration is **Open Library as the only source** (a known and
  documented UX degradation), not a scraper.

## Rejected alternatives

- **GoodReads scraper as the primary source**: rejected — blocked by
  the three previous arguments (legal, technical and
  load/benefit).
- **GoodReads scraper as the fallback source**: rejected — it inherits
  the same legal blockage and the same infrastructure cost without
  providing any new field.
- **Proxy server with a headless browser (Firebase Functions or
  another)**: rejected — it breaks the no-backend architecture, has recurring
  cost, and data-center IPs with blocking risk (study section 5.4).
- **Open Library as the only source now**: rejected as an immediate
  change — there is no need (Google Books works); it remains the
  documented plan B for Google Books' permanent outage.

## Consequences

### Positive

- **Zero legal risk**: no scraper is implemented; there is no exposure
  to lawsuits for breach of contract nor `robots.txt` violations.
- **No new infrastructure**: nothing to deploy, maintain or pay; the
  100 % Firebase Hosting client architecture is kept.
- **Zero recurring cost** and no new dependencies: Google Books and
  Open Library are free and work from the browser with CORS
  enabled.
- **Unaltered network load**: one HTTP request per query is kept; the
  traffic towards third parties is not multiplied.

### Negative / Risks

- **Continued third-party dependence** (Google Books + Open Library), as
  ADR-002 documents: subject to quotas, API changes or outages. The
  contingency plan is already staged and documented in the study: Open
  Library as the fallback today and as the only source if Google Books
  fell permanently.

### Neutral

- **No UX impact**: the user perceives no change in the books search.
- **No code changes**: the decision does not touch `js/api-books.js` nor
  any other app file.
- **The study remains as a reference**: `docs/estudio-viabilidad-scraper-
  goodreads.md` serves as evidence and a starting point if the topic were
  re-raised in the future (licensed sources, official integration).

## Created/modified files

| File | Change |
|---------|--------|
| `docs/adr-065-estudio-viabilidad-scraper-goodreads.md` | **New**: this document |
| `docs/estudio-viabilidad-scraper-goodreads.md` | **Existing**: the feasibility study (884 lines, QA PASS) whose conclusion this ADR documents — it is not modified |
| `tasks/task-issue-50.json` | **Existing**: the definition of done (criterion "ADR documenting the study's decision/conclusion (with 'Related issue: #50')") that this ADR fulfills — it is not modified |

Related to: docs/estudio-viabilidad-scraper-goodreads.md

Related issue: #50 — https://github.com/gonzalitojh/Registro-personal/issues/50
