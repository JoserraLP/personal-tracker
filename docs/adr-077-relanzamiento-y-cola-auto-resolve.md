# ADR-077: Automatic relaunch on failure and a run queue in auto-resolve-issues (issue #226)

## Status
Accepted

## Date
2026-08-12

## Context

The workflow `.github/workflows/auto-resolve-issues.yml` (ADR-047 and
the expansions ADR-050, ADR-054, ADR-055) automatically resolves the
backlog of issues with the `ai` label: it selects the most
prioritary issue, launches a headless OpenCode session (the `sdd-master`
agent, the free
model) that creates the branch and the PR against `dev`, and after the session relaunches the
Pages deployment (ADR-050).

Issue #226 reports two problems of today's behavior:

1. **A session failure leaves the issue abandoned until
   a manual trigger**:
   on failure (the free model's tokens, ADR-055's watchdog, a timeout), the
   "Rollback on session failure" step returns the issue to the queue and
   comments the reason, but **does not relaunch anything**: the issue stays in
   `status: todo` waiting for a new event (a new issue, a comment or
   a manual `workflow_dispatch`). If none arrives, it can
   stay unprocessed for days.
2. **Only two runs fit in the queue**: the concurrency
   group `sdd-auto-resolver` with `cancel-in-progress: false` allows 1
   run running + 1 queued; when a 3rd run arrives, GitHub
   **automatically cancels** the previously queued run («Canceling since
   a higher priority waiting request exists»). In practice, if
   N issues are opened in a row, only 2 runs
   run and the rest are lost
   unprocessed (observed in the run itself: issue
   #226's run triggered by the `issues` event got
   `cancelled` when the manual dispatch entered the
   group).

Verified technical findings:

- GitHub released (a 2026-05-07 changelog) **`queue: max`** in the
  concurrency: it queues **up to 100 runs per group** that run **in
  order**, without cancelling the queued ones, when
  `cancel-in-progress` is `false` (or
  undefined). That is exactly the "queue several runs, not
  just two" semantics.
- `gh workflow run` (and the
  `workflow_dispatch` API) **rejects inputs not
  declared** in the workflow with HTTP 422 (`Unexpected inputs provided`).
  Therefore the relaunch needs a declared input (`retry`) and must
  point at a ref whose workflow version declares it:
  `--ref dev` (dev updates before
  main on PR merge; main only after the
  promotion).
- ADR-047's WIP mechanism (section 7-d, issue #128) already keeps a
  failed session's progress in `wip/issue-N` and restores it on
  the next run (`wip-restore`): the relaunch reuses that
  mechanism as-is, so a retry **continues the
  work**, it does not start from
  scratch.
- Runs cancelled **while queued run no step at
  all**: from inside a running run, a step with
  `if: cancelled()` only runs when the active run is
  cancelled, which with `queue: max` and
  `cancel-in-progress: false` only the user can do manually
  (GitHub no longer cancels queued runs). The requirement's "or is
  cancelled" clause (with its caveat "unless the
  user cancelled it manually") is resolved by the **root
  cause**: with the new queue, runs are no longer cancelled
  automatically.

## Decision

**Two changes in `.github/workflows/auto-resolve-issues.yml`:**

### 1. A run queue: `queue: max` in the concurrency group

```yaml
concurrency:
  group: sdd-auto-resolver
  cancel-in-progress: false
  queue: max
```

- Up to **100 queued runs** in the
  group; they run **in order, one session at a time**
  (ADR-047's "one active session" design is kept;
  `cancel-in-progress: false` never kills an active session).
- Queued runs **are no longer cancelled** when a new one arrives: N
  issues opened in a row generate N runs processed sequentially; each
  run selects the most prioritary issue in `status: todo` and claims it to
  `in-progress` (the "Claim" step, anti-race), so each one works
  a different issue.
- The user's **manual cancellation** stays possible (it cancels
  the in-flight run; the next one in the queue starts). There is no
  relaunch in that case: see point 3.

### 2. Automatic relaunch on session failure (with a retry cap)

A new internal input `retry` (a number, default
 0) in `workflow_dispatch`, and the "Rollback on session
failure" step is replaced by "Relaunch or return to the
queue on session failure" (`if: failure() && selected != 'NONE'
&& dry_run != 'true'`), best-effort, with two branches:

- **Retries left** (`retry + 1 <= MAX_RELAUNCHES`, with
  `MAX_RELAUNCHES = 2` → **3 attempts in total**):
  1. The issue **stays in `status: in-progress`** (the relaunch
     resumes it via a dispatch with `issue_number`, which accepts
     any status, and the selector does not re-pick it meanwhile).
  2. The failure is commented on the issue with its reason and the
     attempt (`⚠️ La sesión automática de SDD falló. Motivo: ... Se
     relanza automáticamente (intento N de 3).`; N counts
     the global attempt, the failed one included).
  3. It relaunches: `gh workflow run auto-resolve-issues.yml --ref
     dev -f issue_number=<N> -f retry=<N+1>`.
  4. The relaunched run enters the concurrency's queue (if there are
     other runs, it waits its turn), restores the
     progress with `wip-restore` (issue #128) and
     receives the ITERATION
     MODE prompt (a dispatch with
     `issue_number` →
     `resume=true`): it resumes the task file and updates the
     existing branch/PR.
- **Retries exhausted** (`retry + 1 > MAX_RELAUNCHES`): the previous
  behavior — the
  issue returns to the queue (`status: todo`, or
  `prev_status` if it is a meaningful state other than
  `in-progress`: `blocked`,
  `needs-review`…) with a comment indicating the exhaustion and the
  reason.
- **The relaunch's own dispatch fails** (e.g. in the window before this PR's
  merge, when `dev` does not yet declare the
  `retry` input and the API rejects it with HTTP
  422): the same `return_to_queue` as on exhaustion
  applies (the issue to the queue + a comment "it could not be
  relaunched automatically"), so the issue **never
  stays hung in `in-progress`** with no
  session running.

Robustness details:

- The `retry` input is **sanitized** (digits only) before use;
  the step's own failures are best-effort
  (`|| true`/`|| echo AVISO`): a dispatch failure never
  tinges the run with a false reason.
- The `--ref dev` is deliberate and documented in the YAML: the
  `retry` input only exists in the workflow's new version, and the
  dispatch API validates the inputs against the given ref (HTTP 422 if
  the input is not declared). After the
  `dev → main` promotion, the `dev` ref
  stays valid (dev has the new version).
- The step **does not relaunch without
  `candidate.json`** (the failure preceded the selection:
  checkout/installation) nor on
  `dry_run` runs.
- The steps' order is intact: session →
  `wip-save` (failure) → relaunch/return to the queue
  (failure) → the deploy dispatch (success) → the summary. A deploy
  step's failure does **not** relaunch the session (the steps with
  `if: failure()` already ran).

### 3. Cancellation: do NOT relaunch the manual cancellation

The requirement asks to relaunch if the run "is cancelled, unless
the user cancelled it manually". With `queue: max`:

- GitHub **no longer cancels queued runs** by priority (it was
  the only relevant automatic cancellation: the cause of
  "only two" and of the observed `cancelled`
  run).
- An in-flight run is only cancelled manually
  (`cancel-in-progress: false` protects the active ones). A
  `if: cancelled()` step on a run cancelled **while queued is not
  even run** (there is no job), so relaunching from
  `cancelled()` would relaunch exactly the
  manual cancellations the issue excludes.

That is why **there is no cancellation-based relaunch step**: the
clause is satisfied by the root cause (there are no more
automatic cancellations to relaunch) and the adverse effect of relaunching
an explicit user cancellation is avoided (which would also cancel the
relaunch's retries). It is documented in the workflow's header and in
this ADR.

## Rejected alternatives

- **Removing the concurrency group** (letting GitHub run N runs
  in parallel): rejected — it loses ADR-047's "one
  session at a time" guarantee, multiplies the free model's consumption
  and reintroduces the selection race (two runs could pick
  the same issue before claiming it).
- **Groups per issue** (`group: sdd-${{ inputs.issue_number }}`):
  rejected — it does not solve "queue several runs" of the global backlog
  (the issue number is unknown in the `issues`
  event until selecting) and adds
  complexity without benefit over `queue: max`.
- **Relaunching with `gh workflow run` without the `retry`
  input** (counting retries by another path, e.g.
  `retry: N` labels): rejected — the declared input
  is the simplest mechanism and does not pollute the issue's labels.
- **Relaunching also on `if: cancelled()`**: rejected — with
  `queue: max` cancelling an in-flight run is only manual (the
  only automatic cancellation, of queued runs, disappears), and the
  requirement explicitly excludes the manual cancellation.
- **No retry cap (always relaunch)**: rejected — a systematic
  failure (e.g. the model's quota truly exhausted) would
  launch an infinite loop of runs consuming Actions minutes; the
  cap of 2 retries (3 attempts) balances real
  recovery (with WIP, each attempt advances) and cost.

## Consequences

### Positive

- **A failure no longer abandons the issue**: the session is
  relaunched automatically over the same issue up to
  3 attempts, and each attempt continues the progress
  saved in `wip/issue-N` (issue #128) instead of starting from
  scratch.
- **A real run queue**: N queued runs are processed in order,
  one session at a time; runs are no longer lost to the automatic
  cancellation of the 3rd arriving one (the problem that
  motivated the issue).
- **Traceability**: every failure is commented on the issue with
  reason and attempt; the retries' exhaustion returns the issue to
  the queue with an explicit comment.
- **The issue is protected during the retries**: it stays in
  `in-progress`, so the selector does not re-pick it
  nor does another run adopt it while the relaunch queues.
- **Backwards compatible and best-effort**: if the relaunch's dispatch
  fails (permissions, network), the run does not lie about
  the reason; the previous flow
  (return to the queue + a comment) remains as the last
  resort.

### Negative / Risks

- **Actions minutes consumed in retries**: a systematic failure
  costs up to 3 attempts
  ×
  up to 90 min; mitigated by the cap and by
  ADR-055's watchdog cutting stalled sessions.
- **`queue: max` depends on the feature's availability on
  GitHub**: released in GA (the 2026-05-07 changelog); if the repository's plan did not support it,
  GitHub would reject the workflow when evaluating it from the
  default branch (visible on the first run after the promotion).
  An assumed risk, easy to
  reverse (remove one line).
- **The relaunch uses `--ref dev`**: if `dev` did not
  contain the workflow's new
  version at the moment of failure (e.g. a failure
  before merging), the dispatch would be rejected (HTTP
  422); in that case the
  step applies `return_to_queue` (the issue
  to the queue + a comment) instead
  of
  leaving the issue hung in `in-progress`. After
  this PR's merge, `dev` always
  has the new version.
- **A possible light double processing**: if between the
  failure and the relaunch's execution another queued run selects the same
  issue (only possible if the issue went back to
  `todo` by a pre-this-version path), the
  relaunch resumes it in iteration mode anyway (it updates the existing
  branch/PR, it does not duplicate PRs). An unlikely case with no
  serious consequences.

### Neutral

- **`docs/manual-de-usuario.md` unchanged**: an internal CI infrastructure
  change, not visible to the web's end user (AGENTS.md's rule
  3; the same decision as ADR-047, ADR-050).
- **README updated** (section 6, point 6): the automatic
  relaunch on failure (up to 2 retries) and the run
  queue.
- **The rest of the workflow does not change**: selection,
  claim, WIP, iteration via comment, the deploy dispatch and the summary
  stay intact.

## Created/modified files

| File | Change |
|---------|--------|
| `.github/workflows/auto-resolve-issues.yml` | **Modified**: the `retry` input in `workflow_dispatch` (a number, default 0, sanitized); the concurrency with `queue: max` (the section's and the header's comments updated with the queue and the relaunch); the "Rollback on session failure" step is replaced by "Relaunch or return to the queue on session failure" (best-effort: retries with `gh workflow run --ref dev -f issue_number -f retry`, the issue kept in-progress and a comment per attempt; exhausted → it returns to the queue with `prev_status` and a comment; `MAX_RELAUNCHES=2`); the retry log in the candidate step's dispatch case; the `claim_owner` output removed (nobody consumes it anymore) |
| `README.md` | **Modified**: section 6, point 6 — the automatic relaunch on session failure (up to 2 retries) and queueing several runs |
| `docs/adr-077-relanzamiento-y-cola-auto-resolve.md` | **New**: this document |
| `tasks/task-issue-226.json` | Task file of the task (title/description, acceptance criteria AC1–AC8, DoD and the `issue` block with issue #226) |

Related issue: #226 — https://github.com/gonzalitojh/Registro-personal/issues/226
