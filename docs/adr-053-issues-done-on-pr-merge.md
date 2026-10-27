# ADR-053: Targeted issue closure when merging the PR into `dev` — redesign of `issues-done-on-dev` (issue #143)

## Status
Accepted

## Date
2026-08-09

**SUPERSEDES**: ADR-034 and ADR-029 regarding **issue closure**: closure happens again on PR merge into `dev` (not on the `dev` → `main` promotion) with **targeted** scope on the issue the PR resolves (not a sweep of `status: needs-review` nor the body's keyword). ADR-034's `status: *` labels scheme + `ai` label remains fully in force.

**IMPLEMENTATION TYPOGRAPHY CORRECTED (iteration)**: PR #148 (initial implementation) introduced a bug in the `actions/github-script` script: it used `github.event.pull_request` and `core.getInput('issue_number')`, which do NOT exist in github-script — `github` is the octokit client (REST API) and the event payload is read from `context.payload` (`workflow_dispatch` inputs live in `context.payload.inputs`). That produced `TypeError: Cannot read properties of undefined (reading 'pull_request')` when merging PRs and a no-op with `''` on manual dispatch. Fixed in the branch `fix/issue-143-context-payload-fix`: it reads `context.payload.pull_request` and `context.payload.inputs.issue_number`. The job's `if:` with `github.event.*` is correct (GitHub Actions expressions syntax, different from the JS object).

## Context

The workflow `.github/workflows/issues-done-on-dev.yml` managed issue closure with the `status: *` labels scheme + `ai` (ADR-034), but its design had two problems:

1. **Untargeted sweep**: it triggered on `push: branches: [dev]` and swept **ALL** issues with the `status: needs-review` label, closing them and marking them `status: done`. When merging a PR into `dev`, that push also closed the issues of **other PRs pending review**, advancing their closure and losing the backlog's review state (residue from the era when closure happened on `main`).
2. **The "Closes #N" instruction in the PRs' bodies never worked**: GitHub only auto-closes issues with closing keywords when the PR merges into the repository's **default branch** (`main`), and all the flow's PRs merge against `dev` (finding documented in ADR-029, issue #42: PR #55 merged with "Closes #42" left issue #42 open). Therefore, **a workflow cannot be dropped**: GitHub's auto-close does not apply to `dev`.

Issue #143 asks: when merging a PR into `dev`, **ONLY** the issue that PR resolves should be closed and marked `status: done`; if possible without a workflow, remove `issues-done-on-dev`; and if an action is needed (it is needed), remove the "Closes #N" instruction from the PRs and modify the workflow.

Related issue: #143 — https://github.com/gonzalitojh/personal-tracker/issues/143

## Decision

Redesign the `issues-done-on-dev.yml` workflow as a **targeted per-PR** closure, remove the "Closes #N" keyword from the whole publishing process and adjust the master's Step 6 manual fallback:

### 1. `issues-done-on-dev.yml` workflow rewritten: targeted per-PR closure

- **Trigger**: `pull_request: types: [closed]` with a guard in the job's `if` (`merged == true`, `base.ref == 'dev'` and `head.repo.full_name == github.repository` — anti-forks, equivalent to `context.repo.full_name`) + `workflow_dispatch` with an optional `issue_number` input (manual repair mode for a specific issue; if the input is non-numeric → no-op with `core.notice` and a clean exit).
- **Minimum permissions**: `issues: write` (labels and closure) and `pull-requests: read` (the PR's listFiles).
- **Identification of the PR's issues** (Set → deduplication), in this order:
  - (a) **PR files**: paginated `pulls.listFiles` (`per_page: 100`) matching `tasks/task-issue-<N>.json` — the main path, because the publisher uploads the task file with a second commit to the PR's branch.
  - (b) **PR branch**: pattern `issue-<N>` / `task-<N>` in `pr.head.ref` (the publisher names branches `<type>/issue-<N>-<slug>`).
  - (c) **Closing keywords of the body**: case-insensitive regex of the official keywords, as compatibility with manual PRs or old iterations that still carried them.
- **Per-issue processing** (best-effort: try/catch per issue; a failure never breaks the run):
  - Anti-PR safeguard (`issue.pull_request` → skipped).
  - **Only issues with the agent's marker**: the `ai` label **or** some `status: *` label; user issues without markers are not touched.
  - Idempotency: if the issue is already closed with `status: done`, it is skipped.
  - Cleanup: `removeLabel` in try/catch for the `status: *` ≠ `status: done` and the `ai-*` residuals — **never `deleteLabel`** (deletes the label from the whole repo; ADR-052).
  - `addLabels` `status: done` and closure of the issue if open, both in try/catch with `core.warning` on failure.
- **Immediate activation**: the `pull_request: [closed]` trigger uses the merge ref (PR's base+head), so it runs the workflow version of the merged branch (`dev`): the new behavior activates on the next merge **without waiting for the `dev` → `main` promotion** (same mechanics documented in ADR-047).

### 2. Removal of "Closes #N" from the whole publishing process

Closure no longer depends on the keyword (which never worked on `dev`); the workflow applies it on merge. The instruction to write "Closes #N" is removed from:

- `.opencode/agents/publisher.md`: the PR body starts directly with `## Summary`, with no closing keywords anywhere (nor in iterations); the task file's `no_closes` flag remains as informative metadata (traceability of previous PRs) but no longer conditions anything.
- `.opencode/agents/sdd-master.md`: DoD and Step 5 (Publishing) with no keyword; Step 6 updated (see point 3).
- `.opencode/agents/qa-reviewer.md`: the transition to `status: done` + closure is applied by the workflow when merging into `dev` (best-effort), no longer waiting for the promotion.
- `.github/workflows/auto-resolve-issues.yml`: the session's prompts (normal mode and iteration) instruct the body WITHOUT the keyword and explain that the issue closes on merge via `issues-done-on-dev.yml`.
- `scripts/gh-issue.sh`: header comment updated (the transition to `status: done` is applied by `issues-done-on-dev.yml` when merging the PR into `dev`).

### 3. The master's Step 6 manual fallback: no longer waits for the promotion

The manual fallback is now based on the PR's state, not on the `dev` → `main` promotion:

- The `gh api repos/{owner}/{repo}/compare/main...dev --jq .status` check (≠ `ahead`) is removed.
- New condition: if the task file's `pr` block's PR is **MERGED** (`gh pr view <N_PR> --json state -q .state` → `"MERGED"`) and the issue is still open or in `status: needs-review` (the workflow did not run or failed), the master applies manually: `set-state <N> "status: done"` + `gh issue close <N>` (best-effort) and the task file → `"published"`.

## Rejected alternatives

- **Dropping the workflow (GitHub auto-close with "Closes #N")**: rejected — impossible: GitHub only auto-closes issues when the PR merges into the default branch (`main`); all PRs merge against `dev` (demonstrated with issue #42, ADR-029). That is why a workflow is kept as the single closure source.
- **Keeping the `status: needs-review` sweep on push to `dev`**: rejected — it is issue #143's bug: it also closed the issues of other PRs pending review; the user asked for targeted closure of ONLY the PR's issue.
- **Changing the repository's default branch to `dev`**: rejected — the default branch (`main`) is production's and the one GitHub uses for auto-close and for the workflows' version on `issues`/`issue_comment` events (ADR-047); changing it would have unwanted side effects (auto-close would close issues when merging into `main`, duplicating the mechanism, and would break `main`'s production semantics).
- **Workflow closing on merge into `dev` ALL the PR's issues with keyword + sweep**: rejected — the keyword does not work on `dev` (it is decorative) and the sweep repeats the bug; identification by task file/branch is the reliable one.

## Consequences

### Positive

- **Targeted closure**: when merging a PR into `dev`, ONLY the issues that PR resolves are processed (task file, branch or body); the rest of the backlog in `status: needs-review` stays intact.
- **Immediate closure without waiting for the promotion**: the issue closes and is marked `status: done` at the moment of merging into `dev`, not when the user promotes `dev` → `main`; the "finished" state is reflected instantly.
- **Single closure source**: the workflow replaces the "Closes #N" keyword (which never worked on `dev`); the guides and prompts no longer instruct writing it, removing the auto-close's false expectation.
- **Robustness**: multi-path identification (task file → branch → body), deduplication with `Set`, best-effort per issue with try/catch, idempotency and the anti-PR safeguard; the `workflow_dispatch` mode with `issue_number` allows manually repairing a specific issue without touching the rest.
- **ADR-052's technique kept**: `removeLabel` + try/catch (never `deleteLabel`) in the labels cleanup.

### Negative / Risks

- **Dependence on GitHub Actions for closure**: if the workflow does not run or fails (e.g. Actions disabled, rate limit), the issue stays pending until Step 6's reconciliation (the master's manual fallback, which no longer depends on the promotion).
- **Residual risk of unidentified issues**: if a PR includes neither the task file nor matches the `issue-<N>`/`task-<N>` branch pattern nor carries a body keyword, the issue is not processed (logged in the run's log); it is an edge case of manual PRs, fixable with `workflow_dispatch` + `issue_number`.
- **Body keywords no longer close anything**: a manual PR created with "Closes #N" no longer auto-closes the issue; only the workflow processes it if the PR is from the repo itself and merges into `dev` (compatibility via identification point (c)).

### Neutral

- **`docs/manual-de-usuario.md` unchanged**: internal CI infrastructure change, not visible to the web's end user (AGENTS.md's rule 3 does not apply).
- **The `status: *` + `ai` labels scheme does not change**: it remains ADR-034's; only the closure's moment (merge into `dev`, not promotion) and scope (the PR's issue, not a sweep) change.
- **The task file's `no_closes` flag remains as metadata**: historical and informative (traceability of previous PRs), with no effect on the publisher.

## Created/modified files

| File | Change |
|---------|--------|
| `.github/workflows/issues-done-on-dev.yml` | **Rewritten**: `pull_request: [closed]` trigger with guards (`merged`, `base.ref == 'dev'`, anti-forks `head.repo.full_name == github.repository`) + `workflow_dispatch` with the optional `issue_number` input; permissions `issues: write` / `pull-requests: read`; issue identification via task file (paginated listFiles), `issue-N`/`task-N` branch and body keywords; targeted per-issue processing (anti-PR safeguard, only `ai`/`status: *` labels, idempotency, `removeLabel` + try/catch — never `deleteLabel`, `status: done` + closure, best-effort) |
| `.opencode/agents/publisher.md` | **Modified**: the "Closes #N" instruction removed from the PR body (starts with `## Summary`); `no_closes` remains as informative metadata with no effect; the closure is applied by the workflow when merging into `dev` |
| `.opencode/agents/sdd-master.md` | **Modified**: DoD and Step 5 with no closing keyword; Step 6: manual fallback if the `pr` block's PR is MERGED and the issue is still open/`needs-review` (the `compare/main...dev` promotion check removed) |
| `.opencode/agents/qa-reviewer.md` | **Modified**: transition to `status: done` + closure applied by `issues-done-on-dev.yml` when merging into `dev` (best-effort, without waiting for the promotion) |
| `.github/workflows/auto-resolve-issues.yml` | **Modified**: session prompts (normal and iteration) with no "Closes #N" in the PR body; it explains that the issue closes on merge via `issues-done-on-dev.yml` |
| `scripts/gh-issue.sh` | **Modified**: header comment updated (the transition to `status: done` + closure is applied by `issues-done-on-dev.yml` when merging the PR into `dev`) |
| `tasks/task-issue-143.json` | Task file of this task (the `issue` block with issue #143) |
| `docs/adr-053-issues-done-on-pr-merge.md` | **New**: this document |
| `docs/adr-029-issue-done-on-merge.md` | Supersession/recovery note by this ADR |
| `docs/adr-034-status-labels-close-on-main.md` | Note: closure no longer happens on the promotion, but on each PR merge into `dev` (this ADR) |
| `docs/adr-047-auto-resolve-issues.md` | Note at the end: the prompt no longer instructs "Closes #N" (this ADR) |
| `docs/adr-052-remove-label-vs-delete-label.md` | Note: the `removeLabel` + try/catch technique is kept in the redesigned workflow (this ADR) |
| `docs/adr-019-dev-branch-integration.md` | Note: the "Closes #N" auto-close claim on any branch is refuted (ADR-029/this ADR) |
| `docs/adr-018-gh-issues-integration.md` | Existing note expanded: later supersession of closure by this ADR (closure on merge to `dev`) |

Related issue: #143 — https://github.com/gonzalitojh/personal-tracker/issues/143
