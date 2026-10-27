# Project rules

This file contains general rules that EVERY opencode agent must
comply with ALWAYS, in any task, without exception. If a task conflicts
with these rules, stop and ask the user for confirmation before
continuing.

## General rules

### 1. PRs ALWAYS against `dev` (never against `main`)

- All Pull Requests are created against the `dev` integration branch.
- Creating PRs against `main` (or pushing directly to `main`) is forbidden
  under any circumstance. The only one who promotes `dev` to `main` is the
  user, when they consider the version stable.
- The publisher must apply `--base dev` automatically when creating each PR.

### 2. Mandatory responsiveness

The web app must look right on desktop, tablet and mobile, at any
screen width.

Mandatory criteria:

1. There must be no page-level horizontal scroll at any
   width. Horizontal scroll is only allowed inside specific containers
   designed for it (e.g. tables with `overflow-x: auto`).
2. No text may go off-screen: titles, dates, author
   names and long synopses must fit their container
   (`overflow-wrap: break-word`, `min-width: 0` on flex/grid children,
   relative units). Do not truncate essential content with ellipsis on mobile.
3. Use relative units (%, rem, em, fr, vw/vh, `minmax()`) for widths,
   columns and body typography. Avoid fixed `px` in full-width containers.
4. Using `overflow-x: hidden` on `body`/`html` as a patch is forbidden: it masks
   the overflow and can cut content. Always fix the root cause.

Mandatory verification when the task touches HTML, CSS or UI:

1. Test at least three widths: ~360 px (mobile), ~768 px (tablet) and
   ~1280 px (desktop), with the DevTools device mode.
2. Confirm there is no horizontal scroll:
   `document.documentElement.scrollWidth <= window.innerWidth` in the console
   (must be true).
3. Test with realistic long content: long titles, dates, URLs or
   words without spaces.

### 3. User manual always up to date

There is a user manual at `docs/manual-de-usuario.md` that explains, in
non-technical language and for any user, everything that can be done in
the web app (statuses, actions, settings, search, refresh frequencies,
etc.).

- **Any change that affects what the user sees or does** (new
  features, behavior changes, texts, statuses, settings,
  data refresh frequencies...) **must be reflected in the manual**
  in the same task that implements it: adding, correcting or removing
  the relevant section/subsection.
- Purely internal changes (refactors, optimizations, security)
  that do not alter the user experience do not require touching the manual.
- The manual must always be up to date with the web app's real behavior;
  a PR that changes something visible to the user without updating it will
  be incomplete.

### 4. Correct display in all theme modes

The web app has **four display modes**: Dark, Pure black,
Light and Pure white (ADR-009, ADR-064 and ADR-066). The light family
(Light/Pure white) uses `--paper` as surface and `--ink` as text;
the dark family (Dark/Pure black) the other way around, with per-element
overrides grouped in `css/styles.css` and `ocio/ocio.css`.

**Anything new added to the web app** (component, element,
screen, color, CSS variable...) **must always comply with the display in
all existing modes**:

1. Verify the new element in the **four modes** (not only the
   one being worked on), even if the change seems isolated to one.
2. Check that no surface or text is left **invisible or with
   insufficient contrast** in any mode (minimum WCAG AA: 4.5:1 for
   normal text, 3:1 for large text and graphical components).
3. If the element uses theme variables (`--ink`, `--paper`,
   `--ink-raised`, `--paper-dim`, `--white`, alphas, states), check the
   **two roles each variable plays** depending on the family (background or
   text) and add the corresponding override for the families
   (`[data-theme="light"]`/`[data-theme="white"]` and
   `[data-theme="black"]`) following the existing **grouped selectors**
   pattern, with a single source of truth per rule.
4. Hardcoded colors (e.g. hex of the card stamps in pure black) must be
   documented with a comment explaining why they do not use a variable.

A PR that adds something new without checking (or fixing) the four
modes will be incomplete.
