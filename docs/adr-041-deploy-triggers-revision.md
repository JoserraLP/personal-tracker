# ADR-041: Review of the deploy-all-branches workflow triggers (issue #98)

> **OBSOLETE (ADR-106, 2026-10-24)**: the workflow this ADR reviewed
> (deploy-all-branches) was removed when switching to publishing only
> `main` (`deploy-pages.yml`). Kept as historical.

## Status
Accepted

## Date
2026-08-06

## Context

ADR-036 introduced the workflow
`.github/workflows/deploy-all-branches.yml`, which deploys **all
branches** of the repository to GitHub Pages (main at the root, each
branch in its subdirectory). Its `on: push` trigger fired on **every push
of any branch** (plus `workflow_dispatch` and `delete`), as ADR-036
documented.

Issue #98 reported that the workflow **took too long**, that the log
**seemed to loop** and that several recent deployments had failed with
`Timeout reached, aborting!`. The diagnosis (master,
2026-08-06) identified the root cause:

- **Every run creates a GitHub Pages deployment**, and Pages processes
  deployments **queued, one by one**. With an empty queue a deploy is
  fast (evidence: run 31107063823, `delete` event 13:40, build 11 s +
  deploy 8 s, success in ~28 s). With push spikes (each PR generates 2-3
  pushes + merge + branch deletion) the queue saturates: deployments
  stay in `deployment_queued` state and `actions/deploy-pages` aborts at
  10 minutes with `Timeout reached, aborting!` (evidence: run
  31103249570, `workflow_dispatch`, deploy stuck 10 m 31 s, failure).
- The perceived "loop" in the log was not one: it was the **state poll
  every 5 s** (`Current status: deployment_queued`) repeated until the
  timeout.
- A **known intermittent problem of the GitHub Pages infrastructure**
  (actions/deploy-pages#406, since 2026-01-13) aggravated the case:
  even with an empty queue, some deployments got stuck in queue without
  apparent reason.
- In addition, the step **Pages legacy → Actions migration via `gh api`**
  failed on **every** run (recurring warning "No se pudo migrar Pages
  legacy…"): the `GITHUB_TOKEN` lacks administration permissions
  for that API. The official path is `actions/configure-pages@v5`, which
  is also `deploy-pages`' documented prerequisite.

Related issue: #98 — https://github.com/gonzalitojh/personal-tracker/issues/98

## Decision

Review the workflow's **triggers** and **migration step**, keeping
ADR-036's functionality intact (main at the root, each branch at
`/<branch>/`, no infinite loops, `concurrency` with cancellation):

### 1. `push` trigger limited to the integration branches `main` and `dev`

`on: push` goes from "all branches, no filter" to
`branches: [main, dev]`. Each merge to `main`/`dev` rebuilds **all**
branches: `scripts/build-pages-site.sh` always deploys the full list of
remote branches, so the open branches' previews update with each merge
without needing to trigger on every push of the branch itself.
`workflow_dispatch` is kept to force a manual re-deploy from the UI, and
`delete` is kept so the site stops serving deleted branches.

### 2. Guard in the `build` job for the `delete` event

The `delete` event does not accept branch filters, so the guard moves
into the job:

```yaml
if: github.event_name != 'delete' || github.event.ref_type == 'branch'
```

It discards **tag deletions** (the site must not rebuild for a deleted
tag) and keeps **branch deletions**. On
`push`/`workflow_dispatch` the `ref_type` property does not exist, so the
condition evaluates `true` and the job always runs.

### 3. Replacement of the `gh api` hack with `actions/configure-pages@v5`

The step «Migrate Pages to GitHub Actions (automatic attempt)» (PUT/POST
via `gh api` with `GITHUB_TOKEN`, which always failed and emitted a
recurring warning) is replaced by:

```yaml
- name: Configurar GitHub Pages (prerequisito de deploy-pages)
  uses: actions/configure-pages@v5
  with:
    enablement: true   # migra Pages legacy → Actions si procede
```

`actions/configure-pages@v5` is `actions/deploy-pages`' **official
prerequisite**; with `enablement: true` it migrates Pages legacy →
Actions when applicable, is **idempotent** (no effects if already
configured) and removes the logs' recurring warning.

### 4. README section 6 updated

Section 6 («Subir a GitHub y activar Pages») reflects the new policy:
deployment of all branches on every push to `main`/`dev`, a note that
previews update with merges (not with each branch push), manual
re-deploy with `workflow_dispatch` and branch-only deletion behavior
(deleting a tag does not rebuild).

**Not touched**: `scripts/build-pages-site.sh` (the script already
deploys all branches on every run; there is nothing to change) nor
`docs/manual-de-usuario.md` (internal infrastructure change, not visible
to the end user — same decision as ADR-036).

### 5. Automatic deployment retries (iteration 2)

After iteration 1's merge (PR #99), the merge's own run
(`31109152406`, push to `dev`, 14:06Z) failed again with
`Timeout reached, aborting!`: the deployment was created correctly but
got stuck in **`deployment_in_progress`** (not queued) for the 10
minutes of timeout. The queue was already empty (a single deployment) and
the workflow already used `configure-pages@v5`: it is the **intermittent
problem of the GitHub Pages infrastructure** (actions/deploy-pages#406,
deployments stuck in any state, `queued`/`in_progress`/`syncing_files`).

Mitigation with **native GitHub Actions jobs (no third-party
dependencies)**:

- Each attempt's deploy step has `continue-on-error: true` **at step
  level** (attempts 1 and 2): an infrastructure timeout does not tinge
  the run on its own; the final result is decided by the retries.
- Each job exposes its real result via **job outputs** with
  `steps.<id>.outcome` (the step's value **before** applying
  `continue-on-error`). **Critical semantic detail**: `needs.<job>.result`
  is not used to decide the retry, because with `continue-on-error` at
  job level GitHub Actions reports it as `success` even if the job
  failed (the retries would never fire); the outcome/conclusion
  distinction only exists at step level.
- Jobs `deploy-retry-1` and `deploy-retry-2` run only if the previous
  job's output is `failure`
  (`if: needs.<job>.outputs.deploy_result == 'failure' && !cancelled()`),
  with a prior wait of 60 s / 120 s (time for the Pages queue to process
  or drain the stuck deployment). They reuse the same run's artifact
  (`deploy-pages` locates it by name) and create a **new** deployment;
  since the bug is intermittent, a new deployment has a high probability
  of completing (evidence: on the same day, deployments in
  8-30 s when the infra is fine).
- The last retry (`deploy-retry-2`) goes **without** `continue-on-error`: if
  the 3 opportunities fail, the run fails (a real signal) and is
  re-launched manually with `workflow_dispatch`.

## Rejected alternatives

- **Keeping `push` on all branches**: rejected — it is the **root cause**
  of the deployment queue's saturation; any mitigation over the timeout or
  the wait would leave the underlying problem unsolved.
- **Increasing `actions/deploy-pages`' timeout**: rejected —
  **impossible**: the timeout is hard-capped at 600000 ms (10 minutes) in
  the action itself and is not configurable from the workflow.
- **Third-party retry wrapper** (actions wrapping `deploy-pages` with
  retry, e.g. `Wandalen/wretry.action`): rejected — it adds an external
  dependency not maintained by GitHub and complicates output reading
  (`page_url`); the same retry effect is achieved with **native chained
  jobs** (`deploy-retry-*`), with no dependencies.
- **Removing the `delete` event entirely**: rejected — the site must
  **stop serving deleted branches**; without the event, the subdirectory
  of a deleted branch would remain published indefinitely.
- **Relying only on the trigger reduction (iteration 1) without retry**:
  rejected — iteration 1's own merge run proved that a single deployment
  can also get stuck due to the infrastructure's intermittent problem;
  the trigger reduction was necessary but not sufficient.

## Consequences

### Positive

- **Drastic reduction of deployments**: from firing on every push of any
  branch to only merges to `main`/`dev`, `delete` of branches and a manual
  `workflow_dispatch`. With the reduced frequency, the **Pages queue
  drains** and `Timeout reached, aborting!` stops happening under normal
  conditions.
- **Previews are kept**: each run keeps building **all** branches (the
  script did not change), so every merge to `main`/`dev` updates the
  preview of all open branches.
- **Recurring warning removed**: `actions/configure-pages@v5` with
  `enablement: true` replaces the `gh api` hack that failed on every run
  (the `GITHUB_TOKEN` lacks administration permissions for that API);
  besides, it is `deploy-pages`' official prerequisite.
- **Tag deletions without rebuild**: the `ref_type == 'branch'` guard
  avoids full builds for deleted tags.
- **No behavior change for the published site**: main stays at the root,
  each branch in its subdirectory, and neither the build script nor the
  app were touched.

### Negative / Risks

- **Less fresh previews of open branches**: a push to a work branch no
  longer updates its preview immediately; it only refreshes with a merge
  to `main`/`dev` or a manual `workflow_dispatch`. It is the decision's
  accepted trade-off.
- **The Pages infrastructure's intermittent problem persists**
  (actions/deploy-pages#406): not solvable from the repo. The trigger
  reduction + retries mitigate it (3 opportunities per run; each new
  deployment has a high probability of completing), but a prolonged
  infrastructure failure could still make a run fail after exhausting
  the 3 attempts (relaunch manually with `workflow_dispatch` or re-run).
- **Longer runs in the worst case**: if the 3 attempts exhaust their
  timeouts (10 min each + waits of 60/120 s), the run can last
  ~32 minutes before failing. It is the assumed cost of resilience; under
  normal conditions the deploy completes in <1 min on the first attempt.
- **ADR-036's history becomes partially obsolete**: its triggers section
  (`on: push` on all branches) and the `gh api` migration step no longer
  describe the real behavior; a deprecation note is added to ADR-036
  itself pointing to this document.

### Neutral

- **`docs/manual-de-usuario.md` unchanged**: the change is internal
  (deployment infrastructure); the end user sees no behavioral
  difference, so AGENTS.md's obligation to update the manual does not
  apply (same decision as ADR-036).
- **`scripts/build-pages-site.sh` unchanged**: the `_site/` build with all
  branches, name sanitization, collision checks and `strip_sensitive()`
  remain exactly as ADR-036 documented.
- **`concurrency` and permissions intact**: `group: pages,
  cancel-in-progress: true` and the permissions `contents: read`, `pages:
  write`, `id-token: write` are not touched.

## Implementation note

- On `push`/`workflow_dispatch` the `github.event.ref_type` property does
  not exist (returns an empty string), so the guard
  `github.event_name != 'delete' || github.event.ref_type == 'branch'`
  evaluates `true` and the `build` job always runs. Only the `delete`
  event with `ref_type == 'tag'` discards the job.
- The 10-minute timeout (`600000 ms`) is hard-capped in
  `actions/deploy-pages@v4`; a stuck deployment's log shows
  `Current status: deployment_queued` (or `deployment_in_progress`)
  repeated every 5 s until the abort (`Timeout reached, aborting!`), which
  was perceived as a loop.
- `actions/configure-pages@v5` with `enablement: true` is idempotent: if
  Pages is already configured with GitHub Actions it makes no changes, it
  only configures the site per the artifact uploaded afterwards.
- The `deploy-retry-*` jobs reuse the same run's `github-pages` artifact:
  `actions/deploy-pages` locates it by name via the artifacts API, with
  no need for checkout nor to upload it again.
- Retries are decided with `needs.<job>.outputs.deploy_result`
  (propagated with `steps.<id>.outcome`), **not** with
  `needs.<job>.result`: with `continue-on-error` at job level, `result`
  returns `success` even if the job failed (verified semantics:
  actions/runner#2347, actions/toolkit#1034). A `skipped`/`cancelled`
  job's output evaluates to empty, so `== 'failure'` is false and the
  retries do not run (correct behavior: do not retry if the build failed,
  a tag was deleted or the run was cancelled by concurrency).
- The three jobs use the same `environment: github-pages` (no restrictive
  protection rules; the `url` is resolved per job from its own
  `steps.deployment.outputs.page_url`). `timeout-minutes: 15` per job
  bounds the worst case (deploy ~10 min + sleeps).

## Created/modified files

| File | Change |
|---------|--------|
| `.github/workflows/deploy-all-branches.yml` | **Modified**: `on: push` limited to `branches: [main, dev]`; guard `if: github.event_name != 'delete' \|\| github.event.ref_type == 'branch'` in the `build` job (discards tag deletions); the `gh api` migration hack replaced by `actions/configure-pages@v5` with `enablement: true`; jobs `deploy-retry-1`/`deploy-retry-2` with retries (iteration 2: `continue-on-error` at step level + job outputs from `steps.<id>.outcome`); header comment with the triggers policy and the retries |
| `README.md` | Section 6 updated: deployment on every push to `main`/`dev`, note that previews update only with merges, manual re-deploy and tag deletion without rebuild |
| `docs/adr-036-deploy-all-branches.md` | **Modified**: partial deprecation note at the start (triggers policy and the `gh api` step replaced by ADR-041, issue #98); the rest of the ADR stays intact as historical |
| `docs/adr-041-deploy-triggers-revision.md` | **New**: this document (expanded with iteration 2: deploy retries) |
| `docs/manual-de-usuario.md` | **Unchanged** (internal infrastructure change, not visible to the end user — same decision as ADR-036) |
| `scripts/build-pages-site.sh` | **Unchanged** (the script already deploys all branches on every run) |

Related issue: #98 — https://github.com/gonzalitojh/personal-tracker/issues/98
