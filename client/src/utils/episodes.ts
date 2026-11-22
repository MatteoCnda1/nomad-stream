// Fiche d'une série : épisode proposé par le bouton principal et rangement des saisons (#98)
import type { MediaItem, Season } from "../types";

export type UpNextAction = "resume" | "play" | "replay";

export interface UpNext {
  episode: MediaItem;
  action: UpNextAction; // Reprendre, Regarder, Revoir
}

const isSpecial = (ep: { seasonNumber?: number }) => ep.seasonNumber === 0;
const started = (ep: MediaItem) => ep.progressPercent > 0;

// Épisode à lancer, les épisodes étant dans l'ordre de Plex (saisons puis épisodes) :
// - l'épisode regardé le plus récemment, s'il est entamé : on le reprend ;
// - sinon le premier non vu après lui, ou à défaut le premier non vu de la série ;
// - série entièrement vue : on la revoit, en partant de l'épisode qui suit le dernier revu.
// Les épisodes spéciaux (saison 0) ne sont proposés que si on vient d'en entamer un.
export function pickUpNext(episodes: MediaItem[]): UpNext | null {
  if (episodes.length === 0) return null;
  const regular = episodes.filter((ep) => !isSpecial(ep));
  const pool = regular.length > 0 ? regular : episodes;

  // Dernier regardé (fini ou entamé) ; à date égale ou inconnue, le plus loin dans la série
  let latest: MediaItem | null = null;
  for (const ep of episodes) {
    if (!ep.watched && !started(ep)) continue;
    if (!latest || (ep.lastViewedAt ?? 0) >= (latest.lastViewedAt ?? 0)) latest = ep;
  }
  if (!latest) return { episode: pool[0], action: "play" };
  if (started(latest)) return { episode: latest, action: "resume" };

  const after = pool.slice(pool.indexOf(latest) + 1);
  const next = after.find((ep) => !ep.watched) ?? pool.find((ep) => !ep.watched);
  if (next) return { episode: next, action: started(next) ? "resume" : "play" };
  return { episode: after[0] ?? pool[0], action: "replay" };
}

// Saisons dans l'ordre, les épisodes spéciaux en dernier
export function sortSeasons(seasons: Season[]): Season[] {
  return [...seasons].sort((a, b) => Number(isSpecial(a)) - Number(isSpecial(b)) || a.seasonNumber - b.seasonNumber);
}

export const seasonLabel = (season: Season) => (isSpecial(season) ? "Épisodes spéciaux" : season.title);
