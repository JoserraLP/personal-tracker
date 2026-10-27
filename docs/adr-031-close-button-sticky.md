# ADR-031: Sticky close button on modals — the ✕ always visible when scrolling (issue #26)

## Status
Accepted

## Date
August 2026

## Context

Issue #26 reports that the detail modal's ✕ button was not visible when scrolling: when opening a modal with long content (e.g. an extensive synopsis), the close button disappeared along with the modal's header and the user had to scroll back to the top to close it.

**Root cause**: `.modal__card` (the button's direct parent) is the modal's scroll container (`overflow-y: auto; max-height: 88vh`). With `position: absolute`, the ✕ was positioned relative to the whole card and, on scroll, moved along with the content: the button ended up outside the visible area. The `.modal__close` rule is shared by the project's two modals, both with the structure `.modal__card > .modal__close`: `#item-modal` (series, movie, book, editing, manual creation, saga, search preview and friend profile) and `#rating-modal` (rating, issue #21).

The decision was taken following the task-architect's plan; QA approved with 5/5 criteria and the security review came out clean. It is a CSS-only change: no HTML or JS touched.

Related issue: #26 — https://github.com/gonzalitojh/personal-tracker/issues/26

## Decision

Change the `.modal__close` rule in `css/styles.css` from `position: absolute` to **`position: sticky`**, anchoring the ✕ to the top edge of the scroll container and turning it into a **chip** with the card's color:

- `position: sticky; top: 0.7rem; right: 0.7rem` — the button stays glued to the scroll container's visible area while scrolling; `top` fixes its distance from the visible top edge and `right` reinforces the anchoring to the right edge.
- `display: block; width: fit-content; margin-left: auto` — being in flow (no longer absolute), the button takes its own line and aligns to the card's right.
- `background: var(--paper)` — the same color as `.modal__card`: the ✕ acts as a chip that cleanly covers the content passing beneath it while scrolling, keeping the button readable.
- `border-radius: var(--radius)` — rounded corners consistent with the card's.

The rest of the rule does not change: `border: none`, size (`font-size: 1.1rem`), color (`var(--ink-soft)`), `line-height: 1`, `padding: 0.3rem` and the hover (`color: var(--ink)`) are kept, as well as the existing `.modal__close:focus-visible` rule.

Being a shared rule, the fix automatically applies to both modals (`#item-modal` and `#rating-modal`) without changes to `index.html` or `js/ui.js`.

## Rejected alternatives

- **B1: flex column with inner scroll in `#modal-content`**: rejected — moving the scroll to a child container changes the box model of the modals' shared frame, with regression risks in the many flows that re-render `#modal-content` (editing, creation, search preview, multi-cover book confirmation, etc.).
- **B2: HTML wrapper `.modal__scroll`**: rejected — it requires touching `index.html` and re-verifying the modals' focus trap (the wrapper changes the tab order), for a problem solved with a single CSS property.

## Consequences

### Positive
- **✕ always visible**: when scrolling inside the modal, the close button stays anchored to the top edge; there is no need to go back up to close.
- **Invisible chip at rest**: at rest the button does not overlap content — being in flow and with `background: var(--paper)` identical to the card, the chip integrates and the **latent overlap** that existed with long detail-modal headers is removed.
- **One change, two modals**: the shared rule gives the same behavior to `#item-modal` and `#rating-modal` without touching HTML or JS; the rating (`modal__card--small`) inherits the fix without extra adjustments.
- **Broad compatibility**: `position: sticky` is universal in modern browsers (Chrome 56+, Firefox 59+, Safari 13+ since ~2020); no degradation for the target audience.

### Negative
- **The button takes its own line in the card's flow**: it adds a small vertical space at the start of the modal that did not exist before (the ✕ floated over the header). It is the cost that removes the overlap and it is minimal (≈1.1rem).

### Neutral
- **No contract changes**: no function in `js/ui.js` nor structure in `index.html` is affected; the remaining visual properties of `.modal__close` (hover, color, focus) do not change.
- **`right: 0.7rem` with `position: sticky` does not shift the button at rest**: the effective anchoring comes from `top` + `margin-left: auto`; `right` remains as a declarative reinforcement of the right anchoring.

## Created/modified files

| File | Change |
|---------|--------|
| `css/styles.css` | `.modal__close`: `position: absolute` → `position: sticky; top: 0.7rem; right: 0.7rem`, with `display: block; width: fit-content; margin-left: auto` (anchored to the right), `background: var(--paper)` as a chip covering the content while scrolling and `border-radius: var(--radius)` |
| `docs/adr-031-close-button-sticky.md` | **New**: this document |

Related issue: #26 — https://github.com/gonzalitojh/personal-tracker/issues/26
