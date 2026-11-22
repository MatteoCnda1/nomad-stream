// Progression propre à chaque profil (#39) : le profil lié à Plex garde celle de Plex, les autres
// ont la leur, gardée par la passerelle.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deckIds, overlayProgress } from "../progress.js";
import { isPlexLinked } from "../userdata.js";
import { launch } from "./helpers.js";
import { startFakePlex } from "./fake-plex.js";

describe("règles", () => {
  test("profil lié à Plex : le premier par défaut, un seul à la fois", () => {
    const a = { id: "p_a" };
    const b = { id: "p_b" };
    assert.equal(isPlexLinked(a, [a, b]), true);
    assert.equal(isPlexLinked(b, [a, b]), false);
    const list = [a, { ...b, plex: true }];
    assert.equal(isPlexLinked(list[0], list), false);
    assert.equal(isPlexLinked(list[1], list), true);
    const none = [{ ...a, plex: false }, b];
    assert.equal(isPlexLinked(none[0], none), false, "aucun profil lié");
  });

  test("position du profil à la place de celle de Plex, partout dans la réponse", () => {
    const body = {
      onDeck: [{ id: "1", type: "movie", duration: 1000, viewOffset: 900, progressPercent: 90 }],
      nested: { episodes: [{ id: "2", type: "episode", duration: 1000, viewOffset: 0, progressPercent: 0 }] },
      track: { id: "3", type: "track", duration: 1000, viewOffset: 500, progressPercent: 50 },
    };
    const out = overlayProgress(body, { 2: { offset: 250, updatedAt: 1 }, 1: { offset: 0, watched: true, updatedAt: 1 } });
    assert.equal(out.onDeck[0].viewOffset, 0, "inconnu ou vu : depuis le début");
    assert.equal(out.nested.episodes[0].viewOffset, 250);
    assert.equal(out.nested.episodes[0].progressPercent, 25);
    assert.equal(out.track.viewOffset, 500, "musique : inchangée");
    assert.equal(body.onDeck[0].viewOffset, 900, "réponse d'origine (en cache) intacte");
  });

  test("vu et dernière lecture du profil à la place de ceux de Plex (#98)", () => {
    const ep = (id) => ({ id, type: "episode", duration: 1000, viewOffset: 0, progressPercent: 0, watched: true, lastViewedAt: 5 });
    const [vu, entame, enFile, inconnu] = overlayProgress([ep("1"), ep("2"), ep("3"), ep("4")], {
      1: { offset: 0, watched: true, updatedAt: 100 },
      2: { offset: 400, updatedAt: 200 },
      3: { offset: 0, upNext: true, updatedAt: 300 },
    });
    assert.deepEqual([vu.watched, vu.lastViewedAt], [true, 100]);
    assert.deepEqual([entame.watched, entame.lastViewedAt, entame.progressPercent], [false, 200, 40]);
    assert.deepEqual([enFile.watched, enFile.lastViewedAt], [false, null], "épisode suivant mis en file : pas encore regardé");
    assert.deepEqual([inconnu.watched, inconnu.lastViewedAt], [false, null], "vu par le compte Plex, pas par le profil");
  });

  test("« Continuer la lecture » : en cours et épisodes suivants, du plus récent au plus ancien", () => {
    const ids = deckIds({
      a: { offset: 10, updatedAt: 1 },
      b: { offset: 0, watched: true, updatedAt: 5 },
      c: { offset: 0, upNext: true, updatedAt: 3 },
      d: { offset: 0, updatedAt: 9 },
    });
    assert.deepEqual(ids, ["c", "a"]);
  });
});

describe("routes, avec deux profils", () => {
  let plex;
  let gw;
  let owner;
  let guest;
  before(async () => {
    plex = await startFakePlex();
    gw = await launch({ PLEX_URL: plex.url, PLEX_TIMEOUT_MS: "2000", NOMAD_DATA_DIR: mkdtempSync(path.join(tmpdir(), "nomad-data-")) });
    const create = (name) =>
      fetch(`${gw.base}/api/profiles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then((r) => r.json());
    owner = await create("Matteo");
    guest = await create("Invité");
  });
  after(() => {
    gw?.stop();
    plex?.close();
  });
  const as = (profile, p, init = {}) =>
    fetch(`${gw.base}${p}`, {
      ...init,
      headers: { ...(init.body && { "Content-Type": "application/json" }), Cookie: `nomad_profile=${profile.id}` },
    });
  const timeline = (profile, body) => as(profile, "/api/timeline", { method: "POST", body: JSON.stringify(body) });

  test("liste des profils : le premier est lié à Plex", async () => {
    const { profiles } = await (await fetch(`${gw.base}/api/profiles`)).json();
    assert.deepEqual(profiles.map((p) => p.plexLinked), [true, false]);
  });

  test("profil lié à Plex : « Continuer la lecture » et rapports de Plex, comme avant", async () => {
    const hubs = await (await as(owner, "/api/hubs")).json();
    assert.deepEqual(hubs.onDeck.map((i) => [i.id, i.viewOffset]), [["1", 600000]]);
    const before = plex.requests.filter((r) => r === "/:/timeline").length;
    await timeline(owner, { ratingKey: "2", state: "playing", time: 1000, duration: 6000000 });
    assert.equal(plex.requests.filter((r) => r === "/:/timeline").length, before + 1);
  });

  test("autre profil : sa propre position, jamais envoyée à Plex", async () => {
    const hubs = await (await as(guest, "/api/hubs")).json();
    assert.deepEqual(hubs.onDeck, [], "rien en cours pour l'invité (pas le film 1 du compte Plex)");
    assert.equal((await (await as(guest, "/api/metadata/1")).json()).viewOffset, 0);

    const before = plex.requests.filter((r) => r === "/:/timeline").length;
    const res = await timeline(guest, { ratingKey: "2", state: "stopped", time: 1_500_000, duration: 6_000_000 });
    assert.equal((await res.json()).profile, true);
    assert.equal(plex.requests.filter((r) => r === "/:/timeline").length, before, "Plex n'a rien reçu");

    const meta = await (await as(guest, "/api/metadata/2")).json();
    assert.equal(meta.viewOffset, 1_500_000);
    assert.equal(meta.progressPercent, 25);
    const deck = (await (await as(guest, "/api/hubs")).json()).onDeck;
    assert.deepEqual(deck.map((i) => [i.id, i.progressPercent]), [["2", 25]]);
    // Le profil lié à Plex ne voit pas la position de l'invité
    assert.notEqual((await (await as(owner, "/api/metadata/2")).json()).viewOffset, 1_500_000);
  });

  test("épisode terminé : retiré, et l'épisode suivant arrive dans « Continuer la lecture »", async () => {
    await timeline(guest, { ratingKey: "301", state: "playing", time: 600_000, duration: 1_200_000 });
    let deck = (await (await as(guest, "/api/hubs")).json()).onDeck.map((i) => i.id);
    assert.equal(deck[0], "301");
    await timeline(guest, { ratingKey: "301", state: "stopped", time: 1_150_000, duration: 1_200_000 });
    await new Promise((r) => setTimeout(r, 300)); // recherche de l'épisode suivant
    deck = (await (await as(guest, "/api/hubs")).json()).onDeck.map((i) => i.id);
    assert.ok(!deck.includes("301"), "épisode vu retiré");
    assert.equal(deck[0], "302", "épisode suivant en tête");
  });

  test("fiche d'une série : vu, dernière lecture et série de chaque épisode, propres au profil (#98)", async () => {
    const state = (body) => Object.fromEntries(body.episodes.map((e) => [e.id, [e.watched, e.lastViewedAt, e.progressPercent]]));
    const plexView = await (await as(owner, "/api/shows/400")).json();
    assert.deepEqual(state(plexView), {
      401: [true, 1_700_000_010_000, 0],
      411: [true, 1_700_000_100_000, 0],
      412: [true, 1_700_000_200_000, 0],
      413: [false, 1_700_000_050_000, 25],
      414: [false, null, 0],
    });
    assert.ok(plexView.episodes.every((e) => e.showId === "400"), "série de chaque épisode");
    assert.equal(plexView.show.showId, undefined);

    // L'invité ne voit ni les épisodes vus ni la reprise du compte Plex
    let guestView = await (await as(guest, "/api/shows/400")).json();
    assert.ok(guestView.episodes.every((e) => !e.watched && e.lastViewedAt === null && e.progressPercent === 0));
    const t0 = Date.now();
    await timeline(guest, { ratingKey: "411", state: "stopped", time: 1_150_000, duration: 1_200_000 });
    await timeline(guest, { ratingKey: "413", state: "stopped", time: 300_000, duration: 1_200_000 });
    await new Promise((r) => setTimeout(r, 300)); // 412 mis en file comme épisode suivant
    guestView = state(await (await as(guest, "/api/shows/400")).json());
    assert.equal(guestView[411][0], true);
    assert.ok(guestView[411][1] >= t0);
    assert.deepEqual(guestView[412], [false, null, 0], "en file, pas encore regardé");
    assert.equal(guestView[413][2], 25);
    assert.ok(guestView[413][1] >= guestView[411][1]);
    assert.deepEqual(guestView[401], [false, null, 0]);
    // Le compte Plex garde les siens
    assert.deepEqual(state(await (await as(owner, "/api/shows/400")).json())[413], [false, 1_700_000_050_000, 25]);
  });

  test("musique : pas de position gardée pour un profil", async () => {
    await timeline(guest, { ratingKey: "120", state: "playing", time: 30_000, duration: 240_000, type: "track" });
    const deck = (await (await as(guest, "/api/hubs")).json()).onDeck.map((i) => i.id);
    assert.ok(!deck.includes("120"));
  });

  test("cookie absent ou inconnu : comme avant les profils", async () => {
    const hubs = await (await fetch(`${gw.base}/api/hubs`)).json();
    assert.equal(hubs.onDeck[0].viewOffset, 600000);
    const odd = await fetch(`${gw.base}/api/hubs`, { headers: { Cookie: "nomad_profile=p_000000000000" } });
    assert.equal((await odd.json()).onDeck[0].id, "1");
  });

  test("lien avec Plex déplacé : un seul profil lié", async () => {
    await as(guest, `/api/profiles/${guest.id}`, { method: "PATCH", body: JSON.stringify({ plex: true }) });
    const { profiles } = await (await fetch(`${gw.base}/api/profiles`)).json();
    assert.deepEqual(profiles.map((p) => p.plexLinked), [false, true]);
    // L'invité, désormais lié, voit le « Continuer la lecture » de Plex
    assert.equal((await (await as(guest, "/api/hubs")).json()).onDeck[0].id, "1");
  });
});
