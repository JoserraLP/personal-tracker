# ADR-076: Excluding branches from the deployment with the no-deploy/ prefix (issue #198)

## Status
Accepted

## Date
2026-08-11

## Context

The `deploy-all-branches`
action (`.github/workflows/deploy-all-branches.yml`) deploys **all the
branches** of the repository to GitHub Pages via
`scripts/build-pages-site.sh` (ADR-036): `main` at `_site/`'s root and
each non-default branch at
`_site/dev/<sanitized-route>/`, with `/dev/` as the **previews hub** and an
auto-generated index (`_site/dev/index.html`) linking all the branches
and the root (ADR-044). Every run consumes Actions minutes and
creates a deployment in the Pages queue (the queue's saturation was problem
that motivated ADR-041).

Issue #198: the user keeps branches they **will not merge** (e.g.
`feat/issue-191-portadas-no-cargan`) and wants branches whose name
starts with `no-deploy/` (e.g. `no-deploy/feat/issue-191-portadas-no-cargan`)
to be **excluded from the deployment**, to not consume resources deploying
something that will stay there for a long time. They propose renaming
the branch with that prefix as the exclusion mechanism.

Code state verified at decision time:

- `scripts/build-pages-site.sh` lists **all** the remote branches
  (`git for-each-ref refs/remotes/origin`, trimming the prefix and
  filtering `origin/HEAD`) and extracts each non-default branch into
  `_site/dev/<sanitized-route>/`
  (`sanitize_segment`/`branch_path`, with
  `strip_sensitive()` as defense in depth over the extracted tree).
- The workflow's `push` trigger fires again on **all
  branches, without a filter**: the user reverted on purpose (commit
  `1cd1061`,
  2026-08-07) ADR-041's limitation to `main`/`dev`. **This issue does
  NOT reintroduce that limitation**: pushes
  to normal work branches keep deploying like
  before.
- The `workflow_dispatch` and `delete` events **do not accept branch
  filters**: any exclusion living only in the trigger would cover neither
  the manual re-deployment nor a branch's deletion.

## Decision

**Exclude from the deployment the branches whose name starts with the
`no-deploy/` prefix (with the slash), on two levels: the workflow's
trigger and the build script (defense in depth).**

### 1. Trigger layer: `branches-ignore` on `on: push`

The `push` trigger goes from "all branches, no filter" to:

```yaml
on:
  push:
    branches-ignore:  # un push a ramas no-deploy/* no dispara el workflow
      - 'no-deploy/**'
```

- The `no-deploy/**` pattern is **multi-segment**: it covers
  `no-deploy/foo` and `no-deploy/foo/bar` (the `**` crosses `/`,
  unlike `*` — the same
  `File.fnmatch` semantics as the `**/*` pattern
  of the `github-pages` environment documented in
  ADR-036).
- A push to a `no-deploy/*` branch **does not fire the workflow**: it
  consumes no Actions minutes nor creates a deployment in the Pages
  queue. The rest of the pushes (including normal work branches)
  keep firing it.
- `workflow_dispatch` and `delete` stay **intact** (they do not accept
  branch filters; covering those paths' exclusion is the script
  layer's job).

### 2. Script layer: the INCLUDED/EXCLUDED partition in `build-pages-site.sh`

The script defines `NO_DEPLOY_PREFIX="no-deploy/"` and **partitions**
the remote branches' list into `INCLUDED_BRANCHES` /
`EXCLUDED_BRANCHES` with a *prefix match* including
the slash (`[[ "${b}" == "${NO_DEPLOY_PREFIX}"* ]])`:

- The excluded branches are **not extracted** in `_site/dev/` nor
  linked in the previews hub (AC1).
- If there are excluded branches it logs
  `Ramas excluidas del despliegue (prefijo no-deploy/): ...`
  (**traceability** in the build's logs, AC4); the included ones log
  as `Ramas detectadas (se desplegarán): ...`.
- **The "all excluded" safeguard**: if ALL the branches carry the
  prefix, the script emits `::warning::` («Todas las ramas tienen el
  prefijo no-deploy/: solo se desplegará la rama por defecto en la
  raíz.») and continues deploying only the default branch at the root
  — **without aborting**. The real case of
  **zero branches without the prefix** (e.g. a
  repository without remote branches) keeps the previous behavior:
  `::error::` +
  `exit 1`.
- The hub's text is adjusted: «Las ramas no-default **desplegadas**
  tienen su preview bajo esta ruta...» (before «Cada rama no-default
  del repositorio tiene su preview...»), reflecting that not all
  branches are served anymore.

### 3. Accepted edge case: `no-deploy` without the slash is NOT excluded

The prefix match is `no-deploy/` with the slash: a branch called
exactly `no-deploy` (without the slash nor later segments) **does
not** match the prefix and deploys like a normal branch. An
improbable edge case (the prefix is a namespace, not a branch name)
accepted and documented; the same criterion is consistent in both
layers (GitHub's `no-deploy/**` pattern also does not match
`no-deploy`).

### 4. Documentation

The README (section 6) documents the mechanism: branches with
the `no-deploy/` prefix excluded from the previews hub and a push to
them not firing the workflow, with the use case of
keeping unmergeable branches (`feat/...` → `no-deploy/feat/...`). The
section's header line goes back to saying "each push of
any branch", coherent with `1cd1061`'s
revert (without reintroducing ADR-041's limitation).

## Rejected alternatives

- **Reintroducing the `push` limitation to `main`/`dev` (ADR-041)**:
  rejected — the user reverted it on purpose (`1cd1061`,
  2026-08-07); besides contradicting that explicit intent, it would
  lose the work branches' fresh previews on each push (which updated
  instantly and is the behavior the user wants to keep).
- **Only `branches-ignore` without touching the script**: rejected —
  `workflow_dispatch` and `delete` do not accept branch filters; a
  manual re-deploy or the deletion of a `no-deploy/` branch would
  extract it into `_site/dev/` and link it in the hub again.
- **Only a script filter without `branches-ignore`**: rejected — a push
  to a `no-deploy/*` branch would keep firing the workflow and consuming
  Actions minutes (a full build of all the branches) even though the final
  result would not deploy the branch; half of the issue's savings depends on
  the trigger's filter.
- **Another prefix or a manually maintained list**: rejected —
  `no-deploy/` is self-explanatory (an excluded branch "is not
  deployed" with no convention beyond its name) and the mechanism is
  **identical for any prefix**, so changing it adds
  nothing; an explicit branch list would require maintenance on
  every add/removal and would de-sync the two layers (the
  trigger cannot express an arbitrary list with a simple
  pattern).

## Consequences

### Positive

- **Real resource savings**: a push to a `no-deploy/*` branch does not
  fire the workflow (zero Actions minutes) and the branch never enters
  the Pages deployments' queue; the kept unmerged
  branches stop consuming on every iteration.
- **Double layer (defense in depth)**: the trigger's filter avoids the
  cost; the script's filter guarantees the **correct result** on all
  the entry paths (`push` with the workflow not yet promoted,
  `workflow_dispatch` and `delete`).
- **Traceability**: the build's logs list the excluded branches, so a
  branch not appearing in the hub is distinguishable between
  "excluded" and "undetected".
- **Atomic deployment in the edge case**: if all the branches end with
  the prefix, the build does not abort (a warning + only the
  default branch at the root); the
  `::error::` +
  `exit 1` is preserved for the real case of zero remote
  branches.
- **The rest of the branches unchanged**: `main` at the root,
  non-default branches in
  `/dev/<sanitized-route>/` and a regenerated hub with its links
  (AC3).

### Negative / Risks

- **Deleting a `no-deploy/` branch DOES fire a run**: the `delete`
  event accepts no filters and rebuilds the whole site. Accepted: it is a
  single run with a result **identical** to the previous one (the branch was
  never deployed), and removing the exclusion after deleting the branch is
  exactly the desired behavior.
- **A branch called exactly `no-deploy` (without the slash) is not
  excluded**: an accepted and documented edge case; the prefix is defined
  with the slash so it only acts on the whole namespace.
- **The trigger's filter only fully applies when the workflow is on
  the default branch (main)**: while this version
  lives only on the work branch, GitHub evaluates
  the workflow from `main` to decide whether to fire, so a push
  to `no-deploy/*` would still run; the script layer already excludes it
  from the build in that scenario.
- **The recommended order for the user**: **promote this version to
  `main` BEFORE renaming** the branch (`feat/...` → `no-deploy/feat/...`):
  renaming
  first risks an intermediate run with the old script (the renamed
  branch does not have this script's version) that would deploy the
  branch one last time.

### Neutral

- **`docs/manual-de-usuario.md` unchanged** (AGENTS.md's rule 3): the
  change is internal (deployment infrastructure); the end user sees no
  behavioral difference and the manual does not document the per-branch
  previews (the same decision as ADR-036, ADR-041 and ADR-044).
- The change is **backwards compatible**: no existing branch with the
  prefix was deployed differently before (the prefix is new), and the rest
  of the pipeline (sanitization, collision checks, `strip_sensitive`, the
  hub) is untouched.

## Created/modified files

| File | Change |
|---------|--------|
| `scripts/build-pages-site.sh` | **Modified**: `NO_DEPLOY_PREFIX="no-deploy/"`; the remote branches' partition into `INCLUDED_BRANCHES`/`EXCLUDED_BRANCHES` (prefix match with the slash); the log «Ramas excluidas del despliegue (prefijo no-deploy/): ...»; the "all excluded" safeguard (`::warning::` + only the default branch at the root, without aborting; `::error::` + `exit 1` preserved for the real case of zero branches); the hub's text («Las ramas no-default desplegadas...»); header and step 2 comments |
| `.github/workflows/deploy-all-branches.yml` | **Modified**: `on: push` with `branches-ignore: ['no-deploy/**']` (a `**` multi-segment pattern); header comment with the exclusion policy; `workflow_dispatch` and `delete` intact |
| `README.md` | **Modified**: section 6 — a bullet documenting the exclusion prefix (it is not served in the hub, a push does not fire the workflow, the "keep unmergeable branches" use case) and the header line reworded to «each push of any branch» |
| `docs/adr-076-excluir-ramas-no-deploy.md` | **New**: this document |

Related issue: #198 — https://github.com/gonzalitojh/Registro-personal/issues/198
