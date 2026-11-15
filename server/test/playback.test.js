// Observabilité de la lecture : journal par lecture (validation, rotation) et état du transcodeur
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPlaybackLog, sanitizePlayback, summarizePlayback } from "../playback-log.js";
import { launch } from "./helpers.js";
import { startFakePlex } from "./fake-plex.js";

const sample = {
  id: "123",
  title: "Alpha",
  mode: "abr",
  quality: "720p",
  ttffMs: 2400,
  watchedS: 2460,
  stalls: 3,
  stallMs: 12000,
  qualitySwitches: 2,
  restarts: 0,
  cause: "network",
  bandwidthKbps: 5200,
  droppedFrames: 12,
  totalFrames: 60000,
  error: null,
};

describe("journal des lectures (unitaire)", () => {
  test("ne garde que les champs attendus, typés et bornés", () => {
    const e = sanitizePlayback({ ...sample, mode: "inconnu", cause: "<script>", stalls: -4, ttffMs: "2", extra: "x".repeat(1e5) });
    assert.equal(e.mode, null);
    assert.equal(e.cause, null);
    assert.equal(e.stalls, 0);
    assert.equal(e.ttffMs, null);
    assert.ok(!("extra" in e));
    assert.equal(sanitizePlayback({ ...sample, title: "t".repeat(500) }).title.length, 160);
  });

  test("événements du lecteur et fin de séance : bornés et filtrés", () => {
    const events = [...Array(200).keys()].map((i) => (i === 199 ? "y".repeat(500) : `${i}s attente`));
    const e = sanitizePlayback({ ...sample, events: [...events, 42, null, ""], recoveries: 2, endReason: "pagehide" });
    assert.equal(e.events.length, 77); // 80 derniers, dont 3 non textuels écartés
    assert.equal(e.events[0], "123s attente");
    assert.equal(e.events.at(-1).length, 160);
    assert.equal(e.recoveries, 2);
    assert.equal(e.endReason, "pagehide");
    const bad = sanitizePlayback({ ...sample, events: "pas une liste", endReason: "<b>" });
    assert.deepEqual(bad.events, []);
    assert.equal(bad.endReason, null);
    assert.match(summarizePlayback(e), /2 lecture\(s\) figée\(s\) rattrapée\(s\)/);
  });

  test("identifiant de média obligatoire et numérique", () => {
    for (const id of [undefined, 12, "abc", "1/../2"]) assert.equal(sanitizePlayback({ ...sample, id }), null);
  });

  test("résumé lisible pour journalctl", () => {
    assert.equal(
      summarizePlayback(sanitizePlayback(sample)),
      "▶ Alpha · abr 720p · 1re image 2,4 s · 3 coupures (12,0 s, réseau) · 41 min vues · 2 changement(s) de qualité"
    );
    assert.match(summarizePlayback(sanitizePlayback({ ...sample, ttffMs: undefined })), /fermé avant la 1re image/);
  });

  test("une ligne par lecture, et rotation au-delà de la taille maximale", async () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "nomad-log-"));
    try {
      const log = createPlaybackLog({ dir, maxBytes: 600 });
      for (let i = 0; i < 5; i++) await log.append({ n: i, ...sanitizePlayback(sample) });
      const current = fs.readFileSync(log.file, "utf8").trim().split("\n").map(JSON.parse);
      const rotated = fs.readFileSync(`${log.file}.1`, "utf8").trim().split("\n").map(JSON.parse);
      assert.deepEqual([...rotated, ...current].map((e) => e.n), [0, 1, 2, 3, 4]);
      assert.ok(current.length < 5);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("observabilité via HTTP", () => {
  let plex;
  let gw;
  let cacheDir;

  before(async () => {
    plex = await startFakePlex();
    cacheDir = fs.mkdtempSync(path.join(tmpdir(), "nomad-cache-"));
    gw = await launch({ PLEX_URL: plex.url, NOMAD_CACHE_DIR: cacheDir });
  });

  after(() => {
    gw?.stop();
    plex?.close();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  const post = (body) =>
    fetch(`${gw.base}/api/playback/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Test/1.0" },
      body: JSON.stringify(body),
    });

  test("une lecture est ajoutée au journal, avec appareil et navigateur", async () => {
    assert.equal((await post({ ...sample, client: "abcdef123456" })).status, 204);
    await new Promise((r) => setTimeout(r, 100));
    const lines = fs.readFileSync(path.join(cacheDir, "logs", "playback.jsonl"), "utf8").trim().split("\n");
    const e = JSON.parse(lines.at(-1));
    assert.equal(e.id, "123");
    assert.equal(e.client, "abcdef123456");
    assert.equal(e.ua, "Test/1.0");
    assert.ok(!Number.isNaN(Date.parse(e.at)));
  });

  test("entrée invalide refusée", async () => {
    assert.equal((await post({ title: "sans id" })).status, 400);
  });

  test("vitesse du transcodeur Plex pour la session du lecteur", async () => {
    const res = await fetch(`${gw.base}/api/playback/stats?session=nomad-test123`);
    assert.deepEqual(await res.json(), {
      transcoder: { kind: "plex", speed: 2.4, throttled: false, videoDecision: "transcode", hw: false },
    });
  });

  test("session inconnue : pas de transcodeur ; paramètres invalides : 400", async () => {
    assert.deepEqual(await (await fetch(`${gw.base}/api/playback/stats?session=nomad-absente`)).json(), { transcoder: null });
    assert.equal((await fetch(`${gw.base}/api/playback/stats?session=..%2Fx`)).status, 400);
  });
});
