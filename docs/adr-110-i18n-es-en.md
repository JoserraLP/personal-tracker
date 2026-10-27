# ADR-110: Switchable Spanish / English bilingual interface

## Status
Accepted

## Date
2026-10-26

## Context

The owner asks to "fix the Spanish texts" (accents and weird strings)
and also to be able to use the web app in English (switchable).

Prior research: I reviewed all the HTML and JS looking for mojibake
(U+FFFD) — there was only **one** corrupted string in the live web app,
and it came from `js/wishlist.js` («no es válida» [is not valid],
corrupted by an encoding typo in a previous commit). The rest of the
"garbage" seen in the console is a Windows terminal artifact, not a web
issue: the files are in correct UTF-8 and display their accents fine in
the browser.

The app has no internationalization layer: texts live scattered across
static HTML (index + Leisure partials injected lazily) and in JS
(status labels, toasts...).

## Decision

Model: **"Spanish as the source of truth" + translation applied to the
DOM** (`js/i18n.js`):

1. **Spanish only needs to be written once**: any text the app renders
   in Spanish (static or dynamic) is translated on the spot if the user
   chose English.
2. **Exact normalized matching** (collapsed spaces) against an en/m
   dictionary:
   - Text nodes via `TreeWalker`.
   - Translated attributes: `placeholder`, `aria-label`, `title`.
3. **MutationObserver** on `document.body`: dynamic renders (library,
   cards, lists) get translated without touching the existing render
   points.
4. **Language select** in Ajustes › Apariencia › Idioma
   [Settings › Appearance › Language] (`settings-lang-select`),
   persisted in `localStorage("mi-registro-lang")` (independent of the
   user so it works on the sign-in screen).
5. Status labels (`constants.js STATUS_LABELS`) covered via the
   dictionary.

## v1 coverage

- All the static copy (index + Leisure/Purchases partials).
- Dynamic status labels (status chips).
- **Not covered:** dynamic toast/error messages from JS remain in
  Spanish (next iteration; documented).

## Rejected alternatives

- **Hand-written data-i18n** on each string of the ~1,500 elements:
  error-prone and with double the changing surface.
- **i18n framework (i18next)**: dependency and build for 2 languages of
  static UI: oversized (the app has no bundler).

## Consequences

- Adding a new string: nothing to do if it is real Spanish (it will
  only show in English if added to the `js/i18n.js` dictionary).
- Performance: the observer re-translates only added or rewritten nodes
  (minimal cost; EN text does not match and there are no
  translation-loops over itself).
