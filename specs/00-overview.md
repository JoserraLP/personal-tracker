# 00 — Overview: Arquitectura OpenSpec SDD (personal-tracker)

## 1. Stack detectado (leído del repo, sin lockfiles)

| Capa | Detectado | Evidencia |
|---|---|---|
| Lenguaje | JavaScript ESM (`"type": "module"`), sin TypeScript ni `tsconfig.json`, sin `src/` | `package.json`, `glob tsconfig*` = 0 |
| Framework UI | Ninguno (vanilla DOM, `index.html` + `js/app.js`, vistas por `show(name)`) | `js/app.js` |
| Estado | Módulos con estado + `onSnapshot` de Firestore (suscripciones por vista) | `js/app.js`, `js/catalog.js` |
| Backend | Firebase Web SDK **10.13.0 por CDN** (Auth Google + Firestore), sin build step | `js/firebase.js` |
| Estilos | CSS puro `css/app.css` (sin Tailwind/preprocesador) | `css/app.css` |
| Testing | **Vitest 3** (`npm test` → `vitest run`), tests en `tests/*.test.js` | `package.json`, `tests/` |
| APIs externas | TMDB, Google Books; proxies Cloudflare Workers (IGDB, Steam) | `js/api-*.js`, `cloudflare/` |
| Seguridad | `firestore.rules`: allowlist de correos (`isAllowedUser`) + owner-only | `firestore.rules` |
| Specs previas | `specs/<id>-<slug>/spec.md` con tablas REQ/DB/UI/AC | `specs/001..004` |
| Deploy | GitHub Pages desde rama `dev` | `README.md` |

## 2. Estructura de carpetas (existente + nueva)

```
personal-tracker/
├── index.html            # app shell
├── css/app.css           # estilos
├── js/                   # módulos ESM (sin bundler)
│   ├── config.js         # claves públicas y URLs
│   ├── firebase.js       # ÚNICO punto con URLs de CDN (Auth/Firestore)
│   ├── catalog.js        # parte pura + store (dynamic import de firebase.js)
│   ├── api-*.js          # proveedores externos
│   └── app.js            # orquestación de vistas
├── tests/                # vitest, sin red ni Firebase
├── specs/                # especificaciones vivas (esta serie: 00-05)
├── openspec/changes/     # cola de cambios OpenSpec (.gitkeep)
├── firestore.rules
└── cloudflare/           # workers proxy
```

## 3. Convenciones a respetar

| ID | Convención |
|---|---|
| REQ-C1 | Módulos con **parte pura** (importable en Node sin red) y **parte store** que hace `await import("./firebase.js")` dentro de cada función (nunca import estático). |
| REQ-C2 | Comentarios de cabecera en cada módulo referenciando sus IDs (`REQ-*`, `DB-*`, `AC-*`). |
| REQ-C3 | IDs estables por serie; esta serie usa rangos propios para no colisionar con specs 001–004: `REQ-1xx` catálogo, `REQ-2xx` tracking/colecciones, `REQ-3xx` dashboard, `REQ-4xx` recomendaciones, `AC-1xx` criterios nuevos, `DB-1xx`/`DB-2xx`, `SEC-01..0n`, `API-01..`, `UI-01..`, `ALG-01..`. |
| REQ-C4 | Nombres de test: `tests/<área>-<tema>.test.js`; cada `it()` cita el ID que cubre. |
| REQ-C5 | Textos de UI en español; enums en inglés mayúsculas (`PLANNED`, …). |
| REQ-C6 | Sin build step: los contratos TypeScript de este documento se implementan como `@typedef`/`@param` JSDoc en los módulos JS (tipos=documentales, validación en runtime con los validadores de `catalog.js`). |

## 4. Contratos transversales

### 4.1 Tipos base (JSDoc `@typedef`, espejo TS)

```typescript
type MediaType = "SERIES" | "ANIME" | "MANGA" | "BOOK" | "AUDIOBOOK" | "MOVIE" | "GAME";
type EntryStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "DROPPED";

type Result<T> =
  | { ok: true; value: T }
  | { ok: false; code: "not_found" | "permission_denied" | "validation" | "unavailable" | "unknown"; message: string };
```

### 4.2 Manejo de errores

| ID | Regla |
|---|---|
| REQ-E1 | Toda función repository devuelve `Result<T>`; nunca lanza excepciones no capturadas a la UI. |
| REQ-E2 | Errores de red/Firestore se normalizan a `code` (tabla 4.1); la UI muestra mensaje en español y permite reintentar. |
| REQ-E3 | Validación antes de escribir (validators puros, sección 5 de `01-data-model.md`); `code:"validation"` incluye `errors: string[]` en mensaje. |
| REQ-E4 | Fallos de APIs externas no bloquean el alta manual (conserva AC-015 de spec 002). |

## 5. Supuestos verificados / delta con el código actual

| # | Supuesto | Estado |
|---|---|---|
| S1 | Esta serie **reemplaza** el modelo `users/{uid}/movies\|series\|…` por `catalog` + `users/{uid}/entries`; migración de datos = fuera de alcance inicial (seed re-pobla `catalog`). | A confirmar al implementar |
| S2 | `SEC-01` convive con la allowlist `isAllowedUser()` existente mediante **AND combinado**: toda acceso exige `request.auth != null && isAllowedUser() && request.auth.uid == uid` (owner dentro de la allowlist). Definido en `01-data-model.md` SEC-04. | Decidido |
| S3 | No hay `src/`: la serie describe módulos bajo `js/` siguiendo convención REQ-C1. | Verificado |
