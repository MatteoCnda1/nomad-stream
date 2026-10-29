// Lecture continue (#24) : choix des titres qui prolongent une file terminée.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "../search.js";
import { pickRadio } from "../radio.js";
import { launch } from "./helpers.js";
import { startFakePlex, MUSIC } from "./fake-plex.js";

const index = buildIndex([...MUSIC[8], ...MUSIC[9], ...MUSIC[10]]);
// Tirages reproductibles
const seeded = (n = 1) => () => ((n = (n * 16807) % 2147483647) - 1) / 2147483646;
const artists = (items) => items.map((t) => t.grandparentTitle);

describe("choix des titres", () => {
  test("ni le titre de départ, ni ses doublons, ni les titres exclus", () => {
    for (let s = 1; s < 30; s++) {
      const items = pickRadio(index, { seed: "120", exclude: ["121"], limit: 20, random: seeded(s) });
      const ids = items.map((t) => t.id);
      assert.ok(!ids.includes("120") && !ids.includes("121"));
      assert.ok(!ids.includes("127"), "« Get Lucky (Radio Edit) » est le même morceau que le titre de départ");
      assert.equal(new Set(ids).size, ids.length, "pas de doublon");
      for (const t of items) assert.match(t.streamUrl, /^\/api\/stream\/audio\?key=/);
    }
  });

  test("artistes similaires et même genre d'abord, jamais deux fois le même artiste d'affilée si possible", () => {
    const items = pickRadio(index, { seed: "121", similar: ["Justice"], limit: 4, random: seeded(7) });
    assert.equal(items.length, 4);
    assert.equal(items[0].grandparentTitle, "Justice", "similaire en premier");
    assert.equal(items[1].grandparentTitle, "Kavinsky", "puis même genre (Electronic)");
    const seq = artists(items);
    for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1], seq.join(" → "));
  });

  test("bibliothèque épuisée : s'arrête sans boucler", () => {
    const all = MUSIC[10].map((t) => t.ratingKey);
    assert.deepEqual(pickRadio(index, { seed: "120", exclude: all, limit: 10 }), []);
  });
});

describe("route /api/music/radio", () => {
  let plex;
  let gw;
  before(async () => {
    plex = await startFakePlex();
    gw = await launch({ PLEX_URL: plex.url, PLEX_TIMEOUT_MS: "2000" });
  });
  after(() => {
    gw?.stop();
    plex?.close();
  });

  test("titres proches, artistes similaires selon Plex", async () => {
    const res = await fetch(`${gw.base}/api/music/radio?seed=121&exclude=120,abc&limit=3`);
    assert.equal(res.status, 200);
    const { items } = await res.json();
    assert.equal(items.length, 3);
    assert.ok(!items.some((t) => t.id === "121" || t.id === "120"));
    assert.ok(plex.requests.includes("/library/metadata/100"), "étiquettes Similar de Daft Punk demandées");
    assert.ok(artists(items).includes("Justice"));
  });

  test("paramètres invalides", async () => {
    assert.equal((await fetch(`${gw.base}/api/music/radio?seed=../x`)).status, 400);
    assert.equal((await fetch(`${gw.base}/api/music/radio`)).status, 400);
  });
});
