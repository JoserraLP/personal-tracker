# ADR-107: Contadores de «veces» e integración de Steam para los videojuegos

## Estado
Aceptado

## Fecha
2026-10-24

## Contexto

Dos peticiones del propietario:

1. **Contador de cuántas veces se ha visto/leído/jugado** un elemento
   (serie, capítulo, libro, película). La web YA registra cada
   sesión/visionado con fecha en historiales (watchLog de películas,
   readLog de libros con sesiones terminadas, playLog de
   videojuegos, timesCompleted de series y times por episodio, D-105),
   así que el contador natural ya existía; le faltaba verse como un
   contador claro y poder ANOTAR/CORREGIR cuando el registró no
   refleja la realidad.
2. **Integración de bibliotecas de juegos (Steam, Epic Games)** para
   obtener los juegos del usuario y SUS HORAS JUGADAS.

Restricciones técnicas investigadas:

- **Steam**: la API oficial (api.steampowered.com, por ejemplo
  `IPlayerService/GetOwnedGames`) exige una clave propietaria
  (STEAM_API_KEY) y NO responde con CORS del navegador. La clave no
  puede ir en la SPA.
- **Epic Games**: NO existe una API pública que devuelva la
  biblioteca de un usuario ni sus horas de juego (requeriría
  OAuth de la tienda con permisos de desarrollador y no hay
  endpoint público de tiempo de juego). SIN integración posible
  para un tercero sin partner de Epic.

## Decisión

### 1. Contadores (js/counter.js, puro y testado)

- `naturalTimes(item)`: nº natural según el tipo (len del log
  correspondiente; en series, `timesCompleted`).
- `timesCount(item)`: lo que VISUALIZA la web — la anotación manual
  (`seenCount`, siempre que sea >= 1) si hay; si no, el natural.
  Nunca muestra menos de lo registrado (max(natural, manual)).
- **Chip «×N» en las tarjetas** (grid y lista) en los 4 medios
  cuando vale >= 1 (`.item-card__counter`).
- **Ajuste manual en el modal de edición** (abierto desde la ficha
  de cualquier ítem): campo numérico "Veces vista / completada /
  leído / jugada" con validación (entero >= 1; vacío = cuenta
  automática; valor igual al natural = no se anota nada).
- El contador NO multiplica nada por sí solo: los avisos de
  estrenos/episodios y estadísticas siguen funcionando con sus
  historiales (el `seenCount` es presentación/corrección).

### 2. Steam (cloudflare/steam-proxy + js/api-steam.js)

- **Worker nuevo `cloudflare/steam-proxy/`** (mismo patrón que el
  igdb-proxy existente): guarda `STEAM_API_KEY` como secreto de
  Cloudflare, expone `GET /owned?steamid=<SteamID64>`, llama a
  `IPlayerService/GetOwnedGames` (con `include_appinfo` y
  `include_played_free_games`), y devuelve una lista normalizada
  `{ appid, name, playtimeHours, lastPlayedAt }` ordenada por horas,
  con CORS y verificación de origen opcional (`ALLOWED_ORIGIN`).
- **Cliente `js/api-steam.js`** (puramente componible con config):
  sanitiza el SteamID64 (17 dígitos), normaliza horas ("134,7 h"),
  y pide la biblioteca al worker con errores claros.
- **Config `STEAM_PROXY_URL`** (""): card de Ajustes advierte si no
  hay proxy desplegado; las instrucciones de despliegue viven en
  `cloudflare/steam-proxy/README.md` (wrangler secret put +
  deploy) con verificación paso a paso.
- **UI en Ajustes → Integración de Steam**: SteamID64
  (recuerda el último valor con el mismo storage de ajustes),
  botón «Buscar mis juegos de Steam», y una lista con horas jugadas
  y día del último juego. El **alta en el registro** añade el juego
  como ítem manual (`steamAppId` y `steamPlaytimeHours`) con UNA
  sesión de juego que agrupa las horas (suman en la estadística
  "horas jugadas" del perfil), status "completado" (= "Jugado");
  duplicados marcados "Añadido ✓".

### 3. Epic Games

Queda **fuera** con nota: sin API pública no se puede implementar
una sincronización oficial. Si Epic saca una API pública o un export
oficial, se añadiría con un nuevo ADR.

## Consecuencias

- El usuario ve "×N" en sus títulos y puede corregir la cuenta
  cuando el registro no refleje la realidad.
- La integración Steam no requiere ningún server nuevo: reutiliza el
  patrón de Worker de Cloudflare ya existente y no expone secretos.
- Riesgo conocido: la lista de Steam llega en inglés (nombre
  original) y SIN portadas; si el juego usa otro nombre en IGDB, el
  usuario lo corrige desde la ficha (editar título).
