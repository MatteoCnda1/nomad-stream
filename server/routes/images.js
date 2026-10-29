// Vignettes : WebP produits par le transcodeur photo de Plex, cache disque et ETag, avec le
// garde-fou contre les images qui font planter Plex (voir image-guard.js).
import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fetchPlex } from "../plex.js";
import { isPlexImagePath, clampInt } from "../validate.js";
import { createImageCache } from "../image-cache.js";
import { createImageGuard, isConnectionDrop, jpegComponents, readHead } from "../image-guard.js";

// Liste fermée : le format sert aussi d'extension au fichier de cache (jamais de valeur libre
// dans un chemin de fichier : `format=/../../etc/passwd` lisait n'importe quel fichier)
const IMAGE_FORMATS = { webp: "image/webp", jpeg: "image/jpeg", png: "image/png" };

export function imageRoutes({ plex, cacheDir, imageCacheDir, imageCacheMb, concurrency }) {
  const { plexUrl, token, timeoutMs } = plex;
  const router = express.Router();

  // Plafonné (500 Mo par défaut ≈ 25 000 vignettes) : les moins récemment servies partent en premier
  const imageCache = createImageCache({ dir: imageCacheDir, maxBytes: imageCacheMb * 1024 ** 2 });
  // Images qui ont fait planter le transcodeur photo de Plex (hors du dossier des vignettes, que
  // le ménage du cache vide) et nombre de transcodages photo simultanés
  const imageGuard = createImageGuard({
    file: path.join(cacheDir, "plex-crash-images.json"),
    concurrency,
    // Plex répond-il encore ? N'importe quelle réponse HTTP suffit
    isPlexUp: () =>
      fetchPlex(plexUrl("/identity"), { timeoutMs: 3000 }).then(
        (r) => {
          r.body?.cancel().catch(() => {});
          return true;
        },
        () => false,
      ),
  });

  // Image brute en JPEG niveaux de gris ? Seuls ses premiers Ko sont lus (en-tête du fichier ;
  // les métadonnées EXIF peuvent repousser l'en-tête de trame au-delà de 64 Ko)
  async function isGrayscaleJpeg(imagePath) {
    try {
      const upstream = await fetchPlex(plexUrl(imagePath), {
        headers: { Range: "bytes=0-262143" },
        timeoutMs,
        retries: 1,
      });
      if (!upstream.ok || !upstream.body) {
        upstream.body?.cancel().catch(() => {});
        return false;
      }
      return jpegComponents(await readHead(upstream.body, 256 * 1024)) === 1;
    } catch {
      return false; // Plex injoignable : le transcodage échouera de lui-même
    }
  }

  // 18. Proxy & Cache Haute Performance d'Images (WebP + Cache Disque + ETag)
  router.get("/api/image", async (req, res) => {
    const imagePath = req.query.path;
    const format = req.query.format || "webp";
    if (!isPlexImagePath(imagePath) || !Object.hasOwn(IMAGE_FORMATS, format)) {
      return res.status(400).send("Image invalide");
    }
    const width = clampInt(req.query.width, 300, 16, 2000);
    const height = clampInt(req.query.height, 450, 16, 2000);

    const cacheKey = crypto.createHash("md5").update(`${imagePath}_${width}_${height}_${format}`).digest("hex");
    const cachedFilePath = path.join(imageCacheDir, `${cacheKey}.${format}`);
    const etag = `"${cacheKey}"`;

    // Validation du cache HTTP navigateur
    if (req.headers["if-none-match"] === etag) return res.status(304).end();

    // 1. Image déjà présente sur disque
    if (fs.existsSync(cachedFilePath)) {
      imageCache.touch(cachedFilePath);
      res.setHeader("Content-Type", IMAGE_FORMATS[format]);
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable"); // Cache 30 jours
      res.setHeader("ETag", etag);
      return fs.createReadStream(cachedFilePath).pipe(res);
    }

    const get = (url, options) =>
      fetchPlex(url, { timeoutMs, retries: 1, signal: AbortSignal.timeout(timeoutMs * 2), ...options });
    const read = async (upstream) => ({
      buffer: Buffer.from(await upstream.arrayBuffer()),
      type: upstream.headers.get("content-type"),
    });
    try {
      // 2. Transcodage ultra-léger via le photo transcoder de Plex, sauf si l'image l'a déjà fait planter
      let image = null;
      let cacheControl = "public, max-age=2592000, immutable"; // Cache 30 jours
      // Les JPEG en niveaux de gris font planter le transcodeur : reconnus avant de le solliciter
      if (!imageGuard.isSuspect(imagePath) && (await isGrayscaleJpeg(imagePath))) {
        imageGuard.setAside(imagePath, "JPEG en niveaux de gris");
      }
      if (!imageGuard.isSuspect(imagePath)) {
        const innerUrl = `${imagePath}?X-Plex-Token=${token}`;
        const transcodeUrl = plexUrl("/photo/:/transcode", { width, height, minSize: "1", upscale: "1", format, url: innerUrl });
        image = await imageGuard.transcode(imagePath, async () => {
          // Jamais de nouvelle tentative après une coupure : si Plex vient de tomber sur cette
          // image, la lui redemander le referait planter
          const upstream = await get(transcodeUrl, { retryIf: (err) => !isConnectionDrop(err) });
          if (upstream.ok) return read(upstream);
          upstream.body?.cancel().catch(() => {});
          return null;
        });
      }
      if (!image) {
        // Repli sur l'image brute si le photo transcoder échoue (ou a planté sur cette image)
        const upstream = await get(plexUrl(imagePath));
        if (!upstream.ok) {
          upstream.body?.cancel().catch(() => {});
          return res.status(upstream.status === 404 ? 404 : 502).send("Image introuvable");
        }
        image = await read(upstream);
        cacheControl = "public, max-age=604800";
      }
      const { buffer } = image;
      // Sauvegarde sur disque asynchrone
      fs.promises
        .writeFile(cachedFilePath, buffer)
        .then(() => imageCache.noteWrite())
        .catch((err) => console.error("Cache file write error:", err));
      res.setHeader("Content-Type", image.type || IMAGE_FORMATS[format]);
      res.setHeader("Cache-Control", cacheControl);
      res.setHeader("ETag", etag);
      res.send(buffer);
    } catch {
      if (!res.headersSent) res.status(502).send("Image indisponible");
    }
  });

  return router;
}
