# ADR-026: General agent rules — AGENTS.md at the root and mandatory responsiveness

## Status
Accepted

## Date
August 2026

## Context

The free opencode agent (and any agent working on the project) had no fixed
project rules: each agent only knew the instructions of its own file in
`.opencode/agents/`, and the free agent acted only on the user's
conversation. This caused two problems:

1. **Responsiveness was not guaranteed**: the web must look right on
   computer, tablet and mobile (any width), with no page-level horizontal
   scroll and no text off-screen, but there was no rule obliging agents to
   verify it in every task that touches HTML, CSS or UI.
2. **There was no place for general rules**: there was no project rules file
   loaded automatically by opencode; any cross-cutting rule (like
   responsiveness) would have to be repeated manually in every agent or in
   every conversation, with the risk of omissions and inconsistencies.

The goal was to create a **single, automatic place** for the project's
general rules, so that the free agent and any opencode agent (subagents,
build/plan) would always have them present, in any task, without exception.

Related issue: #19 — https://github.com/gonzalitojh/Registro-personal/issues/19

## Decision

Create `AGENTS.md` at the **project root** as the general rules file, with
the section `## Reglas generales` → `### 1. Responsividad obligatoria` as
the first rule. opencode loads `AGENTS.md` automatically into the context of
**all** agents (free, subagents and build/plan), so the rule applies to any
task without needing to invoke a specific agent.

### 1. General rule in the root `AGENTS.md`

The file states that EVERY opencode agent must comply with the rules ALWAYS,
in any task, without exception, and that if a task conflicts with them, the
agent must stop and ask the user for confirmation before continuing.

Rule 1 («Responsividad obligatoria» [Mandatory responsiveness]) defines
**4 verifiable criteria**:

1. **No page-level horizontal scroll** at any width; horizontal scroll is
   only allowed inside containers designed for it (e.g. tables with
   `overflow-x: auto`).
2. **No text off-screen**: titles, dates, author names and long synopses
   must fit their container (`overflow-wrap: break-word`, `min-width: 0` on
   flex/grid children, relative units). No truncating essential content with
   ellipsis on mobile.
3. **Relative units** (%, rem, em, fr, vw/vh, `minmax()`) for widths,
   columns and body typography; avoid fixed `px` in full-width containers.
4. **`overflow-x: hidden` on `body`/`html` is forbidden as a patch**: it
   masks the overflow and can cut content; always fix the root cause.

It also includes the **mandatory verification** for tasks that touch HTML,
CSS or UI:

1. Test at least three widths: **~360 px (mobile), ~768 px (tablet) and
   ~1280 px (desktop)**, with DevTools device mode.
2. Confirm there is no horizontal scroll:
   `document.documentElement.scrollWidth <= window.innerWidth` in the
   console (must be `true`).
3. Test with realistic long content: long titles, dates, URLs or words
   without spaces.

### 2. Reinforcement in `qa-reviewer.md`

The section `## Reglas generales del proyecto` [Project general rules] was
added to `.opencode/agents/qa-reviewer.md`: when the task touches HTML, CSS
or UI, the QA reviewer must also verify the responsiveness rule of the root
`AGENTS.md` (no horizontal scroll nor text off-screen at widths of ~360 px,
~768 px and ~1280 px) and mention any non-compliance in its report.

### 3. Scope and documentation

- **Strict scope**: the first version of `AGENTS.md` contains **only** the
  responsiveness rule; no other rules were added to keep the file bounded to
  the issue.
- **No README reference**: the existence of the rules is not documented in
  the README; the ADR is the sufficient reference.

## Rejected alternatives

- **Include the rule in a specific agent** (e.g. `tdd-ddd-architect.md` or
  `sdd-master.md`): rejected — an agent's instructions are only loaded when
  that agent is invoked; the rule would not apply to the free agent or to
  build/plan, which are precisely those doing the most UI tasks.
- **Global rule in `~/.config/opencode`**: rejected — the global config is
  local to the user's machine, does not travel with the repository, is not
  seen by other collaborators and is not versioned.
- **`.opencode/AGENTS.md`**: rejected — loading this file depends on the
  opencode version and it is less documented than the root `AGENTS.md`,
  which is the standard mechanism.
- **`opencode.json` with `instructions`**: rejected — it solves the same
  thing with more configuration complexity (a JSON file is less readable for
  long rules like the verification checklist).

## Consequences

### Positive
- **The rule reaches all agents**: any opencode agent working on the project
  (free, subagents, build/plan) keeps responsiveness in mind in any task,
  regardless of which agent is invoked.
- **Single, versioned place for general rules**: future general rules will
  be added as numbered points in the same `## Reglas generales` section of
  `AGENTS.md`.
- **Objective verification in UI tasks**: the checklist (3 widths,
  `scrollWidth <= innerWidth`, realistic long content) turns responsiveness
  into a checkable criterion, and the reinforcement in `qa-reviewer.md`
  makes it validated in the QA review too.
- **Solved at the configuration layer, not in code**: no changes to HTML,
  CSS or JS; the rule is preventive (avoids responsiveness regressions in
  future tasks).

### Negative
- **New configuration file to maintain**: `AGENTS.md` must be kept
  consistent with the real project; if the rule became obsolete, it would
  need updating (mitigated by the general nature of the rule and by the ADR
  itself documenting its purpose).

### Neutral
- **`AGENTS.md` complements, does not replace**: agents in
  `.opencode/agents/` keep their specific instructions; the root file adds
  the missing cross-cutting layer.
- **Initial scope limited to responsiveness**: the file is ready to grow
  with new numbered points, but issue #19 only adds rule 1.

## Files created/modified

| File | Change |
|---------|--------|
| `AGENTS.md` | **New**: project general rules; section `## Reglas generales` → `### 1. Responsividad obligatoria` with 4 verifiable criteria and a verification checklist for UI tasks (widths ~360/~768/~1280 px, `scrollWidth <= innerWidth`, realistic long content) |
| `.opencode/agents/qa-reviewer.md` | Section `## Reglas generales del proyecto`: the QA reviewer verifies the responsiveness rule in tasks touching HTML, CSS or UI and reports it |
| `docs/adr-026-agent-rules.md` | **New**: this document |

Related issue: #19 — https://github.com/gonzalitojh/Registro-personal/issues/19
