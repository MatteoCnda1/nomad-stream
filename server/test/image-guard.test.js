import { test } from "node:test";
import assert from "node:assert/strict";
import { jpegComponents, readHead, createLimiter } from "../image-guard.js";

const hex = (s) => Buffer.from(s.replace(/\s/g, ""), "hex");
const JFIF = "ffd8 ffe0 0010 4a46494600 0101 01 012c 012c 00 00";
const sof = (marker, components) =>
  `ff${marker} ${(8 + 3 * components).toString(16).padStart(4, "0")} 08 0010 0010 ${components
    .toString(16)
    .padStart(2, "0")} ${"011100".repeat(components)}`;

test("JPEG : nombre de composantes lu dans l'en-tête de trame", () => {
  assert.equal(jpegComponents(hex(`${JFIF} ${sof("c0", 1)} ffd9`)), 1); // niveaux de gris
  assert.equal(jpegComponents(hex(`${JFIF} ${sof("c0", 3)} ffd9`)), 3); // couleur
  assert.equal(jpegComponents(hex(`${JFIF} ${sof("c2", 1)} ffd9`)), 1); // progressif
});

test("JPEG : segments sautés (EXIF, table de Huffman) et octets de remplissage", () => {
  const exif = `ffe1 0008 457869660000`;
  const dht = `ffc4 0004 0000`;
  assert.equal(jpegComponents(hex(`ffd8 ${exif} ffff ${dht} ${sof("c0", 1)}`)), 1);
});

test("pas un JPEG, ou en-tête de trame absent : null", () => {
  assert.equal(jpegComponents(hex("89504e470d0a1a0a0000000d49484452")), null); // PNG
  assert.equal(jpegComponents(Buffer.from("GIF89a")), null);
  assert.equal(jpegComponents(hex(`${JFIF} ffda 0002`)), null); // données d'image avant la trame
  assert.equal(jpegComponents(hex(`${JFIF} ffe1 ffff 0000`)), null); // tronqué
  assert.equal(jpegComponents(Buffer.alloc(0)), null);
});

test("readHead : s'arrête à la taille demandée", async () => {
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(1000).fill(pulled));
    },
  });
  const head = await readHead(stream, 2500);
  assert.equal(head.length, 2500);
  assert.ok(pulled <= 4, `${pulled} morceaux lus`);
});

test("limiteur : jamais plus de `max` tâches à la fois, toutes terminées", async () => {
  const limit = createLimiter(2);
  let active = 0;
  let peak = 0;
  const task = async (i) => {
    peak = Math.max(peak, ++active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    return i;
  };
  const results = await Promise.all([0, 1, 2, 3, 4].map((i) => limit(() => task(i))));
  assert.deepEqual(results, [0, 1, 2, 3, 4]);
  assert.equal(peak, 2);
});
