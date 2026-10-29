// Recherche approximative : normalisation, distance d'édition, notation sur une petite
// bibliothèque, et route /api/search reliée à un faux Plex.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { normalize, editDistance, buildIndex, searchIndex } from "../search.js";
import { launch } from "./helpers.js";
import { startFakePlex, MUSIC } from "./fake-plex.js";

const movie = (id, title, extra = {}) => ({ ratingKey: String(id), type: "movie", title, ...extra });
const library = buildIndex([
  ...MUSIC[8],
  ...MUSIC[9],
  ...MUSIC[10],
  movie(1, "Spider-Man : Homecoming", { year: 2017 }),
  movie(2, "Le Seigneur des anneaux", { originalTitle: "The Lord of the Rings" }),
  movie(3, "Interstellar", { Director: [{ tag: "Christopher Nolan" }] }),
  movie(4, "Anatomie d'une chute"),
  movie(5, "Dune : Première partie"),
  movie(6, "The Batman"),
]);
const search = (q) => searchIndex(library, q);
const titles = (list) => list.map((x) => x.title);

describe("normalisation", () => {
  test("accents, ponctuation, élisions, caractères de substitution", () => {
    assert.equal(normalize("Beyoncé"), "beyonce");
    assert.equal(normalize("AC/DC"), "ac dc");
    assert.equal(normalize("A$AP Rocky"), "asap rocky");
    assert.equal(normalize("P!nk"), "pink");
    assert.equal(normalize("Anatomie d'une chute"), "anatomie une chute");
    assert.equal(normalize("Œuvre  —  L’Été"), "oeuvre ete");
  });

  test("distance d'édition bornée, transpositions comprises", () => {
    assert.equal(editDistance("poter", "potter", 2), 1);
    assert.equal(editDistance("dfat", "daft", 2), 1);
    assert.equal(editDistance("abc", "xyz", 1), 2, "abandon au-delà du maximum");
    assert.equal(editDistance("a", "abcdef", 2), 3);
  });
});

describe("notation", () => {
  test("fautes de frappe", () => {
    assert.equal(search("daft pank").top.title, "Daft Punk");
    assert.equal(search("beyonse").top.title, "Beyoncé");
    assert.equal(search("interstelar").top.title, "Interstellar");
    assert.equal(search("higway to hell").top.title, "Highway to Hell");
  });

  test("mots collés ou séparés", () => {
    assert.equal(search("acdc").top.title, "AC/DC");
    assert.equal(search("spiderman").top.title, "Spider-Man : Homecoming");
    assert.equal(search("dafpunk").top.title, "Daft Punk");
  });

  test("début de mot en cours de frappe", () => {
    assert.equal(search("daft p").top.title, "Daft Punk");
    assert.equal(search("interst").top.title, "Interstellar");
  });

  test("un artiste renvoie aussi ses albums et ses titres", () => {
    const r = search("daft punk");
    assert.equal(r.top.type, "artist");
    assert.deepEqual(titles(r.albums), ["Random Access Memories"]);
    assert.equal(r.tracks.length, 3);
    assert.equal(r.tracks[0].title, "Get Lucky (feat. Pharrell Williams)", "le plus écouté d'abord");
    assert.match(r.tracks[0].streamUrl, /^\/api\/stream\/audio\?key=/);
  });

  test("artiste invité : compte comme artiste, pas comme titre", () => {
    const r = search("get lucky");
    assert.equal(r.top.title, "Get Lucky (feat. Pharrell Williams)");
    assert.equal(r.top.score, 1);
    assert.ok(search("pharrell").tracks.length === 1);
  });

  test("titre original, réalisateur, année", () => {
    assert.equal(search("lord of the rings").top.title, "Le Seigneur des anneaux");
    assert.deepEqual(titles(search("nolan").movies), ["Interstellar"]);
    assert.deepEqual(titles(search("2017").movies), ["Spider-Man : Homecoming"]);
  });

  test("pas de faux positifs évidents", () => {
    assert.deepEqual(titles(search("dune").movies), ["Dune : Première partie"]);
    assert.ok(!titles(search("man").movies).includes("The Batman"));
    assert.equal(search("zzzz").top, null);
    assert.equal(search("   ").top, null);
  });
});

describe("route /api/search", () => {
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
  const get = async (q) => (await fetch(`${gw.base}/api/search?q=${encodeURIComponent(q)}`)).json();

  test("index de toute la bibliothèque, construit à la première recherche", async () => {
    const r = await get("daft pank");
    assert.equal(r.top.title, "Daft Punk");
    assert.deepEqual(titles(r.artists), ["Daft Punk"]);
    assert.equal(r.tracks.length, 3);
    assert.ok(plex.requests.includes("/library/sections/5/all"));
    assert.deepEqual(titles((await get("bravo")).movies), ["Bravo"]);
  });

  test("limitée aux artistes (barre de recherche de l'onglet Musique)", async () => {
    const r = await (await fetch(`${gw.base}/api/search?q=${encodeURIComponent("daft pank")}&types=artist`)).json();
    assert.deepEqual(titles(r.artists), ["Daft Punk"]);
    assert.equal(r.top.type, "artist");
    assert.deepEqual([r.albums, r.tracks, r.movies, r.shows].flat(), []);
    const none = await (await fetch(`${gw.base}/api/search?q=bravo&types=artist`)).json();
    assert.equal(none.top, null, "le film Bravo n'est pas un artiste");
  });

  test("films trouvés par Plex grâce à un acteur", async () => {
    const r = await get("brad pitt");
    assert.deepEqual(titles(r.movies), ["Charlie"]);
  });

  test("recherche vide", async () => {
    const r = await get(" ");
    assert.equal(r.top, null);
    assert.deepEqual(r.tracks, []);
  });

  test("Plex injoignable : 502 sans faire tomber le serveur", async () => {
    const down = await launch();
    try {
      const res = await fetch(`${down.base}/api/search?q=daft`);
      assert.equal(res.status, 502);
    } finally {
      down.stop();
    }
  });
});
