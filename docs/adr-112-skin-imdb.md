# ADR-112: Identidad visual IMDb (plana, sin Liquid Glass)

## Estado
Aceptado

## Fecha
2026-10-26

## Contexto
Tras la iteración "IMDb + Apple Liquid Glass" (ADR-109) el propietario
pide retirar el vidrio de Apple y referenciar la web de imdb.com para
toda la UI.

Referencia IMDb (2026): portada en negro, acento dorado de marca
(#F5C518) en titulares y valoraciones, superficies planas sin blur,
tarjetas poster-forward y tipografía de catálogo en versalitas.

## Decisión
Se sustituye la capa del ADR-109 por una capa de overrides plana
(final de `css/styles.css` y `ocio/ocio.css`):

1. **Sin Liquid Glass**: cero `backdrop-filter`/blur; superficies
   sólidas por familia (oscura `--ink`/`--ink-raised`, clara
   `--paper-dim`/`--white`).
2. **Dorado IMDb** (`--brand-gold` #f5c518 + `--brand-gold-ink`):
   - Texto de titulares (`--heading`) SOLO en la familia oscura
     (sobre papel daría ~1.7:1; en clara el heading es `--ink`).
   - Botón primario y escudo de valoración auto-colored (dorado con
     tinta oscura ≈ 10:1) en los 4 modos.
3. **Tarjetas poster-forward**: sólidas, hairline, radio 10px
   (`--radius-card`), sin perforación de ticket, cover 210px, sello
   de estado transparente a borde, chip de valoración escudo dorado,
   contador ×N píldora plana.
4. **Titulares de sección** en sans versalitas con tracking.
5. Barras (cabecera/pestañas), dropdowns, toast y modales planos con
   hairline.

Contraste verificado (los 4 modos, con los overrides de familia
re-afirmados sobre la base), estados de tarjeta conservados.

## Consecuencias
- Se elimina la dependencia del `@supports`/fallback de
  backdrop-filter (mejor rendimiento en móvil y navegadores viejos).
- El manual no cambia (re-estilización sin comportamiento).
