# ADR-061: Profile's back button as a left arrow (issue #157)

## Status
Accepted

## Date
2026-08-09

## Context

Issue #157 (type: style) asks to change the profile view's back button: «Cambiar el botón de volver por una flecha hacia la izquierda
simplemente, sin recuadro ni palabra _volver_». The affected button is
`#btn-close-profile`, in the profile view's header
(`#profile-view__header`, `index.html`), which had this markup:

```html
<button type="button" class="btn btn--ghost" id="btn-close-profile">← Volver</button>
```

It had a box (the `btn btn--ghost` class, with a rounded border) and the
word «Volver». The issue asks to keep **only a left
arrow, without box nor text**.

The **`.icon-btn`** pattern already existed in the repo: transparent
borderless icon button, with a ~1.15rem `currentColor`-stroke SVG
(`.icon-btn svg`) and `:focus-visible` with a `--teal-reel` outline, used in
the header for the hamburger `#btn-sidebar-toggle` and the bell
`#btn-notifications`. In the light theme, `[data-theme="light"] .icon-btn {
color: var(--ink) }` over `.profile-view`'s `--paper-dim` background
(contrast ~12.8:1, AA/AAA).

The `#btn-back-to-friends` button («← Todos los amigos», the `btn-link`
class) **does not say "volver"** and already lacks a box: it stays
**out of scope** of this issue.

The implementation is **validated (QA 8/8 criteria PASS)** and
**scanned (security PASS, 0 findings)**; the user manual was
updated in the same task (`docs/manual-de-usuario.md` §13, rule 3 of
AGENTS.md). This ADR documents the decision retrospectively, like the
recent ones (ADR-059, ADR-060).

Related issue: #157 — https://github.com/gonzalitojh/Registro-personal/issues/157

## Decision

Replace the boxed text button with an **icon button reusing the existing
`.icon-btn` class** and the **feather
`arrow-left` SVG** (left chevron, the same visual glyph as the
«←» already shown), and remove the `.btn--ghost` class as dead code.

### 1. `index.html`: the button's markup

`#btn-close-profile` goes from `btn btn--ghost` with text to:

```html
<button type="button" class="icon-btn" id="btn-close-profile" aria-label="Volver">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
</button>
```

- **The `id` does NOT change**: `js/profile.js`'s listener
  (`getElementById("btn-close-profile")`) works the same; the wiring
  stays intact.
- The button carries `aria-label="Volver"` and the SVG is
  `aria-hidden="true"` (it does not duplicate readable text):
  accessibility is kept.
- The focus highlight is inherited from `.icon-btn:focus-visible`
  (a 2px `--teal-reel` outline).

### 2. `css/styles.css`: remove `.btn--ghost` (dead code)

**4 rules are removed**: the base `.btn--ghost`
(`background: transparent; border-color: var(--paper-alpha-35)…`),
`.btn--ghost:hover` and the 2 light-theme ones
(`[data-theme="light"] .btn--ghost` and its `:hover`). Its **only
use** in the repo was that button; after the change there is dead code
left. The cleanup follows **ADR-046**'s precedent (removal of orphaned
styles when changing a button). **No new CSS is added**: `.icon-btn`
already existed.

### 3. `js/profile.js`: no logic changes

Only a **comment** changes («← Volver» → «Flecha de volver»); the
`#btn-close-profile` listener (closing the view with a manual toggle
and returning to the last active Ocio tab) stays as it is.

### 4. PWA bump `20260833` → `20260834`

The PR touches versioned assets, so **one bump per PR** is applied
(ADR-049/059) via `scripts/bump-version.sh`:
`js/config.js` (`APP_VERSION = '20260834'`), `index.html` (`?v=` ×3:
`styles.css`, `ocio.css`, `app.js`) and `service-worker.js` (`?v=` ×6 in
`STATIC_ASSETS`).

### 5. User manual (§13)

`docs/manual-de-usuario.md` §13 adds the sentence: «En la cabecera del
perfil, la flecha de la izquierda te devuelve a la última pestaña de
Ocio (Series, Películas o Libros) que tenías abierta.» — AGENTS.md's rule
3 (a change visible to the user documented in the same
task). Since the button's name is no longer visible in the interface, the
manual is now the explicit reference of its function.

### 6. `.gitignore`: CI artifacts

`candidate.json` and `sdd_prompt.md` are added (untracked artifacts of
the CI session via `scripts/gh-select-issue.sh`; LOW finding of the
security scan).

## Rejected alternatives

- **Keeping `.btn--ghost` removing its border** (overriding the box on
  that button): rejected — it would duplicate `.icon-btn` with a
  second class of identical purpose (transparent icon button); the
  coherent thing is to reuse the header's existing pattern.
- **Using the «←» glyph in a classless button**: rejected — it depends
  on the system font (variable metrics and stroke) and is inconsistent
  with the stroke SVGs (`stroke="currentColor"`, `stroke-width="1.8"`)
  the rest of the interface's icon buttons use.
- **Removing the button relying on the browser's back button**:
  rejected — `js/profile.js`'s logic does a **manual toggle** of
  views that does **not always change the hash**; the browser's button
  does not guarantee closing the profile view nor returning to the last
  active Ocio tab.
- **Keeping `.btn--ghost` "just in case"**: rejected — dead
  code in production (its only use removed); the cleanup follows
  ADR-046's precedent and the class is recoverable from git if ever
  needed.

## Consequences

### Positive

- **Profile header consistent with the header**: the back button now uses
  the same `.icon-btn` as the hamburger and the bell; same
  look and same behavior (transparent, borderless, 1.15rem SVG,
  teal outline when focused).
- **Less visual noise**: the rounded box and the word «Volver»
  disappear; only the arrow remains, as the issue asks.
- **Accessibility kept**: `aria-label="Volver"` + an
  `aria-hidden="true"` SVG; `.icon-btn`'s `:focus-visible` inherits the
  teal outline.
- **Wiring intact**: the `id` does not change; `js/profile.js`'s listener
  (via `getElementById`) works without being touched.
- **AA/AAA contrast in both themes**: in the light theme `--ink` over
  `--paper-dim` (~12.8:1); in the dark theme `--paper` over the profile's
  background.
- **Technical debt settled**: the dead `.btn--ghost` removed (ADR-046
  precedent) and CI artifacts added to `.gitignore`.

### Negative / Risks

- **Small touch area**: the button measures ~28px (1.15rem SVG +
  `padding: 0.3rem`), below WCAG 2.5.8's 44px target. **Accepted**
  for consistency with the header's existing `.icon-btn`s (the same
  pattern); if the criterion hardens in the future, it will have to be
  expanded for all of them.
- **The word "volver" is no longer visible**: the text disappears from the
  interface; mitigated with the button's `aria-label` and documented in
  the manual (§13), which explains what the arrow does.
- **Deletion of `.btn--ghost`**: if a future button needs that
  style it will have to be recreated — recoverable from git (identical to
  ADR-046).

### Neutral

- **Routine PWA bump**: `20260833` → `20260834`, one bump per PR
  (ADR-049/059), applied with `scripts/bump-version.sh`.
- **Historical ADRs intact**: ADR-043 (profile button) and ADR-046
  (removal of the button's name) document the previous state and are **not
  modified**.
- **`.gitignore` expanded**: `candidate.json` and `sdd_prompt.md` are
  protected from a manual `git add -A`.
- **`#btn-back-to-friends` unchanged**: «← Todos los amigos»
  (`btn-link`) stays out of scope, as the issue delimits.

## Created/modified files

| File | Change |
|---------|--------|
| `index.html` | **Modified**: `#btn-close-profile` goes from `<button class="btn btn--ghost">← Volver</button>` to `<button class="icon-btn" aria-label="Volver">` with the feather `arrow-left` SVG (`viewBox="0 0 24 24"`, `stroke="currentColor"`, `stroke-width="1.8"`, `aria-hidden="true"`, polyline `15 18 9 12 15 6`); the `id` does not change; bump `?v=20260833` → `?v=20260834` (×3) |
| `css/styles.css` | **Modified**: 4 `.btn--ghost` rules removed (base, `:hover` and the 2 light-theme ones) — dead code after the change, its only use was that button (ADR-046 precedent); no new CSS (`.icon-btn` is reused) |
| `js/profile.js` | **Modified**: only a comment («← Volver» → «Flecha de volver»); the `#btn-close-profile` listener stays intact |
| `js/config.js` | **Modified**: `APP_VERSION` `20260833` → `20260834` |
| `service-worker.js` | **Modified**: bump `?v=20260833` → `?v=20260834` on the 6 versioned assets of `STATIC_ASSETS` (via `scripts/bump-version.sh`) |
| `docs/manual-de-usuario.md` | **Modified**: §13 adds the sentence about the profile header's arrow (returns to the last open Ocio tab) — AGENTS.md's rule 3 |
| `.gitignore` | **Modified**: `candidate.json` and `sdd_prompt.md` added (untracked artifacts of the CI session, LOW finding of the security scan) |
| `docs/adr-061-boton-volver-perfil-flecha.md` | **New**: this document |

Related issue: #157 — https://github.com/gonzalitojh/Registro-personal/issues/157
