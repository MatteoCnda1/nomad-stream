// Playlists du transcodeur iGPU (sans iGPU : seules les playlists sont fabriquées ici)
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTranscoder, RUNGS } from "../transcoder.js";

const cacheDir = fs.mkdtempSync(path.join(tmpdir(), "nomad-tx-"));
const tx = createTranscoder({ device: path.join(cacheDir, "pas-de-gpu"), cacheDir });
after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));

const job = (startSeconds) => ({
  duration: 600,
  segCount: 150,
  startSeconds,
  variants: RUNGS.map((r) => ({ ...r, width: r.maxW, height: r.maxH })),
});

describe("playlists HLS du transcodeur", () => {
  test("reprise annoncée dans la playlist principale et celles des qualités (EXT-X-START)", () => {
    const tag = "#EXT-X-START:TIME-OFFSET=1234.500,PRECISE=YES";
    const j = { ...job(1234.5), duration: 3600, segCount: 900 };
    assert.ok(tx.masterPlaylist(j).split("\n").includes(tag));
    assert.ok(tx.variantPlaylist(j).split("\n").includes(tag));
  });

  test("lecture depuis le début : pas d'EXT-X-START", () => {
    assert.doesNotMatch(tx.masterPlaylist(job(0)), /EXT-X-START/);
    assert.doesNotMatch(tx.variantPlaylist(job(0)), /EXT-X-START/);
  });

  test("la playlist d'une qualité annonce tout le film, segment par segment", () => {
    const lines = tx.variantPlaylist(job(0)).trim().split("\n");
    assert.equal(lines.filter((l) => l.endsWith(".ts")).length, 150);
    assert.equal(lines.at(-1), "#EXT-X-ENDLIST");
  });
});
