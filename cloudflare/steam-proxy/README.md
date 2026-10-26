# steam-proxy — Worker de Cloudflare

Proxy de la API de Steam para la app. La API de Steam exige una clave
(`STEAM_API_KEY`) que no puede exponerse en la web, y sus respuestas no
llevan CORS: este Worker guarda la clave como secreto y devuelve la
lista de juegos con horas jugadas lista para la app.

## Obtener lo necesario

1. **Clave de la API de Steam**: entra en https://steamcommunity.com/dev/apikey con tu
   cuenta de Steam (dominio "localhost" vale para registrarla) y copia la clave.
2. **Tu SteamID64**: puedes verlo en tu perfil de Steam (la URL
   `.../profiles/7656119XXXXXXXXXXXX`) o con herramientas como
   <https://steamid.io>.
3. **Perfil público**: tus horas solo se comparten si tu detalle del
   juego es público en Steam (Perfil → Editar → Privacidad → Detalles
   del juego → Público).

## Desplegar

```bash
cd cloudflare/steam-proxy
npm install --save-dev wrangler   # (o usa npx wrangler)
npx wrangler login
npx wrangler secret put STEAM_API_KEY      # pega la clave de Steam
# Opcional (recomendado): limitar el origen a tu GitHub Pages
npx wrangler secret put ALLOWED_ORIGIN     # pega p. ej. https://joserralp.github.io
npx wrangler deploy
```

`wrangler deploy` imprime la URL pública (formato
`https://steam-proxy.<tu-subdominio>.workers.dev`).

## Conectar con la app

Pon esa URL en `js/config.js`:

```js
export const STEAM_PROXY_URL = "https://steam-proxy.<tu-subdominio>.workers.dev";
```

y sube con `scripts/bump-version.sh` después (la config se cachea
con el service worker).

## Verificación

1. Abre `https://steam-proxy.<tu-subdominio>.workers.dev/` en el navegador:
   debe responder `{"ok":true,"service":"steam-proxy",...}`.
2. Prueba `GET /owned?steamid=<tuSteamID64>`: lista de juegos con
   `playtimeHours` y `lastPlayedAt`.
3. En la web, Ajustes → Integración de Steam: pega tu SteamID64 y
   «Buscar mis juegos».
