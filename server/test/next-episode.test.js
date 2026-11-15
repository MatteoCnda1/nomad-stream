// Épisode suivant proposé à la fin d'un épisode, et début du générique de fin
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { creditsStart, episodesAfter } from "../plex.js";
import { launch } from "./helpers.js";
import { startFakePlex } from "./fake-plex.js";

describe("épisode suivant (unitaire)", () => {
  const leaves = [
    { ratingKey: "10", parentIndex: 0, index: 1 }, // épisode spécial
    { ratingKey: "11", parentIndex: 1, index: 1 },
    { ratingKey: "12", parentIndex: 1, index: 2 },
    { ratingKey: "13", parentIndex: 0, index: 2 }, // autre spécial, rangé plus loin
    { ratingKey: "21", parentIndex: 2, index: 1 },
  ];
  const fakeFetch = async (p) => {
    if (p.endsWith("/allLeaves")) return { MediaContainer: { Metadata: leaves } };
    const id = p.split("/").pop();
    const leaf = leaves.find((l) => l.ratingKey === id);
    return { MediaContainer: { Metadata: [leaf ? { ...leaf, type: "episode", grandparentRatingKey: "1" } : { type: "movie" }] } };
  };
  const ids = async (id) => (await episodesAfter(fakeFetch, id)).map((e) => e.ratingKey);

  test("suite de la série, saison suivante comprise, sans les épisodes spéciaux", async () => {
    assert.deepEqual(await ids("11"), ["12", "21"]);
    assert.deepEqual(await ids("12"), ["21"]);
  });

  test("dernier épisode, film : rien", async () => {
    assert.deepEqual(await ids("21"), []);
    assert.deepEqual(await ids("99"), []);
  });

  test("depuis un épisode spécial, les spéciaux suivent", async () => {
    assert.deepEqual(await ids("10"), ["11", "12", "13", "21"]);
  });

  test("début du générique : marqueur final, sinon le dernier, sinon null", () => {
    assert.equal(creditsStart({ Marker: [{ type: "credits", startTimeOffset: 5, final: true }, { type: "credits", startTimeOffset: 9 }] }), 5);
    assert.equal(creditsStart({ Marker: [{ type: "intro", startTimeOffset: 0 }, { type: "credits", startTimeOffset: 7 }] }), 7);
    assert.equal(creditsStart({ Marker: [{ type: "intro", startTimeOffset: 0 }] }), null);
    assert.equal(creditsStart({}), null);
  });
});

describe("épisode suivant via HTTP", () => {
  let plex;
  let gw;

  before(async () => {
    plex = await startFakePlex();
    gw = await launch({ PLEX_URL: plex.url });
  });

  after(() => {
    gw?.stop();
    plex?.close();
  });

  const next = async (id) => {
    const res = await fetch(`${gw.base}/api/metadata/${id}/next`);
    return { status: res.status, body: await res.json() };
  };

  test("épisode 1 → épisode 2, mis en forme comme une fiche", async () => {
    const { status, body } = await next(301);
    assert.equal(status, 200);
    assert.equal(body.next.id, "302");
    assert.equal(body.next.type, "episode");
    assert.equal(body.next.episodeNumber, 2);
    assert.equal(body.next.grandparentTitle, "Série");
  });

  test("dernier épisode et film : pas d'épisode suivant", async () => {
    assert.deepEqual((await next(303)).body, { next: null });
    assert.deepEqual((await next(1)).body, { next: null });
  });

  test("identifiant invalide refusé", async () => {
    assert.equal((await fetch(`${gw.base}/api/metadata/abc/next`)).status, 400);
  });

  test("la fiche d'un épisode donne le début du générique quand Plex le connaît", async () => {
    const withCredits = await (await fetch(`${gw.base}/api/metadata/302`)).json();
    assert.equal(withCredits.creditsStart, 1_150_000);
    const without = await (await fetch(`${gw.base}/api/metadata/301`)).json();
    assert.equal(without.creditsStart, null);
  });
});
