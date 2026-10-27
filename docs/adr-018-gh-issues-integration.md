# ADR-018: Integration of GitHub Issues as a task source for the AI agents

## Status
Implemented

## Date
August 2026

**NOTE — SUPERSEDED REGARDING THE LABEL SCHEME AND CLOSURE**: the `ai-*` scheme described here is replaced by that of ADR-034 (issue #74): shared `status: *` states, the `ai` label as an agent marker, and issue closure when promoting `dev` to `main` (workflow `issues-done-on-main.yml`), not when merging the PR — and this closure point is in turn superseded by ADR-053 (issue #143): closure happens again when **merging each PR into `dev`** (workflow `issues-done-on-dev.yml`, scope targeted at the PR's issue). The rest is kept as a historical record.

## Context

Until now, the AI agents in the SDD flow received their tasks exclusively through local files in `tasks/` (created manually by the user) or through direct requests in the conversation. This created several problems:

1. **Lack of traceability**: there was no link between the work performed by the agents and the repository's GitHub Issues; it was impossible to know which issue each task came from.
2. **Manual issue closure**: when a change was merged, the corresponding issue had to be closed by hand; GitHub's automatic closure via keywords in the PR description (`Closes #N`) was not used.
3. **Out-of-sync labels**: issues did not reflect the actual state of the task (pending, in progress, in review, blocked, completed), nor was their type classification corrected (`type: feature|bug|style|refactor|content`).
4. **The user could not consult pending work**: there was no way to ask which issues were open in order to decide which one the agent should tackle, since the local task was only created at the moment of adoption.

The goal was to make GitHub Issues the **task source** of the SDD flow: agents only process issues labeled with `ai-*` (the rest are user issues), the user can consult them and choose which one to tackle, the local task is created upon adoption, and the issue's labels stay in sync with the SDD state on every transition.

Related issue: #18 — https://github.com/gonzalitojh/personal-tracker/issues/18

## Decision

Integrate GitHub Issues as the task source of the SDD flow, with the following components:

### 1. Business rule: only issues with label `ai-*`

The SDD master agent **only adopts issues that have some `ai-*` label** (`ai-todo`, `ai-in-progress`, `ai-needs-review`, `ai-blocked`, `ai-done`). If the issue does not have one (or is closed), the agent politely declines the adoption and lists those available with `scripts/gh-issue.sh list --todo`, since those issues correspond to user work.

### 2. Query and adoption flow in `sdd-master.md`

Two new steps were added to the master agent:

- **Step 0 — Request interpretation**: distinguishes between *consultation* (listing issues: `--all`, `--todo`, `--review`, `--blocked`, `--done`, `--type <type>`) and *adoption* ("tackle issue #N"). In consultations **no** local task is created: only the information is presented so the user can decide.
- **Step 0-b — Adoption of an issue**: fetches the details (`scripts/gh-issue.sh show <N>`), verifies the `ai-*` rule, checks whether `tasks/task-issue-N.json` already exists (in that case the task is resumed, reconciling local state and issue labels without recreating it), and if not, creates it with the block:
  ```json
  "issue": { "number": 18, "url": "https://github.com/.../issues/18", "title": "..." }
  ```
  It also verifies/corrects the type label (`set-type`) if it is missing or misclassified, removes the user label `todo` if present, and sets the initial state label (`ai-todo` or `ai-in-progress`).

### 3. State label synchronization (Step 3-b)

On **every transition** of the task, the master agent synchronizes the issue's state label (exactly one at a time), according to the mapping:

| Local task state | Issue label | When |
|--------------------------|-------------------|--------|
| `created` / `planned` | `ai-todo` | Adopted but not yet implemented |
| `implemented` / `validated` / `security-cleared` / `documenting` | `ai-in-progress` | Active work |
| `blocked` | `ai-blocked` | Requires user input or repeated failures |
| `review` (PR created) | `ai-needs-review` | Applied by the publisher after creating the PR |
| `done` / `published` | `ai-done` | PR merged and issue closed (verified) |

Synchronization is **best-effort**: if the command fails (network, rate limit), the failure is logged in the report and the flow continues; it never blocks the SDD process.

### 4. Correction of type labels

It is verified that the issue has exactly one label `type: feature|bug|style|refactor|content`. If it is missing or clearly misclassified, it is corrected with `scripts/gh-issue.sh set-type <N> <type>`. If the classification is ambiguous, the user is asked instead of guessing.

### 5. Automatic issue closure on merge (`publisher.md`)

The publisher extracts the issue number from the `issue` block of the task file, names the branch including the issue (`fix/issue-18-<slug>`), includes `Closes #N` as the **first line of the PR body** (GitHub closes the issue automatically on merge) and, after creating the PR, applies `scripts/gh-issue.sh set-state <N> ai-needs-review`. If the task file has no `issue` block, both the `Closes #N` and the label update are skipped.

### 6. Reconciliation at login (Step 6)

At the start of a session (or when the user requests it), the master agent:
- Lists the issues in `ai-needs-review`; if the PR was already merged and the issue is closed, it applies `ai-done` and marks the local task as `published`.
- Lists the issues in `ai-blocked` and asks the user whether to resume them.

### 7. `/issues` command for the user

New opencode command (`.opencode/command/issues.md`) that allows querying the repository's issues without creating tasks: `--all`, `--todo`, `--review`, `--blocked`, `--done`, `--type <type>`, `--help`. Results are presented in a readable table (number, type, title, state, agent/user), highlighting how many are ready to be tackled (`ai-todo`).

### 8. Helper `scripts/gh-issue.sh`

Central bash script that encapsulates all interaction with the GitHub API (via `gh`) with the following guarantees:

- **Allow-lists**: it only touches labels from the `AI_STATES` lists (`ai-todo`, `ai-in-progress`, `ai-needs-review`, `ai-blocked`, `ai-done`) and `TYPES` (`feature`, `bug`, `style`, `refactor`, `content`). It never manipulates other labels.
- **Idempotency**: `set-state` and `set-type` remove labels of the same category before adding the new one (excluding the target due to the behavior of `gh 2.45`, which processes `remove-label` before `add-label`), guaranteeing exactly one state label and one type label.
- **Rejection of closed issues**: only the terminal transition `ai-done` is allowed on a closed issue; any other change to a closed issue aborts with a warning.
- **Anti-PR safeguard**: it checks via the API whether the number corresponds to a Pull Request and, in that case, aborts without modifying its labels.

### 9. New labels in GitHub

The missing labels were added to complete the flow's taxonomy:
- **Priority**: `priority: high`, `priority: medium`, `priority: low`.
- **Nature**: `question`.

Alongside the already existing ones (`type: feature|bug|style|refactor|content` and `ai-todo|ai-in-progress|ai-needs-review|ai-blocked|ai-done`).

### 10. Adjustments in auxiliary agents

- **`qa-reviewer.md`**: when validating a task that references an issue, it verifies (informative, not blocking) that the labels reflect the state: `ai-in-progress` during validation and a type consistent with the reviewed change; if there is an inconsistency, it reports it to the master so it can synchronize.
- **`documentation-sync.md`**: when documenting, if the task references an issue, the ADR must include `Related issue: #<N>` with the URL; ADR numbering is always computed as the **maximum of the existing numbers in `docs/adr-*.md` + 1**, to avoid collisions due to the historical duplicates (adr-008 and adr-009).

## Rejected alternatives

- **Keeping only local tasks in `tasks/` without GitHub Issues**: rejected because it provides no traceability, does not allow automatic issue closure or label synchronization, and the user could not consult the state of the work.
- **Synchronizing state via the issue's title or body** (e.g. prefixes `[TODO]`/`[DONE]`): rejected because labels are GitHub's native mechanism, queryable via the API and visible on the web; the title text is also used to build the task.
- **A bot/Actions workflow for GitHub Actions to synchronize labels**: rejected as over-engineering: the agents already have an authenticated `gh` and the helper covers synchronization with business logic (allow-lists, safeguards) that an external flow would complicate.
- **Creating the local task automatically for all issues with `ai-*`**: rejected because the user must decide which one to tackle; the task is created **at the moment of adoption**, not before (explicit requirement of issue #18).
- **Removing user state labels (`todo`, `in-progress`, `done`, `blocked`)**: rejected: they are kept to distinguish user issues from agent ones (`ai-*`); in fact the script and the master explicitly distinguish both categories in queries.

## Consequences

### Positive
- **Full traceability**: issue → local task (`task-issue-N.json`) → branch `issue-N-<slug>` → PR with `Closes #N` → issue closed automatically on merge.
- **The user controls the agent's work**: they can query which issues are open/pending/completed and choose which to tackle; the task is only created on adoption.
- **Visible state in GitHub**: the `ai-*` labels reflect the SDD state at all times, and the type and priority classification is correctable by the agent.
- **Helper safety**: allow-lists, idempotency, rejection of closed issues (except `ai-done`) and the anti-PR safeguard prevent accidental mutations of issues/PRs.
- **Resilience**: label synchronization is best-effort; a network failure or rate limit does not block the SDD flow.

### Negative
- **Dependence on an authenticated `gh`**: the whole issue flow requires the GitHub CLI with permissions over the labels; without it, queries and synchronizations fail (reported but not blocking).
- **GitHub state can become stale**: if an agent forgets to synchronize or the command fails repeatedly, the label may not reflect the real state until the reconciliation of the next session.
- **Issues without an `ai-*` label are outside the flow**: by design the agent does not process them; the user must label them to delegate them.

### Neutral
- **New label taxonomy** (state `ai-*`, type `type:*`, priority `priority:*`, `question`) that must be kept coherent in the repository; the helper centralizes them in two allow-lists.
- **Branch naming with the issue**: `fix/issue-18-<slug>` identifies the origin of the work, but can be verbose for large numbers.
- **ADR numbering** is now computed as max + 1 due to the historical duplicates (adr-008 and adr-009), and each ADR linked to an issue carries `Related issue: #<N>`.

## Created/modified files

| File | Change |
|---------|--------|
| `.opencode/agents/sdd-master.md` | Steps 0/0-b (issue consultation/adoption), Step 3-b (label mapping per state), Step 6 (reconciliation at login: merged PRs → `ai-done`) |
| `.opencode/agents/publisher.md` | Extraction of the issue number from the task file, branch `issue-N-<slug>`, `Closes #N` as the first line of the PR body, `set-state N ai-needs-review` after creating the PR |
| `.opencode/agents/qa-reviewer.md` | Informative verification of state/type labels when reviewing tasks from issues |
| `.opencode/agents/documentation-sync.md` | ADR numbering rule (max + 1) and `Related issue: #N` line with URL |
| `.opencode/command/issues.md` | **New**: `/issues` command with filters `--all/--todo/--review/--blocked/--done/--type` |
| `scripts/gh-issue.sh` | **New**: bash helper (`list`, `show`, `set-state`, `set-type`) with allow-lists, idempotency, rejection of closed issues and anti-PR safeguard |
| `tasks/task-issue-18.json` | **New**: local task generated upon adoption of issue #18, with `issue` block {number, url, title} |
| GitHub labels | **New**: `priority: high/medium/low` and `question` (alongside the already existing `type:*` and `ai-*`) |
