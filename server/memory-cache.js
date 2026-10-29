// Cache mémoire des réponses API (TTL) : une liste déjà demandée répond en ~1 ms au lieu
// d'un aller-retour vers Plex. Au-delà de `maxEntries`, l'entrée la plus ancienne part.
export function createMemoryCache({ maxEntries = 500 } = {}) {
  const entries = new Map();

  function get(key) {
    const item = entries.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      entries.delete(key);
      return null;
    }
    return item.data;
  }

  function set(key, data, ttlSeconds) {
    if (entries.size >= maxEntries && !entries.has(key)) {
      entries.delete(entries.keys().next().value);
    }
    entries.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  function deletePrefix(prefix) {
    for (const k of entries.keys()) {
      if (k.startsWith(prefix)) entries.delete(k);
    }
  }

  return { get, set, delete: (key) => entries.delete(key), deletePrefix };
}
