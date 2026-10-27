# ADR-058: Unify the profile's data tab into Settings (issue #135)

## Status
Accepted

## Date
2026-08-09

## Context

Issue #135 («Unificar pestaña de datos del perfil en ajustes») asks
to remove the profile's «Datos» tab and include its content in the
«Ajustes» tab as a data section.

Previous state:

- The profile had **5 subtabs** (`index.html`, `.profile-subtabs`):
  Estadísticas, Amigos, Actividad, Datos and Ajustes; besides, the
  **profile dropdown** (`#profile-dropdown`) had its own
  «Datos» entry (`data-section="data"`).
- The `#profile-section-data` section contained **3 `.data-card`
  cards**: Export backup (`#btn-export-backup`), Import backup
  (`#btn-import-backup`) and Export `.ics` calendar
  (`#btn-export-ics`).
- The hash router (ADR-051) mapped the «datos» token → the
  `"data"` section (deep links `#/perfil/datos`).
- The «Ajustes» tab (`#profile-section-settings`) already had its own
  cards (Apariencia, Notificaciones, Sincronización de datos) with the
  `.settings-card` + `.settings-desc` pattern.

The implementation is validated (QA PASS) and scanned (security PASS);
the user manual was already updated in the same task (rule 3 of
AGENTS.md). This ADR documents the decision retrospectively.

Related issue: #135 — https://github.com/gonzalitojh/personal-tracker/issues/135

## Decision

Unify the data tab inside Settings as the «Datos» section,
keeping the `#/perfil/datos` URL alias → Settings.

### 1. UI: the «Datos» tab is removed and its content moves to Settings

- The **«Datos» subtab** is removed (4 subtabs remain: Estadísticas,
  Amigos, Actividad and Ajustes) and the **«Datos» entry of the profile's
  dropdown** (4 entries remain).
- The `#profile-section-data` section is removed from the DOM (with its 3
  `.data-card` cards).
- Its content moves into `#profile-section-settings` as **a single
  «Datos» card** (`div.settings-card.settings-card--data`) with the same
  structure as the rest of Settings: `h3` title, `.settings-desc`
  paragraphs and the 3 buttons stacked vertically
  (`.settings-card--data .btn { display:block; width:fit-content;
  max-width:100%; margin:0 0 1.2rem }` and `:last-child` without margin),
  following the old cards' pattern.
- **The buttons' ids are kept** (`#btn-export-backup`,
  `#btn-import-backup`, `#btn-export-ics`): the `setupExportBackup(ctx)`
  / `setupExportIcs(ctx)` wiring of `js/profile.js`
  is untouched, and neither are the `js/export-backup.js` /
  `js/export-ics.js` modules referencing them.

### 2. Router: the «datos» token becomes an alias of `settings`

In `js/router.js`, the `PROFILE_KEY_TO_SECTION` map stops having
`datos: "data"` (a nonexistent section) and becomes:

```js
datos: "settings",
ajustes: "settings",
```

Routing consequences:

- The legacy deep link **`#/perfil/datos` keeps working** and opens
  Settings; the URL is **not normalized** (it stays `#/perfil/datos` in the
  address bar).
- **Critical detail documented in the code**: `PROFILE_SECTION_TO_KEY`
  is auto-generated with `Object.fromEntries` and the **last key wins**,
  which is why «ajustes» must come **after** «datos» in
  `PROFILE_KEY_TO_SECTION`: this way the inverse returns `settings` →
  «ajustes» and the canonical hash stays `#/perfil/ajustes`. A comment
  on the map fixes this order for future edits.
- The module's header comment is updated: «The old "datos" token
  survives as a Settings alias (issue #135)».

### 3. CSS: `.data-card` removed and `.settings-card--data` added

- The `.data-card` rules are **removed** (dead: no card with that class
  exists in the DOM anymore).
- The vertical stacking rules of the «Datos» section's buttons inside
  Settings are **added** (`.settings-card--data .btn` with
  `display:block`, `width:fit-content`, `max-width:100%` and a bottom
  margin of `1.2rem`, except `:last-child`), reusing the
  rest of `.settings-card`'s style without duplicating anything.

### 4. Documentation, user manual and PWA

- **Manual** (`docs/manual-de-usuario.md`): profile sections lists
  reduced from 5 to 4; the «13.4 Datos» subsection removed;
  «13.5 Ajustes» renumbered to «13.4 Ajustes»; the «Datos» section added
  to row 14 (export/import backup and export `.ics`); a note in 13.0
  that `#/perfil/datos` keeps working and opens Settings.
- **PWA bump** `20260830` → `20260831` (one bump per PR touching
  assets, cf. ADR-049): `js/config.js` (`APP_VERSION`), `index.html`
  (`?v=20260831` ×3) and `service-worker.js` (`?v=20260831` ×6).
- **Historical ADRs intact**: `adr-008-export-backup.md`,
  `adr-014-export-ics.md` and `adr-051-enrutamiento-hash.md` mention
  `#profile-section-data`, `.data-card` and the «datos» token; they are
  historical records of the previous state and are **not modified**.

## Rejected alternatives

- **Removing the «datos» token from the router** (normalizing
  `#/perfil/datos` to `#/perfil/estadisticas`): rejected — it would break
  favorites and shared URLs users have already saved since
  ADR-051; the alias costs one line and keeps compatibility.
- **Keeping `.data-card` with its own rules inside Settings**:
  rejected — unnecessary duplicated CSS; the «Datos» card reuses the
  `.settings-card` pattern and only needs the button stacking rules.
- **Moving the section without a URL alias**: rejected — inconsistent with
  ADR-051's deep-link feature (each profile section has its own shareable
  URL); leaving `#/perfil/datos` broken would silently degrade a
  documented public URL.

## Consequences

### Positive

- **A single place for data and settings**: less navigation surface
  (4 subtabs and 4 dropdown entries); the profile is cleaner and the user
  finds export/import alongside the rest of the settings.
- **Legacy deep links preserved**: `#/perfil/datos` keeps opening
  Settings without breaking favorites or shared URLs (ADR-051).
- **Wiring intact**: by keeping the buttons' ids,
  `setupExportBackup`/`setupExportIcs` do not change — zero regression
  risk in backup export/import and `.ics`.
- **CSS with no duplicates nor dead code**: `.data-card` removed
  (none was left in the DOM) and a single new class
  (`.settings-card--data`) for the stacking.
- **Manual up to date**: AGENTS.md's rule 3 met in the same task
  (lists at 4 sections, the «Datos» section in row 14 and the
  legacy note in 13.0).
- **QA and security PASS** before documenting: the decision is
  validated in practice.

### Negative / Risks

- **Visible change for the user**: whoever looked for the profile's
  «Datos» tab must now go to Settings. Mitigated by the manual's
  update and the `#/perfil/datos` legacy note.
- **Canonical dependent on key order**: if a future editor
  reorders `PROFILE_KEY_TO_SECTION` (e.g. «ajustes» before
  «datos»), the inverse `Object.fromEntries` would canonicalize `settings`
  as `#/perfil/datos`. Mitigated by the comment fixing the order in the
  map itself.
- **Desync with historical ADRs**: ADR-008, ADR-014
  and ADR-051 describe `#profile-section-data`, `.data-card` and the
  «datos» token as a real section; they no longer reflect the current
  state (left as historical legacy, unmodified). This ADR describes the
  current state.

### Neutral

- **URLs not normalized**: `#/perfil/datos` remains in the address bar
  when opening Settings (not rewritten to `#/perfil/ajustes`); the
  canonical stays `#/perfil/ajustes`.
- **No changes in `js/export-backup.js` nor `js/export-ics.js`**: the
  export/import modules are untouched; only their DOM location
  changes.
- **Routine PWA bump**: `20260830` → `20260831` following the
  one-bump-per-PR practice (ADR-049); browsers purge the
  previous caches on the next `activate`.

## Created/modified files

| File | Change |
|---------|--------|
| `index.html` | **Modified**: the «Datos» subtab removed (4 subtabs remain) and the dropdown's «Datos» entry removed (4 entries remain); `#profile-section-data` removed; the «Datos» card (`settings-card settings-card--data`) added in `#profile-section-settings` with the 3 buttons keeping their ids (`#btn-export-backup`, `#btn-import-backup`, `#btn-export-ics`); bump `?v=20260830` → `?v=20260831` (×3) |
| `js/router.js` | **Modified**: the «datos» token goes from the `"data"` section to being an alias of `"settings"` in `PROFILE_KEY_TO_SECTION` (with a comment fixing the order: «ajustes» must come after «datos» so the canonical stays `#/perfil/ajustes`, because the `Object.fromEntries` inverse lets the last key win); module header comment updated |
| `js/profile.js` | **Modified**: the `dataSection` reference removed (const + hidden toggle); the `setupExportBackup(ctx)`/`setupExportIcs(ctx)` wiring stays intact (the buttons' ids do not change) |
| `css/styles.css` | **Modified**: the `.data-card` rules removed (dead); `.settings-card--data .btn` (`display:block`, `width:fit-content`, `max-width:100%`, `margin:0 0 1.2rem`) and `.settings-card--data .btn:last-child` (no bottom margin) added |
| `js/config.js` | **Modified**: `APP_VERSION` `20260830` → `20260831` |
| `service-worker.js` | **Modified**: bump `?v=20260830` → `?v=20260831` on the 6 versioned assets of `STATIC_ASSETS` |
| `docs/manual-de-usuario.md` | **Modified**: profile sections lists at 4; «13.4 Datos» removed; «13.5 Ajustes» renumbered to «13.4 Ajustes»; the «Datos» section added to row 14; note in 13.0 that `#/perfil/datos` keeps working and opens Settings (AGENTS.md's rule 3) |
| `tasks/task-issue-135.json` | Task file of the task (title/description, change plan, acceptance criteria and the `issue` block with issue #135) |
| `docs/adr-058-unificar-pestana-datos-en-ajustes.md` | **New**: this document |

Related issue: #135 — https://github.com/gonzalitojh/personal-tracker/issues/135
