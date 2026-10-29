// Passerelle reliée à un faux Plex : appels de métadonnées (délais, nouvelles tentatives),
// cache d'images, et non-régression des failles de chemin corrigées.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launch } from "./helpers.js";
import { startFakePlex } from "./fake-plex.js";

let plex;
let gw;
let cacheDir;

before(async () => {
  plex = await startFakePlex();
  cacheDir = mkdtempSync(path.join(tmpdir(), "nomad-cache-"));
  gw = await launch({ PLEX_URL: plex.url, NOMAD_CACHE_DIR: cacheDir, PLEX_TIMEOUT_MS: "300" });
});

after(() => {
  gw?.stop();
  plex?.close();
  rmSync(cacheDir, { recursive: true, force: true });
});

const get = (p, init) => fetch(`${gw.base}${p}`, init);
const count = (p) => plex.requests.filter((r) => r === p).length;
const thumb = "/api/image?path=" + encodeURIComponent("/library/metadata/1/thumb/1700000000");

describe("métadonnées", () => {
  test("statut du serveur", async () => {
    const res = await get("/api/status");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "online");
    assert.equal(body.serverName, "Faux Plex");
  });

  test("films mis en forme, vignettes servies par la passerelle", async () => {
    const res = await get("/api/movies");
    assert.equal(res.status, 200);
    const { items, totalSize } = await res.json();
    assert.equal(totalSize, 2);
    assert.deepEqual(items.map((m) => m.title), ["Alpha", "Bravo"]);
    assert.match(items[0].thumb, /^\/api\/image\?path=%2Flibrary%2Fmetadata%2F1%2Fthumb%2F/);
    assert.equal(items[0].partKey, "/library/parts/11/file.mp4");
  });

  test("une erreur 500 passagère de Plex est rattrapée par une nouvelle tentative", async () => {
    plex.behave("/library/sections/1/all", { fail: 1 });
    const before = count("/library/sections/1/all");
    const res = await get("/api/movies?limit=7"); // autre clé de cache
    assert.equal(res.status, 200);
    assert.equal((await res.json()).items.length, 2);
    assert.equal(count("/library/sections/1/all") - before, 2);
  });

  test("un Plex figé ne bloque plus la requête (délai maximal)", async () => {
    plex.behave("/library/sections/2/all", { hang: true });
    const t0 = Date.now();
    const res = await get("/api/shows?limit=9");
    assert.equal(res.status, 500);
    assert.ok(Date.now() - t0 < 3000, `réponse en ${Date.now() - t0} ms`);
  });
});

describe("images", () => {
  test("transcodée en WebP puis servie depuis le cache disque", async () => {
    const first = await get(thumb);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("content-type"), "image/webp");
    assert.deepEqual(Buffer.from(await first.arrayBuffer()), plex.image);
    await new Promise((r) => setTimeout(r, 200)); // écriture du cache asynchrone
    const before = count("/photo/:/transcode");
    const second = await get(thumb);
    assert.equal(second.status, 200);
    assert.deepEqual(Buffer.from(await second.arrayBuffer()), plex.image);
    assert.equal(count("/photo/:/transcode"), before, "pas de nouvel appel à Plex");
  });

  test("ETag connu : 304 sans corps", async () => {
    const etag = (await get(thumb)).headers.get("etag");
    const res = await get(thumb, { headers: { "If-None-Match": etag } });
    assert.equal(res.status, 304);
  });

  test("format jpeg (artwork Media Session)", async () => {
    const res = await get(thumb.replace("1700000000", "1700000001") + "&format=jpeg");
    assert.equal(res.headers.get("content-type"), "image/jpeg");
  });

  test("repli sur l'image brute si le transcodeur photo échoue", async () => {
    plex.behave("/photo/:/transcode", { fail: 2 });
    const res = await get("/api/image?path=" + encodeURIComponent("/library/metadata/2/thumb/1700000000"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "public, max-age=604800");
    assert.ok(count("/library/metadata/2/thumb/1700000000") >= 1);
  });

  test("image par défaut de Plex acceptée", async () => {
    const res = await get("/api/image?path=" + encodeURIComponent("/:/resources/movie.png"));
    assert.notEqual(res.status, 400);
  });
});

// Non-régression : chacune de ces requêtes atteignait Plex (avec le token admin) ou le disque
describe("sécurité : chemins refusés", () => {
  const refused = async (p, plexPath) => {
    plex.requests.length = 0;
    const res = await get(p);
    assert.equal(res.status, 400, p);
    const body = Buffer.from(await res.arrayBuffer()).toString("latin1");
    assert.ok(!body.includes("test-token"), "aucune fuite du token");
    if (plexPath) assert.ok(!plex.requests.includes(plexPath), `${plexPath} demandé à Plex`);
  };

  test("format d'image utilisé comme chemin de fichier (/proc/self/environ)", async () => {
    const fmt = "/" + "../".repeat(14) + "proc/self/environ";
    await refused(`${thumb}&format=${encodeURIComponent(fmt)}`);
  });

  test("image : page Plex arbitraire ou traversée", async () => {
    await refused("/api/image?path=" + encodeURIComponent("/:/prefs"), "/:/prefs");
    await refused("/api/image?path=" + encodeURIComponent("/library/metadata/1/../../../:/prefs"), "/:/prefs");
  });

  test("identifiants de route", async () => {
    for (const r of ["metadata", "shows", "music/artists", "music/albums"]) {
      await refused(`/api/${r}/..%2F..%2Fstatus%2Fsessions`, "/status/sessions");
    }
  });

  test("clé de fichier des flux directs", async () => {
    for (const r of ["file", "audio"]) {
      await refused(`/api/stream/${r}?key=` + encodeURIComponent("/library/parts/1/../../:/prefs"), "/:/prefs");
    }
  });

  test("sous-chemin de session HLS", async () => {
    await refused("/api/stream/hls/session/abc/..%2F..%2F..%2F..%2F..%2F%3A%2Fprefs", "/:/prefs");
  });
});
