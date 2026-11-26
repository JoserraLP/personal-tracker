# Personal Tracker

Tracker personal en su **núcleo base**: login con Google restringido por allowlist y dashboard vacío. Especificación viva y mínima en `specs/00-overview.md`.

## Servir en local

Abre la raíz del repositorio con un servidor estático y entra en `http://localhost:5500` (por ejemplo, la extensión Live Server de VS Code). No hay build step: `index.html` carga `js/app.js` como módulo ESM nativo.

## Configuración de Firebase

`js/config.js` define `firebaseConfig` (Firebase console → Project settings → Your apps → SDK web). Son identificadores públicos del proyecto web; la protección real de los datos la ejercen `firestore.rules`. `js/firebase.js` es el único módulo que importa el SDK del CDN y expone `login()`, `logout()` y `watchAuthState()`.

## Allowlist de acceso

Quién puede entrar se define en **dos sitios que se editan juntos**:

1. **Web:** `js/allowed-emails.js` (`ALLOWED_EMAILS`) — la puerta de la aplicación.
2. **Datos:** `isAllowedUser()` en `firestore.rules` — lo que Firestore exige. Tras editarlo, publica las reglas en Firebase console → Firestore Database → Reglas.

Un correo fuera de la lista ve «Acceso no autorizado» y se cierra su sesión automáticamente.

## Desarrollo SDD

- Metodología SDD con configuración conservada en `.opencode/` (skill y subagentes) y `opencode.jsonc` (roles, permisos, modelos).
- Cola de tareas en `tasks.md`; alcance y contratos (`REQ-*`, `AC-*`) en `specs/00-overview.md`.
- Sin tests ni scripts de build en esta fase: `npm test` ya no existe.
