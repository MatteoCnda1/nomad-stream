// Épisode proposé sur la fiche d'une série (#98). Lancé par « npm test » (Node lit le TypeScript).
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickUpNext, seasonLabel, sortSeasons } from "./episodes.ts";
import type { MediaItem, Season } from "../types";

type Seen = { watched?: boolean; progress?: number; at?: number };
const ep = (season: number, index: number, seen: Seen = {}) =>
  ({
    id: `${season}-${index}`,
    type: "episode",
    seasonNumber: season,
    episodeNumber: index,
    progressPercent: seen.progress ?? 0,
    watched: seen.watched ?? false,
    lastViewedAt: seen.at ?? null,
  }) as MediaItem;
const pick = (episodes: MediaItem[]) => {
  const next = pickUpNext(episodes);
  return next && `${next.action} ${next.episode.id}`;
};

test("rien de vu : le premier épisode, pas un épisode spécial", () => {
  assert.equal(pick([ep(0, 1), ep(1, 1), ep(1, 2)]), "play 1-1");
  assert.equal(pick([]), null);
});

test("épisodes vus en entier : le suivant, pas le premier", () => {
  const episodes = [ep(1, 1, { watched: true, at: 1 }), ep(1, 2, { watched: true, at: 2 }), ep(1, 3), ep(2, 1)];
  assert.equal(pick(episodes), "play 1-3");
});

test("dernier épisode d'une saison vu : la saison suivante", () => {
  assert.equal(pick([ep(1, 1, { watched: true, at: 1 }), ep(1, 2, { watched: true, at: 2 }), ep(2, 1)]), "play 2-1");
});

test("épisode entamé le plus récemment : on le reprend", () => {
  const episodes = [ep(1, 1, { watched: true, at: 1 }), ep(1, 2, { progress: 40, at: 5 }), ep(1, 3)];
  assert.equal(pick(episodes), "resume 1-2");
});

test("épisode entamé il y a longtemps : pas devant celui vu hier", () => {
  const episodes = [ep(1, 1, { progress: 30, at: 1 }), ep(1, 2, { watched: true, at: 5 }), ep(1, 3), ep(1, 4)];
  assert.equal(pick(episodes), "play 1-3");
});

test("suivant déjà entamé : on le reprend", () => {
  const episodes = [ep(1, 1, { watched: true, at: 5 }), ep(1, 2, { progress: 20, at: 1 })];
  assert.equal(pick(episodes), "resume 1-2");
});

test("épisodes vus dans le désordre : le premier non vu après le dernier regardé", () => {
  const episodes = [ep(1, 1, { watched: true, at: 1 }), ep(1, 2, { watched: true, at: 9 }), ep(1, 3, { watched: true, at: 2 }), ep(1, 4)];
  assert.equal(pick(episodes), "play 1-4");
});

test("fin de série vue, début jamais vu : on revient au premier non vu", () => {
  const episodes = [ep(1, 1), ep(1, 2), ep(1, 3, { watched: true, at: 3 })];
  assert.equal(pick(episodes), "play 1-1");
});

test("épisode spécial vu en dernier : la série reprend où elle en était", () => {
  const episodes = [ep(0, 1, { watched: true, at: 9 }), ep(1, 1, { watched: true, at: 1 }), ep(1, 2)];
  assert.equal(pick(episodes), "play 1-2");
});

test("épisode spécial entamé : on le reprend", () => {
  assert.equal(pick([ep(0, 1, { progress: 50, at: 9 }), ep(1, 1, { watched: true, at: 1 }), ep(1, 2)]), "resume 0-1");
});

test("série entièrement vue : on la revoit depuis le début, puis épisode après épisode", () => {
  const all = [ep(1, 1, { watched: true, at: 1 }), ep(1, 2, { watched: true, at: 2 }), ep(1, 3, { watched: true, at: 3 })];
  assert.equal(pick(all), "replay 1-1");
  all[0] = ep(1, 1, { watched: true, at: 10 }); // S01E01 revu
  assert.equal(pick(all), "replay 1-2");
});

test("dates inconnues : le plus loin dans la série", () => {
  assert.equal(pick([ep(1, 1, { watched: true }), ep(1, 2, { watched: true }), ep(1, 3)]), "play 1-3");
});

test("saisons : les épisodes spéciaux en dernier", () => {
  const season = (n: number, title: string) => ({ id: String(n), key: "", title, seasonNumber: n, episodeCount: 1, thumb: null }) as Season;
  const sorted = sortSeasons([season(0, "Specials"), season(1, "Saison 1"), season(2, "Saison 2")]);
  assert.deepEqual(sorted.map(seasonLabel), ["Saison 1", "Saison 2", "Épisodes spéciaux"]);
});
