# ADR-108: VinculaciÃ³n de Steam por inicio de sesiÃ³n y actualizaciÃ³n automÃ¡tica diaria

## Estado
Aceptado

## Fecha
2026-10-24

## Contexto

El primer diseÃ±o de la integraciÃ³n Steam (PR #4) era manual: el
usuario pegaba su SteamID64 y tiraba de botÃ³n. El propietario pide
ahora:

1. **VinculaciÃ³n por inicio de sesiÃ³n**, no por cÃ³digo pegado.
2. **ActualizaciÃ³n continua**: que los datos (horas jugadas) se vayan
   refrescando.

InvestigaciÃ³n tÃ©cnica:

- Steam NO ofrece OAuth2 para aplicaciones web de usuario (solo para
  publishers con partner). El mecanismo oficial y estÃ¡ndar es
  **OpenID 2.0** ("Sign in through Steam"): la web manda al usuario a
  `steamcommunity.com/openid/login`, Steam autentica y devuelve al
  callback una `openid.identity` firmada que hay que VERIFICAR con
  `openid.mode=check_authentication` (contra Steam, servidor a
  servidor). La verificaciÃ³n debe hacerse EN SERVIDOR (huella
  anti-spoof), asÃ­ que el lugar natural es el Worker steam-proxy ya
  existente.
- Para el refresco continuo: la pasada diaria de la web
  (`js/daily-check.js`) es el punto natural (se ejecuta al abrir la
  web cada dÃ­a con sesiÃ³n iniciada).

## DecisiÃ³n

### 1. Worker steam-proxy: dos rutas nuevas

- `GET /login?return_to=<url de la app>` â†’ 302 al endpoint OpenID de
  Steam (`checkid_setup`), con `openid.return_to` apuntando al
  callback del propio worker y `openid.realm` al origen del worker.
- `GET /callback?return_to=...&openid.*`:
  1. ReenvÃ­a TODOS los parÃ¡metros `openid.*` a Steam con
     `openid.mode=check_authentication` (POST form-urlencoded).
  2. Comprueba `is_valid:true` en la respuesta.
  3. Extrae el SteamID64 de `openid.identity`
     (`â€¦/openid/id/<steamid>`).
  4. Redirige 302 a la app con `#/steam-callback?steamid=â€¦` (o
     `#/steam-callback?error=verify` si la verificaciÃ³n falla).
- **`validateReturnTo`**: solo se aceptan `return_to` en https y, si
  el worker tiene `ALLOWED_ORIGIN`, del mismo host (anti-open
  redirect). El ni se persiste ninguna cookie/session en el worker.
- Ruta `/owned` queda como estÃ¡ (el steamid ya lo tiene la web).

### 2. Web: vincular (settings.js + api-steam.js)

- `steamLoginUrl()`: URL del worker /login con `return_to` el origen
  de la web actual (null sin proxy o sin window).
- **BotÃ³n Â«Vincular mi cuenta de SteamÂ»** en Ajustes â†’ IntegraciÃ³n de
  Steam (`browser.location.href = ...`). Al volver, `app.js`
  intercepta el hash `#/steam-callback?...` ANTES de enrutamiento
  (applySteamCallback): guarda el SteamID en los ajustes, hace toast
  y resetea el hash a `#/ocio` (sin recargar la pÃ¡gina).
- El ajuste manual del SteamID64 **se conserva como fallback** (se
  rellena solo al vincular). Â«Re-vincularÂ» repite el flujo (por si
  cambiÃ³ de cuenta).

### 3. Refresco automÃ¡tico (daily-check.js)

Nuevo paso al final de `checkForUpdates` (pasada diaria o Â«Comprobar
estrenosÂ»), **fail-open y silencioso**:

- Si hay steamId vinculado y juegos del registro con `steamAppId`:
  pide la biblioteca al proxy y por cada juego conocido
  actualiza `steamPlaytimeHours` y las horas de su sesiÃ³n
  (`source: "steam"`), con backfill de sesiÃ³n para juegos viejos sin
  marca.
- NO se auto-altan juegos nuevos de Steam (evita inundar el registro
  con cientos de tÃ­tulos; el alta sigue siendo manual y elegida).
- Un fallo de Steam no aborta la pasada ni quema el cooldown.

## Consecuencias

- "Vincúlame" = un clic sobre Steam; sin pegar IDs a mano.
- Las horas se mantienen frescas solas, sin botón, cada día al
  abrir la web (o con «Comprobar estrenos»).
- Riesgo: si el perfil se vuelve privado, Steam devuelve 0 juegos y
  las horas dejan de refrescarse hasta revisar la privacidad (la UI
  de /owned ya lo explica).