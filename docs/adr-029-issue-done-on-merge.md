# ADR-029: Automatic issue closure on PR merge — issue-done-on-merge workflow and uploading the task file to the repository (issue #44)

## Status
Accepted

## Date
August 2026

**NOTE — CONCEPT RECOVERED BY ADR-053 (issue #143)**: ADR-053 recovers this ADR's concept (issue closure on PR merge) adapted to the `status: *` labels scheme + `ai` label (ADR-034) and with **targeted** scope: when merging the PR into `dev`, ONLY the issue that the PR resolves is closed and marked `status: done` (identified by its task file, its branch or a body keyword), without sweeping all the issues in review. Closure no longer waits for the `dev` → `main` promotion.

**NOTE — SUPERSEDED REGARDING THE LABEL SCHEME AND THE CLOSURE**: this ADR is superseded by ADR-034 (issue #74): the `issue-done-on-merge.yml` workflow is removed and replaced by `issues-done-on-main.yml`, which on promoting `dev` to `main` closes all issues in `status: needs-review` (not on PR merge). The rest is kept as a historical record.

## Context

Issue #44 reports three problems in the management of SDD task state transitions:

1. **Task files not pushed to the repo**: when publishing a task, the local task file (`tasks/task-issue-*.json`) changes its `status` (e.g. to `"review"` or `"published"`), but the change is never pushed to the repository, because the publisher's commit predates that update. Evidence: `tasks/task-issue-42.json` stayed with `status: "review"` and the `pr` block (PR #55) uncommitted in the working tree.
2. **Manual transition to `ai-done`**: issues are marked `ai-needs-review` when the PR is created, but moving them to `ai-done` required manual intervention (Step 6's reconciliation at login).
3. **"Closes #N" was sometimes omitted**: when iterating on an issue with several PRs, one PR would not include the closing keyword and the issue would not close on resolution.

**Key finding (root cause of problem 3)**: the repository's default branch is `main`, but ALL PRs are merged against `dev`. GitHub only auto-closes issues with closing keywords ("Closes #N") when the PR is merged into the DEFAULT branch. That is why PR #55 (merged, with "Closes #42" as the first body line) left issue #42 **OPEN** with `ai-needs-review`. GitHub's auto-close mechanism never worked in this repository; this decision's workflow becomes the reliable closure + label mechanism.

Related issue: #44 — https://github.com/gonzalitojh/personal-tracker/issues/44

## Decision

### 1. New workflow `.github/workflows/issue-done-on-merge.yml` (GitHub Actions)

When a PR whose body contains closing keywords ("Closes #N", etc.) is merged, for each referenced issue that has some `ai-*` label: the other `ai-*` labels are removed, `ai-done` is added and the issue is CLOSED if open (closure essential due to the `dev` base finding). Technical details:

- **Trigger**: `pull_request: types: [closed]` with a `if merged == true` guard, plus a `workflow_dispatch` backup with inputs `pr_number`/`pr_body` for manual testing.
- **Implementation**: `actions/github-script@v7` (inline node script, no helper binaries).
- **Official keywords regex**: `\b(?:closes?|closed|fix(?:es|ed)?|resolves?|resolved)\s*:?\s*#(\d+)` — case-insensitive, optional colon, numbers deduplicated (`Set`).
- **Only issues with label `ai-*`**: user issues (with no `ai-*` label at all) are not touched.
- **Fork guard**: if `pr.head.repo.full_name !== context.repo.full_name`, the update is skipped (fork PRs do not touch the main repo's issues).
- **Minimum permissions**: `issues: write`, `pull-requests: read`.
- **Best-effort**: each issue is processed in `try/catch`; a failure emits `core.warning` and does not break the rest (the merge already happened, there is nothing to block).
- **No secrets and no `pull_request_target`**: only the workflow's automatic `GITHUB_TOKEN`.

### 2. Publisher with a second commit (task file upload)

After creating the PR (and applying `set-state <N> ai-needs-review`), the publisher updates the local task file and pushes it:

- Updates `tasks/task-issue-<N>.json` with python3 **round-trip JSON preserving all fields**, including unknown ones (e.g. `bump_pwa`): `"status"` → `"review"`, block `"pr"` `{number, url, title, branch, commit, closes}` (the `closes` field only if there is an `issue` block), and the previous `pr` block is saved into `"previousPr"` across iterations (one-level history).
- `git add tasks/task-issue-<N>.json` — ONLY the task file, never `git add .`.
- Commit `chore: task #<N> en revisión (PR #<N_PR>)` and push to the **same branch**: the existing PR updates itself with that commit, without recreating it.
- Safeguards: if the task file did not change, commit/push is skipped; if the push fails due to a stale branch, `git pull --rebase` (or `--force-with-lease` if the rebase drags garbage from the previous PR).

### 3. "Closes #N" ALWAYS

The publisher includes the keyword as the FIRST line of the PR body whenever the task file has an `issue` block, **including iteration/reopening PRs**: the new PR carries its own "Closes #N" even if a previous PR exists for the same issue; it is never omitted nor taken for granted from previous PRs.

### 4. Master Step 6 with push (reconciliation at login)

When an issue's PR is **MERGED** (verified with `gh pr view <N_PR> --json state -q .state`):

1. `set-state <N> ai-done` — best-effort manual fallback (the workflow usually did it already).
2. Issue closure if still open (the workflow did not run or failed): `gh issue close <N>`.
3. Task file → `"status": "published"` (round-trip JSON preserving the rest of the fields).
4. **PUSH of the task file to `dev`**: `git checkout dev`, `git pull origin dev`, `git add tasks/task-issue-<N>.json` (only the task file), commit `chore: task #<N> publicado`, push, and restoration of the previous branch. Prior stash of unrelated changes (`git stash push` / `pop`) and a clean abort if `git pull` gives a conflict (it is not half-solved).

### 5. Partial reversal of ADR-018

ADR-018's "Rejected alternatives" section rejected a GitHub Actions bot/workflow to synchronize labels as over-engineering ("the agents already have an authenticated `gh`"). **ADR-029 revises ADR-018 on that point**: the workflow is adopted out of necessity — GitHub's auto-close with keywords does not work when the integration branch (`dev`) is not the default branch, as issue #42 demonstrated. The rest of ADR-018 remains in force (issues as source of truth, labels, `gh-issue.sh` helper).

### 6. One-off cleanup of issue #42

PR #55 is already merged and **does not re-trigger the workflow** (the `closed` trigger is only evaluated on merge, not retroactively). After publishing this task, the manual cleanup is done: closure of issue #42, `set-state 42 ai-done` and task file → `"published"` with a push to `dev`, thereby rescuing the pending task file update (status `review` + `pr` block #55 that was left uncommitted).

## Rejected alternatives

- **`bash` + `gh` on the runner instead of `actions/github-script`**: rejected: quoting the PR body in bash is fragile and offers no structured error handling (a parse failure would silently break the flow); the `github-script` handles the API in a typed way with `try/catch` per issue.
- **Only `workflow_dispatch` without the automatic trigger**: rejected: it would require manual intervention on every merge, which fails the goal of issue #44 (zero manual work in the transition to `ai-done`). `workflow_dispatch` is kept only as a testing backup.
- **Keeping only Step 6's manual fallback**: rejected: it does not remove the manual work the issue asks to minimize (the transition would keep waiting for the next reconciliation session).
- **Manual issue closure / relying on GitHub's auto-close**: rejected: auto-close does not work with `dev` base (demonstrated with issue #42, PR #55 merged with "Closes #42" and the issue stayed open) and manual closure is exactly the work to be eliminated.

## Consequences

### Positive
- **Complete cycle without manual intervention**: issue → task → PR → merge → `ai-done` + issue closed, all automatic.
- **The task file's state is always reflected in the repository**: publisher's second commit (status `review`) and Step 6's push (status `published`); the publisher no longer leaves local "debt".
- **The "Closes #N" keyword is always guaranteed**, including iteration/reopening PRs (issue problem 3).
- **Reliable issue closure independent of the merge branch**: the workflow closes the issue explicitly via API, without depending on GitHub's auto-close.

### Negative
- **Dependence on GitHub Actions for the final transition**: if the workflow fails or does not run (e.g. Actions disabled in the repo), the state stays pending until Step 6's reconciliation in the next session.
- **Direct push to `dev` in Step 6**: assumed because `dev` has no branch protection and is the flow's integration branch; a failed push due to conflicts aborts and is reported without half-solving.
- **One-level `previousPr` history**: only the immediately previous PR is kept, not the issue's full PR history.

### Neutral
- **The workflow does not distinguish forks/collaborators beyond the `full_name` guard**: any PR from the repo itself with closing keywords can close `ai-*` issues; this is the desired behavior for collaborators.
- **The `GITHUB_TOKEN` with `issues: write` stays active in the repository**: the minimum permission needed for labels/closure, with `pull-requests: read` and no secrets.

## Created/modified files

| File | Change |
|---------|--------|
| `.github/workflows/issue-done-on-merge.yml` | **New**: workflow `issue-done-on-merge` (`pull_request: [closed]` + `workflow_dispatch`, `actions/github-script@v7`, closing keywords regex, only issues with label `ai-*`, fork guard, permissions `issues: write`/`pull-requests: read`, best-effort with `core.warning`) |
| `.opencode/agents/publisher.md` | Step 6 "Upload the task file (second commit)" (round-trip JSON, `pr` + `previousPr` blocks, commit/push to the same branch), "Closes #N" ALWAYS as first line including iterations, pre-flight with EOL noise cleaning (`git diff --ignore-space-at-eol`), branch prefixes `refactor`/`content`, capture of the PR's `number`/`url` via `gh pr create --json` |
| `.opencode/agents/sdd-master.md` | Step 3-b: workflow note (automatic `ai-done` transition; manual sync as fallback); Step 5: Closes always + publisher's second commit; Step 6 rewritten (MERGED PR → `ai-done` + closure + `published` with push to `dev` and stashing of unrelated changes) |
| `.opencode/agents/qa-reviewer.md` | Note: `ai-needs-review` is applied by the publisher and `ai-done` + closure by the workflow on merge — not a manual step |
| `scripts/gh-issue.sh` | 3 header comment lines: the workflow is the automatic path of the `ai-done` transition; the script remains as manual backup |
| `tasks/task-issue-42.json` | Rescued pending update: `status: "review"` + `pr` block (PR #55) with a one-off commit/push at issue #42's closure |
| `tasks/task-issue-44.json` | Task file of this task |
| `docs/adr-029-issue-done-on-merge.md` | **New**: this document |

Related issue: #44 — https://github.com/gonzalitojh/personal-tracker/issues/44
