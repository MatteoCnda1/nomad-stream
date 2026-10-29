// Garde-fou du transcodeur photo de Plex. Certaines images le font planter (segfault, puis
// ~1 min 30 d'indisponibilité de tout Plex) : sans mémoire, chaque affichage de la page
// redemandait la même image et replantait Plex en boucle. Une image en cours de transcodage
// quand Plex tombe est donc mise de côté (fichier JSON) et servie brute ensuite. Le nombre de
// transcodages simultanés est limité : Plex moins sollicité, et moins d'images innocentes
// prises dans la même chute (elles sont mises de côté elles aussi, faute de savoir laquelle a
// fait planter Plex : servies brutes, elles restent affichées).
import fs from "fs";
import path from "path";

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

  function mark(imagePath) {
    if (suspects.has(imagePath)) return;
    suspects.set(imagePath, new Date().toISOString());
    if (suspects.size > maxEntries) suspects.delete(suspects.keys().next().value);
    console.warn(`⚠ Plex est tombé pendant la miniature de ${imagePath} : elle sera servie sans transcodage`);
    fs.promises
      .writeFile(file, JSON.stringify(Object.fromEntries(suspects), null, 1))
      .catch((err) => console.error("Liste des images mises de côté :", err.message));
  }

  return {
    isSuspect: (imagePath) => suspects.has(imagePath),
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
            mark(imagePath);
            throw err;
          }
          return attempt();
        }
      }),
  };
}
