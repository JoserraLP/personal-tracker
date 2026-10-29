# steam-proxy — Cloudflare Worker

Steam API proxy for the app. The Steam API requires a key
(`STEAM_API_KEY`) that cannot be exposed in the web, and its responses
carry no CORS: this Worker stores the key as a secret and returns the
list of games with hours played, ready for the app.

## Getting what's needed

1. **Steam API key**: go to https://steamcommunity.com/dev/apikey with your
   Steam account ("localhost" as domain works to register it) and copy the key.
2. **Your SteamID64**: you can see it in your Steam profile (the URL
   `.../profiles/7656119XXXXXXXXXXXX`) or with tools such as
   <https://steamid.io>.
3. **Public profile**: your hours are only shared if your game detail is
   public on Steam (Profile → Edit → Privacy → Game details → Public).

## Deploy

```bash
cd cloudflare/steam-proxy
npm install --save-dev wrangler   # (or use npx wrangler)
npx wrangler login
npx wrangler secret put STEAM_API_KEY      # paste the Steam key
# Optional (recommended): restrict the origin to your GitHub Pages
npx wrangler secret put ALLOWED_ORIGIN     # paste e.g. https://joserralp.github.io
npx wrangler deploy
```

`wrangler deploy` prints the public URL (format
`https://steam-proxy.<your-subdomain>.workers.dev`).

## Connect with the app

Put that URL in `js/config.js`:

```js
export const STEAM_PROXY_URL = "https://steam-proxy.<your-subdomain>.workers.dev";
```

and push afterwards with `scripts/bump-version.sh` (the config is cached
by the service worker).

## Verification

1. Open `https://steam-proxy.<your-subdomain>.workers.dev/` in the browser:
   it must respond `{"ok":true,"service":"steam-proxy",...}`.
2. Try `GET /owned?steamid=<yourSteamID64>`: list of games with
   `playtimeHours` and `lastPlayedAt`.
3. On the web, Settings → Steam integration: paste your SteamID64 and
   hit "Find my games".
