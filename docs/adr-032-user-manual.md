# ADR-032: User manual — `docs/manual-de-usuario.md` in non-technical language and mandatory maintenance rule in `AGENTS.md` (issue #60)

## Status
Accepted

## Date
August 2026

## Context

The web «Personal Tracker» had grown to accumulate many features —statuses per item type (series, movies and books), episode and reading management, histories, searches (TMDB/Google Books/Open Library catalog, own list and global with Ctrl+K), manual creation, organization (grid/list, filters, order, colors), detail profiles with trailer/streaming/saga/recommendations, ratings, quick actions (big button, swipe, undo delete), notifications, profile, settings, sync, privacy, PWA, etc.— without **any end-user-facing documentation** existing. Knowledge of the web's behavior lived only in the code and in the ADRs, written for developers and agents, not for a user who wants to "watch the series they follow tomorrow" or know why a book does not appear in the catalog.

Issue #60 asked for two concrete things:

1. A **complete user manual**, in non-technical language, that any user could read and understand: well organized, with sections and subsections, covering the different statuses and options of each item type, the settings and actions, how often the data updates, how to search, etc.
2. A **rule for the agent** that forces the relevant explanation to be included in that manual whenever changes affecting what the user sees or does are made — so the manual does not become obsolete a few weeks after its creation.

Related issue: #60 — https://github.com/gonzalitojh/personal-tracker/issues/60

## Decision

Create `docs/manual-de-usuario.md`, a complete user manual in Spanish, written in non-technical language (step by step, without technical jargon) and meant for any user of the web, and add a general rule to `AGENTS.md` requiring keeping it up to date. The decision is organized in two parts.

### 1. User manual (`docs/manual-de-usuario.md`)

An 18-section manual (with numbered subsections where required), covering everything that can be done on the web:

1. **What Personal Tracker is**: purpose (private log of series, movies and books), automatic data completion by the web, friend-group model with logs visible in read mode.
2. **How to get in**: Google login, guest list (error message if the email is not on it), automatic account creation, «Salir» button.
3. **The main screen**: header (bell, magnifying glass, gear, sun/moon, photo/name, salir) and the three Series/Movies/Books tabs; default landing on Series with the «Viendo» filter and list view.
4. **Series**: statuses (Pendiente/Viendo/Vista/Standby/Abandonada), adding, watching and marking episodes (with dates), pausing/abandoning/resuming, re-watching from the beginning, watch history, editing and deleting.
5. **Movies**: statuses, adding, marking as watched, re-watch history.
6. **Books**: statuses, adding, starting and finishing readings, current page, reading history, search in Spanish only.
7. **How to search**: catalog (TMDB for series/movies, Google Books and Open Library for books), search within your own list, global search (Ctrl+K), manual item creation.
8. **Organizing and sorting your log**: grid/list view, filters, sorting criteria, colors.
9. **Each movie's, series' or book's profile**: trailer, streaming platforms, sagas, recommendations.
10. **Star ratings**: personal rating and the community score.
11. **Quick actions**: each row's big button, swiping on mobile, undoing a delete.
12. **Notifications**: which alerts arrive and where they are consulted.
13. **Your profile**: statistics, friends, activity, data, settings.
14. **Settings**: theme, notifications, sync now.
15. **When does the data update?**: daily check, filling in of missing data, 30-minute cooldown between syncs.
16. **Privacy**: what is stored, who sees it.
17. **Installing the web on your phone**: PWA installation.
18. **Frequent problems**: solutions to common doubts.

The manual's style: non-technical language, step-by-step instructions, button names in quotes or bold, cross-references between sections (e.g. «more in [section 12]»), and a linked table of contents at the start. No code, no internal file names and no development terms.

### 2. General rule in `AGENTS.md` (rule 3: «Manual de usuario siempre actualizado»)

`### 3. Manual de usuario siempre actualizado` is added to the `## Reglas generales` section of the root `AGENTS.md` (alongside rules 1 «Responsividad obligatoria», ADR-026, and 2 «PRs SIEMPRE contra dev»), with the following scope:

- **Any change that affects what the user sees or does** (new features, behavior changes, texts, statuses, settings, data refresh frequencies...) **must be reflected in `docs/manual-de-usuario.md` in the same task** that implements it: adding, correcting or removing the relevant section/subsection.
- **Purely internal** changes (refactors, optimizations, security) that do not alter the user experience **do not require** touching the manual.
- The manual must be **always up to date** with the web's real behavior; a PR that changes something visible to the user without updating it is incomplete.

Being in the root `AGENTS.md`, the rule is automatically loaded into the context of all opencode agents (free, subagents and build/plan), just like rules 1 and 2 (ADR-026), without depending on which agent is invoked.

## Rejected alternatives

- **Documenting only in the existing ADRs**: rejected — the ADRs are written for developers and agents (files, functions, CSS classes); an end user cannot use them as a guide, and they do not cover the "how it is used" of the web.
- **README as user manual**: rejected — the README is technical/operational documentation of the repository; mixing in the user manual would lengthen and confuse both audiences.
- **Manual without a maintenance rule**: rejected — issue #60 explicitly asked for the rule; without it the manual would become obsolete in a few weeks and future PRs would not know they must update it.
- **Maintenance rule outside `AGENTS.md`** (e.g. only in the documentation-sync agent): rejected — a specific agent's instructions are only loaded when that agent is invoked; the rule must apply to *any* task touching visible functionality, and `AGENTS.md` is the single, automatic place for cross-cutting rules (same decision as ADR-026).

## Consequences

### Positive
- **Issue #60 solved**: there is a complete, well-organized manual in non-technical language that any user can read and understand, covering everything that can be done on the web (statuses, actions, settings, searches, update frequencies, etc.).
- **The manual stays alive**: `AGENTS.md`'s rule 3 forces `docs/manual-de-usuario.md` to be updated in the same task that changes something visible to the user; a PR skipping it is incomplete, as was already the case with responsiveness (ADR-026).
- **The rule reaches all agents**: any opencode agent working on the project keeps the obligation to sync the manual present, without depending on which agent is invoked.
- **Clear audience separation**: the manual (end users), the ADRs (technical decisions) and the README (repo operation) each serve their function without overlapping.

### Negative
- **Cost per task**: any task with a visible impact on the user adds the step of updating the manual; it is an intentional cost, required by issue #60 to avoid obsolescence.
- **Desync risk if the rule is ignored**: if an agent or the user modified the web without touching the manual, the documentation would become outdated; mitigated because rule 3 declares the PR incomplete.

### Neutral
- **A long document to maintain**: `docs/manual-de-usuario.md` has 18 sections and will grow with each new feature; its linked table of contents makes navigation and locating the section to update easier.
- **No impact on application code**: no HTML, CSS or JS was modified; the decision is documentation and process rules only.
- **The manual coexists with the ADRs**: the ADRs keep documenting decisions and implementation details for developers and agents; the manual provides the missing end-use layer.

## Created/modified files

| File | Change |
|---------|--------|
| `docs/manual-de-usuario.md` | **New**: complete user manual in Spanish, non-technical language, 18 sections with subsections (what it is, how to get in, main screen, series, movies, books, search, organization, detail profile, ratings, quick actions, notifications, profile, settings, update frequencies, privacy, PWA installation and frequent problems), with a linked table of contents |
| `AGENTS.md` | Rule `### 3. Manual de usuario siempre actualizado` in `## Reglas generales`: any change affecting what the user sees or does must be reflected in `docs/manual-de-usuario.md` in the same task; purely internal changes do not require it |
| `docs/adr-032-user-manual.md` | **New**: this document |

Related issue: #60 — https://github.com/gonzalitojh/personal-tracker/issues/60
