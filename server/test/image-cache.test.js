import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createImageCache } from "../image-cache.js";

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "nomad-images-"));
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

// Fichiers de 100 octets, du plus ancien (index 0) au plus récent
function addFiles(n) {
  const base = Date.now() - 3600 * 1000;
  for (let i = 0; i < n; i++) {
    const f = path.join(dir, `img${i}.webp`);
    fs.writeFileSync(f, Buffer.alloc(100));
    const t = new Date(base + i * 1000);
    fs.utimesSync(f, t, t);
  }
}

const remaining = () => fs.readdirSync(dir).filter((n) => n.endsWith(".webp")).sort();

async function newCache(maxBytes) {
  const cache = createImageCache({ dir, maxBytes });
  await cache.enforceLimit(); // ménage initial (dossier encore vide)
  return cache;
}

test("sous le plafond : rien n'est supprimé", async () => {
  const cache = await newCache(1000);
  addFiles(5);
  assert.deepEqual(await cache.enforceLimit(), { total: 500, removed: 0 });
  assert.equal(remaining().length, 5);
});

test("au-delà du plafond : les plus anciennes partent jusqu'à 80 % du plafond", async () => {
  const cache = await newCache(500);
  addFiles(10);
  const { total, removed } = await cache.enforceLimit();
  assert.equal(removed, 6);
  assert.equal(total, 400);
  assert.deepEqual(remaining(), ["img6.webp", "img7.webp", "img8.webp", "img9.webp"]);
});

test("une vignette servie récemment est épargnée", async () => {
  const cache = await newCache(250);
  addFiles(3);
  cache.touch(path.join(dir, "img0.webp"));
  await new Promise((r) => setTimeout(r, 50)); // touch est asynchrone
  await cache.enforceLimit();
  assert.deepEqual(remaining(), ["img0.webp", "img2.webp"]);
});

test("les dossiers sont ignorés, et un seul ménage tourne à la fois", async () => {
  const cache = await newCache(1000);
  fs.mkdirSync(path.join(dir, "sous-dossier"));
  addFiles(2);
  const a = cache.enforceLimit();
  assert.equal(cache.enforceLimit(), a);
  assert.deepEqual(await a, { total: 200, removed: 0 });
});
