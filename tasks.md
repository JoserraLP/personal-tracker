# Tasks — Núcleo base personal-tracker (poda)

Fuente de verdad: `specs/00-overview.md` (núcleo base: Auth Google + dashboard
vacío + Firestore + configuración SDD). Sin issues de GitHub en esta fase. Sin
`git commit` ni `git push`.

| Task | Owner | Files | Spec refs | Depends | Done when (resumen BDD) | Status |
|---|---|---|---|---|---|---|
| BASE | tech-lead | `js/config.js`, `js/firebase.js`, `js/allowed-emails.js`, `js/app.js`, `index.html`, `css/app.css`, `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `opencode.jsonc`, `.opencode/` | REQ-A\*, REQ-D\*, REQ-F\* | — | Núcleo operativo: login Google con allowlist en dos copias, máquina `loading → {login\|allowed\|denied}`, barra superior con logout, nav placeholder vacía, estado vacío «Selecciona o añade una categoría para empezar» y Firestore/Auth inicializados con el SDK 10.13.0 sobre `js/config.js` | done |
| P-1 | tech-lead | (borrados) `js/catalog.js`, `js/api-*.js`, `js/seed/`, `js/repositories/`, `js/services/`, `js/ui/`, `cloudflare/`, `tests/`, `openspec/`, specs antiguas (`01..05`, `001..004`), `spec.md`, `more specs.txt` | `specs/00-overview.md` §1, §5 | — | Eliminados módulos, vistas, servicios, adaptadores, seeds y tests de funciones antiguas; conservados intactos `js/config.js`, `js/firebase.js`, `js/allowed-emails.js`, `index.html`, `css/app.css`, `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `opencode.jsonc`, `.opencode/`, `manifest.json`, `resources/` | done |
| P-2 | dev-frontend | `index.html`, `js/app.js`, `css/app.css` | REQ-A1..A4, REQ-D1..D3, REQ-C1..C3 | P-1 | Shell del núcleo: login Google con error en español, allowlist permite/deniega, logout y «Volver», barra superior con foto/nombre/email, nav vacía, estado vacío exacto, `<meta charset="UTF-8">` primera etiqueta de `<head>`, cero imports rotos | done |
| P-3 | devops | `package.json`, `manifest.json`, `README.md` | REQ-F2, REQ-C1 | P-2 | `package.json` mínimo sin scripts/devDependencies de tests obsoletos, `manifest.json` y `README.md` coherentes con el núcleo; ficheros tocados en UTF-8 sin BOM | done |
| P-3b | tech-lead | `specs/00-overview.md`, `tasks.md` | REQ-C4 | P-3 | `specs/` reducida a la especificación mínima del núcleo (REQ-A/D/F + AC + convenciones) y `tasks.md` reiniciado con BASE y este histórico; UTF-8 sin BOM | done |
| P-4 | code-reviewer | (read-only) | REQ-A\*, REQ-D\*, REQ-F\*, REQ-C\* | P-3b | Revisión sin imports rotos ni referencias muertas, sin restos de categorías/funciones antiguas, charset y codificación correctos, árbol listo para probar en `http://localhost:5500` | done |

## Estado

- BASE, P-1, P-2, P-3, P-3b y P-4 completados. Árbol podado y verificado.
- Hallazgos de P-4 diferidos (no bloquean el núcleo): comentarios obsoletos en
  `js/config.js` (claves TMDB/Books/IGDB/Steam y refs a `cloudflare/` y
  `scripts/`), `js/firebase.js` (cita `db.js`) y `js/allowed-emails.js` (cita la
  spec 001 eliminada). `js/config.js` se conserva INTACTO por decisión del
  usuario; su limpieza se hará en la próxima fase de especificación.
- Árbol listo para prueba local en `http://localhost:5500` antes del reset de
  Git por el usuario.
