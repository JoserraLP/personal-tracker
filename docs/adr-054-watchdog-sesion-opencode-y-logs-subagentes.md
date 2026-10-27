# ADR-054: opencode session watchdog and subagent logs in auto-resolve-issues (issue #145)

## Status
Accepted

## Date
2026-08-08

## Context

The workflow `.github/workflows/auto-resolve-issues.yml` (ADR-047) launches
headless opencode sessions (agent `sdd-master`, free model
`opencode/deepseek-v4-flash-free`, variant `max`) to resolve backlog issues.
The session was invoked with `timeout 3600 opencode run ...` and the step
with `timeout-minutes: 90`.

Two problems observed in real operation:

1. **Session alive and silent up to 1 hour after a failure**: when the session
   failed (free model's tokens exhausted, `git push` rejected,
   subagent failure...), opencode stayed alive producing no output until
   exhausting `timeout 3600`, burning free GitHub Actions minutes while
   doing nothing. The observed successful runs took 7-25 minutes; the failed
   run burned ~60 minutes until the timeout.
2. **No subagent logs in the action's log**: one only saw the
   start/end of each subagent («• ... subagent» / «✓ ...»), never their
   content, because `opencode run --format json/default` **filters the child
   sessions' parts** (verified in opencode v1.18.7's source,
   `run.ts`, line 717) and `--print-logs` only offers metadata, without
   message content.

Issue #145 asks: (1) stop execution with a proper output when
any component fails, including a subagent; (2) a time limit avoiding
getting stuck on a single step (~10 minutes suggested, adjusted to the
observed runs); (3) the subagents' logs also visible in the action's log.

Related issue: #145 — https://github.com/gonzalitojh/Registro-personal/issues/145

## Decision

### 1. New `scripts/run-sdd-session.sh`: session watchdog

Replaces the workflow's old `timeout 3600 opencode run ...`. Launches
opencode in the background and supervises it:

- **`setsid`**: the session runs in its own process group, so that
  `kill -9 -$PID` also kills the child tools (e.g. a `bash` tool
  running `npm install`), not just the opencode process.
- **`tail -f` of the live log**: the raw output is written to
  `opencode-session.log` and replicated to stdout, keeping the previous
  behavior of live logs in the action.
- **Stall detection**: if there is no new output for
  `SESSION_STALL_LIMIT_SEC` (default **600 s = 10 min**, configurable via env),
  it kills the session, prints the reason with `::error::` and writes it
  to `session-failure.txt`.
- **Total limit**: `SESSION_TOTAL_LIMIT_SEC` (default **2700 s = 45 min**,
  configurable via env), calibrated with the observed runs (successful
  ones of 7-25 min; the failed one burned 60 min). Replaces the fixed
  3600 s timeout.
- **Heartbeat**: every 120 s it prints a «session running» notice with
  the elapsed time, the seconds without output and the log size, to
  keep visibly active the watchdog.
- **Exit codes**: `exit 1` on any failure (stall, total limit or
  non-zero exit code from opencode), which activates issue #128's
  `wip-save` and `rollback` steps; `exit 0` on success. The failure
  reason is always written to `session-failure.txt` (path configurable
  with `SESSION_FAIL_REASON`).
- Other configurable env variables: `SESSION_AGENT` (sdd-master),
  `SESSION_MODEL` (opencode/deepseek-v4-flash-free), `SESSION_VARIANT` (max),
  `SESSION_OUT_LOG` (opencode-session.log).
- Usage: `bash scripts/run-sdd-session.sh <prompt-file> <session-title>`.

### 2. New `scripts/dump-session-transcript.py`: transcript with subagent logs

`opencode run`'s stdout stream does not expose the subagents' content,
but opencode **stores all messages** (primary session and child sessions
linked by `parent_id`) in its local SQLite database
(`~/.local/share/opencode/opencode.db`). The script rebuilds the full
log by reading that database **in read-only mode** (`mode=ro`, URI):

- **Run's primary session**: looked up by exact title + `time_created`
  later than startup (60 s margin) + `parent_id IS NULL` (reinforces it
  being a root session, never a subagent).
- **Child sessions**: recursive CTE over `session.parent_id` to include
  all descendants of the primary session.
- **`assistant` messages of all the run's sessions, in temporal order**,
  with the header `--- HH:MM:SS | agent [subagent] ---` identifying the agent and
  moment.
- **Content**: completed `type=text` parts (`time.end`) and tool errors
  (`type=tool` with `state.status == "error"`).
- **Best-effort**: on any problem (db not found, query
  error, session not found) it prints a warning to stderr and exits with 0 —
  it never makes the workflow fail over a diagnosis.

The script is invoked **always**, both on success and failure, from
`run-sdd-session.sh` with the session title and the startup timestamp in
ms.

### 3. Changes in `.github/workflows/auto-resolve-issues.yml`

- The "OpenCode Session" step now calls
  `bash scripts/run-sdd-session.sh "sdd_prompt.md" "auto: issue #$N"`
  (`timeout-minutes: 60` on the step; the job keeps `timeout-minutes: 90`).
  The watchdog bounds the session well below the step/job timeout.
- **`wip-save`** (issue #128) excludes the new artifacts from the save
  commit, besides `candidate.json` and `sdd_prompt.md`:
  `:(exclude)opencode-session.log` and `:(exclude)session-failure.txt`.
- **`rollback`** includes the failure reason in the issue's comment:
  it reads `session-failure.txt` and appends it with
  `head -c 4000` (truncated to 4000 bytes) as « Motivo: ...».
- **`.gitignore`**: `opencode-session.log` and `session-failure.txt` are
  added as defense in depth (protects against a manual `git add -A`, in
  addition to the wip-save's explicit exclusions).

### 4. SDD flow behavior intact

The rest of the flow is not altered (AC7): micro-commits, PR branch against
`dev`, publisher, claim, WIP restore and deployment stay identical.

## Considerations

- **The watchdog replaces, does not complement, the `timeout`**: the old
  `timeout 3600` is removed; the script's limits (10 min stall,
  45 min total) are much stricter and have an explicit failure reason.
- **The dump is post-mortem, not live**: the full transcript (with
  subagents) prints at the session's end, success or failure; during
  execution the action's log keeps showing only the stream's live output
  (without subagents) — a limitation of opencode itself, not of the script.
- **The run's artifacts do not travel to the repo**: raw log and failure
  reason are excluded from the wip-save and in the `.gitignore`; the
  agent's PR never includes them.
- **No visible changes for the user**: AGENTS.md's rule 3 does not apply
  (`docs/manual-de-usuario.md` not touched).

## Rejected alternatives

- **opencode's `--fail-fast`**: rejected — the flag does not exist in
  v1.18.7.
- **`--format json` to detect errors and show subagents**: rejected —
  verified in v1.18.7's source (`run.ts` line 717): the json/default
  format likewise filters the child sessions' parts; the
  stream's events do not contain the subagents' content.
- **`--print-logs`**: rejected — it only exposes session metadata
  (titles, times), without message content.
- **Reading opencode's storage JSONLs**: rejected — v1.18.7 persists in
  SQLite (`opencode.db`), not JSONL; complemented by direct reading
  of the database, which is the source containing the subagents'
  messages.

## Consequences

### Positive

- **End of the zombie session**: a stalled session (10 min without output)
  or one exceeding the 45 min total is killed with a clear reason in
  `::error::`; GitHub Actions' free minutes stop being burned until the 1
  hour timeout.
- **Full diagnosis**: the transcript with subagent logs (text and
  tool errors) always prints, and the failure reason reaches the
  issue's comment (rollback) and the action's log.
- **Failure chain preserved**: the watchdog's `exit 1` activates `wip-save`
  and `rollback` (issue #128): the intermediate progress is saved to
  `wip/issue-N` and the issue returns to the queue with the reason.
- **Configurable via env**: limits and session parameters adjust without
  touching the workflow.

### Negative / Risks

- **A legitimately long session (>45 min) would be cut**: bounded risk —
  the limit was calibrated with the observed runs (successful ones of
  7-25 min); it is configurable via `SESSION_TOTAL_LIMIT_SEC` if the flow
  changed.
- **Dependence on opencode's local db schema/path**: the dump reads
  `~/.local/share/opencode/opencode.db` with v1.18.7's schema; if a
  future version changed the location or tables, the dump degrades to a
  warning (best-effort) and the workflow does not fail, but the diagnosis
  would be lost.

### Neutral

- **`docs/manual-de-usuario.md` unchanged**: internal CI infrastructure,
  not visible to the end user (rule 3 does not apply).
- **Rest of the SDD flow intact**: micro-commits, PR branch against `dev`,
  publisher, WIP restore and the deployment dispatch are untouched (AC7).

## Created/modified files

| File | Change |
|---------|--------|
| `scripts/run-sdd-session.sh` | **New**: session watchdog — `setsid` (own process group, `kill -9 -PID` also kills child tools), live log `tail -f`, stall (`SESSION_STALL_LIMIT_SEC`, default 600 s), total limit (`SESSION_TOTAL_LIMIT_SEC`, default 2700 s), heartbeat every 120 s, reason in `::error::` + `session-failure.txt`, `exit 1` on failure (activates wip-save/rollback) / `exit 0` on success |
| `scripts/dump-session-transcript.py` | **New**: always dumps the full transcript from opencode's local SQLite db (mode=ro) — primary session by title + `time_created` + `parent_id IS NULL`, recursive CTE of child sessions, assistant messages in temporal order with the header `--- HH:MM:SS \| agent [subagent] ---`, completed `type=text` parts and tool errors; best-effort (never fails the workflow) |
| `.github/workflows/auto-resolve-issues.yml` | **Modified**: the "OpenCode Session" step calls `bash scripts/run-sdd-session.sh "sdd_prompt.md" "auto: issue #$N"` (step `timeout-minutes: 60`, job 90); `wip-save` excludes `opencode-session.log` and `session-failure.txt` (besides `candidate.json` and `sdd_prompt.md`); `rollback` includes the failure reason (`head -c 4000` of `session-failure.txt`) in the issue's comment |
| `.gitignore` | **Modified**: `opencode-session.log` and `session-failure.txt` added (defense in depth against a manual `git add -A`) |
| `docs/adr-054-watchdog-sesion-opencode-y-logs-subagentes.md` | **New**: this document |
| `docs/manual-de-usuario.md` | **Unchanged** (internal CI change, not visible to the user) |

Related issue: #145 — https://github.com/gonzalitojh/Registro-personal/issues/145
