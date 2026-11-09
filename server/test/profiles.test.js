// Profils, playlists et « Ma liste » gardés par la passerelle (#40), réparés quand un titre est
// réimporté dans Plex (#67).
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildIndex } from "../search.js";
import { cleanItem, cleanPlaylist, createUserData, repairData, repairItem } from "../userdata.js";
import { launch } from "./helpers.js";
import { startFakePlex, MUSIC } from "./fake-plex.js";

const index = buildIndex([...MUSIC[8], ...MUSIC[9], ...MUSIC[10]]);

// Titre tel qu'une playlist l'enregistre
const track = (id, title, artist, album, partId = 1000 + Number(id)) => ({
  id: String(id),
  key: `/library/metadata/${id}`,
  type: "track",
  title,
  grandparentTitle: artist,
  parentTitle: album,
  duration: 240000,
  partKey: `/library/parts/${partId}/file.mp3`,
  partId: String(partId),
  thumb: null,
});
const playlist = (id, tracks, extra = {}) => ({ id, title: "Route", createdAt: 1, updatedAt: 1, tracks, ...extra });

describe("nettoyage", () => {
  test("champs inconnus retirés, types vérifiés", () => {
    const item = cleanItem({ ...track(120, "Get Lucky", "Daft Punk", "RAM"), evil: "<script>", streamUrl: "x", duration: "12" });
    assert.equal(item.evil, undefined);
    assert.equal(item.streamUrl, undefined);
    assert.equal(item.duration, 0);
    assert.equal(cleanItem({ id: "../x", type: "track" }), null);
    assert.equal(cleanItem({ id: "1", type: "virus" }), null);
  });

  test("playlist : identifiant contrôlé, seuls les titres de musique gardés", () => {
    assert.equal(cleanPlaylist({ id: "pl_../x" }), null);
    const pl = cleanPlaylist(playlist("pl_1_a", [track(120, "A", "B", "C"), { id: "5", type: "movie", title: "Film" }]));
    assert.equal(pl.tracks.length, 1);
  });
});

describe("réparation des identifiants (#67)", () => {
  test("titre réimporté : retrouvé par artiste, album et titre", () => {
    const old = track(9120, "Get Lucky (feat. Pharrell Williams)", "Daft Punk", "Random Access Memories", 77);
    const fixed = repairItem(old, index);
    assert.equal(fixed.id, "120");
    assert.equal(fixed.partId, "1120");
    assert.equal(fixed.partKey, "/library/parts/1120/file.mp3");
    assert.equal(fixed.title, old.title, "ce que l'utilisateur voyait est gardé");
  });

  test("album renommé : retrouvé par artiste et titre", () => {
    const fixed = repairItem(track(9126, "Nightcall", "Kavinsky", "OutRun (Deluxe)"), index);
    assert.equal(fixed.id, "126");
  });

  test("titre toujours là : inchangé (même objet)", () => {
    const same = repairItem(index.entries.find((e) => e.item.id === "121").item, index);
    assert.equal(same, index.entries.find((e) => e.item.id === "121").item);
  });

  test("titre disparu : signalé indisponible, pas supprimé, et rétabli s'il revient", () => {
    const gone = repairItem(track(9999, "Inconnu", "Personne", "Rien"), index);
    assert.equal(gone.unavailable, true);
    const back = repairItem({ ...track(121, "Instant Crush", "Daft Punk", "Random Access Memories"), unavailable: true }, index);
    assert.equal(back.unavailable, undefined);
  });

  test("« Ma liste » : deux entrées devenues le même élément n'en font plus qu'une", () => {
    const doc = {
      playlists: [playlist("pl_1", [track(9124, "D.A.N.C.E.", "Justice", "†"), track(122, "Highway to Hell", "AC/DC", "Highway to Hell")])],
      wishlist: [
        { item: track(124, "D.A.N.C.E.", "Justice", "†"), savedAt: 2 },
        { item: track(9124, "D.A.N.C.E.", "Justice", "†"), savedAt: 1 },
      ],
    };
    const { doc: fixed, repaired } = repairData(doc, index);
    assert.equal(fixed.playlists[0].tracks[0].id, "124");
    assert.equal(fixed.playlists[0].tracks[1].id, "122", "titre valide gardé");
    assert.equal(fixed.playlists[0].tracks[1].parentThumb, "/api/image?path=%2Flibrary%2Fmetadata%2F111%2Fthumb%2F1700000000&width=300&height=300", "pochette mise à jour");
    assert.equal(fixed.wishlist.length, 1);
    assert.equal(repaired, 3, "deux titres reliés (playlist, Ma liste), un doublon retiré");
  });

  test("épisodes : laissés tels quels (absents de l'index)", () => {
    const ep = { id: "777", type: "episode", title: "Pilote" };
    assert.equal(repairItem(ep, index), ep);
  });
});

describe("stockage", () => {
  test("fichier illisible : erreur, jamais écrasé", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nomad-data-"));
    const store = createUserData({ dir });
    const p = await store.createProfile({ name: "Matteo" });
    mkdirSync(path.join(dir, "profiles"), { recursive: true });
    writeFileSync(path.join(dir, "profiles", `${p.id}.json`), "{ abîmé");
    await assert.rejects(store.upsertPlaylist(p.id, cleanPlaylist(playlist("pl_1", []))), /illisible/);
    assert.equal(readFileSync(path.join(dir, "profiles", `${p.id}.json`), "utf8"), "{ abîmé");
  });
});

describe("routes /api/profiles", () => {
  let plex;
  let gw;
  let dataDir;
  before(async () => {
    plex = await startFakePlex();
    dataDir = mkdtempSync(path.join(tmpdir(), "nomad-data-"));
    gw = await launch({ PLEX_URL: plex.url, PLEX_TIMEOUT_MS: "2000", NOMAD_DATA_DIR: dataDir });
  });
  after(() => {
    gw?.stop();
    plex?.close();
  });
  const api = (p, method = "GET", body) =>
    fetch(`${gw.base}${p}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });

  test("création, modification, suppression d'un profil", async () => {
    assert.equal((await api("/api/profiles", "POST", { name: "  " })).status, 400);
    assert.equal((await api("/api/profiles", "POST", { name: "Léa", color: "red" })).status, 400);
    const res = await api("/api/profiles", "POST", { name: "Léa" });
    assert.equal(res.status, 201);
    const lea = await res.json();
    assert.match(lea.id, /^p_[a-f0-9]{12}$/);
    assert.equal((await (await api(`/api/profiles/${lea.id}`, "PATCH", { name: "Léa B." })).json()).name, "Léa B.");
    await api(`/api/profiles/${lea.id}/playlists/pl_1`, "PUT", playlist("pl_1", []));
    assert.equal((await api(`/api/profiles/${lea.id}`, "DELETE")).status, 204);
    assert.equal((await api(`/api/profiles/${lea.id}/data`)).status, 404);
    assert.ok(readdirSync(path.join(dataDir, "deleted")).some((f) => f.startsWith(lea.id)), "données mises de côté");
  });

  test("profil inconnu ou identifiant invalide : 404", async () => {
    assert.equal((await api("/api/profiles/p_000000000000/data")).status, 404);
    assert.equal((await api("/api/profiles/..%2F..%2Fetc/data")).status, 404);
  });

  test("playlists et « Ma liste » : écrites, relues, réparées et réenregistrées", async () => {
    const me = await (await api("/api/profiles", "POST", { name: "Matteo" })).json();
    const base = `/api/profiles/${me.id}`;
    // Playlist envoyée par un appareil, avec un titre réimporté depuis
    const pl = playlist("pl_1700_ab", [track(9121, "Instant Crush", "Daft Punk", "Random Access Memories"), track(122, "Highway to Hell", "AC/DC", "Highway to Hell")]);
    assert.equal((await api(`${base}/playlists/pl_1700_ab`, "PUT", pl)).status, 200);
    assert.equal((await api(`${base}/playlists/pl_bad%2F`, "PUT", pl)).status, 400);
    assert.equal((await api(`${base}/wishlist/124`, "PUT", { item: track(124, "D.A.N.C.E.", "Justice", "†"), savedAt: 5 })).status, 200);
    assert.equal((await api(`${base}/wishlist/999`, "PUT", { item: track(124, "x", "y", "z") })).status, 400, "identifiant incohérent");

    const data = await (await api(`${base}/data`)).json();
    assert.equal(data.repaired, 1);
    assert.equal(data.playlists[0].tracks[0].id, "121");
    assert.equal(data.wishlist[0].item.id, "124");
    // Réparation enregistrée : la lecture suivante n'a plus rien à corriger
    assert.equal((await (await api(`${base}/data`)).json()).repaired, 0);
    const onDisk = JSON.parse(readFileSync(path.join(dataDir, "profiles", `${me.id}.json`), "utf8"));
    assert.equal(onDisk.playlists[0].tracks[0].partId, "1121");

    await api(`${base}/wishlist/124`, "DELETE");
    await api(`${base}/playlists/pl_1700_ab`, "DELETE");
    const empty = await (await api(`${base}/data`)).json();
    assert.deepEqual([empty.playlists.length, empty.wishlist.length], [0, 0]);
  });

  test("import des données d'un appareil : réunies, la version la plus récente l'emporte", async () => {
    const me = await (await api("/api/profiles", "POST", { name: "Import" })).json();
    const base = `/api/profiles/${me.id}`;
    await api(`${base}/playlists/pl_a`, "PUT", playlist("pl_a", [], { title: "Serveur", updatedAt: 10 }));
    const res = await api(`${base}/import`, "POST", {
      playlists: [playlist("pl_a", [], { title: "Vieux", updatedAt: 5 }), playlist("pl_b", [], { title: "Nouveau" }), { id: "nope" }],
      wishlist: [{ item: track(126, "Nightcall", "Kavinsky", "OutRun"), savedAt: 3 }],
    });
    assert.equal((await res.json()).added, 2);
    const data = await (await api(`${base}/data`)).json();
    assert.deepEqual(data.playlists.map((p) => p.title).sort(), ["Nouveau", "Serveur"]);
    assert.equal(data.wishlist.length, 1);
  });
});
