// Genres de la musique et mixes tout faits par genre (#50).
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildIndex } from "../search.js";
import { createMusicGenres, genreOfFile, genreId, parseFolders, rootRules } from "../genres.js";
import { launch } from "./helpers.js";
import { startFakePlex, MUSIC, MUSIC_ROOT } from "./fake-plex.js";

// Tirages reproductibles
const seeded = (n = 1) => () => ((n = (n * 16807) % 2147483647) - 1) / 2147483646;

describe("genre d'un fichier", () => {
  const folders = parseFolders("Black Sabbath=Metal,Queen=Rock,Divers=");
  // Comme chez nous : une racine Plex par dossier de genre, côte à côte
  const sideBySide = rootRules(["/media/Music/Rap FR", "/media/Music/Rap", "/media/Music/Black Sabbath", "/media/Music/QUEEN", "/media/Music/Divers/"]);
  // Ou une seule racine qui contient les dossiers de genre
  const single = rootRules(["/media/Music"]);

  test("racines côte à côte : le genre est la racine", () => {
    assert.equal(genreOfFile("/media/Music/Rap FR/Nekfeu/Feu/01.flac", sideBySide, folders), "Rap FR");
    assert.equal(genreOfFile("/media/Music/Rap/Nas/Illmatic/01.flac", sideBySide, folders), "Rap", "« Rap » n'avale pas « Rap FR »");
    assert.equal(genreOfFile("/media/Music/Rap FR/titre-seul.mp3", sideBySide, folders), "Rap FR");
  });

  test("racine unique : le genre est le dossier de premier niveau", () => {
    assert.equal(genreOfFile("/media/Music/Rap FR/Nekfeu/Feu/01.flac", single, folders), "Rap FR");
    assert.equal(genreOfFile("/media/Music/titre.mp3", single, folders), null, "fichier posé à la racine");
  });

  test("dossiers d'artiste renommés, fourre-tout écarté, la casse n'y change rien", () => {
    for (const rules of [sideBySide, single]) {
      assert.equal(genreOfFile("/media/Music/Black Sabbath/Paranoid/01.mp3", rules, folders), "Metal");
      assert.equal(genreOfFile("/media/Music/QUEEN/A Night at the Opera/11.mp3", rules, folders), "Rock");
      assert.equal(genreOfFile("/media/Music/Divers/x/titre.mp3", rules, folders), null);
    }
  });

  test("hors bibliothèque ou sans chemin : pas de genre", () => {
    assert.equal(genreOfFile("/media/MusicBis/Rock/x/y.mp3", single, folders), null, "dossier voisin de la racine");
    assert.equal(genreOfFile("/autre/Rock/x.mp3", sideBySide, folders), null);
    assert.equal(genreOfFile(undefined, single, folders), null);
  });

  test("identifiants d'adresse", () => {
    assert.equal(genreId("Rap FR"), "rap-fr");
    assert.equal(genreId("R&B"), "r-b");
    assert.equal(genreId("Électro"), "electro");
  });

  test("NOMAD_MUSIC_GENRE_FOLDERS vide : aucun dossier renommé", () => {
    assert.equal(parseFolders("").size, 0);
    assert.equal(genreOfFile("/media/Music/Divers/x/y.mp3", single, parseFolders("")), "Divers");
  });
});

describe("liste des genres et mixes", () => {
  const index = buildIndex([...MUSIC[8], ...MUSIC[9], ...MUSIC[10]], { musicRoots: [MUSIC_ROOT] });
  const genres = createMusicGenres({ folders: parseFolders("") });

  test("genres du plus fourni au moins fourni, avec artistes et pochettes", () => {
    const list = genres.list(index);
    assert.deepEqual(list.map((g) => [g.id, g.name, g.trackCount, g.artistCount]), [
      ["electro", "Electro", 6, 3],
      ["r-b", "R&B", 1, 1],
      ["rock", "Rock", 1, 1],
    ]);
    const electro = list[0];
    assert.ok(electro.covers.length >= 1 && electro.covers.length <= 4);
    assert.equal(new Set(electro.covers).size, electro.covers.length, "une pochette par album");
    assert.match(electro.covers[0], /^\/api\/image\?path=%2Flibrary%2Fmetadata%2F110%2F/, "l'album le plus écouté d'abord");
  });

  test("sans dossiers racine (Plex ne les a pas donnés) : aucun genre, pas d'erreur", () => {
    assert.deepEqual(genres.list(buildIndex(MUSIC[10])), []);
  });

  test("mix : titres du genre, sans doublon de morceau, jamais deux fois le même artiste d'affilée si possible", () => {
    for (let s = 1; s < 40; s++) {
      const items = genres.mix(index, "electro", { limit: 50, random: seeded(s) });
      assert.ok(items.every((t) => ["Daft Punk", "Justice", "Kavinsky"].includes(t.grandparentTitle)));
      assert.ok(items.every((t) => /^\/api\/stream\/audio\?key=/.test(t.streamUrl)));
      const ids = items.map((t) => t.id);
      assert.equal(new Set(ids).size, ids.length, "pas de doublon");
      assert.ok(!(ids.includes("120") && ids.includes("127")), "« Get Lucky » une seule fois (album ou single)");
      assert.equal(items.length, 5, "6 titres dont un doublon de morceau");
      const seq = items.map((t) => t.grandparentTitle);
      // Daft Punk a 2 morceaux sur 5 : on peut toujours les séparer
      for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1], seq.join(" → "));
    }
  });

  test("mix : limite respectée, deux tirages différents", () => {
    const a = genres.mix(index, "electro", { limit: 3, random: seeded(3) });
    assert.equal(a.length, 3);
    const tirages = new Set(Array.from({ length: 10 }, (_, s) => genres.mix(index, "electro", { limit: 3, random: seeded(s + 1) }).map((t) => t.id).join()));
    assert.ok(tirages.size > 1, "le hasard change le mix");
  });

  test("genre d'un seul artiste : le mix se remplit quand même", () => {
    const solo = buildIndex(
      MUSIC[10].filter((t) => t.grandparentTitle === "Justice"),
      { musicRoots: [MUSIC_ROOT] },
    );
    const items = genres.mix(solo, "electro", { limit: 10, random: seeded(5) });
    assert.deepEqual(items.map((t) => t.title).sort(), ["D.A.N.C.E.", "Genesis"]);
  });

  test("genre inconnu", () => {
    assert.equal(genres.mix(index, "jazz"), null);
    assert.equal(genres.info(index, "jazz"), null);
  });
});

describe("routes /api/music/genres", () => {
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

  test("liste des genres, d'après les dossiers que Plex indique pour la musique", async () => {
    const res = await fetch(`${gw.base}/api/music/genres`);
    assert.equal(res.status, 200);
    const { items } = await res.json();
    assert.deepEqual(items.map((g) => g.name), ["Electro", "R&B", "Rock"]);
    assert.ok(plex.requests.includes("/library/sections"));
  });

  test("mix d'un genre, sans le chemin des fichiers", async () => {
    const res = await fetch(`${gw.base}/api/music/genres/electro/mix?limit=4`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.genre.name, "Electro");
    assert.equal(body.items.length, 4);
    assert.ok(!JSON.stringify(body).includes(MUSIC_ROOT), "les chemins du serveur ne sortent pas");
  });

  test("genre inconnu ou invalide", async () => {
    assert.equal((await fetch(`${gw.base}/api/music/genres/jazz/mix`)).status, 404);
    assert.equal((await fetch(`${gw.base}/api/music/genres/..%2Fx/mix`)).status, 400);
    assert.equal((await fetch(`${gw.base}/api/music/genres/${"a".repeat(61)}/mix`)).status, 400);
  });
});
