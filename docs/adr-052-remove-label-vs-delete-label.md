# ADR-052: `removeLabel` instead of `deleteLabel` in issues-done-on-dev (issue #124)

## Status
Accepted

## Date
2026-08-08

**NOTE — TECHNIQUE KEPT IN ADR-053 (issue #143)**: the `removeLabel` +
defensive try/catch technique documented in this ADR is kept in the
workflow redesigned in ADR-053 (`issues-done-on-dev.yml`, targeted closure
of the PR's issue when merging into `dev`): the cleanup loop still uses
`github.rest.issues.removeLabel` with `core.warning` on 404 and **never**
`deleteLabel`. The rest of this document remains in force.

## Context

The workflow `.github/workflows/issues-done-on-dev.yml` (labels scheme
documented in ADR-034) marks as `status: done` and closes, when pushing to `dev`,
all issues with the `status: needs-review` label. The cleanup
loop removed from each issue the `status: *` labels (except
`status: done`) and the `ai-*` residuals using
`github.rest.issues.deleteLabel`.

The problem: `deleteLabel` calls `DELETE /repos/{owner}/{repo}/labels/{name}`,
whose endpoint removes the label **from the whole repository**, affecting
**all** issues using it — instead of removing it from the specific issue,
which was the intention. Observed consequences (issue #124):

- The `status: needs-review` label kept disappearing from the repository,
  affecting all issues (agent and user ones).
- The disappearance sometimes caused errors in the action itself: with the
  label no longer in the repo, the calls referencing it failed and the
  marking as `status: done` / closure was left half-done.

The correct call to remove the label from only one issue is
`github.rest.issues.removeLabel` (`DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}`).

Process note: an earlier automatic session (branch `fix/issue-124-etiqueta-needs-review`)
performed this fix, ADR and task file, but the runner was ephemeral and the
work was lost unpublished (the bot lacked the `workflows` permission). The user
granted the permissions and the task is reimplemented with the same
specification.

Related issue: #124 — https://github.com/gonzalitojh/personal-tracker/issues/124

## Decision

In `.github/workflows/issues-done-on-dev.yml`, replace
`github.rest.issues.deleteLabel` with `github.rest.issues.removeLabel`, wrapped
in a defensive try/catch:

### 1. `removeLabel` instead of `deleteLabel`

The cleanup loop now removes the label from each specific issue
(`DELETE .../issues/{issue_number}/labels/{name}`) instead of deleting the
label from the repository. The rest of the flow stays intact: adding
`status: done` if the issue does not have it, closing the issue if open and
the anti-PR safeguard.

### 2. Defensive try/catch

Each `removeLabel` call is wrapped in
`try { ... } catch (error) { core.warning(...) }`: if the label is no longer on the
issue (e.g. removed manually, or a 404 for any reason), a
warning is emitted with the issue number and the error message, and the
loop keeps processing the rest of the labels and issues without breaking
the run.

## Rejected alternatives

- **Keeping `deleteLabel` and recreating the label afterwards**: rejected —
  recreation is not atomic: it leaves a window in which the label does not
  exist (errors in other actions, in `scripts/gh-issue.sh` and in the
  workflow itself) and it does not fix the root cause (deleting the label
  from the whole repo).
- **Wrapping `deleteLabel` in try/catch without changing the endpoint**:
  rejected — the try/catch avoids the run failing, but the repo's label
  would already be lost; it does not meet the requirement that the label
  stays in the repository.

## Consequences

### Positive

- **The `status: needs-review` label persists in the repository**: the
  action only removes it from each issue, as intended; it stops
  disappearing from the repo and affecting other issues.
- **Robust per-issue flow**: if a label is not on an issue, the
  try/catch emits a `core.warning` and the loop continues; the marking as
  `status: done` and the closure complete for the rest of the issues.
- **Visible diagnosis in CI**: the catch's warning includes the issue
  number and the error message (e.g. the 404), easing the audit of later
  runs.
- **No external behavior change**: the action processes the same issue set
  and produces the same visible result; only how the labels are removed
  changes.

### Negative / Risks

- **Expected 404 warnings**: if a `toRemove` label is no longer on the
  issue, the catch produces a `core.warning` (log noise; the run does not
  fail). Accepted risk: better than breaking the run and deleting the
  label from the repository.
- **Transient noise with the `ai-*` residuals**: issues with residual
  labels of the old scheme may generate warnings until the cleanup
  removes them; it is an edge case solved by the runs themselves.

### Neutral

- **`docs/manual-de-usuario.md` unchanged**: internal CI infrastructure
  change, not visible to the web's end user (AGENTS.md's rule 3 does not
  apply).
- **Permissions and safeguards intact**: `issues: write`, triggers (`push`
  to `dev` + `workflow_dispatch`) and the anti-PR safeguard are kept
  unchanged.

## Created/modified files

| File | Change |
|---------|--------|
| `.github/workflows/issues-done-on-dev.yml` | **Modified**: `github.rest.issues.deleteLabel` → `github.rest.issues.removeLabel` in the cleanup loop, wrapped in a defensive try/catch with `core.warning` (the run does not fail if the label is not on the issue); success message updated («retirada de la issue» instead of «eliminada») |
| `docs/adr-052-remove-label-vs-delete-label.md` | **New**: this document |
| `docs/manual-de-usuario.md` | **Unchanged** (internal CI change, not visible to the user) |

Related issue: #124 — https://github.com/gonzalitojh/personal-tracker/issues/124
