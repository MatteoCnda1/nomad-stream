// Playlists du transcodeur iGPU (sans iGPU : seules les playlists sont fabriquées ici)
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTranscoder, RUNGS, parseVaDecoders, hwDecodable, conversionCost, fitsBudget, GEN9_DECODERS } from "../transcoder.js";

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

// Sortie de vainfo sur pve (i5-6500T, HD Graphics 530), le 26/11/2026
const VAINFO_GEN9 = `vainfo: Driver version: Intel iHD driver for Intel(R) Gen Graphics - 25.2.3 ()
vainfo: Supported profile and entrypoints
      VAProfileMPEG2Simple            :	VAEntrypointVLD
      VAProfileMPEG2Main              :	VAEntrypointVLD
      VAProfileH264Main               :	VAEntrypointVLD
      VAProfileH264Main               :	VAEntrypointEncSlice
      VAProfileH264High               :	VAEntrypointVLD
      VAProfileVC1Advanced            :	VAEntrypointVLD
      VAProfileH264ConstrainedBaseline:	VAEntrypointVLD
      VAProfileVP8Version0_3          :	VAEntrypointVLD
      VAProfileHEVCMain               :	VAEntrypointVLD
      VAProfileHEVCMain               :	VAEntrypointEncSlice`;

// iGPU plus récent (N100, Gen12) : HEVC 10 bits, VP9 et AV1 en plus
const VAINFO_GEN12 = `${VAINFO_GEN9}
      VAProfileHEVCMain10             :	VAEntrypointVLD
      VAProfileHEVCMain10             :	VAEntrypointEncSlice
      VAProfileVP9Profile0            :	VAEntrypointVLD
      VAProfileVP9Profile2            :	VAEntrypointVLD
      VAProfileAV1Profile0            :	VAEntrypointVLD`;

describe("décodage par l'iGPU (vainfo)", () => {
  const video = (codec, pixFmt) => ({ codec, pixFmt, width: 1920, height: 1080 });

  test("iGPU de pve : H.264 et HEVC 8 bits, MPEG-2 ; rien d'encodage seul", () => {
    const d = parseVaDecoders(VAINFO_GEN9);
    assert.deepEqual(Object.fromEntries(d), { mpeg2video: 8, h264: 8, hevc: 8 });
    assert.deepEqual(Object.fromEntries(d), Object.fromEntries(GEN9_DECODERS), "mêmes valeurs que sans vainfo");
  });

  test("HEVC 10 bits : processeur sur pve, iGPU sur un N100", () => {
    const hevc10 = video("hevc", "yuv420p10le");
    assert.equal(hwDecodable(hevc10, parseVaDecoders(VAINFO_GEN9)), false);
    const gen12 = parseVaDecoders(VAINFO_GEN12);
    assert.equal(hwDecodable(hevc10, gen12), true);
    assert.equal(hwDecodable(video("av1", "yuv420p10le"), gen12), true);
    assert.equal(hwDecodable(video("vp9", "yuv420p"), gen12), true);
  });

  test("jamais par l'iGPU : H.264 10 bits, 4:2:2, codec inconnu", () => {
    const gen12 = parseVaDecoders(VAINFO_GEN12);
    assert.equal(hwDecodable(video("h264", "yuv420p10le"), gen12), false);
    assert.equal(hwDecodable(video("hevc", "yuv422p10le"), gen12), false);
    assert.equal(hwDecodable(video("vc1", "yuv420p"), gen12), false);
    assert.equal(hwDecodable(video("h264", "yuv420p"), new Map()), false);
  });
});

describe("capacité du transcodeur (#70)", () => {
  const v = (width, height, hdr = false) => ({ width, height, hdr });

  test("coût : iGPU presque rien pour le processeur, 10 bits 1080p un cœur, 4K et HDR plafonnés", () => {
    assert.deepEqual(conversionCost(v(1920, 1080), true), { cpu: 0.1, gpu: 1 });
    assert.deepEqual(conversionCost(v(1920, 1080), false), { cpu: 1, gpu: 1 });
    assert.deepEqual(conversionCost(v(1280, 720), false), { cpu: 0.5, gpu: 1 });
    assert.deepEqual(conversionCost(v(3840, 2160), false), { cpu: 2.5, gpu: 2 });
    assert.deepEqual(conversionCost(v(1920, 1080, true), false), { cpu: 2.5, gpu: 1 });
  });

  test("pve (3 cœurs, 4 places) : 3 lectures 10 bits, 4 lectures décodées par l'iGPU", () => {
    const budget = { cpu: 3, gpu: 4 };
    const add = (used, cost) => ({ cpu: used.cpu + cost.cpu, gpu: used.gpu + cost.gpu, conversions: used.conversions + 1 });
    const fill = (cost) => {
      let used = { cpu: 0, gpu: 0, conversions: 0 };
      while (fitsBudget(used, cost, budget)) used = add(used, cost);
      return used.conversions;
    };
    assert.equal(fill(conversionCost(v(1920, 1080), false)), 3);
    assert.equal(fill(conversionCost(v(1920, 1080), true)), 4);
    assert.equal(fill(conversionCost(v(1920, 1080, true), false)), 1, "HDR : une à la fois");
  });

  test("la première conversion passe toujours, même plus lourde que le budget", () => {
    assert.equal(fitsBudget({ cpu: 0, gpu: 0, conversions: 0 }, { cpu: 9, gpu: 9 }, { cpu: 1, gpu: 1 }), true);
  });

  test("sans iGPU : transcodeur indisponible, création refusée", async () => {
    assert.equal(tx.available, false);
    await assert.rejects(() => tx.createJob({ plexFile: "/x.mkv" }), { status: 503 });
  });
});
