// Films au fichier disparu (perdu avec un disque, ou remplacé par une version réencodée) :
// signalés sur leur fiche, retirés des listes, et la version encore présente est lue.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { launch } from "./helpers.js";
import { startFakePlex } from "./fake-plex.js";

let plex;
const dirs = [];
const tempDir = (prefix) => {
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};

before(async () => {
  plex = await startFakePlex();
});

after(() => {
  plex?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

// Passerelle qui voit les fichiers : `present` = films dont le fichier existe sous /media/Films
async function gateway(present) {
  const media = tempDir("nomad-media-");
  mkdirSync(path.join(media, "Films"));
  for (const id of present) writeFileSync(path.join(media, "Films", `${id}.mp4`), "");
  const gw = await launch({
    PLEX_URL: plex.url,
    NOMAD_CACHE_DIR: tempDir("nomad-cache-"),
    NOMAD_HIDE_MISSING: "1",
    NOMAD_MEDIA_MAP: `/media=${media}`,
  });
  return { gw, get: (p) => fetch(`${gw.base}${p}`).then((r) => r.json()) };
}

describe("fiche d'un film", () => {
  let gw;
  let get;
  before(async () => ({ gw, get } = await gateway([1, 2])));
  after(() => gw?.stop());

  test("fichier présent : lisible ; fichier disparu : signalé manquant", async () => {
    assert.equal((await get("/api/metadata/1")).missing, false);
    assert.equal((await get("/api/metadata/60")).missing, true);
  });

  test("film réencodé : la version encore sur le disque est retenue, avec son index Plex", async () => {
    const m = await get("/api/metadata/61");
    assert.equal(m.missing, false);
    assert.equal(m.mediaIndex, 1);
    assert.equal(m.partKey, "/library/parts/611/file.mkv");
    assert.equal(m.videoCodec, "hevc");
  });
});

describe("listes", () => {
  test("film sans fichier retiré de la liste, total ajusté", async () => {
    const { gw, get } = await gateway([1]);
    try {
      const { items, totalSize } = await get("/api/movies");
      assert.deepEqual(items.map((m) => m.title), ["Alpha"]);
      assert.equal(totalSize, 1);
    } finally {
      gw.stop();
    }
  });

  test("aucun fichier visible (disque non monté) : rien n'est masqué", async () => {
    const { gw, get } = await gateway([]);
    try {
      const { items, totalSize } = await get("/api/movies");
      assert.equal(items.length, 2);
      assert.equal(totalSize, 2);
    } finally {
      gw.stop();
    }
  });
});
