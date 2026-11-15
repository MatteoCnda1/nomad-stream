// Journal des lectures : une ligne JSON par lecture, envoyée par le lecteur à sa fermeture (temps
// jusqu'à la 1re image, coupures et leur cause probable, changements de qualité…). Sert à savoir,
// après coup, si une lecture saccadée venait du réseau ou du transcodeur.
import fs from "fs";
import path from "path";

const MODES = new Set(["direct", "hls", "abr", "local"]);
const QUALITIES = new Set(["original", "1080p", "720p", "480p", "360p"]);
const CAUSES = new Set(["network", "transcoder"]);
const END_REASONS = new Set(["closed", "pagehide", "error"]);
const MAX_EVENTS = 80;
const MAX_BYTES = 5 * 1024 * 1024;

const int = (v, max) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : null);
const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// Ne garde que les champs attendus, bornés et typés (le corps vient du navigateur)
export function sanitizePlayback(body) {
  if (!body || typeof body !== "object" || typeof body.id !== "string" || !/^\d{1,12}$/.test(body.id)) return null;
  return {
    id: body.id,
    title: str(body.title, 160),
    mode: MODES.has(body.mode) ? body.mode : null,
    quality: QUALITIES.has(body.quality) ? body.quality : null,
    ttffMs: int(body.ttffMs, 600_000), // null : fermé avant la 1re image
    watchedS: int(body.watchedS, 86_400) ?? 0,
    stalls: int(body.stalls, 10_000) ?? 0,
    stallMs: int(body.stallMs, 86_400_000) ?? 0,
    qualitySwitches: int(body.qualitySwitches, 10_000) ?? 0,
    restarts: int(body.restarts, 1_000) ?? 0,
    cause: CAUSES.has(body.cause) ? body.cause : null,
    bandwidthKbps: int(body.bandwidthKbps, 10_000_000),
    droppedFrames: int(body.droppedFrames, 1e9) ?? 0,
    totalFrames: int(body.totalFrames, 1e9) ?? 0,
    error: str(body.error, 200),
    // Lectures figées rattrapées par le lecteur (sans que l'utilisateur ait à rouvrir)
    recoveries: int(body.recoveries, 1_000) ?? 0,
    endReason: END_REASONS.has(body.endReason) ? body.endReason : null,
    // Derniers événements du lecteur (attente, erreur, relance, AirPlay…), pour comprendre après
    // coup une lecture qui s'est mal passée
    events: Array.isArray(body.events)
      ? body.events.slice(-MAX_EVENTS).map((e) => str(e, 160)).filter(Boolean)
      : [],
  };
}

const sec = (ms) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

// Résumé d'une ligne pour journalctl
export function summarizePlayback(e) {
  const parts = [
    `${e.mode ?? "?"}${e.quality ? ` ${e.quality}` : ""}`,
    e.ttffMs != null ? `1re image ${sec(e.ttffMs)}` : "fermé avant la 1re image",
    e.stalls ? `${e.stalls} coupure${e.stalls > 1 ? "s" : ""} (${sec(e.stallMs)}${e.cause ? `, ${e.cause === "network" ? "réseau" : "transcodeur"}` : ""})` : "0 coupure",
    `${Math.round(e.watchedS / 60)} min vues`,
  ];
  if (e.qualitySwitches) parts.push(`${e.qualitySwitches} changement(s) de qualité`);
  if (e.recoveries) parts.push(`${e.recoveries} lecture(s) figée(s) rattrapée(s)`);
  if (e.restarts) parts.push(`${e.restarts} relance(s) du flux`);
  if (e.error) parts.push(`erreur : ${e.error}`);
  return `▶ ${e.title ?? e.id} · ${parts.join(" · ")}`;
}

export function createPlaybackLog({ dir, maxBytes = MAX_BYTES }) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "playback.jsonl");
  let chain = Promise.resolve();

  // Écritures en série (jamais deux lignes entremêlées) ; au-delà de maxBytes, l'ancien
  // journal devient playback.jsonl.1 (une seule génération conservée)
  function append(entry) {
    chain = chain.then(async () => {
      try {
        const st = await fs.promises.stat(file).catch(() => null);
        if (st && st.size > maxBytes) await fs.promises.rename(file, `${file}.1`);
        await fs.promises.appendFile(file, JSON.stringify(entry) + "\n");
      } catch (err) {
        console.error("Journal des lectures :", err.message);
      }
    });
    return chain;
  }

  return { file, append };
}
