#!/usr/bin/env node
// Écrans de démarrage iOS (#9) : sans `apple-touch-startup-image` correspondant exactement à
// l'appareil, la PWA installée s'ouvre sur un écran blanc. Génère un PNG par taille d'écran et
// par orientation (logo centré sur le fond de l'appli) dans client/public/splash/, et réécrit
// les balises <link> de client/index.html entre les marqueurs splash:start / splash:end.
//
// Rendu par Chrome via playwright-core (non installé dans le projet) :
//   npm i --prefix /tmp/pw playwright-core
//   PLAYWRIGHT=/tmp/pw/node_modules/playwright-core/index.mjs node scripts/make-splash.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT || "playwright-core");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "client/public/splash");
const indexHtml = path.join(root, "client/index.html");

// [largeur, hauteur] en points CSS (portrait), densité de pixels — appareils concernés
const DEVICES = [
  [440, 956, 3], // iPhone 16/17 Pro Max
  [420, 912, 3], // iPhone Air
  [402, 874, 3], // iPhone 16/17 Pro, 17
  [430, 932, 3], // iPhone 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  [393, 852, 3], // iPhone 14 Pro, 15, 15 Pro, 16
  [428, 926, 3], // iPhone 12/13 Pro Max, 14 Plus
  [390, 844, 3], // iPhone 12, 13, 14, 16e
  [375, 812, 3], // iPhone X, XS, 11 Pro, 12/13 mini
  [414, 896, 3], // iPhone XS Max, 11 Pro Max
  [414, 896, 2], // iPhone XR, 11
  [414, 736, 3], // iPhone 6-8 Plus
  [375, 667, 2], // iPhone 6-8, SE 2/3
  [320, 568, 2], // iPhone SE 1
  [1032, 1376, 2], // iPad Pro 13" (M4)
  [1024, 1366, 2], // iPad Pro 12,9"
  [834, 1210, 2], // iPad Pro 11" (M4)
  [834, 1194, 2], // iPad Pro 11"
  [820, 1180, 2], // iPad Air 10,9", iPad 10
  [834, 1112, 2], // iPad Air 10,5"
  [810, 1080, 2], // iPad 10,2"
  [768, 1024, 2], // iPad 9,7", mini 5
  [744, 1133, 2], // iPad mini 6
];

const BG = "#0c0c0e";
const page = (w, h) => `<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;background:${BG};display:grid;place-items:center">
  <svg width="${Math.round(Math.min(w, h) * 0.3)}" viewBox="0 0 28 28" aria-hidden="true">
    <rect x="5" y="5" width="18" height="18" rx="4.5" transform="rotate(45 14 14)" fill="#e5131d"/>
    <path d="M11.6 9.8v8.4l6.6-4.2z" fill="#fff"/>
  </svg></body></html>`;

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
const links = [];
for (const [pw, ph, dpr] of DEVICES) {
  for (const orientation of ["portrait", "landscape"]) {
    const [w, h] = orientation === "portrait" ? [pw, ph] : [ph, pw];
    const name = `splash-${w * dpr}x${h * dpr}.png`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    const tab = await ctx.newPage();
    await tab.setContent(page(w, h));
    await tab.screenshot({ path: path.join(outDir, name) });
    await ctx.close();
    links.push(
      `    <link rel="apple-touch-startup-image" href="/splash/${name}" media="(device-width: ${pw}px) and (device-height: ${ph}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: ${orientation})" />`,
    );
  }
}
await browser.close();

const html = fs.readFileSync(indexHtml, "utf8");
const updated = html.replace(
  /(<!-- splash:start[^>]*-->\n)[\s\S]*?(\s*<!-- splash:end -->)/,
  (_, start, end) => `${start}${links.join("\n")}${end}`,
);
if (updated === html && !html.includes(links[0])) throw new Error("Marqueurs splash:start / splash:end absents de client/index.html");
fs.writeFileSync(indexHtml, updated);
console.log(`${links.length} écrans de démarrage générés dans ${path.relative(root, outDir)}`);
