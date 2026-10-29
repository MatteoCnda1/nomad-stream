// Versions hors connexion : fichiers MP4 H.264 compacts préparés par l'iGPU, que l'appli télécharge
// sur l'appareil (Wi-Fi) pour les lire ensuite sans réseau.
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export const OFFLINE_QUALITIES = {
  "720p": { kbps: 2500 }, // ≈ 1,2 Go par heure (son compris)
  "480p": { kbps: 1000 }, // ≈ 0,5 Go par heure
};
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const MAX_TOTAL_BYTES = 150 * 1024 ** 3;

export function createOffline({ transcoder, cacheDir }) {
  const dir = path.join(cacheDir, "offline");
  fs.mkdirSync(dir, { recursive: true });
  const tasks = new Map();
  const queue = [];
  let running = null;

  const fileFor = (key) => path.join(dir, `${key}.mp4`);
  const isKey = (key) => typeof key === "string" && /^\d{1,12}-a\d{1,3}-(720p|480p)$/.test(key);

  // Fichiers déjà prêts (redémarrage du service) ; les préparations interrompues sont jetées
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name.endsWith(".part")) fs.rmSync(full, { force: true });
    else if (name.endsWith(".mp4")) {
      const key = name.slice(0, -4);
      if (isKey(key)) tasks.set(key, { key, state: "ready", progress: 1, size: fs.statSync(full).size });
    }
  }

  const publicStatus = (t) => ({ key: t.key, state: t.state, progress: t.progress, size: t.size || null, error: t.error || null });

  function enforceLimits() {
    const files = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".mp4"))
      .map((n) => {
        const st = fs.statSync(path.join(dir, n));
        return { key: n.slice(0, -4), size: st.size, used: st.atimeMs };
      })
      .sort((a, b) => a.used - b.used);
    let total = files.reduce((s, f) => s + f.size, 0);
    for (const f of files) {
      if (Date.now() - f.used < MAX_AGE_MS && total <= MAX_TOTAL_BYTES) break;
      if (running?.key === f.key) continue;
      fs.rmSync(fileFor(f.key), { force: true });
      tasks.delete(f.key);
      total -= f.size;
    }
  }

  function pump() {
    if (running || queue.length === 0) return;
    const task = tasks.get(queue.shift());
    if (!task || task.state !== "queued") return pump();
    running = task;
    task.state = "encoding";
    const part = `${fileFor(task.key)}.part`;
    const { args } = transcoder.mp4Args({
      file: task.file,
      video: task.video,
      audioIndex: task.audioIndex,
      quality: task.quality,
      kbps: OFFLINE_QUALITIES[task.quality].kbps,
      out: part,
    });
    // Priorité basse : une lecture en cours reste prioritaire sur le processeur
    const proc = spawn("nice", ["-n", "10", "ffmpeg", ...args], {
      env: { ...process.env, LIBVA_DRIVER_NAME: transcoder.driver },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let buffer = "";
    proc.stdout.on("data", (d) => {
      buffer += d.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const m = /^out_time_us=(\d+)/.exec(line);
        if (m && task.duration) task.progress = Math.min(0.99, Number(m[1]) / 1e6 / task.duration);
      }
    });
    proc.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-1500);
    });
    proc.on("exit", (code) => {
      running = null;
      if (code === 0 && fs.existsSync(part)) {
        fs.renameSync(part, fileFor(task.key));
        task.state = "ready";
        task.progress = 1;
        task.size = fs.statSync(fileFor(task.key)).size;
        enforceLimits();
      } else {
        fs.rmSync(part, { force: true });
        task.state = "error";
        task.error = stderr.trim().split("\n").slice(-2).join(" | ") || `ffmpeg code ${code}`;
        console.error(`[offline ${task.key}] échec : ${task.error}`);
      }
      pump();
    });
  }

  async function prepare({ id, plexFile, audioIndex, quality, durationHintMs }) {
    if (!OFFLINE_QUALITIES[quality]) throw Object.assign(new Error("Qualité inconnue"), { status: 400 });
    const file = transcoder.localPath(plexFile);
    if (!fs.existsSync(file)) throw Object.assign(new Error("Fichier introuvable sur la passerelle"), { status: 404 });
    const info = await transcoder.probe(file);
    const audio = info.audio.find((a) => a.index === audioIndex) || info.audio[0];
    if (!audio) throw Object.assign(new Error("Aucune piste audio"), { status: 409 });
    const key = `${id}-a${audio.index}-${quality}`;
    const existing = tasks.get(key);
    if (existing && existing.state !== "error") return publicStatus(existing);
    const task = {
      key,
      state: "queued",
      progress: 0,
      file,
      video: info.video,
      audioIndex: audio.index,
      quality,
      duration: info.duration || (durationHintMs || 0) / 1000,
    };
    tasks.set(key, task);
    queue.push(key);
    pump();
    return publicStatus(task);
  }

  function status(key) {
    const t = isKey(key) && tasks.get(key);
    return t ? publicStatus(t) : null;
  }

  // Chemin du fichier prêt (la date d'accès sert au ménage : un fichier téléchargé récemment est gardé)
  function readyFile(key) {
    const t = isKey(key) && tasks.get(key);
    if (!t || t.state !== "ready") return null;
    const f = fileFor(key);
    const now = new Date();
    fs.utimes(f, now, now, () => {});
    return f;
  }

  return { prepare, status, readyFile, isKey };
}
