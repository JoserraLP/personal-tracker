# ADR-102: Verification of real session completion in auto-resolve-issues (issue #314)

## Status
Accepted

## Date
2026-08-20

## Context

Issue #314 (type: bug, priority: high) reports that the
`.github/workflows/auto-resolve-issues.yml` workflow sometimes «finishes
without completing the task or giving an error or anything»: the run
ends green but the issue is left half-done.

Verified evidence (Actions runs 252 and 253, both on issue #310): both
runs ended with `conclusion: success`, the «Sesión OpenCode» step
returned exit 0, but issue #310 was still in `status: in-progress` and
there was no updated PR nor publisher agent. In run 253 the transcript
shows the model writing «Seguridad PASS... Ahora actualizo la PR #313...»
[Security PASS... Now I update PR #313...] and the session ends right
after, with no further tool calls.

Root cause: `opencode run --auto` terminates with exit code 0 when the
model emits its final message. The free model
(`opencode/deepseek-v4-flash-free`, max variant) sometimes emits that
final message **in the middle of the SDD flow** (e.g. after the security
scan and before the publisher, or while investigating a bug).
`scripts/run-sdd-session.sh` only distinguished stalling
(`SESSION_STALL_LIMIT_SEC` = 1200 s without activity in the opencode
database), total time (`SESSION_TOTAL_LIMIT_SEC` = 5400 s) and exit code
!= 0; an exit 0 was interpreted as success and the workflow continued to
«Disparar despliegue» [Trigger deployment] and «Resumen» [Summary]
without verifying that the task completed. The watchdog does not detect
it because the model **does** have activity until the end: it simply
decides to finish early (probably due to context/token limits of the
free model or a premature final answer).

### Environment restriction discovered

During implementation it was verified (2026-08-20, empirically) that the
session's `GITHUB_TOKEN` (the installed GitHub App token; since issue
#257 the whole session publishes with `github.token`) **does not have
the `workflows` permission**: GitHub rejects any push or ref that
modifies `.github/workflows/*` (rejection checked both in `git push` and
in the Git Data API: blobs/trees/commits are created, but creating or
updating a ref whose history changes a workflow returns 403). This
prevents a session from publishing workflow changes — the first session
that needed to touch one (this one) discovered the limit. That is why
the fix lives in `scripts/`, a directory publishable with the session
token.

## Decision

### 1. Verification of real completion inside `run-sdd-session.sh`

A `verify_completion` function is added to `scripts/run-sdd-session.sh`,
invoked after opencode's exit 0 and before the «session completed
successfully» message:

- **Opt-in by title**: it only verifies if the session title is
  `auto: issue #N` (the exact format the workflow uses to launch it).
  Local use (arbitrary titles) does not verify and its behavior does
  not change.
- **Logic**: it reads the `status: *` label of issue N
  (`gh issue view --json labels`, same extraction as the workflow's
  «Determinar issue candidata» [Determine candidate issue] step: one
  label per line, defensive `head -1` against residuals;
  `gh-issue.sh set-state` guarantees a single `status: *`).
- If the issue is **still in `status: in-progress`**, it is a **false
  success**: the reason is written to `$SESSION_FAIL_REASON` (default
  `session-failure.txt`, the file that the «Relanzar o devolver a la
  cola en fallo de sesión» [Relaunch or return to queue on session
  failure] step includes in the issue comment via `head -c 4000`), a
  `::error::` is emitted and the script exits with **exit 1**.
- **Any other status** (`needs-review`, `blocked`, `done`, `todo` or
  none) → OK (no relaunch).
- **Deliberate fail-closed**: if in an `auto: issue #N` session the
  status cannot be read (network/rate limit), it also fails: relaunching
  is safe and bounded by `MAX_RELAUNCHES`, whereas not verifying would
  reintroduce the bug.

When the workflow's session step fails, the existing failure machinery
comes in (issue #226): `wip-save` saves the progress in `wip/issue-N`
and the workflow is automatically relaunched on the same issue with the
internal `retry` input incremented (max `MAX_RELAUNCHES` = 2 relaunches;
once exhausted, the issue returns to the queue with a comment).

### 2. Justification of the condition

In the normal SDD flow a session that completes **always** ends in
`needs-review` (via publisher) or decides to stop at `blocked`/`todo`;
staying in `in-progress` without publishing is exactly the bug → the
condition produces no false positives in the normal flow.

### 3. Why not in the workflow (evaluated and rejected alternative)

The natural alternative was a verification step in
`.github/workflows/auto-resolve-issues.yml` (between «Sesión OpenCode»
and «Guardar progreso WIP» [Save WIP progress]). It was rejected when
the environment restriction described above was discovered: with the
session token it is impossible to publish any change to
`.github/workflows/*`, so a fix there would be unpublishable by the
sessions themselves (vicious circle: the workflow fix cannot be
published via the workflow). The script is publishable and its contract
is even strengthened: an exit 0 returned by `run-sdd-session.sh`
guarantees the task is really completed.

## Consequences

### Positive

- **The false success stops being silent**: the session (and therefore
  the run) ends red with a clear, actionable reason, instead of green
  without the task completed.
- **The automatic relaunch from issue #226 also covers this case**: the
  issue is retried with the saved WIP context/progress.
- **The reason travels to the issue comment** (via `session-failure.txt`
  and the «Relanzar o devolver a la cola» step) **and to the run log**
  (`::error::`), which makes it possible to diagnose the false success
  without opening the issue.
- **The contract of `run-sdd-session.sh` is stronger**: exit 0 means
  «session finished and task completed»; the verification lives next to
  the exit code decision, where it belongs.
- **No `workflows` permission required**: the change is published with
  the normal session token.

### Negative / Risks

- **Unnecessary relaunch** if an external actor moved the issue to
  `in-progress` during the verification window. Harmless: bounded by
  `MAX_RELAUNCHES` and, once exhausted, the issue returns to the queue
  with a comment.
- **Coupling to the title format** `auto: issue #N`: if the workflow
  changed that format, the verification would stop applying. Documented
  in the script header.
- **Future review**: if one day the flow allowed deliberately finishing
  in `in-progress` (e.g. multi-batch tasks split up), this verification
  would need to be revisited so as not to relaunch in that case.
- **Pending environment issue**: the session token's missing
  `workflows` permission is a latent problem for any future workflow
  change (e.g. issue #314 has only been dodged by living in
  `scripts/`). It is worth reviewing the GitHub App configuration
  (*Workflows* permission) or the workflow's `permissions:` block to
  restore the ability to publish workflow changes.

### Related

- Extends issue #226 (automatic relaunch on session failure) and is
  consistent with #145 (session watchdog), #128 (WIP protection) and
  #245/#257 (comment publication as `github-actions[bot]`).

## Rejected alternatives

- **Shorter fixed timeout in the session**: rejected — it does not solve
  the case: the model is not stalled, it has activity until the end; it
  simply emits its final message before completing the flow.
- **Heuristic over the transcript/log** (e.g. searching for
  «publisher» in the transcript): rejected — fragile, depends on the
  log and model format, and does not distinguish a premature ending
  from a legitimate stop.
- **Verification step in the workflow**: rejected due to the environment
  restriction (missing `workflows` permission in the session token; the
  fix would be unpublishable by the sessions themselves).

Related issue: #314 — https://github.com/gonzalitojh/personal-tracker/issues/314
