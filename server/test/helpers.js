// Outils partagés des tests : démarrer une vraie passerelle, isolée de la machine.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index.js");

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Répertoire de travail vide (dotenv n'y trouve aucun .env local) et environnement
// minimal explicite (n'hérite pas d'un éventuel PLEX_TOKEN ou ACCESS_CODE du shell).
// Plex pointe vers un port fermé : toute requête vers lui échoue immédiatement.
export function spawnServer(env = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "nomad-test-"));
  // Données des profils dans le dossier temporaire, jamais dans server/.data
  env = { NOMAD_DATA_DIR: path.join(cwd, "data"), ...env };
  const child = spawn(process.execPath, [SERVER], {
    cwd,
    // Index de recherche construit à la demande : pas d'appels à Plex imprévus pendant les tests
    env: { PATH: process.env.PATH, HOST: "127.0.0.1", PLEX_URL: "http://127.0.0.1:9", NOMAD_SEARCH_WARMUP: "0", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.on("exit", () => rmSync(cwd, { recursive: true, force: true }));
  return child;
}

async function waitUntilUp(base, child, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Le serveur s'est arrêté (code ${child.exitCode})`);
    try {
      await fetch(`${base}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("Le serveur n'a pas démarré à temps");
}

// Démarre une passerelle prête à répondre ; stop() l'arrête et nettoie.
export async function launch(env = {}) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawnServer({ PORT: String(port), PLEX_TOKEN: "test-token", ...env });
  await waitUntilUp(base, child);
  return { base, stop: () => child.kill() };
}
