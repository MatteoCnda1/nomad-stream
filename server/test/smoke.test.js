// Test de fumée : démarre réellement la passerelle, avec un Plex injoignable,
// et vérifie qu'elle tient debout (démarrage, validation des entrées, erreurs).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { freePort, launch, spawnServer } from "./helpers.js";

let gw;

before(async () => {
  gw = await launch();
});

after(() => gw?.stop());

test("refuse de démarrer sans PLEX_TOKEN", async () => {
  const noToken = spawnServer({ PORT: String(await freePort()) });
  const code = await new Promise((resolve) => noToken.on("exit", resolve));
  assert.equal(code, 1);
});

test("route API inconnue : 404 JSON", async () => {
  const res = await fetch(`${gw.base}/api/inconnue`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "API route not found" });
});

test("Plex injoignable : /api/status répond 502 sans faire tomber le serveur", async () => {
  const res = await fetch(`${gw.base}/api/status`);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).status, "error");
  // Le serveur répond toujours ensuite
  assert.equal((await fetch(`${gw.base}/api/inconnue`)).status, 404);
});

test("flux : clé de fichier absente ou hors /library/parts/ refusée (400)", async () => {
  assert.equal((await fetch(`${gw.base}/api/stream/file`)).status, 400);
  assert.equal((await fetch(`${gw.base}/api/stream/audio?key=/etc/passwd`)).status, 400);
});

test("HLS : identifiants invalides refusés (400)", async () => {
  const res = await fetch(`${gw.base}/api/stream/hls/start.m3u8?id=abc&session=ok`);
  assert.equal(res.status, 400);
  const bad = await fetch(`${gw.base}/api/stream/hls/ping?session=${encodeURIComponent("../x")}`);
  assert.equal(bad.status, 400);
});

test("timeline : ratingKey non numérique refusé (400)", async () => {
  const res = await fetch(`${gw.base}/api/timeline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ratingKey: "1;DROP" }),
  });
  assert.equal(res.status, 400);
});

test("le shell PWA est servi sur /", async () => {
  const res = await fetch(`${gw.base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/);
});

test("version de l'appli servie : script principal de index.html, ou null sans client compilé", async () => {
  const res = await fetch(`${gw.base}/api/version`);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const { version } = await res.json();
  assert.ok(version === null || /^\/assets\/index-[\w-]+\.js$/.test(version), String(version));
});

test("page de l'appli, service worker et manifest revérifiés à chaque ouverture", async () => {
  for (const p of ["/", "/index.html", "/sw.js", "/manifest.json"]) {
    const res = await fetch(`${gw.base}${p}`);
    assert.equal(res.headers.get("cache-control"), "no-cache", p);
  }
});
