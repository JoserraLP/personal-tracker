# ADR-094: The whole auto-resolve-issues SDD session publishes as github-actions[bot] (issue #257)

## Status
Accepted

## Date
2026-08-13

## Context

The workflow `.github/workflows/auto-resolve-issues.yml` (ADR-047 and
the expansions ADR-050, ADR-054, ADR-055, ADR-077, ADR-078) automatically
resolves the backlog of issues with the `ai` label by launching a headless OpenCode session (the
`sdd-master` agent + subagents, the publisher among them). The session
performs write operations on issues
and PRs:

- the **publisher** creates the PR with the
  `gh pr create` and, on
  iterations, updates and comments with the
  `gh pr edit` / the
  `gh pr comment`;
- the session publishes comments on issues and syncs
  the labels (the
  `scripts/gh-issue.sh set-state/set-type`).

The `resolve` job defines at job level the
`GH_TOKEN: ${{ secrets.WORKFLOW_GIT_TOKEN }}`
(the owner's PAT),
and the session launches with
the
`bash scripts/run-sdd-session.sh`, which inherits
all the job's env. Therefore ALL those
`gh` operations
of the
session were published signed
by
the
owner
 (the
 `gonzalitojh`), not by the
 GitHub Actions user.

Issue #245 (ADR-078, PR #247) fixed ONLY
  the two failure comments of the
  "Relaunch or return to the queue"
  step (the
  workflow's
  `gh issue comment`s moved to the
  `GH_TOKEN="$GITHUB_TOKEN"` → the
  author of the
  `github-actions[bot]`).
  Issue #257 extends
  the requirement to EVERYTHING:
  all the comments the workflows make on issues or PRs,
  as well as any issue or PR they create,
  must publish from the GitHub Actions user, with their explanatory
  messages included.

**The root cause**:
  the job's env with the PAT. Besides
  the misleading
  authorship in the
  issue/PR thread, it has a functional consequence: the
  `issue_comment: types: [created]`
  trigger filters only
  on
  the
  `github.actor != 'github-actions[bot]'`,
  so a comment
  published
  by
  the
  session with the
  owner's
  PAT **re-fires the workflow** over that same issue
  (a
  duplicate
  or unwanted
  iteration).

## Decision

**Launch the SDD session with the runner's built-in
`GITHUB_TOKEN`** (the
author: the
`github-actions[bot]-session`
merge), via an env override at STEP level in the
workflow's "OpenCode Session" step:

```yaml
env:
  GH_TOKEN: ${{ github.token }}
```

The step's override only replaces the
`GH_TOKEN`; the rest of the
job's env (the
`OPENCODE_API_KEY`, the
`RETRY_INPUT`) stays
inherited. With this, ALL the
session's
`gh` operations
(the
publisher's PRs, the
iterations' `gh pr edit/comment`,
the issue comments and the labels' sync) publish with
the author of the
`github-actions[bot]`,
which the `issue_comment`
trigger's filter already excludes (the same principle as the
ADR-078).

Verified coverage of permissions: the
job's `permissions:`
block already grants the
`GITHUB_TOKEN`
the
`contents: write` (the
agent's commits/pushes), the
`pull-requests: write` (the
`gh pr create/edit/comment`),
the
`issues: write` (comments and labels) and the
`actions: write`. Git pushes
are NOT affected by the change: git does not use the
`GH_TOKEN` — the
`actions/checkout` leaves
the
credentials (the
github.token)
and the
identity is already
the
`github-actions[bot]`
(the "Git
identity"
step).

**The job's PAT is reserved for the steps needing it only**
(outside the session):
the relaunch's
`gh workflow run` and the
`deploy-all-branches` dispatch
(they require
`actions: write` for the dispatch, the same criterion as the
ADR-078), and the workflow's own
steps'
labels'
`set-state`s
(the claim and the failure) which have no visible
comment authorship.

## Rejected alternatives

- **Instructing the agent in the prompt to prefix the
  `GH_TOKEN="$GITHUB_TOKEN"`**
  onto every comment/PR command:
  rejected — fragile and model-dependent; an
  agent could omit
  it and publish as the owner
  again. The env override is deterministic: the
  session cannot publish with the PAT even if it
  tries.
- **Changing the whole job's env to the
  `${{ github.token }}`**:
  rejected — the relaunch steps (the
  `gh workflow run`) and the deploy dispatch
  need the PAT for
  the
  `actions: write` outside the session's
  scope (the
  same argument as ADR-078).
- **Expanding the job's `if` filter**
  to also exclude the owner:
  rejected in ADR-078 —
  it would censor the owner's legitimate comments
  (an iteration via comment is a
  real user flow,
  ADR-047's section 7-c).
- **Overriding the ADR-078** instead of creating a new one:
  rejected — the
  ADR-078 is the
  partial fix's
  (#245) historical record;
  this ADR extends
  it and references
  it.

## Consequences

### Positive

- **All the session's authorship is the
  `github-actions[bot]`**:
  the publisher's
  created
  PRs, the
  PR/issue comments (the
  explanatory messages included) and the labels'
  changes appear
  signed
  by the
  bot, never by the owner
  (issue #257's requirement).
- **The session's comments no longer re-fire the workflow**:
  being published as the
  `github-actions[bot]`, the
  `issue_comment`
  trigger's filter excludes
  them; the
  duplicate or unwanted
  iteration sessions caused by the
  session's own comments are removed.
- **Least privilege**: the session (which needs no
  `actions: write` for
  anything) uses the minimal
  repo-scoped automatic token; the
  more
  privileged
  PAT remains only where needed.
- **A coherent author**: the
  session signs with the
  same actor already signing
  the
  commits
  (the
  `github-actions[bot]`) and the failure
  comments (the
  ADR-078).

### Negative / Risks

- **The
  `GITHUB_TOKEN` is only valid inside the
  run that emits it**: the session publishes its
  PRs/comments inside the same run,
  so there is no practical risk;
  it cannot be reused outside the
  run
  (not needed).
- **The
  `GITHUB_TOKEN` exposes no
  `actions: write` for
  the
  `workflow_dispatch`**
  (the
  ADR-078's criterion): if
  someday the session needed
  relaunching
  workflows with
  a
  `gh workflow run`,
  this decision would have to
  be
  reviewed
  (mitigated: today the
  session never
  launches
  workflows;
  the
  dispatches are the
  workflow's steps with the
  PAT).
- **The workflow's steps that keep
  the
  PAT**
  (the
  claim and the failure) show
  the
  owner as the
  actor on the
  timeline's
  label
  events: outside
  the
  issue's
  scope (they are
  not
  comments nor
  created
  issues/PRs) and
  with no functional
  effect
  (a label
  change
  does not fire the
  workflow).

### Neutral

- **The
  `docs/manual-de-usuario.md` unchanged**: an internal CI infrastructure
  change (the
  author of the automation's comments/PRs), not visible to the
  web's end user (AGENTS.md's rule 3; the
  same decision as the
  ADR-047, ADR-077, ADR-078).
- **The README updated**
  (section 6, point 6): the failure comments' note
  (the
  ADR-078) generalizes to all the
  session's comments, PRs
  and label
  changes.
- **The rest of the workflow does not change**: the
  selection, the claim, the
  WIP, the retries, the queue, the deploy dispatch and the
  summary stay intact; the
  two failure comments keep
  ADR-078's
  fix.

## Created/modified files

| File | Change |
|---------|--------|
| `.github/workflows/auto-resolve-issues.yml` | **Modified**: the "OpenCode Session" step adds an `env: GH_TOKEN: ${{ github.token }}` (a step override; the author of ALL the session's gh operations: the `github-actions[bot]`); an explanatory note in the workflow's header alongside issue #245's block |
| `README.md` | **Modified**: section 6, point 6 — the author's note now covers all the comments, PRs and label changes of the session and of the failure steps (the `github-actions[bot]`; they do not re-fire the workflow) |
| `docs/adr-094-comentarios-sesion-github-actions.md` | **New**: this document |
| `tasks/task-issue-257.json` | The task's task file (the title/description with the root cause, the acceptance criteria AC1–AC5, the DoD and the `issue` block with issue #257 — https://github.com/gonzalitojh/Registro-personal/issues/257) |

Related issue: #257
