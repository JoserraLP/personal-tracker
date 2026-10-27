# ADR-066: Pure black mode with dark surfaces (issue #165)

## Status
Accepted

## Date
2026-08-09

## Context

The **«Negro puro»** mode added in ADR-064 (issue #43) only darkened
the **background**: the `[data-theme="black"]` block redeclared only
`--ink: #000000`, `--ink-raised: #0a0a0a` and the five
`--ink-alpha-*` tints as translucent blacks. All the **surfaces**
(cards, side panels, dropdowns, modals, settings, the global
search, notifications, ocio profiles, list rows) kept being
painted with `--paper` (`#f1ead9`, parchment), because they inherited
from `:root`: in pure black the background was black but the surfaces
stayed light, breaking the mode's visual coherence.

Issue #165 asks that in pure black **all the surfaces be dark**
(black / near-black), with legible text, and additionally to add to
AGENTS.md a **permanent rule** requiring verifying the
four theme modes on any new element.

The implementation is **validated (QA PASS)** on the 7 acceptance
criteria and **security-scanned (PASS, 0 HIGH**; the client-side keys
found are pre-existing in `main`, not new), on the branch
`style/issue-165-modos-visualizacion` with the commits `8fb619d`
(feat), `f79bc42` (fix of the rows' states) and `091df30` (fix of AA
contrast on hovers with accent and graphic bars). The user manual was
updated in the same task (`docs/manual-de-usuario.md` §14, rule 3
of AGENTS.md). This ADR documents the decision **retrospectively**,
like the recent ones (ADR-059 to ADR-065), **extending ADR-064 and
ADR-009**.

Related issue: #165 — https://github.com/gonzalitojh/personal-tracker/issues/165

## Decision

Extend the `[data-theme="black"]` block with **additional delta
variables** to darken all the surfaces, plus a **grouped-selector
override section** following the same grouped-selectors pattern (a
single source of truth per rule) that the
`[data-theme="light"]`/`[data-theme="white"]` families use (ADR-064).
The decision is organized in six points: the delta variables, the
grouped overrides, the fixed-hex stamps, the variable rotation, the
verified contrast and AGENTS.md's new rule 4.

### 1. The `[data-theme="black"]` block expanded (delta, `css/styles.css` and `ocio/ocio.css`)

The delta block goes from redeclaring only the ink to also redeclaring
the surfaces:

- `--paper-dim: #111111` (secondary surfaces).
- `--white: #0f0f0f` (form inputs).
- `--paper-line: rgba(241, 234, 217, 0.28)` (borders over dark
  surfaces).
- The five `--ink-alpha-*` tints are **reverted to light tints**
  `rgba(241, 234, 217, X)` (instead of black ones): in pure black they act
  over dark surfaces, so hover/focus paints with translucent
  parchment.
- The four `--bg-state-*` states go dark: `#12372f`
  (en_curso), `#33291a` (completado), `#26241e` (standby) and `#3d1f18`
  (abandonado).
- Light accents for use over a dark background: `--teal-reel-dark:
  #4f9c8e`, `--ochre-spine-dark: #c99a4e`, `--stamp-dark: #cf6655`
  (text/graphics with black ink on top).

**Everything else keeps inheriting from `:root`** (as in ADR-064): the
base `--paper` is kept and becomes the mode's **text**
(see point 4).

### 2. Grouped-selector override section for pure black

An override section scoped per element under
`[data-theme="black"]` is added with the **same grouped-selectors
pattern** as the
`[data-theme="light"]`/`[data-theme="white"]` families
(ADR-064): a single source of truth per rule, grouping selectors
with commas. It covers all the components with a paper surface:
cards, side panels, dropdowns, modals, settings, the global search,
notifications, ocio profiles (`ocio/ocio.css`) and list rows,
including the `en_curso`/`completado`/`standby`/
`abandonado` and `unreleased` states (fix `f79bc42`), which move to the
dark surfaces and states of point 1.

### 3. Card stamps with original hexes (no variables)

The cards' stamps (`item-card__stamp--*`) **keep their original
hexes** (`#7e2c22`, `#1c4a41`, `#8f6522`) instead of using
variables: they represent the **physical reality of the stamp**
pressed on the card and must look **identical in all 4 modes**. Each rule
carries a comment explaining why it does not use a variable, following
AGENTS.md's rule 4 (point 6).

### 4. Variable rotation

In pure black the variable rotation turns the same as in dark:
`--ink` is **background** and `--paper` is **text**. The
per-element overrides invert selector/semantics where needed (e.g.
texts that in `:root` are `--ink` become `--paper` in the override,
and surfaces that were `--paper` become `--ink`/`--ink-raised`/
`--paper-dim`).

### 5. WCAG AA contrast (verified)

Minimum AA ratio: 4.5:1 for normal text and 3:1 for graphics. Verified
values:

| Pair | Ratio | Use |
|-----|-------|-----|
| `#f1ead9` (paper) over `#0a0a0a` (ink-raised) | 16.51:1 | text over elevated surfaces |
| `#000` (ink) over `#4f9c8e` (teal-reel-dark) | 6.48:1 | texts with a light accent |
| `#000` over `#c99a4e` (ochre-spine-dark) | 8.22:1 | texts with a light accent |
| `#f1ead9` over `#a63b2e` (stamp) | 5.33:1 | `.btn--danger` (base and `:hover`) |
| States `#12372f`/`#33291a`/`#26241e`/`#3d1f18` with paper | ≈ 10-12:1 | states' background with parchment text |
| Stamps `#7e2c22`/`#1c4a41`/`#8f6522` over a light stamp | 3.75-7.21:1 | decorative (the card's physical stamp) |

Graphics (3:1): active tabs with a 3 px inset (6.11/5.36/7.75:1) and
the episode checkbox (6.11:1). **Button hovers with an accent**
resolve **a light-accent background with black ink** (6.48:1 and
8.22:1, see the QA iteration's point 5). Not applicable:
`.btn--danger:hover` keeps the base `--stamp` background with paper
text.

### 6. New AGENTS.md rule 4

AGENTS.md's permanent rule **«Visualización correcta en todos los
modos de tema»** is added: every new element must be verified in the
**four modes**, with a minimum WCAG AA contrast (4.5:1 text,
3:1 graphics); the overrides must follow the **grouped-selectors
pattern** with a single source of truth per rule; hardcoded
colors must carry a **justifying comment** for why they do not use a
variable.

### QA iteration (fixes in `091df30`)

The qa-reviewer detected two contrast problems in the first
version, fixed in `091df30`:

1. **Hovers with light accents as background and paper text** → an
   insufficient ratio (2.1-2.7:1). Fixed: **black ink over a light
   accent** (6.48:1 / 8.22:1).
2. **`.btn--danger:hover`** with `--stamp-dark` over `--stamp` →
   1.73:1. Fixed: the danger hover stays **without an override**
   (it keeps the base `--stamp` with paper text, 5.33:1).

Final QA: **PASS on the 7 acceptance criteria** of issue #165.
Security scan: **PASS** (0 HIGH; the detected client-side keys
are pre-existing in `main`, not introduced in this branch).

## Rejected alternatives

- **Per-mode variable daisy** (rewriting in pure black all of `:root`'s
  variables and the dark family's overrides one mode at a time, with no
  sharing): rejected — it would duplicate dozens of rules and create
  two sources of truth. The choice was the **expanded delta block** +
  overrides with **grouped selectors** (the same pattern as
  ADR-064): a single source of truth per rule and automatic
  inheritance of the rest of `:root` (paper, accents, shadows, the date
  picker's filter) as it evolves.
- **Introducing new variables for the cards' stamps**
  (e.g. `--stamp-*` per mode): rejected — the stamps
  represent the physical reality of the stamp pressed on the card and
  must look identical in all 4 modes; the original
  hexes are kept with a justifying comment (AGENTS.md's rule 4).
- **Applying the pure black overrides by duplicating the dark family's
  blocks** instead of grouping selectors: rejected — it would break the
  single source of truth per rule that ADR-064 already established
  for the light/white families.
- **Keeping the `--ink-alpha-*` as black tints** and solving the dark
  hovers with another mechanism: rejected — over dark surfaces a
  black tint is invisible; the reversion to parchment light tints is what
  gives legible hovers in pure black.
- **Leaving light surfaces in pure black** (limiting to the background,
  as ADR-064 did): rejected — it is exactly what issue #165 asks
  to fix: the mode must be coherent, with BOTH the background and the
  surfaces dark.

## Consequences

### Positive

- **Issue #165 solved**: in pure black all the surfaces (cards,
  side panels, dropdowns, modals, settings, the global search,
  notifications, ocio profiles, list rows) become dark, with
  legible text (acceptance criteria 1-7, QA PASS).
- **Permanent rule in AGENTS.md** (rule 4): any new element must be
  verified in the 4 modes with a minimum WCAG AA; it avoids future
  regressions like this issue's.
- **WCAG AA contrast verified** in text (16.51:1, 6.48:1, 8.22:1,
  5.33:1, ≈10-12:1 in states) and graphics (3:1 exceeded: the episode
  checkbox's 6.11:1 and the active tabs' 5.36-7.75:1), including
  hovers.
- **Grouped-selectors pattern consolidated**: pure black uses the
  same single-source-of-truth-per-rule technique as light and pure
  white (ADR-064), with its own commented override section.
- **Physical stamps intact**: the cards look identical in all 4
  modes; each hardcoded hex carries its justifying comment.
- **No regressions** in dark/light/pure white: the computed-styles diff =
  0 changes in the other three modes; also verified with no
  horizontal scroll at 360/768/1280 px (AGENTS.md's rule 2).
- **Security PASS**: 0 HIGH; no new keys introduced.

### Negative / Risks

- **Bigger CSS surface**: the expanded delta block and the grouped
  overrides section add ~100 lines between `css/styles.css` and
  `ocio/ocio.css`; each new component with a paper surface will need
  its extension to pure black (mitigated by AGENTS.md's rule 4).
- **Double role of the `--ink-alpha-*`**: in the dark family they are
  light tints (over dark surfaces) and in the light one they are black
  tints; a new use of these tints requires checking the
  background/text pair of each family.
- **Comments to keep in sync**: the blocks document their contrasts;
  if a color changes, the comment must be updated and the ratio verified
  (the same assumed debt as in ADR-064).
- **Light `*-dark` accents valid only with black ink above**:
  using them as a background with paper text produces 2.1-2.7:1 (the
  failure the QA fixed); the correct pattern is documented in the CSS.

### Neutral

- **No new dependencies**: ADR-009/ADR-064's same CSS Custom
  Properties + `[data-theme]` architecture; GitHub Pages without a
  build step.
- **`--paper` keeps its role as text** in pure black: the ink/paper
  rotation is the same as dark, only the surfaces are now redeclared.
- **PWA bump `20260837` → `20260838`** (ADR-019): one bump per PR
  (ADR-049/059/061/064), via `scripts/bump-version.sh`, for touching
  precached assets (`css/styles.css`, `ocio/ocio.css`,
  `index.html`, `js/config.js`, `service-worker.js`).
- **User manual up to date**: §14 Settings → Apariencia → Tema documents
  that the pure black mode now darkens BOTH the background **and** the
  surfaces — AGENTS.md's rule 3.

## Created/modified files

| File | Change |
|---------|--------|
| `css/styles.css` | **Modified**: the `[data-theme="black"]` delta block expanded (`--paper-dim #111111`, `--white #0f0f0f`, `--paper-line rgba(241,234,217,0.28)`, `--ink-alpha-*` reverted to light tints `rgba(241,234,217,X)`, dark `--bg-state-*` `#12372f`/`#33291a`/`#26241e`/`#3d1f18`, light accents `--teal-reel-dark #4f9c8e`, `--ochre-spine-dark #c99a4e`, `--stamp-dark #cf6655`); new `[data-theme="black"]` grouped-selector override section (the same grouped-selectors pattern as light/white); the `item-card__stamp--*` stamps keep their original hexes (`#7e2c22`/`#1c4a41`/`#8f6522`) with a justifying comment on each rule |
| `ocio/ocio.css` | **Modified**: the `[data-theme="black"]` delta block and grouped overrides for ocio profiles (the same pattern as `css/styles.css`) |
| `AGENTS.md` | **Modified**: new rule 4 «Visualización correcta en todos los modos de tema» (verify the 4 modes, minimum WCAG AA 4.5:1/3:1, the grouped-selectors pattern with a single source of truth, hardcoded colors with a justifying comment) |
| `docs/manual-de-usuario.md` | **Modified**: §14 Settings → Apariencia → Tema: the pure black mode now darkens BOTH the background **and** the surfaces (not only the background) — AGENTS.md's rule 3 |
| `js/config.js` | **Modified**: `APP_VERSION` `20260837` → `20260838` |
| `index.html` | **Modified**: bump `?v=20260837` → `?v=20260838` (×3: `styles.css`, `ocio.css`, `app.js`) via `scripts/bump-version.sh` |
| `service-worker.js` | **Modified**: bump `?v=20260837` → `?v=20260838` on the 6 versioned assets of `STATIC_ASSETS` (via `scripts/bump-version.sh`) |
| `tasks/task-issue-165.json` | **Modified**: the task's state (implemented → QA PASS validated on the 7 criteria → security scan PASS) with the `pr` block and issue #165 |
| `docs/adr-066-modo-negro-puro-superficies-oscuras.md` | **New**: this document |

Related issue: #165 — https://github.com/gonzalitojh/personal-tracker/issues/165
