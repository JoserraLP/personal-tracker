// =============================================================
// fetch with retry. External APIs (especially Google Books)
// sometimes return temporary server errors (503, etc.).
// Retrying once after a short wait resolves most
// of those cases without the user having to search again by hand.
// =============================================================

export async function fetchJson(url, { retries = 1, retryDelayMs = 400 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  throw lastError;
}
