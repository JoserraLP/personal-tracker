# ADR-110: Interfaz bilingüe Español / English switchable

## Estado
Aceptado

## Fecha
2026-10-26

## Contexto

El propietario pide "arreglar los textos en español" (tildes y
textos raros) y además poder usar la web en inglés (switchable).

Investigación previa: revisé todos los HTML y JS buscando mojibake
(U+FFFD) — solo había **un** texto corrupto en la web viva y era de
`js/wishlist.js` («no es válida» corrompido por una errata de
encoding en un commit anterior). El resto de la "basura" que se ve
en consola es artefacto del terminal de Windows, no de la web: los
ficheros están en UTF-8 correcto y en el navegador se ven con sus
tildes.

La app no tiene capa de internacionalización: los textos viven
dispersos en HTML estático (index + partials de Ocio inyectados
lazy) y en JS (etiquetas de estado, toasts...).

## Decisión

Modelo **"español como fuente de verdad" + traducción aplicada al
DOM** (`js/i18n.js`):

1. **Sólo hay que escribir español una vez**: cualquier texto que
   la app renderice en español (estático o dinámico) se traduce en
   el acto si el usuario eligió English.
2. **Matching exacto normalizado** (espacios colapsados) contra un
   diccionario en/m:
   - Nodos de texto via `TreeWalker`.
   - Atributos translate: `placeholder`, `aria-label`, `title`.
3. **MutationObserver** sobre `document.body`: los renders
   dinámicos (biblioteca, fichas, listas) se traducen sin tocar
   los puntos de render existentes.
4. **Select de idioma** en Ajustes › Apariencia › Idioma
   (`settings-lang-select`), persistido en
   `localStorage("mi-registro-lang")` (independiente del usuario
   para funcionar en la pantalla de acceso).
5. Etiquetas de estado (`constants.js STATUS_LABELS`) cubiertas
   vía el diccionario.

## Cobertura v1

- Toda la marqueta estática (index + partials Ocio/Compras).
- Etiquetas de estado dinámicas (chips de estado).
- **No cubierto:** mensajes dinámicos de toasts/errores JS
  siguen en español (siguiente iteración; documentado).

## Alternativas descartadas

- **data-i18n a mano** en cada string de los ~1.500 elementos:
  error-prone y con el doble de superficie que cambia a la vez.
- **Framework i18n (i18next)**: dependencia y build para 2 idiomas
  de UI estática: sobredimensionado (la app no tiene bundler).

## Consecuencias

- Añadir un texto nuevo: nada si es español-de-verdad (solo se
  verá en inglés si se añade al dict de `js/i18n.js`).
- Rendimiento: el observer re-traduce solo los nodos añadidos o
  reescritos (coste mínimo; el texto EN no matchea y no hay
  bucles de traducción sobre sí mismo).
