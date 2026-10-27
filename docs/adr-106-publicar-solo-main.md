# ADR-106: Publishing to production from the main branch ONLY

## Status
Accepted

## Date
2026-10-24

## Context

The deployment in force until now (ADR-036 → ADR-044) published **all
branches** of the repository on GitHub Pages: main at the root and the
rest (including `dev`) in subdirectories as previews. This carries risks
and costs the project owner does not want to assume:

- Any feature branch was publicly visible with its full web app
  (including its unmerged data).
- Every deployment rebuilt the entire multi-branch site (the script
  `scripts/build-pages-site.sh` extracted all branches with
  `fetch-depth: 0`): slower and more fragile builds.
- The user wants a classic, simple model: **only `main` is the
  published and updated application**, after each merge to `main`.

## Decision

1. **New single workflow `deploy-pages.yml`** (replaces
   `deploy-all-branches.yml`):
   - Trigger: `push` to `main` **only** + manual `workflow_dispatch`.
   - `actions/checkout` of the code of the triggering branch (main) and
     `actions/upload-pages-artifact` of the repo root, as is.
   - `actions/deploy-pages` with the `github-pages` environment.
   - No `fetch-depth: 0`, no `delete` trigger, no previews.
2. **`deploy-all-branches.yml` and `scripts/build-pages-site.sh` are
   removed**.
3. **`auto-resolve-issues.yml`** (Pages relaunch after session): its
   dispatch switches from `deploy-all-branches.yml` to
   `deploy-pages.yml`.
4. **The branch flow does NOT change**: PRs are created against `dev`
   (AGENTS.md), and the only one who promotes `dev` → `main` is the
   user. On merging to `main`, the public web updates immediately to
   that version.
5. **The `tests.yml` workflow keeps its triggers** (push to main/dev,
   PRs to dev): quality keeps being verified on the integration branch
   and on promotions.
6. ADR-036/041/044 are marked as superseded with a reference to this
   ADR (history intact).

## Consequences

- The public app at `https://<user>.github.io/<repo>/` is ALWAYS the
  latest version stabilized on `main`.
- Branch previews disappear; to test a feature before the merge, the
  local environment remains.
- Faster Pages builds with no multi-branch queue risk.
- The `github-pages` environment with branch restriction (protection)
  remains correct: it now only allows `main`.
