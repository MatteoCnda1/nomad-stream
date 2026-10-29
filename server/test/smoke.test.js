// Test de fumée : démarre réellement la passerelle, avec un Plex injoignable,
// et vérifie qu'elle tient debout (démarrage, validation des entrées, erreurs).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index.js");
// Répertoire de travail vide : dotenv n'y trouve aucun .env local (tests isolés de la machine)
const CWD = mkdtempSync(path.join(tmpdir(), "nomad-test-"));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Environnement minimal et explicite (n'hérite pas d'un éventuel PLEX_TOKEN du shell)
function startServer(extraEnv = {}) {
  return spawn(process.execPath, [SERVER], {
    cwd: CWD,
    env: { PATH: process.env.PATH, HOST: "127.0.0.1", PLEX_URL: "http://127.0.0.1:9", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitUntilUp(base, child, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Le serveur s'est arrêté (code ${child.exitCode})`);
    try {
      await fetch(`${base}/api/inconnue`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("Le serveur n'a pas démarré à temps");
}

let child;
let base;

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = startServer({ PORT: String(port), PLEX_TOKEN: "test-token" });
  await waitUntilUp(base, child);
});

after(() => {
  child?.kill();
  rmSync(CWD, { recursive: true, force: true });
});

test("refuse de démarrer sans PLEX_TOKEN", async () => {
  const noToken = startServer({ PORT: String(await freePort()) });
  const code = await new Promise((resolve) => noToken.on("exit", resolve));
  assert.equal(code, 1);
});

test("route API inconnue : 404 JSON", async () => {
  const res = await fetch(`${base}/api/inconnue`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "API route not found" });
});

test("Plex injoignable : /api/status répond 502 sans faire tomber le serveur", async () => {
  const res = await fetch(`${base}/api/status`);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).status, "error");
  // Le serveur répond toujours ensuite
  assert.equal((await fetch(`${base}/api/inconnue`)).status, 404);
});

test("flux : clé de fichier absente ou hors /library/parts/ refusée (400)", async () => {
  assert.equal((await fetch(`${base}/api/stream/file`)).status, 400);
  assert.equal((await fetch(`${base}/api/stream/audio?key=/etc/passwd`)).status, 400);
});

test("HLS : identifiants invalides refusés (400)", async () => {
  const res = await fetch(`${base}/api/stream/hls/start.m3u8?id=abc&session=ok`);
  assert.equal(res.status, 400);
  const bad = await fetch(`${base}/api/stream/hls/ping?session=${encodeURIComponent("../x")}`);
  assert.equal(bad.status, 400);
});

test("timeline : ratingKey non numérique refusé (400)", async () => {
  const res = await fetch(`${base}/api/timeline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ratingKey: "1;DROP" }),
  });
  assert.equal(res.status, 400);
});

test("le shell PWA est servi sur /", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/);
});
