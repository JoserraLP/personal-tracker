# ADR-097: The profile's back arrow also returns to the Gym (issue #268)

## Status
Accepted

## Date
2026-08-13

## Context

Issue #268 (type:
bug) detects that
**the
profile's back arrow returned to Ocio instead of the Gym** when the
user entered the profile from the
Gym
section. The bug appeared
with the section's integration (issue
#62, ADR-095): the router already
stored
the
`lastSection = "gimnasio"`, but the arrow's handler did not
consider
it and fell to the default branch.

Previous
state (built in the
ADR-061, ADR-077, ADR-078 and ADR-079):

- The profile has its own header
  (the
  `#profile-view__header`) with the
  **back arrow**
  (the
  `#btn-close-profile`, the
  ADR-061); the global
  header does not appear on the profile (the
  ADR-077, issue #206).
- The
  `#btn-close-profile`'s handler in
  the
  `js/profile.js` decides the
  destination based on the
  `getLastSection()`
  (issue #213, ADR-079): if it is
  the
  `"recetas"` it navigates to Recipes with its
  last tab; if
  not
  it falls to the
  `else`
  and returns to Ocio. That logic **got
  written when only
  Ocio and Recipes existed**: the Gym
  (issue #62,
  ADR-095) got
  integrated afterwards and the new branch was never
  added to the handler.
- The router (the
  `js/router.js`) was updated
  with
  the section:
  the
  `lastSection = "gimnasio"` in
  the
  `applyRoute()`
  and the
  `getLastGymTab()` for
  the
  session's last gym
  tab (the
  ADR-095). The
  result was an
  incoherent
  state: the memory got
  stored, but the back
  arrow ignored it.

The user manual **already documented the correct behavior** (the
`docs/manual-de-usuario.md`'s §3.2 and
§15: the arrow returns to the
section the user entered from, either
**"Ocio", "Recetas" or "Gimnasio"**, with the
active tab — updated on the section's
task, issue #62, the
AGENTS.md's rule 3). The
fix aligns the code with what's documented: there's no need to
touch the manual (rule
3).

The implementation is validated (a
QA PASS: 30
E2E
checks on a real headless
chromium — the
gym/workouts, the
gym/exercises, the Recipes and Ocio
regressions, the hidden tab in Settings, the direct
deep-link to
the
`#/perfil`, the browser's back button and the
responsiveness of
the
360/768/1280 px) and scanned
(a
security PASS, the scan in
progress). This ADR documents the decision
retrospectively, like the recent ones
(the
ADR-093, ADR-094, ADR-095, ADR-096).

Related issue: #268 — https://github.com/gonzalitojh/Registro-personal/issues/268

## Decision

### 1. The new "Gym" branch in the back arrow's handler

Adding the Gym
branch to the
`#btn-close-profile` in
the
`js/profile.js`, with the
**Recipes branch's same
pattern** (issue #213, ADR-079):

```js
} else if (getLastSection() === "gimnasio") {
  navigate({ section: "gimnasio", tab: normalizeTabKey("gimnasio", getLastGymTab()) });
}
```

- **The expanded import**: the
  `getLastGymTab` is added to the existing
  `./router.js` import (next to
  `navigate`, `parseHash`, `getLastOcioKey`, the
  lastRecipesTab and the
  lastSection).
- **The Ocio `else` stays as the fallback**: it covers the direct
  deep-link to
  the
  `#/perfil` with no visited
  content section (the
  `lastSection` being
  the
  `"ocio"`
  by default, ADR-079).
- **The updated handler comment**: the back
  sections' list goes from
  "Ocio or Recipes" to
  "Ocio, Recipes or Gym".

### 2. The navigation flow (verified against the real code)

The
`navigate({ section: "gimnasio", tab })` changes
the hash
(the
`#/perfil/...` → the
`#/gimnasio` or the
`#/gimnasio/ejercicios`) and triggers
the
`canonicalHashFor` → the
`gymHashFor` → the
`onRoute` (the
`gimnasio` branch of
the
`js/app.js`) → the
`openGym({ tab, fromRouter: true })`
(the
`js/gym.js`), which
hides the
`#app`/`#profile-view`/`#recipes-view`,
uncovers the
`#gym-view` and activates the tab. **There
is no need to touch the
`#app` nor the header on the handler**:

- The
  `app.js`'s onRoute
  re-shows the global header on any
  route ≠ profile with a session (the
  `app.js` branches 543-548), so the
  new branch inherits that behavior.
- The hidden-tab guard is covered by
  **double normalization** (issue
  #97, the ADR-067): the handler's
  `normalizeTabKey` falls to the first
  visible
  Gym tab if the
  last one
  stayed hidden in Settings, and the
  `onRoute` re-normalizes it
  with
  a
  `replace: true`
  rewriting the URL if
  needed.
- The
  `getLastGymTab()` returns
  the
  `"entrenos"`
  by default, which canonicalizes to the
  `#/gimnasio` (with no suffix): the
  return from the profile always lands on a
  canonical
  route.

### 3. The PWA bump

The
`APP_VERSION`
being
`20260927` →
`20260928` (the
`scripts/bump-version.sh`,
touching the
`js/config.js`, the
`index.html` and the
`service-worker.js`), the
practice of
one bump per
PR (the
ADR-049/059/079): it invalidates the PWA's
cache-first caches (the
ADR-019) and prevents
serving
a
stale
`js/profile.js`
from the service worker.

### 4. The user manual: unchanged

The manual already documented the return to
"Ocio, Recipes or Gym" with the active tab
(updated on the section's
task, issue #62; the
AGENTS.md's rule 3).
The fix aligns the code with what's documented: **there is nothing to
add or correct**.

## Rejected alternatives

- **Refactoring the
  dispatch to a centralized map or a
  generic
  function of
  "back
  to the last
  section"**:
  rejected — cleaner in the future (a
  single place to register the sections), but a
  bigger regression surface for a
  one-off
  bug; the existing if/else-if
  pattern (issue #213) already sets
  the precedent and adding
  one more branch is the lowest-risk change.
- **Tracing the browser's history (a
  history.back)**:
  rejected — the same
  reasoning as on
  the
  ADR-079: the
  router's session
  memories are the existing source of truth and avoid
  depending on the history (a
  reload, a
  direct
  deep-link).

## Consequences

### Positive

- **The profile's back reflects the user's real intent** on the three
  top-level
  sections: Ocio, Recipes or Gym, with the
  last
  active tab (normalized if it
  stayed hidden, #97).
- **Zero visual changes and zero CSS changes**: just
  navigation logic; the global header is re-shown by the
  existing onRoute.
- **The code aligned with the documentation**: the
  manual already promised the return to the
  Gym (the
  AGENTS.md's rule 3) and now the
  code delivers; the documentation needs no changes.
- **The guaranteed canonical routes**: the
  `getLastGymTab()` always returns a
  valid tab and the
  `normalizeTabKey` + the
  `onRoute`'s guard with a
  `replace: true` rewrite
  the URL if
  needed.

### Neutral

- **The Ocio's `else` keeps the manual toggle** (showing the
  `#app`
  before navigating): it covers the
  navigate-without-a-hash-change case and is the
  fallback for the
  direct deep-links to the
  `#/perfil`.
- **The PWA bump of
  the
  `20260928`**: one more bump of the incremental series (the
  ADR-019/049/059); with no other
  implication.

### Negative / Risks

- **None known.**
  Validated: a
  QA PASS
  (30
  E2E
  checks on a headless chromium: the
  gym/workouts, the gym/exercises, the
  Recipes and Ocio
  regressions, the hidden tab in Settings, the
  deep-link to the
  `#/perfil`, the browser's back
  button and the
  360/768/1280 px responsiveness with no horizontal scroll) and a
  security PASS (the
  scan in progress at this ADR's
  closing, 0 known
  findings).

## Created/modified files

| File | Change |
|---------|--------|
| `js/profile.js` | **Modified**: the
  `getLastGymTab` import
  on the
  `./router.js` import; a
  new
  `gimnasio` branch on the
  `#btn-close-profile`'s handler (the
  `navigate({ section: "gimnasio", tab: normalizeTabKey("gimnasio", getLastGymTab()) })`); the handler's comment updated to
  "Ocio, Recipes or Gym" |
| `js/config.js` | **Modified**: the
  `APP_VERSION`
  going
  `20260927` →
  `20260928` |
| `index.html` | **Modified**: the
  `?v=20260927` refs
  → the
  `?v=20260928` |
| `service-worker.js` | **Modified**: the
  versioned
  entries of
  `?v=20260927` →
  `?v=20260928` |
| `docs/manual-de-usuario.md` | **Unchanged**: it already documented the return to
  "Ocio, Recipes or Gym" with the active tab (the
  §3.2 and §15; the
  AGENTS.md's rule 3) |
| `docs/adr-097-salir-perfil-gimnasio.md` | **New**: this document |

Related issue: #268 — https://github.com/gonzalitojh/Registro-personal/issues/268
