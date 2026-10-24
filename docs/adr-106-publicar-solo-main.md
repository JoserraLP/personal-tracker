# ADR-106: Publicar en producción SOLO la rama main

## Estado
Aceptado

## Fecha
2026-10-24

## Contexto

El despliegue vigente hasta ahora (ADR-036 → ADR-044) publicaba **todas
las ramas** del repositorio en GitHub Pages: main en la raíz y el resto
(incluida `dev`) en subdirectorios como previews. Esto tiene riesgos y
costes que el propietario del proyecto no quiere asumir:

- Cualquier rama de feature era visible públicamente con su web
  completa (incluidos sus datos no fusionados).
- Cada despliegue reconstruía el sitio entero multi-rama (el script
  `scripts/build-pages-site.sh` extraía todas las ramas con
  `fetch-depth: 0`): builds más lentos y más fragiles.
- El usuario quiere un modelo clásico y simple: **solo `main` es la
  aplicación publicada y actualizada**, tras cada merge a `main`.

## Decisión

1. **Nuevo workflow único `deploy-pages.yml`** (sustituye a
   `deploy-all-branches.yml`):
   - Trigger: `push` a `main` **solo** + `workflow_dispatch` manual.
   - `actions/checkout` del código de la rama que dispara (main) y
     `actions/upload-pages-artifact` de la raíz del repo, tal cual.
   - `actions/deploy-pages` con el entorno `github-pages`.
   - Sin `fetch-depth: 0`, sin `delete` trigger, sin previews.
2. **`deploy-all-branches.yml` y `scripts/build-pages-site.sh` se
   eliminan**.
3. **`auto-resolve-issues.yml`** (relanzamiento de Pages tras sesión):
   su dispatch cambia de `deploy-all-branches.yml` a
   `deploy-pages.yml`.
4. **El flujo de ramas NO cambia**: las PRs se crean contra `dev`
   (AGENTS.md), y el único que promueve `dev` → `main` es el
   usuario. Al fusionar a `main`, la web pública se actualiza
   inmediatamente a esa versión.
5. **El workflow `tests.yml` mantiene sus triggers** (push a main/dev,
   PRs a dev): la calidad sigue verificándose en la rama de
   integración y en las promociones.
6. Los ADR-036/041/044 quedan marcados como obsoletos con referencia
   a este ADR (histórico intacto).

## Consecuencias

- La app pública de `https://<usuario>.github.io/<repo>/` es SIEMPRE
  la última versión estabilizada en `main`.
- Los previews de ramas desaparecen; para probar una feature antes
  del merge queda el entorno local.
- Builds de Pages más rápidos y sin riesgo de colas multi-rama.
- El entorno `github-pages` con restricción de rama (protección)
  sigue siendo correcto: ahora solo permite `main`.
