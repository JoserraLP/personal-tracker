---
name: opencode-sdd-team
description: Spec-Driven Development (SDD) workflow for a multi-agent team in OpenCode. Use whenever the user starts a new project or feature, asks for a spec.md, API contract, BDD acceptance criteria, task breakdown, or wants to coordinate architect, orchestrator, developers, reviewer, QA and DevOps agents, even if they do not say "SDD".
---

# SDD Multi-Agent Workflow

Agents are defined in `opencode.jsonc`, key `agent` (`spec-architect`, `orchestrator`, `tech-lead`, `dev-frontend`, `dev-backend`, `code-reviewer`, `qa-engineer`, `devops`, `debugger`). This skill is only the protocol. Role prompts live in the agent config; do not repeat them.

## Files (single source of truth)

- `spec.md`: what to build. Written only by `spec-architect`. Template: `references/spec-template.md` (read it only when drafting a spec).
- `tasks.md`: execution matrix (ID, owner, files, spec refs, status). Written only by `orchestrator`. Kept apart from `spec.md` so status updates never rewrite the spec.
- Large specs: split into `spec/api.md`, `spec/data.md`, `spec/ui.md`; `spec.md` keeps the index plus acceptance criteria.

Every requirement, contract and scenario has a stable ID (`REQ-001`, `API-003`, `AC-007`). Agents cite IDs; they never paste spec text into prompts or replies.

## Flow and gates

1. **Spec** (`spec-architect`, primary). Ask at most 5 clarifying questions, then draft `spec.md`. 
2. **Spec review** (`code-reviewer`, launched by the architect). Checks ambiguity, missing error cases, untestable criteria. Max 1 revision round.
3. **Human gate.** The user approves `spec.md`, then switches to `orchestrator` (Tab). Nothing is built before approval; this prevents the most expensive failure (building the wrong thing).
4. **Plan** (`orchestrator`). Fills `tasks.md`. Each task: one owner, a disjoint file list, spec IDs, a definition of done.
5. **Build** (`tech-lead` first for scaffolding and shared patterns, then `dev-frontend` / `dev-backend` in parallel only on disjoint files).
6. **Verify** (`code-reviewer` on `git diff` only; `qa-engineer` writes and runs tests per `AC-*`).
7. **Ship** (`devops`: Dockerfile, CI, release script).

A failed review or test returns to the task owner with finding IDs; the orchestrator allows 2 fix rounds, then launches `debugger` once (strongest model, reserved for this), then escalates to the user.

## Token rules (apply to every agent)

- **Delegate by reference.** A task prompt is: task ID, spec IDs, file paths, definition of done. Nothing else.
- **Read narrowly.** `grep` for the ID, then read only that section. Never re-read a file already in context; never read the whole spec.
- **Handoff contract.** Subagent replies are at most 150 words: status (done/blocked), files changed, open issues. No code in replies, no restating the task.
- **Review diffs, not files.** The reviewer uses `git diff` and cites `file:line` plus the violated ID.
- **Keep the prefix stable.** Provider prompt caching only works if the start of the context does not change. No timestamps or changing counters in system prompts or `AGENTS.md`; do not switch models mid-session; start a fresh session per phase instead of one endless session.
- **Fresh context per task.** Subagents run in clean child sessions; keep each task small enough to finish in about 25 steps.
- **One writer per file.** Parallel tasks must not touch the same path.
- **Shell output stays small.** Prefer `--quiet`, `-q`, `--short`, `| tail -n 40`.

## Definition of done per role

- Developers: code matches contract signatures in the cited `API-*`/`REQ-*`; touched only assigned files.
- Reviewer: zero unresolved findings against cited IDs, or an explicit list.
- QA: every `AC-*` has at least one passing test; a coverage line in `tasks.md`.
- DevOps: build and tests pass in CI config; no secrets in the repo.
