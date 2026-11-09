const CACHE_NAME = 'nomad-stream-v7';
// Vidéos téléchargées (mode hors connexion) : ce cache n'est JAMAIS purgé lors des mises à jour
const OFFLINE_CACHE = 'nomad-offline-v1';
// Musique préchargée pendant l'écoute (#56, client/src/audioPrefetch.ts) : gardée aussi
const AUDIO_CACHE = 'nomad-audio-v1';
// Playlists téléchargées (client/src/musicOffline.ts) : jamais purgé non plus
const MUSIC_CACHE = 'nomad-music-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== OFFLINE_CACHE && key !== AUDIO_CACHE && key !== MUSIC_CACHE) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Sert une vidéo téléchargée ou un titre préchargé, avec les requêtes partielles (Range)
// qu'exigent Safari et iOS
async function serveCached(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(new URL(request.url).pathname);
  if (!cached) return new Response('Fichier absent du cache', { status: 404 });
  const range = request.headers.get('range');
  if (!range) return cached;
  const type = cached.headers.get('content-type') || 'video/mp4';

  const blob = await cached.blob();
  const size = blob.size;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] ? parseInt(m[1], 10) : 0;
  let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
  if (m && !m[1] && m[2]) {
    // Plage suffixe : les N derniers octets
    start = Math.max(0, size - parseInt(m[2], 10));
    end = size - 1;
  }
  end = Math.min(end, size - 1);
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': type,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes'
    }
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Vidéos téléchargées, musique préchargée et playlists téléchargées
  if (url.origin === self.location.origin && url.pathname.startsWith('/offline/')) {
    event.respondWith(serveCached(event.request, OFFLINE_CACHE));
    return;
  }
  if (url.origin === self.location.origin && url.pathname.startsWith('/precharge/')) {
    event.respondWith(serveCached(event.request, AUDIO_CACHE));
    return;
  }
  if (url.origin === self.location.origin && url.pathname.startsWith('/offline-audio/')) {
    event.respondWith(serveCached(event.request, MUSIC_CACHE));
    return;
  }

  // 2. Ne jamais intercepter les écritures ni l'API (flux, playlists, téléchargements), sauf les images
  if (event.request.method !== 'GET' ||
      (url.origin === self.location.origin && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/image'))) {
    return;
  }

  // 3. Assets applicatifs statiques (JS, CSS, Polices Google) - Stratégie Cache-First
  if (url.pathname.startsWith('/assets/') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;

        const networkRes = await fetch(event.request);
        if (networkRes.status === 200) {
          cache.put(event.request, networkRes.clone());
        }
        return networkRes;
      })
    );
    return;
  }

  // 4. Images Plex - Stale-While-Revalidate (les affiches des téléchargements sont dans OFFLINE_CACHE,
  //    les pochettes des playlists téléchargées dans MUSIC_CACHE)
  if (url.pathname.startsWith('/api/image')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((networkRes) => {
          if (networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkRes;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // 5. Navigation : réseau d'abord (nouvelle version immédiate), page en cache si hors connexion
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((networkRes) => {
        if (networkRes.status === 200) {
          const copy = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
        }
        return networkRes;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 6. Autres fichiers de l'appli (manifest, icônes) : version en cache tout de suite, mise à jour
  //    en arrière-plan (sinon un manifest ou une icône modifiés ne seraient jamais repris)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request).then((networkRes) => {
        if (networkRes.status === 200) {
          const copy = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return networkRes;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
