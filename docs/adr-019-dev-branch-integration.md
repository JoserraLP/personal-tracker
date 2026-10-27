# ADR-019: `dev` branch as the integration branch for the agents' PRs

## Status
Implemented

## Date
August 2026

**NOTE — REFUTATION (ADR-029 / ADR-053)**: the claim in the section "Consecuencias → Neutras" ("GitHub closes the issue with Closes #N when merging the PR into any branch, including dev") is INCORRECT: GitHub only auto-closes issues with closing keywords when merging into the **default branch** (`main`). On `dev` the closure is performed by the workflows: ADR-029 (issue #42) and, currently, ADR-053 (issue #143) with targeted closure of the PR's issue when merging into `dev`.

## Context

Until now, the publisher agent created all Pull Requests against the default branch of the repository (`main`), which meant changes went directly to the production environment without going through an intermediate verification environment.

To solve this, the user created the `dev` branch as the **integration branch**, deployed it to **Cloudflare Pages as the development environment**, and will promote `dev` to `main` when they consider the version stable. Issue #20 splits the work into two parts:

1. **User's part (done)**: creation of the `dev` branch on the remote and a session logged in at Cloudflare Pages for deployment of the development environment.
2. **Agent's part (this task)**: configure the agents so that ALL PRs target `dev` as base branch (instead of `main`).

Related issue: #20 — https://github.com/gonzalitojh/Registro-personal/issues/20

## Decision

Configure the agents' publishing flow so that `dev` is the integration branch for all work, with the following components:

### 1. PRs against `dev` as base branch

The publisher creates **all** PRs against the `dev` branch (not against the repository's default branch):

```
gh pr create --base dev --title "<title>" --body "<body>"
```

If `gh pr create --base dev` fails, the publisher must verify that `origin/dev` exists and that the feature branch has commits, reporting the error if not.

### 2. Feature branches created ALWAYS from `origin/dev`

Feature branches are always created from `origin/dev` —never from the current branch nor from `main`— so that the PR diff against `dev` is clean:

- `git checkout -b <branch-name> origin/dev`
- If the feature branch already exists locally, it is **not recreated**: `git checkout <branch-name>` is done, and `git rebase origin/dev` if needed.

### 3. Pre-flight verification of `origin/dev`

Before publishing, the publisher runs `git fetch origin --prune` and verifies that `origin/dev` exists (`git branch -r | grep dev`). If it does not exist, it stops and reports the error.

### 4. Branch flow

- `dev` = **integration** branch: all the agents' PRs are merged here and the Cloudflare Pages development environment deploys from this branch.
- The user promotes `dev` to `main` when they consider the version stable.
- `main` = **production** branch: receives only promotions from `dev`.

## Rejected alternatives

- **Direct PRs against `main`**: rejected because the user would not see the changes in the development environment before they reach production.
- **Vercel, Netlify or GitHub Actions for deploying the development environment**: rejected; Cloudflare Pages was chosen for its deployment limit.

## Consequences

### Positive
- **Verification before production**: all changes are tested in the development environment (Cloudflare Pages, `dev` branch) before the user promotes them to `main`.
- **Clean diffs**: by starting feature branches from `origin/dev`, each PR's diff against `dev` contains only the task's changes.

### Negative
- **Possible occasional conflicts when promoting `dev` to `main`**: if the promotion is not fast-forward, the user will have to resolve conflicts manually.
- **Old feature branches created from `main`**: if `dev` diverges from `main`, an old feature branch may carry unwanted diffs; they must be recreated or rebased against `origin/dev`.

### Neutral
- **Automatic issue closure**: GitHub closes the issue with `Closes #N` when merging the PR into any branch, including `dev` (closure works the same as against `main`).
- **Branch naming does not change**: it follows the pattern `<type-prefix>/issue-<N>-<slug>` (e.g. `fix/issue-18-<slug>`); only the PR's base branch and the origin of feature branches change.

## Created/modified files

| File | Change |
|---------|--------|
| `.opencode/agents/publisher.md` | Pre-flight `git fetch origin --prune` with verification of `origin/dev`, checkout of feature branches from `origin/dev` (with rebase if the branch already exists) and `gh pr create --base dev` on all PRs |
| `.opencode/agents/sdd-master.md` | Note in Step 5 (Publishing): all PRs are created against `dev`, never against `main`; the user promotes `dev` to `main` when the version is stable; the publisher applies `--base dev` automatically |
| `docs/adr-019-dev-branch-integration.md` | **New**: this ADR documenting the branch flow `dev` (integration) → `main` (production) |
