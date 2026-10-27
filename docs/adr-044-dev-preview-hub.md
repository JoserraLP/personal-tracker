# ADR-044: Previews hub at /dev and restructuring of the multi-branch deployment (issue #103)

> **OBSOLETE (ADR-106, 2026-10-24)**: the previews hub and the whole
> multi-branch deployment disappeared with the switch to "main only"
> (workflow `deploy-pages.yml`). Kept as historical.

## Status
Accepted

## Date
2026-08-07

## Context

ADR-036 introduced the multi-branch deployment on GitHub Pages via
`.github/workflows/deploy-all-branches.yml` and
`scripts/build-pages-site.sh`:
main at the root, each non-default branch at
`/<sanitized-route>/`
(`https://gonzalitojh.github.io/Registro-personal/<branch>/`). ADR-041
later reviewed the triggers (push only to `main`/`dev`, guard on
`delete`, `configure-pages@v5` and deploy retries), leaving the route
structure intact.

Issue #103 asked to restructure that structure:

1. A **simple page**, deployed at `/Registro-personal/dev`, that simply
   has links to the rest of the branches.
2. The `main` branch stays deployed at `/Registro-personal` (root, **no
   changes**).
3. The rest of the branches would be deployed at
   `/Registro-personal/dev/<branch-name>`, **including the `dev` branch**.

That is: the `/dev/` route stops being the `dev` branch's preview and
becomes a **previews hub** with an auto-generated index page.

Related issue: #103 — https://github.com/gonzalitojh/Registro-personal/issues/103

## Decision

Restructure the multi-branch deployment to turn `/dev/` into a **previews
hub**:

- **`main`** keeps being extracted to the **root of `_site/`** (unchanged;
  the production URLs stay intact).
- **`_site/dev/index.html`** is a **simple auto-generated index page**
  produced by the script (the previews hub) with links to all
  non-default branches (including `dev`) and to the root.
- **Each non-default branch** is extracted into
  `_site/dev/<sanitized-route>/`
  (including `dev` → `_site/dev/dev/`), instead of `_site/<route>/`.

### 1. Constant `HUB_DIR="dev"` in `scripts/build-pages-site.sh`

The hub's name is fixed: `HUB_DIR="dev"`. The whole build depends on
this constant (extractions, checks and index generation), so renaming
the hub later reduces to changing one line. Note: `dev` is
also the integration branch's name, which sanitizes to `dev` and is
extracted into `_site/dev/dev/` (the dev branch itself has its preview
like any other non-default branch, under the hub bearing its same name).

### 2. Index generation: `html_escape()` + `build_hub_index()`

- **`html_escape()`**: escapes the five standard entities (`&`, `<`, `>`,
  `"`, `'`) with `sed` before embedding the visible text into the HTML.
  The `href`s use sanitized routes (only `[A-Za-z0-9._-]` and `/`), but
  they are escaped too as defense in depth.
- **`build_hub_index()`**: generates `_site/dev/index.html` as
  self-contained HTML (doctype, `lang="es"`, viewport, minimal CSS with
  `color-scheme: light dark`, headings and links with `overflow-wrap:
  anywhere`). It receives one line per branch with the format
  `NAME<TAB>route` (the sanitized route **relative to the hub**, without
  the `dev/` prefix), already sorted.
- **Byte-identical determinism**: the HTML is accumulated with `printf`
  line by line, **without timestamps or dates**. Two builds of the same
  set of branches produce the same `index.html` byte for byte.
- **Alphabetical order**: the index is sorted by the branch's
  **original name** with `LC_ALL=C sort` (not by the sanitized route).
- **hrefs relative to the hub**: `../` for the link to the root (main) and
  `<sanitized-route>/` for each branch. The visible text is the
  branch's **original name**, escaped with `html_escape()`.
- **Zero non-default branches guard**: `mkdir -p _site/dev` +
  `build_hub_index` with empty entries produce a minimal index with only
  the link to the root; the build does not fail when there are no work
  branches.

### 3. Collision checks updated to the new structure

All run **before extracting** branches and fail with `::error::` +
`exit 1`:

- **(a) Duplicates of full routes**: two non-default branches whose full
  sanitized routes (with the `dev/` prefix) coincide (e.g. `feat/a` and
  `feat/a#x`), with a clear collision message.
- **(b) Hub vs main's top-level entries**: since **all** non-default
  branches share the first segment `HUB_DIR`, the check degenerates to a
  single case: if the root branch (`origin/${DEFAULT_BRANCH}`) has a
  top-level entry named `dev` (file or directory, detected with
  `git ls-tree`), the build fails with a clear message asking to
  **rename main's `dev` entry**.
- **(c) New, defensive — file/directory collision with the index**: no
  route under the hub may start with `index.html`. A branch named
  `index.html` (or `index.html/foo`) would write `_site/dev/index.html`
  as a **directory**, colliding with the hub's index file
  (`_site/dev/index.html`). The check detects it before extraction and
  asks to rename the branch. Note: a branch named `.nojekyll` sanitizes
  to `nojekyll` (sanitization trims leading `-`/`.`), so it does not
  collide with the hub's `.nojekyll` and does not need its own check.

### 4. Extraction under the hub, `.nojekyll` and `strip_sensitive()` intact

Each non-default branch is extracted into
`_site/dev/<sanitized-route>/` with `git archive`, `.nojekyll` is added
at the root, at the hub (`_site/dev/`) and
in each branch's folder (Pages serves the content as-is, no Jekyll), and
`strip_sensitive()` is applied to the root and to each branch, **exactly
as ADR-036 documented** (defense in depth: `.env`, `*.pem`,
`*.key`, `*.p12`, `*.pfx`, `*service-account*.json`, `credentials*.json`).

### 5. Automatic regeneration on every build

The index is regenerated on **every run** of the script: a new branch
appears in the hub automatically, and a deleted branch disappears. The
workflow's `delete` event (which rebuilds the **whole** site, without
branch filters) guarantees that when deleting a branch its preview stops
being served and is removed from the index in the same build.

### 6. Workflow unchanged

`.github/workflows/deploy-all-branches.yml` is **not touched**: the
triggers (push to `main`/`dev`, `workflow_dispatch`, `delete` with the
`ref_type == 'branch'` guard), the retries and the `configure-pages@v5`
step documented in ADR-041 remain intact; the workflow keeps calling
the script with no change.

### 7. README and `.gitignore`

- **README section 6** updated with the new route structure: hub
  `/dev/` with an auto-generated index, branches at `/dev/<branch>/`, `dev`
  itself at `/dev/dev/`, and the index's regeneration on each build (new
  branches appear, deleted ones disappear).
- **New `.gitignore`** with `_site/`: the local build must not be
  committed. It is the mitigation of the security scan's MEDIUM finding
  (preventing `git add .` from uploading the Pages build to the
  repository).

## Rejected alternatives

- **Manually committed static index**: rejected — it would be **stale**
  as soon as a branch were created or deleted: it would require an extra
  commit and merge per branch change, and it does not cover the "deleted
  branch disappears from the index" case without manual intervention.
- **Index with timestamps or generation date**: rejected — it breaks
  **determinism**: two builds of the same branch set would produce
  different bytes, complicating comparison and caching.
- **Keeping the old URLs `/<branch>/`**: rejected — impossible with the
  new structure: the first segment of all non-default branches is
  now `dev`, and `dev/` is occupied by the hub. The old URLs
  (`/Registro-personal/<branch>/`) start returning **404** — expected
  behavior: the hub (`/dev/`) is the new entry point to the previews.
- **Index generated by the app at runtime**: rejected — the app must not
  know the branch list nor the hub; it is **infrastructure** of
  the deployment and belongs to the build script, not to the web's code.
- **Linking `main` as just another branch in the list**: rejected — main
  lives at the root, not under the hub; it is linked prominently and
  separately at the start of the index with `href="../"` («main — raíz
  (producción)»), instead of mixing it with the rest.

## Consequences

### Positive

- **Navigable previews hub**: a single stable URL (`/dev/`) lists
  all work branches with direct links; the production link elsewhere
  (main) is always present at the start of the index.
- **Index always up to date**: regenerated on each build; new branches
  appear and deleted ones disappear without manual intervention (the
  workflow's `delete` event rebuilds the whole site).
- **Determinism**: without timestamps, two builds of the same branch set
  produce a byte-identical `index.html`.
- **Production URLs intact**: main stays at the root; nothing changes for
  the public site.
- **Stricter collision checks**: check (c) closes the
  file/directory collision with the index, impossible to detect with the
  previous structure.

### Negative / Risks

- **Old URLs `/<branch>/` → 404**: any link or bookmark of a preview with
  the previous structure stops working. It is the decision's expected
  behavior (the hub `/dev/` is the new entry point); no redirect is
  added.
- **If `main` gains a top-level `dev` entry**: the build fails with a
  clear message asking to rename main's entry (check b). It is an
  intentional block: without it, the hub and main's entry would silently
  collide in the deployment.
- **A branch named `index.html` is unviable**: a branch (or a branch's
  first segment) that sanitizes to `index.html` breaks the build with a
  clear message (check c); it must be renamed. An unlikely edge case, but
  now detected in CI instead of corrupting the deployment.

### Neutral

- **`docs/manual-de-usuario.md` unchanged**: the change is internal
  (deployment infrastructure); the end user sees no behavioral
  difference, so AGENTS.md's obligation to update the manual does not
  apply (same decision as ADR-036 and ADR-041;
  it was verified that the manual does not mention deployment routes).
- **Workflow unchanged**: triggers, guard, retries and
  `configure-pages@v5` remain exactly as ADR-041 documented.
- **Each preview's web does not change**: service worker, manifest and
  relative assets keep working the same from their new base
  `/dev/<branch>/` (ADR-036's dynamic base makes them depth-agnostic).

## Implementation note

- **Why `sed` in `html_escape()`**: in bash's pattern expansion, `&` in
  the replacement is substituted by the text matching the pattern:
  `"${s//</&lt;}"` produces `'<lt;'` (the `&` becomes the matched literal
  `<`), not the `&lt;` entity. In `sed`, instead, `\&` is the literal `&`
  character, so `sed 's/&/\&amp;/g; s/</\&lt;/g; ...'` escapes correctly.
  The script's comment documents this detail.
- **Why a loop + `printf` instead of a heredoc with interpolation**: with
  `set -u` and arbitrary branch names, a heredoc with variables (e.g.
  `<h1>${name}</h1>`) is fragile (an undefined variable aborts, and the
  indentation/expansion of `$(...)` inside the heredoc is delicate).
  Accumulating lines with `printf '%s\n'` and single quotes avoids any
  accidental interpolation; the only interpolation point is each
  branch's `li`, where the values already pass through `html_escape()`.
- **Why check (b) degenerates to a single `dev` case**: all non-default
  branches share the first segment (`HUB_DIR`), so the loop over
  `NON_DEFAULT_PATHS` checks the same value N times. The error message
  uses the real first segment (`'${first_segment}'`) and asks to rename
  main's homonymous entry; in practice it can only fail with the
  `dev` entry (unless `HUB_DIR` is changed).
- **Why `.nojekyll` needs no check**: the sanitization trims leading
  `-`/`.` (`s/^[-.]+//` in `sanitize_segment`), so a branch named
  `.nojekyll` becomes `nojekyll` and does not collide with the hub's
  `.nojekyll` file. The same applies to the root.
- **`TAB` separator in the index's entries**: `git` does not allow
  control characters in branch names, so the tab is a safe separator
  between the original name and the sanitized route.
- **The index's order is by original name** (`LC_ALL=C sort` over
  `NAME<TAB>route`), not by sanitized route: the visible text is the
  branch's real name, which is what the user watching the order expects
  to see.
- The zero non-default branches guard: if `HUB_ENTRIES` is empty,
  `build_hub_index` receives zero arguments and generates the minimal
  index (only the root link); step 7b's `mkdir -p _site/dev` covers the
  case.

## Created/modified files

| File | Change |
|---------|--------|
| `scripts/build-pages-site.sh` | **Modified**: `HUB_DIR="dev"`; new functions `html_escape()` and `build_hub_index()` (self-contained HTML accumulated with `printf`, no timestamps → byte-identical determinism, `LC_ALL=C sort` order by original name, hrefs relative to the hub); collision checks (a) duplicates with the `dev/` prefix, (b) hub vs main's top-level entries, (c) new defensive `index.html`; branch extraction into `_site/dev/<sanitized>/` with `.nojekyll` and `strip_sensitive()`; step 7b generates the hub (with a zero non-default branches guard); summary updated |
| `README.md` | **Modified**: section 6 with the new route structure — hub `/dev/` with an index auto-generated on each build, branches at `/dev/<branch>/`, `dev` at `/dev/dev/` |
| `.gitignore` | **New**: `_site/` (the local Pages build must not go to git; MEDIUM mitigation of the security scan) |
| `docs/adr-044-dev-preview-hub.md` | **New**: this document |
| `docs/adr-036-deploy-all-branches.md` | **Modified**: partial deprecation note at the start (the `/<branch>/` route structure replaced by ADR-044's `/dev/` hub); the rest stays intact as historical |
| `.github/workflows/deploy-all-branches.yml` | **Unchanged** (triggers intact: push to `main`/`dev`, `workflow_dispatch`, `delete` with the `ref_type == 'branch'` guard; it keeps calling the script) |
| `docs/manual-de-usuario.md` | **Unchanged** (internal infrastructure change, not visible to the end user — same decision as ADR-036 and ADR-041) |

Related issue: #103 — https://github.com/gonzalitojh/Registro-personal/issues/103
