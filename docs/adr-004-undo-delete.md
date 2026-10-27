# ADR-004: "Undo" system for deleting items

## Status
Accepted

## Context
When clicking "Delete" in the detail modal of a movie,
series or book, the system executed the deletion in Firestore
immediately after a confirmation with `window.confirm()`. This
had two problems:

1. **Lack of safety**: The native `window.confirm()` dialog is
   intrusive and the user could delete an item accidentally
   with no possibility of recovery.
2. **Poor UX**: Once confirmed, the item disappeared
   instantly with no margin to reconsider.

A mechanism was needed that gave the user a second
chance before definitive deletion, similar to the "Undo" pattern
used by Gmail, Google Drive and most
modern applications.

## Decision
Implement a deferred deletion system with an
"Undo" option that replaces the previous flow. Instead of deleting
immediately from Firestore, deletion is scheduled with a
6-second timer while a non-intrusive notice is shown
with an "Undo" button.

### New flow
```
User clicks "Delete"
  → Modal closes
  → Toast appears: "«Inception» will be deleted… [Undo]"
  → For 6 seconds:
    ├─ User clicks "Undo" → the deletion is cancelled
    │  and "Cancelled." is shown
    └─ Timer expires → deleteDoc is executed in Firestore
       and "Deleted." is shown
```

### Deferral strategy
The choice was made to **not delete from Firestore until the timer
expires**. This avoids having to implement a
"restoration" mechanism (which would require saving the deleted data and
re-inserting it). By keeping the item in Firestore during the undo
window, cancellation is trivial: simply do nothing.

### Queue management
Only one undo toast is visible at a time. When a new
deletion is scheduled while another one is pending:

- **Same item**: the timer is reset (useful if the user
  closes and reopens the modal).
- **Different item**: the pending deletion is executed
  immediately and the new one takes its place in the toast.

### Safety against page reload
On page reload (`beforeunload` event), all pending
deletions are cancelled automatically. Since the item
was never deleted from Firestore, there is no data loss.

### Removal of `window.confirm()`
The native confirmation dialog was removed entirely. The undo
toast acts as the user's "second chance", with a
smoother, more modern experience.

### Technical implementation
A new module `js/undo-delete.js` was created that exposes two functions:

- **`scheduleDeletion(item, uid, kind, ctx)`**: Schedules the
  deletion with a timer and shows the undo toast.
- **`cancelAllDeletions()`**: Cancels all pending
  deletions (used in `beforeunload`).

The module keeps an internal `Map` (`pending`) with the
pending deletions. Each entry contains the timer, the item's
identifiers and a reference to the toast's `hide()` function.

In `js/ui.js` the function `showUndoToast(title, onUndo)` was added,
which renders the toast with HTML content (escaped) and returns an
object `{ hide }` so the caller controls the lifecycle.
The existing `showToast()` function was modified to clear
any active undo toast before showing a normal message.

### Rejected alternatives

- **Delete and restore**: Delete the document from Firestore
  immediately and keep its data in memory/localStorage to
  restore it if the user clicks "Undo". Rejected
  because it is more complex, requires handling document IDs and
  does not work if the user reloads the page.
- **Soft delete with a `deletedAt` field**: Mark the item as
  deleted with a timestamp and filter it out of queries.
  Rejected because it would require changing the data model, the
  security rules and the Firestore subscriptions.
- **Keeping `window.confirm()` alongside the toast**: would add
  an unnecessary double confirmation that worsens the UX.
- **Custom modal dialog**: interaction overhead; the
  non-intrusive toast is today's standard for reversible
  operations.

## Consequences

### Positive
- Users can rectify accidental deletions for
  6 seconds.
- The experience is more modern and consistent with other
  applications (Gmail, Google Drive, etc.).
- No data loss if the user reloads the page during
  the undo window.
- The change is transparent to the Firestore data system
  (the model, the security rules and the subscriptions are not
  modified).
- Works the same for movies, series and books with no additional
  changes.

### Negative
- Deletions are not immediate; there is a 6-second window
  before the document is actually deleted from Firestore.
- If the user closes the browser before the timer
  expires and the `beforeunload` event does not fire (e.g. on
  mobile), the item is never deleted. This is acceptable (there is
  no data loss, just an item the user wanted to delete that was
  not deleted).

### Neutral
- The existing toast (`#toast` in `index.html`) is reused with
  `innerHTML` instead of `textContent` for undo mode.
- Two CSS classes were added (`.toast--undo` and `.toast__btn`) that
  use existing design variables (`--teal-reel`, `--paper`).

## Files created/modified
- `js/undo-delete.js` — New module managing deletions with
  undo (98 lines).
- `js/ui.js` — Added `showUndoToast()`, modified `showToast()`
  to clear undo state.
- `js/modal-handlers.js` — `confirmDelete` rewrite using
  `scheduleDeletion`, removed `window.confirm()`.
- `css/styles.css` — Added `.toast--undo` and `.toast__btn`.
