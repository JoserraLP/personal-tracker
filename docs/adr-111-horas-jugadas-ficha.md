# ADR-111: Horas jugadas totales en la ficha de videojuego

## Estado
Aceptado

## Fecha
2026-10-26

## Contexto
El usuario pidió que el detalle de videojuegos muestre cuántas horas
se han jugado. La web ya registra sesiones (`playLog`) con horas
opcionales, y Steam puede aportar un total (`steamPlaytimeHours`,
backfill del ADR-107/108) cuando no hay sesiones registradas.

## Decisión
Helper puro `totalPlayHours(item)` en `js/game-log.js`:

- **Suma de playLog** (fuente de verdad), redondeada a 1 decimal,
  ignorando sesiones sin horas (sesión en curso, hours null).
- Si no hay sesión con horas, **usa `steamPlaytimeHours`**.
- Devuelve null si no hay nada computable y no se pinta la línea.

La ficha lo muestra debajo del título: «X h jugadas»
(`steamHoursLabel`, formato es-ES con 1 decimal).

## Consecuencias
- Las horas de Steam actúan como valor provisional hasta que el
  usuario registra sesiones; con sesiones ganan siempre.
- 5 tests nuevos en `tests/game-hours.test.js`.
