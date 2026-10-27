# ADR-078: auto-resolve-issues' failure comments published by github-actions[bot] (issue #245)

## Status
Accepted

## Date
2026-08-13

## Context

The workflow `.github/workflows/auto-resolve-issues.yml` (ADR-047 and
the expansions ADR-050, ADR-054, ADR-055, ADR-077) automatically resolves
the backlog of issues with the `ai` label. Among its triggers is
`issue_comment: types: [created]` (iteration: a comment on an ongoing
issue relaunches the session over that issue), and the `resolve` job (line 95 of
the YAML) filters in its `if` that the comment's author is not
the bot:

```yaml
|| (github.event_name == 'issue_comment' && !github.event.issue.pull_request
                                         && github.actor != 'github-actions[bot]')
```

Issue #245 reports a bug (priority medium) of the "Relaunch or
return to the queue on session failure" step (ADR-077): the comments that
step publishes on the issue when the SDD session fails (the return
to the queue with `return_to_queue`, or the automatic
relaunch's notice) were published with
`gh issue comment` using the job's `GH_TOKEN`
(`${{ secrets.WORKFLOW_GIT_TOKEN }}`, the owner's PAT).

**The verified root cause**: publishing the comment with the
owner's PAT made the comment appear signed by
`gonzalitojh`, so the `issue_comment` trigger's
`github.actor != 'github-actions[bot]'`
filter **did not exclude it**: the failure comment itself re-fired the
workflow over the same issue. In the relaunch case, the issue
stays in `status: in-progress`
during the retries (ADR-077), so
the failure comment launched a **new
iteration session** duplicating the already-queued relaunch (or running unwanted
iterations over the same issue).

## Decision

**Publish the failure comments with the runner's built-in
`GITHUB_TOKEN`** (the author:
`github-actions[bot]`), which the trigger's filter already
excludes. A minimal and surgical change in the workflow's "Relaunch or
return to the queue on session failure" step:

- **`return_to_queue`** (exhausted retries or the relaunch's
  dispatch failed): the «Se devuelve la issue a la cola
  (status: ...)» `gh issue comment`
  uses `GH_TOKEN="$GITHUB_TOKEN"`.
- **The relaunch comment** («Se relanza automáticamente (intento N
  de 3)»): the `gh issue comment`
  uses `GH_TOKEN="$GITHUB_TOKEN"`.
- **The step's other operations keep using the job's `GH_TOKEN`
  (PAT)**: the labels' `set-state`s (`bash scripts/gh-issue.sh`) and the
  relaunch's `gh workflow run` require actions/workflow permissions that
  the `GITHUB_TOKEN` does not grant (the
  workflow's `actions: write` signs the
  `workflow_dispatch` with its own token, not with
  the runner's).
- **Explanatory comments** in the workflow's header and on the step
  itself documenting the why (the automatic token vs
  PAT, issue #245).
- **README.md section 6, point 6**: a note
  about the failure comments' author
  (`github-actions[bot]`, so they do not re-fire the
  workflow).

The `if: failure()`, the
retries' semantics, the queue (`queue: max`,
ADR-077), issue #128's WIP and the rest
of the flow stay intact.

## Rejected alternatives

- **Expanding the job's `if` filter to exclude the owner
  too** (`github.actor != 'gonzalitojh'`):
  rejected — it would censor the owner's legitimate comments on an
  ongoing issue (iteration via comment is a real
  user flow, ADR-047 section 7-c), and it would leave the underlying
  problem (the bot's comments signed by the
  owner, a misleading author in the issue's thread).
- **Using the `GITHUB_TOKEN` for the whole step** (including the labels
  and the relaunch's dispatch): rejected — the automatic token has no
  permission for `gh workflow run` (it requires
  `actions: write`, which the
  runner's `GITHUB_TOKEN` does not expose for
  `workflow_dispatch`), so
  ADR-077's relaunch would fail; besides the agent needs the PAT for
  commits/pushes with the owner's identity in the
  rest of the job.
- **Not commenting on failure** (removing the step's comments):
  rejected — it would lose the failures' traceability on the issue
  (reason and attempt, ADR-077: «Traceability») that is part of the
  flow's value; the bug is not
  commenting, but the author it comments as.

## Consequences

### Positive

- **Failure comments no longer re-fire the workflow**: being published
  as `github-actions[bot]`, the
  `issue_comment` trigger's
  `github.actor != 'github-actions[bot]'` filter excludes them; already-queued
  relaunches are not duplicated and unwanted iterations are not launched
  over the same issue.
- **Least privilege**: the failure comments (the only operation of the
  step not requiring actions/workflow permissions) use the minimal
  repo-scoped automatic token; the more privileged PAT remains only where
  needed.
- **A coherent author**: the automatic notices are
  signed with the same actor the rest of the
  automation already uses (the
  checkout's commits with
  `github-actions[bot]`), so the issue's thread does not look like it
  carries the owner's comments.

### Negative / Risks

- **`GITHUB_TOKEN` is only valid inside the run that emits it**: the
  comments publish at the failure moment, inside the same
  job, so there is no practical risk; but the
  token cannot be reused
  outside
  the run (e.g. in a later dispatch) — something the step does not
  need.
- **The `GITHUB_TOKEN` has no `actions: write`**: that is why the change
  is partial (only the two `gh issue comment`s); if a future change wanted
  to use the automatic token for `gh workflow run`, it would require
  additional unavailable permissions (mitigated: the PAT keeps covering
  that operation).
- **The step still depends on the PAT for the other operations**: a
  comment's failure was already
  best-effort (`|| true`), and the relaunch
  keeps working as in ADR-077.

### Neutral

- **`docs/manual-de-usuario.md` unchanged**: an internal CI
  infrastructure change (the author of an
  automatic failure comment), not visible to the web's end user
  (AGENTS.md's rule 3; the same decision as ADR-047,
  ADR-077).
- **README updated** (section 6, point 6): a note
  about the failure comments' author.
- **The rest of the workflow does not change**: selection,
  claim, WIP, retries, the queue, the deploy dispatch and the summary
  stay intact.

## Created/modified files

| File | Change |
|---------|--------|
| `.github/workflows/auto-resolve-issues.yml` | **Modified**: in the "Relaunch or return to the queue on session failure" step, the two `gh issue comment`s (the `return_to_queue` function and the relaunch's notice) use `GH_TOKEN="$GITHUB_TOKEN"` (the author: `github-actions[bot]`); explanatory comments of the why (issue #245) in the workflow's header and on the step; the other operations (the labels' set-state, `gh workflow run`) keep using the job's `GH_TOKEN` (the PAT) |
| `README.md` | **Modified**: section 6, point 6 — a note about the failure comments' author (`github-actions[bot]`, they do not re-fire the workflow) |
| `docs/adr-078-comentarios-fallo-github-actions.md` | **New**: this document |
| `tasks/task-issue-245.json` | Task file of the task (title/description with the root cause, acceptance criteria AC1–AC5, DoD and the `issue` block with issue #245 — https://github.com/gonzalitojh/personal-tracker/issues/245) |

Related issue: #245
