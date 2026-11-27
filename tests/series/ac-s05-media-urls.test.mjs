// AC-S05 (API-S07, API-S08): URLs de imágenes y tráiler —
// poster → w500, backdrop → w1280, still → w300; sin ruta ⇒ placeholder (null);
// con `trailerKey` ⇒ https://www.youtube.com/watch?v=….

import assert from "node:assert/strict";
import test from "node:test";

import { loadClientWithKey, TEST_API_KEY } from "./helpers.mjs";

const client = await loadClientWithKey(TEST_API_KEY);

test("AC-S05 · poster/backdrop/still apuntan a image.tmdb.org con sus tamaños", () => {
  assert.equal(
    client.posterUrl("/qJ2tL2b6gB0Rf7a9yGqE4Sj8zXk.jpg"),
    "https://image.tmdb.org/t/p/w500/qJ2tL2b6gB0Rf7a9yGqE4Sj8zXk.jpg"
  );
  assert.equal(
    client.backdropUrl("/b0PlSFdDwbyK0cf5RxwDpaOJQvQ.jpg"),
    "https://image.tmdb.org/t/p/w1280/b0PlSFdDwbyK0cf5RxwDpaOJQvQ.jpg"
  );
  assert.equal(
    client.stillUrl("/xNMl4cqLgvPaxLOWmMiVX87QdCp.jpg"),
    "https://image.tmdb.org/t/p/w300/xNMl4cqLgvPaxLOWmMiVX87QdCp.jpg"
  );
});

test("AC-S05 · tamaños alternativos admitidos y fallback al por defecto", () => {
  assert.equal(client.posterUrl("/p.jpg", "w185"), "https://image.tmdb.org/t/p/w185/p.jpg");
  assert.equal(client.backdropUrl("/b.jpg", "w780"), "https://image.tmdb.org/t/p/w780/b.jpg");
  assert.equal(client.stillUrl("/s.jpg", "w185"), "https://image.tmdb.org/t/p/w185/s.jpg");
  // tamaños invales caen al tamaño por defecto
  assert.equal(client.posterUrl("/p.jpg", "w9999"), "https://image.tmdb.org/t/p/w500/p.jpg");
});

test("AC-S05 · sin ruta se muestra placeholder (null) y nunca un CDN externo", () => {
  assert.equal(client.posterUrl(null), null);
  assert.equal(client.posterUrl(undefined), null);
  assert.equal(client.posterUrl(""), null);
  assert.equal(client.posterUrl("   "), null);
  assert.equal(client.backdropUrl(null), null);
  assert.equal(client.backdropUrl(""), null);
  assert.equal(client.stillUrl(null), null);
  assert.equal(client.stillUrl("   "), null);
  // rutas absolutas ajenas no se enlazan (REQ-C1)
  assert.equal(client.posterUrl("https://evil.example/x.jpg"), null);
  assert.equal(client.stillUrl("http://evil.example/x.jpg"), null);
});

test("AC-S05 · ruta sin barra inicial se normaliza con una sola barra", () => {
  assert.equal(
    client.posterUrl("abc123.jpg"),
    "https://image.tmdb.org/t/p/w500/abc123.jpg"
  );
});

test("AC-S05 · trailerKey ⇒ enlace de YouTube y sin clave ⇒ placeholder", () => {
  assert.equal(
    client.trailerUrl("abc123"),
    "https://www.youtube.com/watch?v=abc123"
  );
  assert.equal(
    client.trailerUrl("  a-b_c  "),
    "https://www.youtube.com/watch?v=a-b_c"
  );
  assert.equal(client.trailerUrl(null), null);
  assert.equal(client.trailerUrl(undefined), null);
  assert.equal(client.trailerUrl(""), null);
  assert.equal(client.trailerUrl("   "), null);
});

test("AC-S05 · imagen y tráiler derivan de la ficha y de la temporada", async () => {
  const { installFetchMock, detailFixture, seasonFixture } = await import("./helpers.mjs");

  installFetchMock((url) =>
    url.includes("/season/") ? seasonFixture(1) : detailFixture()
  );
  const detail = await client.getSeriesDetail(1399);
  assert.equal(
    client.posterUrl(detail.posterPath),
    "https://image.tmdb.org/t/p/w500/gosPoster.jpg"
  );
  assert.equal(
    client.backdropUrl(detail.backdropPath),
    "https://image.tmdb.org/t/p/w1280/gosBackdrop.jpg"
  );

  client.clearSeasonCache();
  const season = await client.getSeasonDetail(1399, 1);
  const [episode] = season.episodes;
  assert.equal(
    client.stillUrl(episode.stillPath),
    "https://image.tmdb.org/t/p/w300/ep1.jpg"
  );
});
