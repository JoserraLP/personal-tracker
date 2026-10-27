# ADR-047: Automatic issue resolution with GitHub Actions (issue #81)

## Status
Accepted

## Date
2026-08-07

## Context

The repository uses GitHub Issues as the SDD flow's **source of truth** (ADR-018, ADR-034): the backlog is managed with the `ai` label (agent-issue marker), `status: todo | in-progress | needs-review | blocked | done`, `type: *` and `priority: very high | high | medium | low | very low`. Until now, each issue was adopted manually by the agent in an interactive session; the `dev` → `main` promotion closes the issues in `status: needs-review` (ADR-034).

Issue #81 asks for a **GitHub Action** that resolves issues automatically: when a PR against `dev` (not `main`) is merged, it creates an OpenCode session (agent `sdd-master`, model `opencode/deepseek-v4-flash-free` — OpenCode Zen's free—, variant `max`) that resolves the most prioritary issue. Selection criteria:

1. Only issues with the `ai` label.
2. Highest priority (`very high` > `high` > `medium` > `low` > `very low`).
3. Priority tie → type (`bug` > `question` > `style` > `content` > `refactor` > `feature`).
4. Tie → the oldest (`created_at`).
5. Never an issue in `status: needs-info` or `status: blocked`, even if it has the `ai` label.
6. Never an issue blocked by another one if the dependency is unresolved.

In addition: if a comment is made on an ongoing issue, the comment must be re-analyzed (iteration); if no issue is left to resolve, "shut down the server" of OpenCode; and if a new issue is created with the server off, "turn it on" and process. Everything must run **internally in GitHub Actions**, without depending on the local machine.

Technical findings from the implementation:

- `opencode run` is **headless by default** (no TTY).
- The `--auto` flag is **necessary** for the agent to be able to run `git`/`gh`/scripts: without it, permissions are auto-rejected and the run does nothing.
- The free model needs no API key.
- `--format json` emits JSONL events (suitable for CI logs).

Related issue: #81 — https://github.com/gonzalitojh/personal-tracker/issues/81

Related issue: #120 — https://github.com/gonzalitojh/personal-tracker/issues/120 (fix for resuming blocked issues)

## Decision

### 1. A single multi-trigger workflow: `.github/workflows/auto-resolve-issues.yml`

A **single workflow** (not two) with these triggers:

- `pull_request: closed` with `merged == true` and `base.ref == 'dev'` → the cycle continues: the next issue is resolved.
- `issues: opened` (with an anti-PR safeguard) → the "server turns on".
- `issue_comment: created` on an open issue with label `ai` and `status: in-progress | needs-review`, excluding `github-actions[bot]` → iteration.
- `workflow_dispatch` with inputs `issue_number` (force an issue, debug) and `dry_run` (selection and prompt only, no session launched).

- **Concurrency group `sdd-auto-resolver` with `cancel-in-progress: false`**: one session at a time; queued runs **wait** and never kill an active session.
- **Permissions**: `contents: write`, `pull-requests: write`, `issues: write` (the agent's commits/PRs and labels/comments).
- `timeout-minutes: 120` (SDD flows with variant `max` take minutes).

### 2. Selection script `scripts/gh-select-issue.sh` (bash + python3)

All business logic lives in python3 (heredoc): lists open issues with `gh issue list` (anti-PR safeguard), filters and sorts by issue #81's criteria 1-6:

- Only issues with the `ai` label; by default only `status: todo` (`--all-states` flag for debug); **never** `needs-info` nor `blocked`.
- Dependency regex in the body (case-insensitive and conservative): `depende de #N`, `bloqueada por #N`, `depends on`, `blocked by`. A dependency is **resolved** ⇔ the issue is `CLOSED` or has the `status: done` label (if the issue does not exist, it is considered unresolved — fail-safe).
- Ranking: `(priority, type, created_at, number)`.
- Flags: `--dry-run` (full ranking with exclusion reasons), `--issue <N>` (forces an issue; exit 2 if not eligible or is a PR), `--all-states`.
- Output: **single-line** JSON (`number`, `title`, `body`, `labels`, `comments`, `createdAt`, `url`) or the string `NONE`; exit codes 0 (selection/NONE), 1 (API error), 2 (invalid use or forced ineligible).
- **Never prints tokens**: consumes `GH_TOKEN` from the environment without `echo`.

### 3. Flow of the `resolve` job

1. **Checkout** with `fetch-depth: 0` (the agent needs branches from `origin/dev`) and the **git identity** (`github-actions[bot]`).
2. **Install pinned OpenCode**: `npm install -g opencode-ai@1.18.7`; the `curl -fsSL https://opencode.ai/install | bash` fallback only if npm fails.
3. **Determine the candidate issue**: `issue_comment` → the commented issue, validating open + `ai` label + `status: in-progress | needs-review` (if not met → `NONE`); `workflow_dispatch` with `issue_number` → `--issue N`; the rest → selector without flags.
4. If `NONE` → the **"server is off"**: the workflow finishes successfully without launching a session.
5. **Claim the issue** (anti-race against queued runs): `set-state N "status: in-progress"` except in iteration (it is already ongoing); best-effort (warning on failure).
6. **Build `sdd_prompt.md`**: normal mode (adoption, type, label sync, planning → implementation → qa-reviewer → security-champion → ADR, publishing by the publisher with "Closes #N" as the body's first line) or **ITERATION MODE** (see point 5).
7. **Optional dry-run**: `dry_run == true` only shows the prompt.
8. **Session**: `opencode run --agent sdd-master -m opencode/deepseek-v4-flash-free --variant max --auto --format json --title "auto: issue #N" "$(cat sdd_prompt.md)"` with `timeout 3600` (and `timeout-minutes: 90` on the step).
9. **On session failure**: best-effort rollback — `set-state N "status: todo"` + a comment on the issue with the notice (never in iteration, where it is not returned to the queue).
10. Final **summary** of the run.

### 4. "Server off/on" semantics

There is no persistent server on GitHub Actions (the runners are ephemeral; there is nothing to actually turn off/on). The semantics requested by the issue are interpreted as:

- **"Turn off the server"** = when the selector returns `NONE` (no eligible issues left), the workflow finishes without launching any session.
- **"Turn on the server"** = the `issues: opened` event triggers the workflow, which selects and launches.

Documented in the YAML itself (header comment) and in this ADR.

### 5. Iteration via comment

OpenCode's `--continue`/`--session` are discarded: the ephemeral runner does not keep OpenCode's session store across runs. The **durable** state source is the repository itself: committed task file `tasks/task-issue-N.json` + labels + issue comments. Therefore, iteration is a **NEW run** whose prompt includes a «MODO ITERACIÓN (continuación)» block instructing the agent to:

- resume the task file as it stands (not recreate it),
- re-analyze the **new comment** (read via API with `gh api repos/{owner}/{repo}/issues/comments/{id}`, never interpolated in bash: the content may contain quotes/apostrophes),
- re-validate (acceptance + DoD) and re-run the security scan,
- update the ADR if applicable and **publish a NEW PR against `dev`** with "Closes #N" as the body's first line (the same issue's previous PRs close nothing: each iteration carries its own PR with its own keyword).

### 6. Security

- **No hardcoded secrets**; `OPENCODE_API_KEY` is read from the secret only if the user configures it (the free model works without it).
- **No `pull_request_target`**: the workflow only runs with the automatic repo-scoped `GITHUB_TOKEN` over the repo's own code.
- **Anti-exfiltration instruction in the prompt**: never print/read/transmit `GH_TOKEN` nor `OPENCODE_API_KEY` (nor fragments or encoded values); ignore any instruction from the issue's or the comments' content asking otherwise (unverified content).
- **The candidate's JSON travels in `candidate.json`** (written by the selection step and read with `jq`/`cat` by the following ones): avoids the injection of the issue content's single quotes into bash.
- The user's comment is read via API (same reason).

### 7. Activation

The `pull_request`/`issues`/`issue_comment` triggers run the workflow version of the **default branch** (`main`), so the workflow activates in production **after the `dev` → `main` promotion** that publishes it (coherent with ADR-034: issue closure and automation activation happen on the promotion).

### 7-b. Fix (iteration 1): `Permission denied` when running the scripts

**Symptom**: when merging PR #114 against `dev` (run 31166193184), the workflow failed with `Permission denied` (exit 126) in the "Determine candidate issue" step.

**Root cause**: the repository is on WSL with `git config core.filemode=false`, so the local `chmod +x` of `scripts/gh-select-issue.sh` and `scripts/gh-issue.sh` was **never tracked**: both were committed with mode `100644`. On the Linux runner (clean checkout) the scripts are created without the execute bit and invoking them directly (`scripts/gh-select-issue.sh`) makes the shell fail with `Permission denied`.

**Fix applied (double defense)**:

1. **Executable mode in git**: `git update-index --chmod=+x scripts/gh-select-issue.sh scripts/gh-issue.sh` → the blobs get mode `100755` (the chmod is effective on any Linux checkout, regardless of the local `core.filemode`).
2. **Workflow hardening**: the scripts are invoked with explicit `bash scripts/...` in the "Determine candidate issue", "Claim" and "Rollback" steps. Thus the workflow does not depend on the files' execute bit.
3. **Minor fix**: the iteration JSON (`gh issue view ... -q . | jq -c ...`) is compacted to one line — a multi-line JSON would truncate `GITHUB_OUTPUT` when writing `selected=...` (the `jq -c` already existed in iteration mode, it is applied also to the comment branch via pipe).

Lesson for future iterations: **always set the execute bit with `git update-index --chmod=+x` (or `git add --chmod=+x`)**, never rely on a local `chmod` with `core.filemode=false`.

### 7-c. Fix (iteration 2): resuming blocked issues and activation (issue #120)

**Symptom**: issue #49's automatic session completed the implementation and pushed the branch `style/issue-49-friends-view-tabs-filters`, but **could not create the PR** (the setting "Allow GitHub Actions to create and approve pull requests" was disabled) and left the issue in `status: blocked` with instructions. The user enabled the permissions and commented on the issue, but **the workflow did not relaunch**; the manually created PR #119 (empty body) did not activate anything either.

**Double root cause**:

1. **Activation (GitHub Actions behavior)**: the `issue_comment` trigger (and `issues`) runs the workflow version of the **default branch (`main`)**, not of the merge ref. Since the workflow was not yet in `main` (the `dev` → `main` promotion had not happened after PRs #114/#117), the comment on #49 was **silently ignored** (no run was created). By contrast `pull_request` uses the merge ref (PR's base+head), which is why the flow did activate when merging PR #117. Until the promotion, **manual resumption** is via `workflow_dispatch` + `issue_number`.
2. **Flow design**: iteration via comment only accepted `in-progress`/`needs-review` — an issue in `blocked` was rejected with "it is not iterated". Also `scripts/gh-select-issue.sh --issue N` rejects `blocked` too (exit 2), so there was **no path** (neither automatic nor manual) to resume a blocked session.

**Fix applied**:

1. **Iteration via comment accepts `blocked`**: the user's comment on an open issue with the `ai` label and `status: blocked` is the signal that the block was resolved → the workflow unblocks it (`blocked` → `in-progress`, "Claim" step) and relaunches the session on that issue.
2. **`workflow_dispatch` with `issue_number` = manual resumption**: instead of the selector's `--issue` (which rejects `blocked`), the candidate is built directly validating only open + `ai` label (any status). The user can thus resume a blocked issue from the Actions UI (Actions → auto-resolve-issues → Run workflow → branch `dev` → `issue_number: N`).
3. **The ITERATION MODE prompt also applies to the forced dispatch** and adds instructions for an **existing PR**: search for the work branch on origin (pattern `<type>/issue-N-*`) and, if it already has an open PR (`gh pr list --head <branch>`), **update it** with `gh pr edit` (title + body with `Closes #N` as the first line) instead of creating a duplicate PR.
4. **Rollback to the previous state**: if a resumption fails, the issue goes back to `blocked` (if it came blocked) instead of to `todo` (new `prev_status` output of the candidate step).
5. **Activation documentation**: the workflow header and this ADR document which events use main vs. merge ref (see section 7's diagnosis point 3).

**Resumption flow after this fix** (case #49): the user runs `workflow_dispatch` with `issue_number=49` → the workflow validates open + `ai`, unblocks to `in-progress`, launches the session in iteration mode → the agent detects the branch `style/issue-49-friends-view-tabs-filters` and the existing PR #119, updates it with `gh pr edit` (body with `Closes #49` and the agent's information) → the user reviews it and merges into `dev` → the merge triggers the cycle for the next issue.

### 7-d. Progress protection on failures due to the free model's tokens (issue #128)

**Symptom**: issue #124's automatic session died mid-run due to the OpenCode Zen free model's quota/token limit (`opencode/deepseek-v4-flash-free`). Since the GitHub Actions runner is ephemeral, all the work the session left in the local working tree (edited files and unpushed local commits) was lost when the runner was destroyed: the failure was reverted to the queue without keeping the intermediate progress.

**Root cause**: any unpushed state of the runner's working tree (local commits, modified files) is lost when the job ends. The SDD flow only makes state durable via git (branch + PR), and that only happens at the session's end with the publisher; if the session dies earlier (rate limit, timeout, model failure), nothing in between survives.

**Fix applied** (3 parts of the Gemini proposal + adjustments):

1. **Automatic WIP save on session failure**: new step `wip-save` with `if: failure() && steps.candidate.outputs.selected != 'NONE'`, immediately after the "OpenCode Session" step and before the rollback. It commits the whole working tree (including the session's local micro-commits) to the branch `wip/issue-N` and pushes it to `origin` with `--force` — BEFORE GitHub destroys the runner. It excludes the run's local artifacts (`candidate.json` and `sdd_prompt.md`) via the pathspec `:(exclude)`, so they do not mix with the repo's code; it does not create the branch if there are no changes (`git diff --cached --quiet`). It is best-effort: if the commit/push fails, it only warns and continues with the rollback.
2. **Automatic restore on the next attempt**: new step `wip-restore`, between claiming the issue and building the prompt. It detects `origin/wip/issue-N` with `git ls-remote --exit-code --heads` and, if it exists, does `git fetch` + `git checkout -B wip/issue-N origin/wip/issue-N` so the new OpenCode session continues exactly from the saved state.
3. **Mandatory micro-commits in the prompt + publishing adjustment**: the session's prompt instructs making incremental commits on the local branch as each task file's subtask completes (plan → implementation → validation → security → ADR), without waiting for the end; and if the session comes from a WIP restore (branch `wip/issue-N`), the PR branch is created FROM the current state (never from `origin/dev`, which would lose what was restored), updating the existing PR if there is one, and the `wip/issue-N` branch is never published as a PR. The ITERATION MODE includes the same reminder.

**Key decisions**:

- `wip-save` also runs in iteration (comment/workflow_dispatch), where the rollback does not apply (the rollback's `if` excludes `issue_comment`): a failure in iteration must also keep the progress.
- Pathspec exclude (`:(exclude)candidate.json` / `:(exclude)sdd_prompt.md`) to not leak the run's artifacts into the repo.
- `checkout -B` on the restore: forced and clear, with no orphan local branches.
- No secret (GH_TOKEN, OPENCODE_API_KEY) is printed, committed nor pushed in the save/restore process.

**Modified files table (iteration 3, issue #128)**:

| File | Change |
|---------|--------|
| `.github/workflows/auto-resolve-issues.yml` | **Modified**: steps `wip-restore` (between "Claim" and "Build prompt") and `wip-save` (between "OpenCode Session" and "Rollback"); micro-commit instructions (4a) and publishing from WIP state (5a) in the normal prompt; WIP reminder at the end of the ITERATION MODE |
| `docs/adr-047-auto-resolve-issues.md` | **Modified**: subsection 7-d |

Lesson: on ephemeral runners, the local working tree is NOT durable state — any intermediate progress must be persisted in git (a branch) before the runner dies; the WIP save + micro-commits make a token failure recoverable on the next attempt.

Related issue: #128 — https://github.com/gonzalitojh/personal-tracker/issues/128

### 8. Associated documentation

- `README.md` section 6, point 6: «(Opcional) Resolución automática de issues» — describes the workflow, the server off/on semantics, that it requires the `dev` → `main` promotion, and the use of `workflow_dispatch` with `dry_run` to test the selection without launching a session.
- `.opencode/agents/sdd-master.md`: note «Modo autónomo (CI)» — if the prompt indicates it is an automatic session («AUTOMÁTICA de SDD lanzada por GitHub Actions», issue #81), the agent does NOT ask the user: it proceeds autonomously with the full flow and reports at the end.

## Rejected alternatives

- **Two separate workflows** (one for PR/issue, another for comments): rejected — they would share the selection logic but have different concurrency groups, with the risk of **two simultaneous sessions**.
- **`pull_request_target`**: rejected — a serious security risk: it runs fork code with the repository's token.
- **`--continue`/`--session` to iterate**: rejected — GitHub Actions' ephemeral runner does not persist OpenCode's session store across runs; iteration is solved with a new run that resumes the repo's durable state (committed task file).
- **A model with a paid API key**: rejected — unnecessary; OpenCode Zen's free model works without an API key (zero cost).
- **Trigger on every push to `dev`** (not only closed PR): rejected — noise (every push would launch a selection/session) and duplicated work with the closed-PR trigger.

## Consequences

### Positive

- **Continuous cycle**: issue → automatic session → PR against `dev` → merge → next issue, with no manual intervention in any step.
- **Zero manual intervention**: the backlog drains by itself while there are eligible `ai` issues.
- **Deterministic, checkable selection**: issue #81's criteria are implemented in the selector, with `--dry-run` to audit the ranking and the exclusion reasons.
- **Iteration via comment**: unfinished issues are automatically revised when the user comments, without losing context (task file + previous PRs).
- **Zero cost**: OpenCode Zen's free model without an API key.
- **Anti-loop**: the selector only picks issues in `status: todo` (those left in `needs-review` are not re-picked), the claim marks `in-progress` before launching the session and the concurrency guarantees a single active session.

### Negative / Risks

- **The workflow does not activate until the `dev` → `main` promotion**: meanwhile there is no automatic resolution (expected behavior, coherent with ADR-034, but the user must promote to turn it on).
- **Ephemeral runners**: there are no persistent OpenCode sessions; iteration re-reads the context from the repo (committed task file), which limits the "conversational" continuity between iterations.
- **Free model's rate limits**: a session failure (timeout or rate limit) reverts the issue to `status: todo` and leaves a comment on the issue; the run fails and the issue will retry on the next trigger.
- **Residual prompt-injection risk**: issues/comments are unverified content; mitigated with an ephemeral runner, a repo-scoped token with no exfiltration path for secrets and the prompt's anti-exfiltration instruction; the flow's security scan classifies it as informative MEDIUM.

### Neutral

- **`docs/manual-de-usuario.md` unchanged**: internal infrastructure (the web's end user sees nothing); AGENTS.md's rule 3 does not apply.
- **OpenCode pinned to `1.18.7`**: stable behavior across runs (the `curl|bash` fallback only acts if npm fails).
- **The selector is manually reusable**: `scripts/gh-select-issue.sh` works outside the workflow (with or without `GH_REPO`), useful for backlogs' debug and audits.

## Created/modified files

| File | Change |
|---------|--------|
| `.github/workflows/auto-resolve-issues.yml` | **New**: `auto-resolve-issues` multi-trigger workflow (`pull_request: closed` merged+base=dev, `issues: opened`, `issue_comment: created` without `github-actions[bot]`, `workflow_dispatch` with `issue_number`/`dry_run`); concurrency `sdd-auto-resolver` with `cancel-in-progress: false`; permissions contents/pull-requests/issues write; `timeout-minutes: 120`; pinned OpenCode installation (npm `opencode-ai@1.18.7`, fallback `curl\|bash`); candidate determination (commented/forced/selector); claim to `in-progress`; prompt normal mode / ITERATION MODE (comment via API); dry-run; session `opencode run --agent sdd-master -m opencode/deepseek-v4-flash-free --variant max --auto --format json --title "auto: issue #N"` with timeout 3600; best-effort rollback on failure (only outside iteration); summary; `candidate.json` for the candidate's JSON |
| `scripts/gh-select-issue.sh` | **New**: bash+python3 selector with issue #81's criteria 1-6 (`ai` label, `status: todo`, never `needs-info`/`blocked`, dependencies by regex with resolution = CLOSED or `status: done`, ranking priority→type→created_at→number); flags `--dry-run`/`--issue`/`--all-states`; single-line JSON output or `NONE`; exit 0/1/2; anti-PR safeguard; never prints tokens |
| `docs/adr-047-auto-resolve-issues.md` | **New**: this document |
| `README.md` | **Modified**: section 6, point 6 — «(Optional) Automatic issue resolution» (workflow, server off/on, activation after the `dev` → `main` promotion, testing with `workflow_dispatch` + `dry_run`) |
| `.opencode/agents/sdd-master.md` | **Modified**: note «Modo autónomo (CI)» — in automatic sessions (prompt «AUTOMÁTICA de SDD lanzada por GitHub Actions»), do not ask the user; proceed with the full flow and report at the end |
| `.github/workflows/auto-resolve-issues.yml` (iteration 2, issue #120) | **Modified**: iteration via comment accepts `status: blocked` (unblock → in-progress); `workflow_dispatch` + `issue_number` builds the candidate directly (manual resumption of blocked issues, `resume`/`prev_status` outputs); the ITERATION MODE prompt also applies to the forced dispatch and instructs detecting and updating the branch's existing PR (`gh pr list --head` + `gh pr edit`) instead of duplicating it; rollback returns to the previous state; header documents activation per event (pull_request → merge ref; issues/issue_comment → default branch) |
| `docs/adr-047-auto-resolve-issues.md` | **Modified**: sections 7-b (Permission denied, iteration 1) and 7-c (resuming blocked issues, iteration 2) |
| `tasks/task-issue-81.json` | Task file of the task (title/description, acceptance criteria, DoD and the `issue` block with issue #81) |
| `docs/manual-de-usuario.md` | **Unchanged** (internal infrastructure; AGENTS.md's rule 3 does not apply) |
| `.github/workflows/auto-resolve-issues.yml` (iteration 3, issue #128) | **Modified**: steps `wip-restore` (between "Claim" and "Build prompt"; `git ls-remote` + fetch + `checkout -B` of `origin/wip/issue-N`) and `wip-save` (between "OpenCode Session" and "Rollback"; `if: failure()`, working tree commit + micro-commits on `wip/issue-N` with pathspec exclude of `candidate.json`/`sdd_prompt.md` and `--force` push, best effort); micro-commit instructions (4a) and publishing from WIP state (5a) in the normal prompt; WIP reminder at the end of the ITERATION MODE |
| `docs/adr-047-auto-resolve-issues.md` | **Modified**: subsection 7-d (progress protection on failures from the free model's tokens) |
| `README.md` | **Modified**: section 6, point 6 — note on the WIP protection (if the session fails due to tokens, the progress is saved to `wip/issue-N` and restored on the next attempt) |

Related issue: #81 — https://github.com/gonzalitojh/personal-tracker/issues/81

### 9. Later note — issue closure on PR merge (ADR-053, issue #143)

The session's prompt **NO LONGER instructs writing "Closes #N"** in the PR body (neither in normal mode nor in ITERATION MODE): the keyword does not work on `dev` (GitHub only auto-closes when merging into the default branch; ADR-029/ADR-053) and the issue's closure + `status: done` are applied by the workflow `.github/workflows/issues-done-on-dev.yml` when merging the PR into `dev`, identifying the issue via the PR's task file, the `issue-<N>`/`task-<N>` branch or a body keyword. The rest of this document remains as a historical record of the automatic resolution's implementation.
