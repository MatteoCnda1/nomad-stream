// Validation des paramètres reçus du navigateur avant qu'ils n'atteignent Plex ou le disque.

export const isNumericId = (v) => typeof v === "string" && /^\d{1,12}$/.test(v);
export const isSessionId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(v);
export const isJobId = (v) => typeof v === "string" && /^[a-f0-9]{16}$/.test(v);

// Images servies par /api/image : uniquement les chemins d'images que Plex renvoie dans ses
// métadonnées. Sans cette liste, le paramètre `path` permettait de lire n'importe quelle page
// de Plex avec le token admin (réglages, sessions en cours…).
const PLEX_IMAGE_PATHS = [
  /^\/library\/metadata\/\d+\/[A-Za-z]+\/\d+$/, // thumb, art, banner…
  /^\/library\/collections\/\d+\/composite\/\d+$/,
  /^\/playlists\/\d+\/composite\/\d+$/,
  /^\/:\/resources\/[\w-]+\.(?:png|jpe?g)$/, // images par défaut de Plex
];
export const isPlexImagePath = (v) => typeof v === "string" && PLEX_IMAGE_PATHS.some((re) => re.test(v));

// Clés de fichier (flux directs) et sous-chemins HLS : jamais de segment "..", qui ferait sortir
// de /library/parts/ (ou de la session) vers n'importe quelle page de Plex
const hasDotSegment = (v) => v.split("/").some((s) => s === "." || s === "..");
export const isPartKey = (v) =>
  typeof v === "string" && /^\/library\/parts\/\d+(?:\/[\w.-]+)+$/.test(v) && !hasDotSegment(v);
export const isHlsSubpath = (v) => typeof v === "string" && /^[\w.-]+(?:\/[\w.-]+)*$/.test(v) && !hasDotSegment(v);

export const clampInt = (v, def, min, max) => Math.min(max, Math.max(min, parseInt(v, 10) || def));
