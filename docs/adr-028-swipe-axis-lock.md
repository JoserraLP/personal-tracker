# ADR-028: Axis lock on the list view's swipe — vertical scroll stops moving the cards (issue #42)

## Status
Accepted

## Date
August 2026

## Context

Issue #42 reports a problem in the library's **list view**: the horizontal swipe gesture (sliding an item to mark it as watched/read) interfered with vertical scrolling. Any micro horizontal finger movement during a vertical scroll (natural jitter) displaced the cards horizontally — although without marking them as watched — because `touchmove` applied `translateX` to the content based **only on deltaX**, ignoring the finger's vertical movement.

The gesture is implemented in `attachSwipe(row, content, onTrigger)` in `js/ui.js`: `touchstart` enabled the drag unconditionally and `touchmove` translated the card with `translateX(clamped)` on every event. **There was no axis lock**: there was no way to distinguish a vertical scroll gesture from a horizontal swipe until the gesture ended. The CSS already defined `touch-action: pan-y` on `.list-row`, so native vertical scroll worked; **the direction lock in JS was missing**.

Related issue: #42 — https://github.com/gonzalitojh/personal-tracker/issues/42

## Decision

Implement **axis lock** in `attachSwipe` (`js/ui.js`, lines 262-332): when crossing a 10 px slop, the gesture's direction is decided **once** and there is no going back. If the gesture is vertical, swipe handling is abandoned (native scroll rules, no transform nor toggle); if horizontal, the original behavior is preserved.

### 1. `touchstart`: capture of the finger's `clientX`, `clientY` and `identifier`

`touch = e.changedTouches[0]` is captured and `startX = touch.clientX`, `startY = touch.clientY` and `startTouchId = touch.identifier` are stored. `dragging = true` is set and the `is-dragging` class is added. Tracking by `identifier` guarantees following the original finger even with more fingers on the screen.

### 2. `touchmove`: `deltaX`/`deltaY` calculation and single direction decision (10 px slop)

The original finger is located by `identifier` (`Array.from(e.touches).find(...) ?? e.touches[0]`) and `deltaX = touch.clientX - startX` and `deltaY = touch.clientY - startY` are computed. Only when `|deltaX| >= 10` **or** `|deltaY| >= 10` (slop `lockThreshold = 10`) and there is no lock yet, the direction is decided:

- `|deltaX| > |deltaY|` → `lock = "horizontal"`.
- Otherwise (**ties included**) → `lock = "vertical"` (scroll always wins).

Once decided, `lock` is **immutable** for the rest of the gesture (acceptance criterion 5: the decision does not change halfway).

### 3. `lock === "vertical"`: early return without transform nor toggle

If the gesture was locked as vertical, `touchmove` returns immediately: **no** `translateX` is applied, **no** `swipe-reveal` is toggled and the swipe background is not painted. Native vertical scroll (enabled by `touch-action: pan-y`) operates without interference. This is the central fix: the horizontal jitter of scrolling stops displacing the cards.

### 4. `lock === "horizontal"`: original behavior preserved

If the gesture is horizontal, the previous logic is kept:

- `clamped = Math.max(-120, Math.min(120, deltaX))` → `content.style.transform = translateX(clamped)`.
- `row.classList.toggle("swipe-reveal", Math.abs(clamped) > 24)`: the swipe background is revealed only after exceeding 24 px of horizontal displacement.

### 5. `touchend`: quick action triggered only with horizontal lock

Before resetting, `shouldTrigger = lock !== "vertical" && Math.abs(deltaX) > threshold` is evaluated (with `threshold = 70`). Only then is `onTrigger()` invoked — the quick action (mark as watched/read, next episode). Gestures locked as vertical never trigger the action, even if the finger ends with a high `deltaX` after a gesture turn.

### 6. `touchcancel` and shared `resetGesture`

A `touchcancel` handler is added that shares the same reset as `touchend` (`resetGesture`): restores `dragging`, removes `is-dragging` and `swipe-reveal`, clears `content.style.transform`, and resets `lock`, `startTouchId` and `deltaX`. This leaves no hanging state (residual transform or `is-dragging` class) if the browser cancels the gesture (e.g. due to an orientation change or a system interruption).

### 7. No CSS changes: `passive: true` and `touch-action: pan-y` intact

- The listeners remain `passive: true` (vertical scrolling is unaffected, acceptance criterion 4).
- The CSS is **not touched**: `touch-action: pan-y` already existed on `.list-row` (`ocio/ocio.css`) and enabled native scrolling.
- The change is **JS only** (`js/ui.js`, `attachSwipe`); `renderList` and the rest of the flow do not change.

## Rejected alternatives

- **`touch-action: none` on `.list-row`**: it would block native scrolling entirely and force implementing scroll manually in JS — rejected: it breaks the browser's scrolling and contradicts acceptance criterion 4.
- **Only raising the quick action's trigger threshold** (e.g. a bigger `threshold`): does not solve the problem: `translateX` keeps being applied during the gesture and the **visual jitter** (cards moving and returning) would persist, even if the action never fired.
- **Doing nothing**: the bug persisted (cards displaced horizontally during vertical scroll), which is exactly what the issue reports.

## Consequences

### Positive
- **Central fix of the issue**: vertical scroll no longer moves the cards a single pixel (acceptance criterion 1) nor reveals the swipe background (criterion 3): any gesture with a dominant vertical component is treated as scroll from the first slop crossing.
- **Intentional horizontal swipe intact**: sliding a card ≥ 70 px and releasing it still triggers the quick action (criterion 2); the ±120 px clamp and the reveal > 24 px are preserved.
- **Immutable direction decision**: the lock is decided once and does not change mid-gesture (criterion 5).
- **Isolated change with no visual regression risk**: only `js/ui.js` (+42/-7), without touching CSS or `renderList`.
- **QA approved**: 5/5 acceptance criteria verified by `qa-reviewer` with coordinate traces (scroll with jitter → vertical lock without transform; 71 px+ swipe fires; reveal only with horizontal lock; `passive` + `pan-y` intact; immutable lock). Security: **NO FINDINGS (PASS)** — one pre-existing LOW finding (client API keys in `js/config.js`, not introduced by this change).

### Negative
- **Ambiguous diagonal gestures are treated as scroll**: if a finger moves at ~45°, the decision depends on the slop crossing and may be interpreted as vertical; it is the accepted trade-off so that vertical scroll always has priority.

### Neutral
- **Ties go to `vertical`**: `|deltaX| > |deltaY|` (strictly greater) is the only way to horizontal; in ties scroll wins — a **conservative** decision that avoids false displacements.
- **`touchcancel` leaves clean state**: the shared reset avoids residual transform or hanging `is-dragging` after a system cancellation.
- **No contract changes**: `attachSwipe(row, content, onTrigger)` keeps its signature; consumers (`renderList`) do not change.
- **No PWA version bump**: the change touches precached JS only; however, to propagate properly to cache-first clients, the JS must be served under a versioned ref or with revalidation (flagged for the bump review at issue closure).

## Created/modified files

| File | Change |
|---------|--------|
| `js/ui.js` | `attachSwipe` (lines 262-332): axis lock with 10 px slop (`lockThreshold`), immutable `lock` `'vertical'`/`'horizontal'` (ties → vertical), finger tracking by `identifier` (`changedTouches[0]` in `touchstart`, `e.touches.find(...)` in `touchmove`), early return if `lock === 'vertical'`, documented horizontal/touchend/touchcancel behaviors, shared `resetGesture`; `passive: true` listeners |
| `docs/adr-028-swipe-axis-lock.md` | **New**: this document |

Related issue: #42 — https://github.com/gonzalitojh/personal-tracker/issues/42
