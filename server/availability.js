// Films et épisodes dont le fichier n'est plus sur le disque (fichier perdu avec un disque, ou
// déplacé sans que Plex ait réanalysé la bibliothèque) : Plex garde leur fiche, mais ils ne
// peuvent être ni lus ni téléchargés. La passerelle, qui voit les mêmes fichiers que Plex
// (montage /media), les repère en parcourant périodiquement la bibliothèque, et ils sont retirés
// des listes de l'appli (accueil, films, épisodes, recherche).
//
// La fiche d'un élément (/api/metadata) le vérifie aussi, à l'unité, par Plex (checkFiles=1) :
// un fichier disparu depuis le dernier passage reste donc signalé au lieu de charger sans fin.
import fs from "fs";
import { SECTIONS } from "./plex.js";

const PAGE = 500;
const CONCURRENCY = 32;
// Au-delà de cette part de fichiers absents, c'est le disque qui n'est pas monté (ou le chemin
// mal configuré), pas des fichiers perdus : on ne masque rien plutôt que de vider l'appli
const MAX_MISSING_SHARE = 0.5;
const FIRST_WAIT_MS = 4000;

// Partie absente selon Plex (fiche lue avec checkFiles=1)
export const partMissing = (part) => part?.exists === false || part?.exists === 0 || part?.exists === "0";

// Fiche lue avec checkFiles=1 : une version dont le fichier existe passe en tête de item.Media
// (après un réencodage, Plex garde l'ancienne version, au fichier disparu, à côté de la nouvelle).
// Renvoie l'index Plex de la version retenue, à transmettre au transcodeur de Plex (mediaIndex).
export function preferExistingMedia(item) {
  const list = item?.Media || [];
  const i = list.findIndex((m) => !partMissing(m.Part?.[0]));
  if (i <= 0) return 0;
  item.Media = [list[i], ...list.filter((_, j) => j !== i)];
  return i;
}

export function createAvailability({ plexFetch, localPath = (p) => p, enabled = false, ttlMs = 10 * 60 * 1000 }) {
  let hidden = new Set(); // ratingKey des films et épisodes sans aucun fichier sur le disque
  let hiddenMovies = 0;
  let scannedAt = 0;
  let running = null;

  const exists = (file) => fs.promises.access(localPath(file)).then(() => true, () => false);

  async function fetchAll(section, type) {
    const all = [];
    for (let start = 0; ; start += PAGE) {
      const data = await plexFetch(
        `/library/sections/${section}/all?type=${type}&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${PAGE}`
      );
      const items = data.MediaContainer?.Metadata || [];
      all.push(...items);
      const total = data.MediaContainer?.totalSize ?? all.length;
      if (!items.length || all.length >= total) return all;
    }
  }

  async function scan() {
    const [movies, episodes] = await Promise.all([fetchAll(SECTIONS.movies, 1), fetchAll(SECTIONS.shows, 4)]);
    const items = [...movies, ...episodes]
      .map((raw) => ({ raw, files: (raw.Media || []).flatMap((m) => m.Part || []).map((p) => p.file).filter(Boolean) }))
      .filter((x) => x.files.length);

    // Un élément est absent si aucune de ses versions n'est sur le disque
    const missing = new Set();
    let next = 0;
    let filesSeen = 0;
    let filesMissing = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const { raw, files } = items[next++];
        const found = await Promise.all(files.map(exists));
        filesSeen += files.length;
        filesMissing += found.filter((f) => !f).length;
        if (!found.some(Boolean)) missing.add(String(raw.ratingKey));
      }
    }));

    if (filesSeen && filesMissing / filesSeen > MAX_MISSING_SHARE) {
      console.error(`⚠ ${filesMissing} fichiers vidéo sur ${filesSeen} introuvables : disque non monté ? Rien n'est masqué.`);
      hidden = new Set();
      hiddenMovies = 0;
    } else {
      if (missing.size !== hidden.size) {
        console.log(`🗂 ${missing.size} film(s) ou épisode(s) sans fichier sur le disque, masqués dans l'appli`);
      }
      hidden = missing;
      hiddenMovies = movies.filter((m) => missing.has(String(m.ratingKey))).length;
    }
    scannedAt = Date.now();
  }

  function refresh() {
    running ??= scan()
      .catch((error) => {
        console.error("Fichiers absents :", error.message);
        scannedAt = Date.now() - ttlMs + 60 * 1000; // Plex injoignable : nouvel essai dans 1 min
      })
      .finally(() => (running = null));
    return running;
  }

  // Ensemble à jour : le premier appel attend le parcours, les suivants le relancent en arrière-plan
  async function current() {
    if (!enabled) return hidden;
    if (!scannedAt) {
      // Premier parcours (normalement lancé au démarrage) : une liste ne l'attend pas plus de 4 s
      await Promise.race([refresh(), new Promise((r) => setTimeout(r, FIRST_WAIT_MS).unref?.())]);
    } else if (Date.now() - scannedAt > ttlMs) refresh();
    return hidden;
  }

  return {
    enabled,
    refresh,
    // Retire d'une liste mise en forme (champ id = ratingKey) les éléments sans fichier
    async filter(items) {
      const set = await current();
      return set.size ? items.filter((i) => !i || !set.has(String(i.id))) : items;
    },
    async isHidden(id) {
      return (await current()).has(String(id));
    },
    // Nombre de films masqués (total de la liste des films ajusté, pour la pagination)
    async hiddenMovieCount() {
      await current();
      return hiddenMovies;
    },
  };
}
