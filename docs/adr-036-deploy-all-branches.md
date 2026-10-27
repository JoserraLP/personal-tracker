# ADR-036: Deployment of all branches via GitHub Actions (issue #83)

> **OBSOLETE (ADR-106, 2026-10-24)**: multi-branch deployment was removed.
> Now only `main` is published to Pages with the `deploy-pages.yml`
> workflow, after every merge to `main`. This document is kept as
> historical.
>
> **Partial deprecation note (ADR-044, issue #103)**: the **route
> structure** documented in this ADR — main at the root and **each
> non-default branch at `/<sanitized-route>/`** — was **replaced** by
> ADR-044 (previews hub, issue #103): main stays at the root (unchanged),
> but non-default branches are now served at `/dev/<sanitized-route>/`
> (including `dev` at `/dev/dev/`), with `/dev/` as the **previews hub**
> with an auto-generated index linking all branches and the root. The rest
> of this ADR (multi-branch workflow, name sanitization, collision checks,
> `strip_sensitive()`, dynamic SW/manifest routes, the `github-pages`
> environment) remains in force. This document is kept intact as
> historical.

> **Partial deprecation note (ADR-041, issue #98)**: the triggers policy
> documented in this ADR — `on: push` to **all branches** and the Pages
> legacy → Actions migration via `gh api` — was **replaced** by ADR-041
> (triggers review, issue #98): `push` limited to `main`/`dev`, guard
> `ref_type == 'branch'` on the `delete` event and
> `actions/configure-pages@v5` with `enablement: true` instead of the
> `gh api` hack. The rest of this ADR (multi-branch, dynamic routes, name
> sanitization, `strip_sensitive()`, `github-pages` environment) remains
> in force. This document is kept intact as historical.

## Status
Accepted

## Date
2026-08-06

## Context

Until now, GitHub Pages was published in **legacy** mode («Deploy from a
branch»): only the `main` branch was served at
`https://gonzalitojh.github.io/personal-tracker/`, and only when `dev` →
`main` was promoted. Work branches (feature, fix…) had no public preview:
to test a change, one had to deploy it locally or wait for it to reach
`main`.

Issue #83 asked for:

1. A GitHub Action that deploys **all branches** of the repository to
   GitHub Pages.
2. The `main` branch stays at the root
   (`https://gonzalitojh.github.io/personal-tracker/`, no branch name).
3. Each branch is served in its own subdirectory
   (`https://gonzalitojh.github.io/personal-tracker/<branch>/`) with the
   web **complete and functional** (CSS/JS, `ocio/*` partials, login,
   service worker, PWA manifest).
4. The workflow must avoid **infinite loops** (the deploy's push must not
   re-trigger the workflow).

State detected in the code that needed changing:

- The **service worker** used absolute hardcoded routes
  `/personal-tracker/...` in `STATIC_ASSETS`, in the offline fallbacks
  and in the check `url.pathname.startsWith('/personal-tracker/')`.
- `js/sw-register.js` registered the SW with `SW_PATH='/personal-tracker/service-worker.js'`
  and `SW_SCOPE='/personal-tracker/'` (absolute hardcoded).
- `manifest.json` had absolute `start_url` and `scope`
  (`/personal-tracker/`).
- `index.html` and the `ocio/*.html` partials already used relative routes
  (`css/...`, `js/...`, `ocio/...`) and relative fetch, so they were
  compatible with subdirectories without touching anything.

Related issue: #83 — https://github.com/gonzalitojh/personal-tracker/issues/83

## Decision

Replace Pages' legacy mode with a **GitHub Actions workflow that publishes
all branches**, and make the service worker, the manifest and the SW
registration resolve their routes **dynamically relative to their own
base**, so the same code works at the root (main) and in each branch's
subdirectory.

### 1. Workflow `.github/workflows/deploy-all-branches.yml`

- **Triggers**: `on: push` (all branches, no filter), `on:
  workflow_dispatch` (manual re-deploy from the UI) and `on: delete` (when
  a branch or tag is deleted the site is rebuilt; the `delete` event does
  not accept branch filters). Note: the first version used `push: []`,
  but GitHub rejects the file with "A sequence was not expected" (the
  schema requires a filter map); the valid way of saying "all branches" is
  `push:` with no value.
- **No infinite loop**: the workflow **does not push** — it only reads the
  repository and uploads an artifact to Pages. Even though it triggers on
  every push of any branch, nothing writes back to the repo and therefore
  it cannot re-trigger itself.
- **Permissions**: `contents: read`, `pages: write`, `id-token: write`
  (declared at workflow level and repeated in the `deploy` job).
- **Concurrency**: `concurrency: group: pages, cancel-in-progress: true`
  — a single Pages run at a time; if another arrives (e.g. two pushes in a
  row), the previous one is cancelled.
- **Job `build`** (ubuntu-latest):
  1. `actions/checkout@v4` with `fetch-depth: 0` (all branches, not only
     the current one).
  2. **Automatic Pages legacy → Actions migration** via the GitHub API:
     `gh api` with `PUT /repos/<repo>/pages` and `build_type=workflow`; if
     it returns 404 (site not yet created) it retries with `POST`. If both
     fail it emits `::warning::` indicating to do it manually in
       Settings → Pages → Source: «GitHub Actions» (the job does not
       fail). **Warning**: the `GITHUB_TOKEN` lacks administration
       permissions for that API, so the automatic attempt usually fails
       and the migration ends up being done by hand the first time.
  3. `bash scripts/build-pages-site.sh` → generates `_site/`.
  4. `actions/upload-pages-artifact@v4` with `path: _site`.
- **Job `deploy`**: `needs: build`, `environment: github-pages` (with the
  artifact's `url`) and `actions/deploy-pages@v4`.
- **Requirement of the `github-pages` environment**: the environment must
  allow deploying to **all branches**. On the first deploy from a
  `feature/...` branch, the `deploy` job failed with «Branch ... is not
  allowed to deploy to github-pages due to environment protection rules»
  because the environment (inherited from legacy mode) only had `main` as
  an allowed branch. Solved by adding the pattern **`**/*`** in Settings →
  Environments → `github-pages` → Deployment branches. With the
  `File.fnmatch` syntax GitHub uses (flag `FNM_PATHNAME`) the wildcards
  `*` and `**` **do not cross `/`**, so `*` does not match `feature/x`;
  the pattern `**/*` covers any hierarchy. (The REST API refuses to set
  `protected_branches` and `custom_branch_policies` both to `false`,
  which is why the wildcard pattern is used.)

### 2. Script `scripts/build-pages-site.sh`

Builds `_site/` (the repo's root) with **all remote branches**:

- Lists branches with `git for-each-ref refs/remotes/origin`, trimming the
  `refs/remotes/origin/` prefix and filtering `origin/HEAD` (the full
  refname avoids the variants of `origin/HEAD` depending on the git
  version).
- **Default branch** (usually `main`): detected with
  `git symbolic-ref refs/remotes/origin/HEAD` (with a fallback to `main`
  if it does not exist). Extracted with `git archive` at the **root of
  `_site/`**.
- **Each non-default branch** is extracted into `_site/<sanitized-route>/`,
  and a `.nojekyll` is added at the root and in each branch folder (Pages
  serves the content as-is, without Jekyll).
- **Branch name sanitization** (`sanitize_segment`): each segment is
  normalized to `[A-Za-z0-9._-]` (everything else → `-`), repeated `-` are
  collapsed, the `-`/`.` at the ends are trimmed and an empty segment
  becomes `branch`. **Hierarchies with `/` are kept**
  (e.g. `feature/mi-cambio` → `_site/feature/mi-cambio/`).
- **Collision checks BEFORE extracting** (with `::error::` + `exit 1`):
  duplicates between branches' sanitized routes, and collision of each
  route's first segment against the root branch's top-level entries (via
  `git ls-tree`). Avoids overwriting the root or the branches over each
  other.
- **`strip_sensitive()` — defense in depth**: removes from the extracted
  tree (root and branches) the sensitive files that must never be served
  publicly: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`,
  `*service-account*.json`, `credentials*.json`.
- Refreshes `refs/remotes/origin/*` with `git fetch --prune` if an
  `origin` remote exists (redundant in CI — the checkout brings
  everything — but allows testing the script locally).
- Final summary with `du`/`find` for the job's logs.

### 3. Dynamic routes in the service worker (`service-worker.js`)

All absolute routes `/personal-tracker/...` are removed:

- On startup: `const scopeURL = new URL(self.registration.scope)`,
  `scopePath = scopeURL.pathname` and a helper
  `resolved(p) = new URL(p, scopeURL).toString()`.
- `STATIC_ASSETS` becomes a list of **relative routes `./...`** resolved
  with `resolved()` during `install`; the same file works for the root
  (main) and for each branch preview.
- The **offline fallbacks** (catch of `cacheFirst` and `networkFirst`) and
  the `cache.put` of the app shell after a network navigation use
  `resolved('./index.html')`.
- The check for **own assets** changes from
  `url.pathname.startsWith('/personal-tracker/')` to
  `url.pathname.startsWith(scopePath)`.
- **Caches renamed** from `mi-registro-v2-*` to `mi-registro-v3-*`: the
  `activate` deletes any cache outside the allowlist, so old entries saved
  with absolute routes are invalidated wholesale.

### 4. Dynamic base in `js/sw-register.js`

- `SITE_BASE = new URL('../', import.meta.url).href` (the module lives in
  `js/` and goes up one level to the app's root).
- `SW_PATH = new URL('service-worker.js', SITE_BASE).href` and
  `SW_SCOPE = SITE_BASE`; the registration passes an explicit
  `{ scope: SW_SCOPE }`, so it works the same at the root and in the
  branch subdirectories.

### 5. Relative `manifest.json`

`start_url` and `scope` become `'./'`: they resolve relative to the
manifest's URL, i.e. to each branch's base.

### 6. PWA versioning

`APP_VERSION` in `js/config.js` moves to `20260808` and
`scripts/bump-version.sh` synchronizes the `?v=20260808` refs in
`index.html` and `service-worker.js`, invalidating the previous version's
PWA caches.

### 7. README updated

Section 6 («Subir a GitHub y activar Pages») is rewritten: Source
**«GitHub Actions»** (with a note about the automatic migration from the
old mode), deployment of all branches (main at the root, the rest at
`/<branch>/` as a full preview), manual re-deploy with `workflow_dispatch`
and behavior when deleting a branch.

## Rejected alternatives

- **Per-branch deploy in legacy mode** («Deploy from a branch»): rejected
  — GitHub Pages legacy only allows choosing **one** branch and **one**
  path per site; there is no way to publish several branches
  simultaneously nor automatic per-branch subdirectories.
- **`gh-pages` branch** (compiling and pushing the site to a dedicated
  branch): rejected — it requires the workflow to **push**, which would
  reintroduce the infinite-loop risk (besides requiring a PAT and
  third-party actions), and complicates the "each branch in its
  subdirectory" model by consolidating branches without their origin
  names.
- **`amalgamate-pages` or other third-party actions**: rejected — it adds
  external dependencies not maintained by GitHub and typically pushes to
  `main`/`gh-pages`; branch consolidation is solved with our own 170-line
  script, with no dependencies.
- **One Pages artifact per branch without consolidating**: rejected —
  GitHub Pages publishes **a single artifact** per deploy; it is not
  possible to publish N artifacts (one per branch) into the same site, and
  the `environment: github-pages` is unique per repository.
- **Keeping absolute routes and publishing only main**: rejected — it does
  not meet the issue's (#83) requirement of serving each branch in its
  subdirectory.

## Consequences

### Positive

- **Public previews of each branch**: any push to a branch (feature,
  fix…) deploys the whole web at `/<branch>/` within minutes; testing
  changes no longer requires waiting for `main` nor deploying locally.
- **`main` intact at the root**: the production URLs do not change.
- **No infinite loops**: the workflow does not push, it only reads and
  uploads an artifact to Pages.
- **Reduced runs**: `concurrency` with `cancel-in-progress` cancels stale
  deploys on consecutive pushes.
- **PWA per branch**: service worker, manifest and assets resolve from
  each branch's base; the same code works for all subdirectories.
- **Automatic Pages migration**: the first deploy attempts to convert the
  legacy mode to GitHub Actions via API; if it fails, a clear
  `::warning::` says to do it manually.
- **Defense in depth**: `strip_sensitive()` guarantees that a sensitive
  file accidentally committed in any branch is **not** served in the
  deploy.
- **Explicit collision errors in CI**: if two branches sanitize to the
  same route or one collides with the root, the build fails with a clear
  message (rename the branch).

### Negative / Risks

- **Actions minutes consumption**: every push of any branch runs build +
  deploy. Mitigated by cancelling stale runs, but branch traffic is
  directly proportional to consumption.
- **Automatic migration not guaranteed**: the legacy → Actions conversion
  depends on the GitHub API (`gh api`); if the account or token prevents
  it, it requires a one-time manual intervention (Settings → Pages). Also,
  the **`github-pages` environment's branch policy** is not migrated
  automatically: if the environment keeps the legacy mode's branch list
  (e.g. only `main`), deploys from other branches fail until the `**/*`
  pattern is added in Settings → Environments.
- **Branch collisions after sanitization**: two branches whose names
  differ only in characters outside `[A-Za-z0-9._-]` (e.g. `feat/a` and
  `feat/a#x`) collide and break the build until the branch is renamed.
- **Previews connected to the production database**: each branch deploys
  the full app with the same Firebase configuration, so previews
  read/write the same Firestore. Not a new change (any deploy did that),
  but now there are N functional apps pointing to the same database;
  mitigated by the Firebase authorized-domains restriction (README
  section 7) and the invited emails list.

### Neutral

- **`docs/manual-de-usuario.md` not touched**: the change is internal
  (deployment infrastructure); the end user sees no behavioral
  difference, so AGENTS.md's obligation to update the manual does not
  apply.
- **PWA versioned to `20260808`**: `APP_VERSION`, `?v=` in `index.html`
  and `service-worker.js` invalidate previous caches (including the old
  ones with absolute routes, as the caches are renamed to `v3`).

## Implementation note

- The workflow uses `on: push` — with no value, which GitHub interprets as
  "all branches" (no branch nor paths filter). The `push: []` form is
  invalid and GitHub rejects it when validating the file.
- The `build` job depends on `fetch-depth: 0` so the checkout brings
  **all** branches into `refs/remotes/origin/*`; the script lists them
  with `git for-each-ref` and extracts each with `git archive` (without
  touching the working tree).
- The `delete` event does not accept branch filters and rebuilds the
  **whole** site (it does not just remove the deleted branch): simple and
  robust, at the cost of one full run after every deletion.
- The default branch is detected via `origin/HEAD` (`git symbolic-ref`),
  with a fallback to `main`, to avoid hardcoding the name in the script.
- Locally, `bash scripts/build-pages-site.sh` serves to preview the site
  (refreshes `origin/*` with `fetch --prune` if there is a remote).

## Created/modified files

| File | Change |
|---------|--------|
| `.github/workflows/deploy-all-branches.yml` | **New**: Pages workflow with all branches (`on: push` + `workflow_dispatch` + `delete`), legacy→Actions migration via `gh api`, jobs `build`/`deploy`, `concurrency` with cancellation |
| `scripts/build-pages-site.sh` | **New**: builds `_site/` with all branches (default at root, rest in sanitized subdirectories), `.nojekyll` per folder, collision checks, `strip_sensitive()` |
| `service-worker.js` | Absolute routes `/personal-tracker/...` → dynamic base (`scopeURL`/`scopePath`/`resolved()`); relative `STATIC_ASSETS`; fallbacks with `resolved('./index.html')`; check `startsWith(scopePath)`; caches renamed to `v3`; `?v=20260808` |
| `js/sw-register.js` | `SITE_BASE`/`SW_PATH`/`SW_SCOPE` derived from `import.meta.url`; registration with explicit scope |
| `manifest.json` | `start_url` and `scope` → `'./'` (relative to the manifest) |
| `js/config.js` | `APP_VERSION` from `20260807` to `20260808` |
| `index.html` | Versioning `?v=20260808` (synchronized by `scripts/bump-version.sh`) |
| `README.md` | Section 6 rewritten: Source «GitHub Actions», all-branch deployment, previews, manual re-deploy, branch deletion. Added requirement of the `github-pages` environment (pattern `**/*`) |
| `docs/adr-036-deploy-all-branches.md` | **New**: this document |
| `docs/manual-de-usuario.md` | **Unchanged** (internal infrastructure change, not visible to the user) |
| `github-pages` environment (Settings) | One-time manual configuration: Deployment branches → pattern `**/*` (after first migration to GitHub Actions) |

Related issue: #83 — https://github.com/gonzalitojh/personal-tracker/issues/83
