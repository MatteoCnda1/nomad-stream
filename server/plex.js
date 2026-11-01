// Accès à Plex : adresses signées par le token, appels avec délai maximal et nouvelles
// tentatives, et mise en forme des éléments renvoyés au client.

export const CLIENT_ID = "nomad-stream-pwa-v1";

// Bibliothèques Plex de ce serveur
export const SECTIONS = { movies: 1, shows: 2, music: 5 };

// Identité "Plex Web / Chrome" envoyée au transcodeur : sans elle, Plex n'applique aucun profil client,
// ignore les plafonds de débit et recopie le flux d'origine en segments de 10 s (lancement très lent)
export const PLEX_WEB_PROFILE = {
  "X-Plex-Product": "Plex Web",
  "X-Plex-Version": "4.120.1",
  "X-Plex-Platform": "Chrome",
  "X-Plex-Device": "Linux",
};

// Un identifiant Plex par appareil : Plex mémorise ses décisions de transcodage par client,
// et deux appareils partageant le même identifiant se gênent mutuellement
export function plexClientId(raw) {
  return typeof raw === "string" && /^[A-Za-z0-9-]{8,64}$/.test(raw) ? `nomad-${raw}` : CLIENT_ID;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Statuts sans corps : rien à lire d'avance
const NULL_BODY = new Set([101, 204, 205, 304]);

// Plex ferme ses connexions restées inactives, et fetch peut réutiliser une connexion qu'il vient
// de fermer : les en-têtes arrivent, puis le corps s'interrompt avant le premier octet
// (UND_ERR_SOCKET, « other side closed »). Mesuré le 01/11/2026 : 2 requêtes sur 60 ; côté
// navigateur, un titre ou une image qui ne se charge pas (« proxy error: EOF » chez tailscaled).
// Le premier morceau du corps est donc lu ici, avant de rendre la réponse : s'il échoue, rien
// n'est encore parti vers le navigateur et la requête peut être refaite sur une autre connexion.
async function withFirstChunk(response) {
  if (!response.body || NULL_BODY.has(response.status)) return response;
  const reader = response.body.getReader();
  const first = await reader.read();
  const body = first.done
    ? null
    : new ReadableStream({
        start(controller) {
          controller.enqueue(first.value);
        },
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

const isStaleConnection = (error) =>
  error?.cause?.code === "UND_ERR_SOCKET" || error?.code === "UND_ERR_SOCKET" || error?.message === "terminated";

// fetch vers Plex avec délai maximal avant réception du début de la réponse et nouvelles tentatives
// (micro-coupure Tailscale, erreur 5xx, connexion périmée). Le délai ne s'applique pas au reste du
// corps : un flux peut durer des heures. Si `signal` est annulé (client parti), le corps est coupé aussi.
// `retryIf(erreur)` écarte les erreurs après lesquelles il ne faut pas réessayer. Une connexion
// périmée est retentée tout de suite, jusqu'à 2 fois, en plus de `retries`.
export async function fetchPlex(url, { method = "GET", headers = {}, timeoutMs = 20000, retries = 0, retryIf = () => true, signal } = {}) {
  let lastError;
  let staleRetries = 2;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new Error("Client déconnecté");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Plex n'a pas répondu en ${timeoutMs / 1000} s`)), timeoutMs);
    signal?.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    try {
      const response = await withFirstChunk(await fetch(url, { method, headers, signal: controller.signal }));
      clearTimeout(timer);
      if (response.status < 500 || attempt === retries) return response;
      response.body?.cancel().catch(() => {});
      lastError = new Error(`Plex HTTP ${response.status}`);
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      // retryIf d'abord : le garde-fou des images interdit toute nouvelle tentative après une
      // coupure pendant un transcodage (Plex vient peut-être de planter sur cette image)
      if (signal?.aborted || !retryIf(error)) throw error;
      if (isStaleConnection(error) && staleRetries-- > 0) {
        attempt--;
        continue;
      }
    }
    if (attempt < retries) await sleep(400 * (attempt + 1));
  }
  throw lastError;
}

export function createPlex({ url, token, timeoutMs = 15000 }) {
  const baseUrl = url.replace(/\/$/, "");

  function plexUrl(endpoint, params = {}, clientId = CLIENT_ID) {
    const qs = new URLSearchParams({ ...params, "X-Plex-Token": token, "X-Plex-Client-Identifier": clientId });
    return `${baseUrl}${endpoint}${endpoint.includes("?") ? "&" : "?"}${qs}`;
  }

  // Appel JSON vers Plex (métadonnées), avec délai maximal global et une nouvelle tentative
  // (micro-coupure Tailscale, erreur 5xx). Sans délai, un Plex figé bloquait la requête indéfiniment.
  async function plexFetch(endpoint, { timeout = timeoutMs } = {}) {
    const response = await fetchPlex(plexUrl(endpoint), {
      headers: { Accept: "application/json" },
      timeoutMs: timeout,
      retries: 1,
      signal: AbortSignal.timeout(timeout * 2),
    });
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      throw new Error(`Plex API Error [${response.status}] on ${endpoint.split("?")[0]}`);
    }
    return response.json();
  }

  return { url: baseUrl, token, timeoutMs, plexUrl, plexFetch };
}

// Lien de flux audio direct d'une piste (MediaItem mis en forme)
export const audioStreamUrl = (partKey) => `/api/stream/audio?key=${encodeURIComponent(partKey)}`;

// Formatter un item média Plex en structure propre avec dimensions d'images ciblées
export function formatMediaItem(item) {
  if (!item) return null;

  const media = item.Media?.[0];
  const part = media?.Part?.[0];

  const duration = item.duration || 0;
  const viewOffset = item.viewOffset || 0;
  const progressPercent = duration > 0 ? Math.min(100, Math.round((viewOffset / duration) * 100)) : 0;

  const isAudio = item.type === "track" || item.type === "album" || item.type === "artist";
  const isEpisode = item.type === "episode";
  const thumbDim = isAudio ? "width=300&height=300" : isEpisode ? "width=480&height=270" : "width=300&height=450";

  return {
    id: item.ratingKey,
    key: item.key,
    type: item.type, // movie, episode, track, show, album, artist
    title: item.title,
    originalTitle: item.originalTitle,
    parentTitle: item.parentTitle, // ex: nom de série ou d'album
    grandparentTitle: item.grandparentTitle, // ex: nom de série pour un épisode
    seasonNumber: item.parentIndex,
    episodeNumber: item.index,
    summary: item.summary || "",
    year: item.year,
    duration: duration,
    durationMinutes: Math.round(duration / 60000),
    viewOffset: viewOffset,
    progressPercent: progressPercent,
    rating: item.audienceRating || item.rating || null,
    contentRating: item.contentRating,
    studio: item.studio,
    tagline: item.tagline,
    addedAt: item.addedAt,
    thumb: item.thumb ? `/api/image?path=${encodeURIComponent(item.thumb)}&${thumbDim}` : null,
    art: item.art ? `/api/image?path=${encodeURIComponent(item.art)}&width=960&height=540` : null,
    parentThumb: item.parentThumb ? `/api/image?path=${encodeURIComponent(item.parentThumb)}&${thumbDim}` : null,
    grandparentThumb: item.grandparentThumb ? `/api/image?path=${encodeURIComponent(item.grandparentThumb)}&${thumbDim}` : null,
    genres: (item.Genre || []).map((g) => g.tag),
    directors: (item.Director || []).map((d) => d.tag),
    roles: (item.Role || []).slice(0, 8).map((r) => r.tag),
    partKey: part?.key || null,
    partId: part?.id ? String(part.id) : null,
    bitrate: media?.bitrate || null, // kb/s, sert au choix automatique de la qualité
    container: media?.container || null,
    videoCodec: media?.videoCodec || null,
    audioCodec: media?.audioCodec || null,
    videoResolution: media?.videoResolution || null,
  };
}

// Élément d'une liste (grille de films, de séries, d'artistes, d'albums) : sans les textes que
// seules les fiches affichent. Les biographies d'artistes faisaient 84 % du poids de la liste
// des artistes (138 Ko gzip pour 100 artistes en 4G).
export function formatListItem(item) {
  const formatted = formatMediaItem(item);
  if (!formatted) return null;
  return { ...formatted, summary: "", tagline: undefined, roles: [], directors: [] };
}

// Piste mise en forme, avec son lien de flux audio
export function formatTrack(item) {
  const track = formatMediaItem(item);
  return { ...track, trackNumber: item.index, streamUrl: audioStreamUrl(track.partKey) };
}
