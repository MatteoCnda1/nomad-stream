// Garde-fou du transcodeur photo de Plex. Certaines images le font planter (segfault, puis
// ~1 min 30 d'indisponibilité de tout Plex) : sans mémoire, chaque affichage de la page
// redemandait la même image et replantait Plex en boucle. Une image en cours de transcodage
// quand Plex tombe est donc mise de côté (fichier JSON) et servie brute ensuite. Le nombre de
// transcodages simultanés est limité : Plex moins sollicité, et moins d'images innocentes
// prises dans la même chute (elles sont mises de côté elles aussi, faute de savoir laquelle a
// fait planter Plex : servies brutes, elles restent affichées). Les JPEG en niveaux de gris,
// cause des plantages observés, sont reconnus d'avance et mis de côté sans attendre de plantage.
import fs from "fs";
import path from "path";

// Nombre de composantes d'un JPEG (1 = niveaux de gris), lu dans son en-tête de trame (SOFn) ;
// null si ce n'est pas un JPEG ou si cet en-tête n'est pas dans `buf`. Le transcodeur photo de
// Plex plante sur les JPEG en niveaux de gris (deux pochettes sur deux le 29/10/2026).
export function jpegComponents(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) {
      i++; // octet de remplissage
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2; // marqueur sans longueur
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // données d'image : plus d'en-tête après
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return i + 9 < buf.length ? buf[i + 9] : null;
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

// Premiers octets d'un flux (au plus `maxBytes`), le reste n'est pas téléchargé
export async function readHead(stream, maxBytes) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).subarray(0, maxBytes);
}

// Connexion coupée par Plex en pleine réponse (≠ connexion refusée, ≠ délai dépassé)
const DROP_CODES = new Set(["UND_ERR_SOCKET", "ECONNRESET", "EPIPE"]);
export const isConnectionDrop = (err) => DROP_CODES.has(err?.cause?.code ?? err?.code);

// Au plus `max` tâches à la fois, les suivantes attendent leur tour
export function createLimiter(max) {
  let active = 0;
  const queue = [];
  return async (task) => {
    if (active < max) active++;
    else await new Promise((resolve) => queue.push(resolve)); // créneau transmis par la tâche finie
    try {
      return await task();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}

export function createImageGuard({ file, isPlexUp, concurrency = 4, maxEntries = 2000 }) {
  // Chemin d'image Plex → date de mise de côté
  let suspects = new Map();
  try {
    suspects = new Map(Object.entries(JSON.parse(fs.readFileSync(file, "utf8"))));
  } catch {
    // Pas encore de fichier (ou illisible) : liste vide
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const limit = createLimiter(concurrency);

  function setAside(imagePath, reason) {
    if (suspects.has(imagePath)) return;
    suspects.set(imagePath, new Date().toISOString());
    if (suspects.size > maxEntries) suspects.delete(suspects.keys().next().value);
    console.warn(`⚠ ${imagePath} (${reason}) : servie désormais sans transcodage`);
    fs.promises
      .writeFile(file, JSON.stringify(Object.fromEntries(suspects), null, 1))
      .catch((err) => console.error("Liste des images mises de côté :", err.message));
  }

  return {
    isSuspect: (imagePath) => suspects.has(imagePath),
    setAside,
    // Un transcodage (`attempt`) dans un créneau. Connexion coupée : si Plex ne répond plus
    // ensuite, il est tombé sur cette image (mise de côté, jamais redemandée) ; s'il répond,
    // ce n'était qu'une micro-coupure et on réessaie une fois.
    transcode: (imagePath, attempt) =>
      limit(async () => {
        try {
          return await attempt();
        } catch (err) {
          if (!isConnectionDrop(err)) throw err;
          if (!(await isPlexUp())) {
            setAside(imagePath, "Plex est tombé pendant sa miniature");
            throw err;
          }
          return attempt();
        }
      }),
  };
}
