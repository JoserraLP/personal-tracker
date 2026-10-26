# ADR-109: Re-estilización visual — aire IMDb con acabado Apple "Liquid Glass"

## Estado
Aceptado

## Fecha
2026-10-26

## Contexto

El propietario pide que la interfaz se parezca a IMDb pero con la
temática de Apple "Liquid Glass" siempre que sea posible. La app
tenía una identidad de "cuaderno de biblioteca / entrada de cine"
(superficies de paper sólidas, ticket perforado, radios de 3px) que
convivía con una navegación que "se integra" con la página (ADR de
iteración de feedback: cabecera y pestañas sin separación).

## Decisión

Se aplica una **capa de re-estilización** (overrides al final de
`css/styles.css` y `ocio/ocio.css`) sin tocar las reglas existentes,
en dos ejes:

### 1. Liquid Glass (tokens, no componentes sueltos)

Nuevos tokens en `:root` + tres bloques de familia:

- `--glass-bg` / `--glass-bg-strong`: superficie translúcida por
  familia (oscura con tinte de tinta en dark/black, blanca en
  light/white).
- `--glass-border[-strong]`: hairline (papel translúcido en oscura,
  tinta translúcida en clara).
- `--glass-blur` / `--glass-saturate`: backdrop-filter compartido.
- `--glass-radius`: 14px (la obsesión de radios redondos de iOS).
- `--glass-spec`: brillo especular superior (gradiente).
- `--page-glow`: foco de cine sutil en el borde superior del body.
- `@supports not (backdrop-filter…)`: fallback con superficies casi
  opacas para navegadores sin vidrio.

Solo se blinda la **cromática** (app-header, tabs--bar, app-sidebar,
dropdowns, toast, tarjeta de acceso, back-to-top, pills). Los
formularios, modales y fichas conservan la superficie de papel/white
porque su texto asume esos fondos (evita reintroducir los overrides
masivos de la issue #165 en el contenido).

### 2. Aire IMDb

- Cabecera fija translúcida tipo navbar de cine (el contenido pasa
  por detrás y se desenfoca).
- Titulares de sección `h2` en versalitas con tracking, sans (IBM
  Plex Sans), menos peso que el display serif.
- Tarjetas **poster-forward**: sin perforación de ticket (oculta),
  cover más alta (210px), radio de vidrio, cuerpo translúcido con el
  texto de la familia correspondiente.
- Chip de valoración estilo "escudo IMDb": dorado auto-colored
  (`--imdb-gold` #f5c518, SIEMPRE con su tinta oscura encima,
  `--imdb-gold-ink`), legible en los 4 modos por contraste propio.
- Chips/pills (estado, contador ×N, filtros, sort, vista) unificados
  en lenguaje de vidrio pill con hairline.

## Contraste verificado (los 4 modos)

- dark/black: texto `--paper` #f1ead9 sobre vidrio oscuro ≥ 13:1;
  meta `--ink-soft` ~6:1 (AA); chip dorado ~10:1.
- light/white: texto `--ink` #171512 sobre vidrio blanco ≥ 13:1;
  chip dorado con tinta oscura ~10:1.
- Los estados de tarjeta (--en_curso/completado/standby/abandonado)
  se re-afirman DESPUÉS del vidrio base para conservar sus tintes
  semánticos ya adaptados por familia (con texto --ink en clara y
  --paper en negro puro).

## Consecuencias

- La identidad "cuaderno" pervive en formularios/modales (solo la
  cromática es de vidrio): un compromiso que conserva la legibilidad
  sin duplicar los overrides de ejemplo de la familia oscura.
- No hay cambios de comportamiento ni de contenido: el manual de
  usuario no requiere actualización.
- El fallback sin backdrop-filter mantiene la legibilidad AA/AAA.
