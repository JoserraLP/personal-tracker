// =============================================================
// CONFIGURATION — fill these values with your own.
// None of these values is "secret" in the traditional sense:
// the real protection of your data comes from the Firestore security
// rules (see firestore.rules) and the login flow, not from
// these keys being hidden. Still, see the README
// for restricting the Google Books key by domain.
// =============================================================

// Deployment/cache version. It is incremented by scripts/bump-version.sh
// and used to version asset URLs (?v=...) so that
// each deploy invalidates the caches of the service worker and the browser.
export const APP_VERSION = '20261031';

// Configuration of your Firebase project
// (Firebase console → Project settings → Your apps → SDK)
export const firebaseConfig = {
  apiKey: "AIzaSyA7Hp6Udu07Eh83Ti4Od5zHWqrV73X_0Yg",
  authDomain: "personal-tracker-e0783.firebaseapp.com",
  projectId: "personal-tracker-e0783",
  storageBucket: "personal-tracker-e0783.firebasestorage.app",
  messagingSenderId: "504174599040",
  appId: "1:504174599040:web:6c8a0e32ae7d768fd1ff65",
  measurementId: "G-HWP0MH3ZF9"
};


  // The list of who can log in lives ONLY in the
  // isAllowedUser() rule of firestore.rules (issue #195):
  // js/allowed-emails.js, which duplicated it, was removed.

  // TMDB API key (free, non-commercial)
// Get it at https://www.themoviedb.org/settings/api
export const TMDB_API_KEY = "f23a198de513705e5970b196de181edb";

// Google Books API key (optional).
// It works the same without a key, with a lower request limit.
// If you use it, restrict it by HTTP referrer to your GitHub Pages domain
// from Google Cloud Console → Credentials.
export const GOOGLE_BOOKS_API_KEY = "AIzaSyAQ0NCW84ldhfmUboMo3ErylgkqexygYZM";

// Public URL of your Cloudflare Worker, IGDB (Twitch) proxy.
// IGDB has no CORS and its Client Secret cannot be exposed in an SPA:
// the Worker keeps the secrets and forwards the requests to IGDB.
// IMPORTANT: put here the EXACT URL printed by `wrangler deploy`
// (format https://igdb-proxy.<your-subdomain>.workers.dev). If you set
// a URL that doesn't exist, the videogame search will fail.
// Deploy the Worker and configure the secrets following
// cloudflare/igdb-proxy/README.md, and put its URL here.
// With no value (""), the videogame search shows a clear warning
// («Falta IGDB_PROXY_URL…») and the rest of the app works the same.
export const IGDB_PROXY_URL = "https://igdb-proxy.gonzalojh596.workers.dev";

// Public URL of the Steam proxy (Cloudflare Worker; see
// cloudflare/steam-proxy/README.md). The Steam API secret
// is not exposed on the web: the Worker keeps it. If it is empty (""),
// the Settings card warns and the integration is unavailable.
export const STEAM_PROXY_URL = "https://steam-proxy.joserralp.workers.dev";
