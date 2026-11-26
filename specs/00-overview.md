# 00 — Overview: Núcleo base (personal-tracker)

Especificación mínima del núcleo base de la aplicación. Sustituye a la serie
anterior (`00`–`05` y `001`–`004`), ya podada. Todo lo que no figure aquí está
fuera de alcance (§5).

## 1. Alcance del núcleo

### 1.1 Autenticación y control de acceso (REQ-A)

- **REQ-A1 — Login con Google (popup).** El botón «Entrar con Google» de
  `index.html` invoca `login()` de `js/firebase.js`, que usa
  `signInWithPopup` con un `GoogleAuthProvider`. Cualquier fallo del popup
  (bloqueado, cancelado, red) se informa en español dentro de `#login-error`,
  sin romper la vista de login.
- **REQ-A2 — Allowlist en dos copias sincronizadas.** `js/allowed-emails.js`
  exporta `ALLOWED_EMAILS` y `isEmailAllowed(email)` (normaliza con `trim` +
  minúsculas y compara exacto; vacío o lista vacía → `false`).
  `firestore.rules` mantiene su propia copia en `isAllowedUser()`, que exige
  sesión, `email_verified == true` y que el correo esté en esa lista. Al
  añadir o quitar un correo se editan **ambas** listas.
- **REQ-A3 — Observador de sesión y máquina de estados.** `js/app.js` registra
  `watchAuthState` y resuelve una única vista visible:
  `loading → login | allowed | denied`. `login`: sin usuario. `allowed`:
  usuario con correo permitido. `denied`: usuario autenticado con correo no
  permitido. Tras denegar se ejecuta `logout()`, pero el estado `denied`
  **persiste** (no se cae a `login`) hasta que se pulsa «Volver».
- **REQ-A4 — Protección de la vista.** La barra superior, la navegación y el
  área principal solo existen en la vista `allowed`, que únicamente se muestra
  con sesión válida y correo autorizado. `denied` no expone ningún dato del
  usuario.

### 1.2 Dashboard base (REQ-D)

- **REQ-D1 — Barra superior de usuario.** En `allowed` se muestra la foto
  (`photoURL`; el `<img>` queda oculto si no hay foto), el nombre
  (`displayName`, o el email, o «invitado»), el email y el botón «Salir», que
  llama a `logout()` de `js/firebase.js`.
- **REQ-D2 — Navegación placeholder.** `#app-nav` existe, tiene
  `aria-label="Navegación principal"` y está **vacía**: no hay enlaces ni
  secciones. Se poblará en fases posteriores.
- **REQ-D3 — Contenedor principal con estado vacío.** `#app-main` alberga el
  estado vacío `#app-empty` con el texto exacto
  «Selecciona o añade una categoría para empezar», visible al entrar en
  `allowed`.

### 1.3 Infraestructura y configuración (REQ-F)

- **REQ-F1 — Firebase sobre el SDK 10.13.0 y credenciales reales.**
  `js/firebase.js` importa el SDK modular **10.13.0** desde el CDN de Google
  (`www.gstatic.com/firebasejs/10.13.0/...`), inicializa la app con
  `firebaseConfig` importado de `js/config.js` (credenciales reales del
  proyecto) y exporta `auth`, `db`, `login`, `logout`, `watchAuthState` y los
  helpers de Firestore que necesiten los módulos futuros. Es el único fichero
  que conoce las URLs del CDN.
- **REQ-F2 — Configuración SDD e infraestructura intactas.** La configuración
  del flujo SDD (`.opencode/`, `opencode.jsonc`, `tasks.md`) y la
  infraestructura de despliegue (`firebase.json`, `firestore.rules`,
  `firestore.indexes.json`) se conservan tal cual: no se reescriben como parte
  de tareas de UI ni de poda de código.

## 2. Criterios de aceptación

- **AC-A1 — Login y error en español.** Con sesión cerrada se ve la vista de
  login; al pulsar «Entrar con Google» se abre el popup de Google. Si el popup
  falla se muestra un mensaje en español en `#login-error` y se puede
  reintentar.
- **AC-A2 — Allowlist permite y deniega.** Un correo de `ALLOWED_EMAILS`
  termina en `allowed`; un correo fuera de la lista termina en `denied` con el
  aviso «Tu correo no está en la lista de invitados.», sin sesión residual.
- **AC-A3 — Salir y volver.** «Salir» cierra sesión y devuelve a `login`.
  Desde `denied`, «Volver» devuelve a `login`; un nuevo login denegado vuelve a
  mostrar `denied`.
- **AC-D1 — Barra superior.** En `allowed` se ven foto (si existe), nombre,
  email y botón «Salir», y la foto se oculta cuando el usuario no tiene
  `photoURL`.
- **AC-D2 — Estado vacío.** En `allowed` la navegación está vacía y el área
  principal muestra el texto «Selecciona o añade una categoría para empezar».
- **AC-F1 — Sin imports rotos ni errores de consola.** Al cargar la página,
  todos los imports ESM resuelven, no hay referencias a ficheros borrados y la
  consola del navegador no muestra errores de carga (los avisos de popup
  cancelado no cuentan como error del código).
- **AC-F2 — Codificación.** `<meta charset="UTF-8">` es la primera etiqueta de
  `<head>` y todos los ficheros del repositorio están en UTF-8 **sin BOM**.

## 3. Convenciones (REQ-C)

- **REQ-C1 — Sin build step; CDN solo en `js/firebase.js`.** La app se sirve
  como estáticos y usa módulos ESM nativos. Ningún otro fichero importa URLs de
  CDN: los helpers de Firebase se reexportan desde `js/firebase.js`.
- **REQ-C2 — Cabeceras con IDs.** Cada bloque de UI relevante (vistas, barra,
  nav, main, botones, avisos) lleva un `id` estable para poder automatizar y
  testear sin depender de clases o textos.
- **REQ-C3 — Español y UTF-8 sin BOM.** Textos de interfaz, comentarios de
  dominio y documentación en español. Se respetan tildes y eñe; nunca se
  escriben caracteres de reemplazo ni BOM.
- **REQ-C4 — Proceso.** Toda tarea nueva pasa por `tasks.md` **antes** de
  implementarse. Los issues de GitHub solo se reabren cuando se reactive el
  flujo SDD completo; en esta fase no se crean issues, ni commits, ni push.

## 4. Estructura conservada

```text
personal-tracker/
├── index.html                  # shell: vistas loading/login/allowed/denied
├── css/
│   └── app.css                 # estilos del shell y del estado vacío
├── js/
│   ├── config.js               # APP_VERSION + firebaseConfig real
│   ├── firebase.js             # único punto con el CDN 10.13.0
│   ├── allowed-emails.js       # allowlist web + isEmailAllowed
│   └── app.js                  # máquina de estados, topbar, estado vacío
├── specs/
│   └── 00-overview.md          # esta especificación
├── tasks.md                    # fuente de tareas (BASE, P-1..P-4)
├── manifest.json               # manifiesto PWA
├── resources/                  # iconos y estáticos
├── firebase.json               # infra de despliegue
├── firestore.rules             # reglas + copia isAllowedUser
├── firestore.indexes.json      # índices
├── opencode.jsonc              # config SDD
└── .opencode/                  # config SDD
```

## 5. Fuera de alcance

Quedan explícitamente fuera de este núcleo: categorías y funciones antiguas
(catálogo de películas, series, libros, juegos y anime, búsqueda, colecciones,
estadísticas, recomendaciones), integraciones con APIs externas (TMDB, Google
Books, IGDB, Steam, Cloudflare Workers), seeds, scripts de datos y tests
automatizados. Se reintroducirán, si procede, con sus propias specs y tareas.
