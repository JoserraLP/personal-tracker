# ADR-034: `status: *` labels scheme + `ai` label and issue closure when promoting dev to main (issue #74)

## Status
Accepted

## Date
2026-08-05

**SUPERSEDES**: ADR-018 and ADR-029 regarding the labels scheme and issue closure (both carry supersession notes pointing to this document). The rest of both is kept as a historical record.

**NOTE — SUPERSEDED REGARDING ISSUE CLOSURE (ADR-053, issue #143)**: issue closure no longer happens on the `dev` → `main` promotion: since ADR-053 each issue is closed and marked `status: done` when **its PR is merged into `dev`** (workflow `issues-done-on-dev.yml` with targeted scope on the PR's issue). The `status: *` labels scheme + `ai` label documented here remains fully in force.

## Context

The user migrated the GitHub Issues labels scheme of the SDD flow. Until now there were two parallel label families: agent labels with the `ai-` prefix (`ai-todo`, `ai-in-progress`, `ai-needs-review`, `ai-blocked`, `ai-done`) and user labels without a prefix (`todo`, `in-progress`, `done`, `blocked`). The new scheme unifies both into **shared states** `status: todo | in-progress | needs-review | blocked | done`, plus an **`ai`** label (no suffix) as the marker of the issues the agent should tackle.

The SDD flow's code was still using the old scheme: the `scripts/gh-issue.sh` helper managed `ai-*` labels, the `issue-done-on-merge.yml` workflow closed issues when merging PRs into `dev`, and the agent guides (sdd-master, publisher, qa-reviewer) and the `issues` command documented the transition to `ai-done`.

In addition, the requirement about closure changed: the original problem (issue #74) was that on completing a PR the issue was neither marked nor closed, but the user expanded the requirement with an explicit rule: the issue is **NOT closed nor moved to `status: done` when the PR is made**. The closure and the transition to `done` must happen **ONLY** when the user promotes `dev` to `main` (merge or direct push to `main`). The old workflow `issue-done-on-merge.yml` (which triggered on `pull_request: closed` and closed issues when merging PRs into `dev`) was removed.

Related issue: #74 — https://github.com/gonzalitojh/Registro-personal/issues/74

## Decision

Adopt the shared states scheme `status: *` + `ai` label as agent marker, and move issue closure to the `dev` → `main` promotion:

### 1. `scripts/gh-issue.sh` helper migrated to the new scheme

- **`STATUS_STATES`**: `("status: todo" "status: in-progress" "status: needs-review" "status: blocked" "status: done")`; the `status: ` prefix is the only thing distinguishing a state.
- **`list`**: filters `--todo` / `--review` / `--blocked` / `--done` with `status: *` queries that **also require the `ai` label** (agent issues only); the AGENT classification is determined by the presence of the `ai` label.
- **`show`**: groups labels into agent (`ai`), state (`status: *`), `ai-*` residuals, type (`type: *`) and others.
- **`set-state`**: validates the state against `STATUS_STATES`, removes in batch the rest of the `status: *` labels (via `--remove-label`) and the `ai-*` residuals (via `gh api -X DELETE ... || true`, because gh 2.45 fails with `--remove-label` if the label no longer exists in the repo; the API tolerates the no-op). **Never touches the `ai` label**: by construction `"ai"` does not match the `"ai-"` prefix, so the agent label always stays intact. It is **idempotent**, has a closed-issues guard (only `status: done` allowed), an anti-PR safeguard and exit codes 2/3/1 (invalid use, validation failure, network/API failure).
- **`set-type`**: unchanged (the `type: *` scheme is kept).

### 2. Removal of the `issue-done-on-merge.yml` workflow

The workflow triggered on `pull_request: [closed]` and closed issues when merging PRs into `dev` is removed: closing on PR merge is no longer wanted, but on the promotion.

### 3. New workflow `.github/workflows/issues-done-on-main.yml`

- **Trigger**: `on: push: branches: [main]` (covers the `dev` → `main` merge both by PR and by direct push; it is **NOT** triggered by PRs to `dev`) + `workflow_dispatch` without inputs as a manual-test backup.
- **Minimum permissions**: `issues: write` (the only permission; no secrets are used).
- **Logic** (with `actions/github-script@v7`): pages through `issues.listForRepo` (`state: all`, `labels: 'status: needs-review'`, `per_page: 100`); anti-PR safeguard (`if (issue.pull_request) continue`); for each issue it removes the `status: *` labels ≠ `done` and the `ai-*` residuals, adds `status: done` if it does not have it and **closes the issue if it is open**.
- **Scope**: it processes **ALL** issues with `status: needs-review`, both agent and user ones (explicit user requirement: the promotion closes everything in review).
- **No body parsing nor "Closes" keywords**: closure does not depend on GitHub's keyword (which does not work anyway because the integration branch `dev` is not the default branch — ADR-029 finding).

### 4. Agent guides and command migrated

- `.opencode/agents/sdd-master.md`: AI-only rule = `ai` label; `status: *` states mapping table; **IMPORTANT note**: the transition to `status: done` + closure is applied by the workflow when promoting `dev` → `main`, so issues remain in `status: needs-review` after merging the PR into `dev`; Step 6 with manual fallback **only** if the promotion already happened (verify with `gh api repos/{owner}/{repo}/compare/main...dev --jq .status` → if it is NOT `'ahead'`); `set-state` with states in quotes.
- `.opencode/agents/publisher.md`: `set-state <N> "status: needs-review"`; new EXCEPCIÓN `no_closes`: if the task file contains `"no_closes": true`, "Closes #N" is omitted from the PR body (closure is done by the promotion workflow).
- `.opencode/agents/qa-reviewer.md`: the transition to `done` only happens via the `dev` → `main` promotion.
- `.opencode/command/issues.md`: help updated with the `ai` label and the `status: *` states.

### 5. Defensive cleanup of `ai-*` residuals

Both `set-state` and the workflow remove residual `ai-*` labels when they appear (half-migrated issues). **`ai-*` labels are not recreated**: the new scheme only creates `status: *`, `ai`, `type: *` and user labels.

## Rejected alternatives

- **Keeping the `ai-*` scheme (agent only) + user labels without prefix**: rejected — the user explicitly changed it to the shared `status: *` scheme + `ai` label; keeping the old one would go against the requirement and perpetuate the duplication of states.
- **Workflow that closes when merging PRs into `dev` (keep `issue-done-on-merge.yml`)**: rejected — explicit user requirement: close ONLY on the `dev` → `main` promotion; merging the PR must not mark or close the issue.
- **GitHub automatic closure with "Closes #N" keywords**: rejected — the integration branch is `dev`, not the default branch (`main`), and GitHub only auto-closes issues when merging into the default branch (finding documented in ADR-029 with issue #42); besides, the requirement is now to close on the promotion, not on the PR merge.
- **Requiring the `ai` label in `set-state` (forcing the helper to check the agent marker)**: rejected — `set-state` is a low-level tool that only manages states; the adoption rule (label every agent issue with `ai`) is applied by the master when taking the issue.

## Consequences

### Positive
- **Zero manual work on closure**: when promoting `dev` to `main`, the workflow marks `status: done` and closes all issues in `status: needs-review` at once.
- **Single shared states scheme for agent/user**: a single `status: *` family for both, with the `ai` label as the only differentiator of the agent scope; the `ai-done` vs `done` duplication disappears.
- **Closure independent of the merge branch**: the workflow closes via API on push to `main`, without depending on GitHub's auto-close nor keywords in the body.
- **Automatic residual cleanup**: `set-state` and the workflow remove the leftover `ai-*` labels of the old scheme without recreating them.
- **Minimum permissions**: the workflow uses only `issues: write`, with no secrets and no `pull_request_target`.

### Negative
- **Issues remain pending the `dev` → `main` promotion**: while the user does not promote, an issue whose PR was already merged into `dev` remains open in `status: needs-review`. This is the requested behavior (the closure marks a published version, not an intermediate merge), but it implies the "finished" state is not reflected until the promotion.
- **If the user never promotes, issues stay in `needs-review`**: direct consequence of the requirement; it is a correct state of the flow (pending publication) and is mitigated by the master's Step 6 manual fallback, which must only be run if the promotion already happened.

### Neutral
- **Issue #74's own PR does not include "Closes #74" nor closes it**: the task file carries `no_closes: true`; #74's closure will be done by the `dev` → `main` promotion that publishes it, like any other issue.
- **The `type: *` scheme and user labels are kept**: the migration only affects states and the agent marker; `set-type` does not change.
- **`workflow_dispatch` without inputs**: allows triggering the cleanup manually (e.g. to test or recover a promotion whose workflow failed), processing exactly the same sweep.

## Created/modified files

| File | Change |
|---------|--------|
| `scripts/gh-issue.sh` | Migrated to the new scheme: `STATUS_STATES` with `status: *`; `list` with filters `--todo/--review/--blocked/--done` based on `status: *` + `ai` label (AGENT classification = `ai` label); `show` groups agent/state/`ai-*` residuals/type/others; `set-state` validates against `STATUS_STATES`, removes other `status: *` in batch and `ai-*` residuals via `gh api -X DELETE ... \|\| true` (gh 2.45 fails with `--remove-label` if the label does not exist), never touches the `ai` label (by construction), idempotent, closed guard (only `status: done`), anti-PR safeguard, exit codes 2/3/1; `set-type` unchanged |
| `.github/workflows/issue-done-on-merge.yml` | **Removed**: the workflow closing on PR merge into `dev` is no longer wanted |
| `.github/workflows/issues-done-on-main.yml` | **New**: workflow `issues-done-on-main` (`push: branches: [main]` + `workflow_dispatch` without inputs, minimum permissions `issues: write`, `actions/github-script@v7`, pages `listForRepo` with `labels: 'status: needs-review'`, anti-PR safeguard, removes `status: *` ≠ done and `ai-*` residuals, adds `status: done` and closes if open; processes all issues with the label, agent and user) |
| `.opencode/agents/sdd-master.md` | AI-only rule = `ai` label; `status: *` states mapping table; IMPORTANT note (the transition to `done` + closure is done by the workflow when promoting `dev` → `main`; issues stay in `needs-review` after merging the PR); Step 6 with manual fallback only if the promotion already happened (`gh api ... compare/main...dev --jq .status` ≠ `ahead`); `set-state` with quotes |
| `.opencode/agents/publisher.md` | `set-state <N> "status: needs-review"`; EXCEPCIÓN `no_closes`: if the task file has `"no_closes": true`, "Closes #N" is omitted from the body (closure done by the promotion workflow) |
| `.opencode/agents/qa-reviewer.md` | Transition to `done` only via the `dev` → `main` promotion |
| `.opencode/command/issues.md` | Help updated with the `ai` label and the `status: *` states |
| `docs/adr-018-gh-issues-integration.md` | Supersession note regarding the labels scheme (points to this ADR) |
| `docs/adr-029-issue-done-on-merge.md` | Supersession note regarding the labels scheme and closure (points to this ADR) |
| `docs/adr-034-status-labels-close-on-main.md` | **New**: this document |

Related issue: #74 — https://github.com/gonzalitojh/Registro-personal/issues/74
