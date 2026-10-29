# Spec 001: Login con Google y lista de correos autorizados

## 1. Feature Target & Git Context
- **Target Branch:** `dev` (adaptación del skill: la rama de integración de este repo es `dev`, y sobre ella el workflow `deploy-pages.yml` despliega automáticamente a GitHub Pages al fusionar)
- **Feature Branch:** `feat/001-google-login-allowlist`
- **Contexto:** primer spec del proyecto tras el reset. El repo solo contiene configuración (Firebase, workers de Cloudflare, manifest, package.json, workflow de Pages). No existe aún `index.html` ni app: este spec crea la puerta de acceso de la nueva aplicación.

## 2. API & Data Contracts

### 2.1 Fichero de configuración externo `js/allowed-emails.js`
Módulo ES puro, sin dependencias (importable por la app y por los tests). Es la fuente de verdad **del lado web** para los correos con acceso:

```js
export const ALLOWED_EMAILS: string[]        // correos autorizados
export function normalizeEmail(email?: string|null): string
    // trim() + toLowerCase(); "" para null/undefined/no-string
export function isEmailAllowed(email?: string|null, list: string[] = ALLOWED_EMAILS): boolean
    // true solo si normalizeEmail(email) está en la lista normalizada
    // lista vacía o email vacío → false
```

- Semilla de la lista: `admin@admin.es` (ejemplo del requisito) y `djoserralozanopinilla@gmail.com` (propietario, ya presente en `firestore.rules`; sin él el propietario quedaría fuera de su propia app).
- La comparación es exacta sobre el correo normalizado (sin wildcards ni dominios completos).

### 2.2 Máquina de estados de la UI (`js/app.js`)
- Estados: `loading → { login | allowed | denied }`.
- `login`: botón «Entrar con Google» (usa `login()` de `js/firebase.js`); si `login()` rechaza (popup bloqueado/cancelado), muestra mensaje de error y permanece operativa.
- `allowed`: saludo con nombre/foto/correo del usuario (`user.displayName`, `user.photoURL`, `user.email`) y botón «Salir» (`logout()`).
- `denied`: mensaje «Tu correo no está en la lista de invitados», cierre de sesión automático (`logout()`) y persistencia de la vista de rechazo (el evento posterior `auth == null` NO debe devolver al login); botón «Volver» que reactiva la vista `login`.

### 2.3 Autenticación
- `js/firebase.js` existente, sin cambios: Auth con `GoogleAuthProvider` (popup), SDK modular 10.13.0 desde CDN, `firebaseConfig` de `js/config.js`.

### 2.4 Datos y enforcement en servidor (`firestore.rules`)
- `isAllowedUser()` mantiene la **copia de servidor** de la misma lista (protección de datos); las dos listas se sincronizan a mano (documentado en el propio fichero y en el README).
- Las colecciones heredadas del proyecto anterior quedan FUERA de alcance de este spec (se redefinirán en specs futuros de datos).

### 2.5 Despliegue
- SPA estática en la raíz del repo servida por GitHub Pages; rutas de assets siempre relativas (`./`, el sitio vive en un subdirectorio de `*.github.io`).

## 3. Acceptance Criteria (BDD)

- **Escenario 1 — visitante sin sesión:** Given un visitante sin sesión, When carga la app, Then ve la vista `login` con el botón «Entrar con Google».
- **Escenario 2 — correo autorizado:** Given un usuario cuyo correo está en `ALLOWED_EMAILS`, When completa el login con Google, Then accede a la vista `allowed` con su nombre, foto, correo y botón «Salir».
- **Escenario 3 — correo rechazado:** Given un usuario cuyo correo NO está en la lista, When completa el login, Then ve «Tu correo no está en la lista de invitados», su sesión se cierra automáticamente y la vista de rechazo persiste hasta que pulse «Volver».
- **Escenario 4 — normalización:** Given un correo de la lista escrito con mayúsculas/minúsculas distintas o espacios alrededor, When se evalúa `isEmailAllowed`, Then devuelve `true` (comparación normalizada).
- **Escenario 5 — correo vacío o nulo:** Given `email` nulo, vacío o solo espacios (o lista vacía), When se evalúa `isEmailAllowed`, Then devuelve `false`.
- **Escenario 6 — cierre manual:** Given un usuario autorizado conectado, When pulsa «Salir», Then la sesión se cierra y vuelve a la vista `login`.
- **Escenario 7 — enforcement en servidor:** Given un cliente cuyo correo no está en `isAllowedUser()` de `firestore.rules`, When intenta leer o escribir en Firestore, Then el servidor lo deniega (la lista web y la de reglas están sincronizadas).
- **Escenario 8 — error de login:** Given el popup de Google bloqueado o cancelado, When `login()` rechaza, Then la vista `login` muestra un mensaje de error y sigue operativa.

## 4. Execution Matrix

| Task ID | Role | Component | Spec Reference | Status |
|---|---|---|---|---|
| T1 | Spec Architect | `specs/001-google-login-allowlist/spec.md` | §1–4 | done |
| T2 | Junior Dev 1 (Frontend) | `index.html`, `css/app.css`, `js/app.js` | §2.2, esc. 1, 2, 3, 6, 8 | pending |
| T3 | Junior Dev 2 (Backend) | `js/allowed-emails.js` | §2.1, esc. 4, 5 | pending |
| T4 | QA & Test Engineer | `tests/allowed-emails.test.js` (`npm test`) | esc. 4, 5 | pending |
| T5 | DevOps & Release | sincronizar `firestore.rules`, `README.md`, PR y merge a `dev` | §2.4, esc. 7 | pending |
| T6 | Reviewer + Security | auditoría del PR contra el spec | todos | pending |

## 5. Decisiones y notas
- La lista de correos NO es un secreto: la protección real de datos es de servidor (`firestore.rules`); el fichero web es puerta de UX. Ambas listas deben editarse juntas.
- El dominio de GitHub Pages ya está autorizado en Firebase Auth (mismo proyecto Firebase y misma URL que el proyecto anterior).
- El cambio de correo autorizado exige: editar `js/allowed-emails.js` (web) + `isAllowedUser()` de `firestore.rules` y publicar las reglas en Firebase console.
