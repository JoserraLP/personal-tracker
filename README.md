# Personal Tracker

Registro personal reconstruido desde cero. Especificación viva en `specs/`.

## Acceso (login con Google)

Solo pueden entrar los correos de la lista de invitados, configurada en **dos sitios que se editan juntos**:

1. **Web:** `js/allowed-emails.js` (`ALLOWED_EMAILS`) — la puerta de acceso de la aplicación (spec 001).
2. **Servidor (datos):** `isAllowedUser()` en `firestore.rules` — lo que Firestore realmente exige; tras editarlo, publica las reglas en Firebase console → Firestore Database → Reglas.

Ambas listas llevan `admin@admin.es` (ejemplo) y el correo del propietario como semilla.

## Desarrollo

- Rama de integración: `dev` (las fusiones a `dev` desde ramas que no sean `main` despliegan automáticamente a GitHub Pages).
- Specs en `specs/<id>-<slug>/spec.md` (metodología SDD).
- Tests: `npm test` (vitest).
