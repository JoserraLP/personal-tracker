# ADR-075: Allowed emails: firestore.rules as the single source of truth (issue #195)

## Status
Accepted

## Date
2026-08-11

## Context

The web is only available to a list of **authorized emails** and
requires a Google login. Until now the list was **duplicated in two
places**:

1. **`js/allowed-emails.js`**: a JS array (`ALLOWED_EMAILS`) that the
   browser checked in `init()` right after login. If the user's email
   was not there, the notice «Tu correo no está en la lista de
   invitados. Pide que te añadan.» showed and the session
   closed. Its role was **purely UX**: giving an
   immediate rejection, without depending on
   the network, and preventing a non-invitee from getting to see the
   app.
2. **`firestore.rules`' `isAllowedUser()`**: the list that **really
   protects the data**, because every Firestore
   read/write goes through it.

The problem: the list **de-synced**. On `main`,
`josemcrespo98@gmail.com` was added to the JS array **without touching
the rules**: the browser's filter let them through, but Firestore
blocked all their reads — the user "entered" a broken app, with the
data
 inaccessible and the problem invisible in the code. Keeping the emails in
two places forced the administrator to make **two manual edits**
per add/removal, and a missed one was easy to go unnoticed.

Issue #195 asks to
 explain why the file existed and, if
possible, **remove it**, keeping the emails only in
the Firebase rule the user updates manually.

Related issue: #195 — https://github.com/gonzalitojh/Registro-personal/issues/195

## Decision

**Remove `js/allowed-emails.js` and turn `firestore.rules` into the
SINGLE source of truth** for the
authorized emails. The administrator
only edits the `isAllowedUser()` function and publishes the
file in the Firebase console; there is no other place where emails
are kept.

1. **The browser's check is replaced by an access probe**: after login,
   the app reads its own profile (a `getDoc` of
   `users/{uid}` via `getUserProfile`) **against
   Firestore's rules**:
   - If Firestore responds `permission-denied`, the user is not in
     `isAllowedUser()`: the notice «Tu correo no está en la
     lista de invitados. Pide que te añadan.» shows and the session
     closes (the same
     text and behavior as before).
   - **Any other error (e.g. without connection) does not block
     entry**:
     the data subscriptions already retry on their own (issue #147) and
     the rules keep protecting the information even if the user
     enters.
2. **`josemcrespo98@gmail.com` is added to `isAllowedUser()`** (the
   4th email): it was only in `main`'s JS and the
   rules rejected it. The rule now authorizes exactly the same 4 emails the
   "JS + rules" set authorized before: the
   authorized set is not reduced.
3. **Service worker**: `js/allowed-emails.js` is removed from the
   precache (`STATIC_ASSETS`).
4. **Version bump to `20260905`** (`js/config.js`, `index.html`,
   `service-worker.js`) to invalidate the previous deploy's caches.
5. **README.md and `docs/manual-de-usuario.md`** are updated
   explaining the new mechanism: the emails are edited in a
   single place (`firestore.rules`).

## Consequences

**Positive**:

- **A single place to maintain**: the emails list lives where
  the data's real protection already lived; it is impossible for it to
  de-sync again (the `josemcrespo98@gmail.com` case on `main` cannot
  repeat).
- **The list is no longer exposed in the browser**: before, any visitor
  could read the whole array of authorized emails by downloading the
  JS; now the list only exists in the rules and is not served to
  the client.
- The decision of who enters is made by
  the same layer that protects the
  data: there can be no difference between "seems
  invited" (JS) and "is invited" (the rules).
- The authorized emails set is not reduced (the 4 remain).

**Negative / to watch**:

- **One extra Firestore read per login** (a `getDoc` of
  the own profile against the rules): it only
  happens on login and is negligible against the rest of the session's
  reads.
- **A non-invitee without connection is not detected until
  reconnecting**: the
  probe fails with a network error and does not block entry. It is mitigated
  because the rules keep denying reads/writes — the user sees
  an empty app and their changes are not saved, but the data are never
  exposed; when the connection recovers, the subscriptions retry
  (issue #147).
- The "non-invitee" notice now depends on a Firestore response:
  with a bad connection it may be slightly slower than the previous instant
  local check (acceptable: it
  is an edge case).

## Related issues

- Related issue: #195
  (allowed emails)
- It builds on: #147 (subscription retry), #145 (the SDD flow)
