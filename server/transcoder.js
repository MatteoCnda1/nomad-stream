// Transcodeur HLS multi-débits sur iGPU Intel (VAAPI / Quick Sync).
//
// Utilisé quand la passerelle tourne à côté des fichiers (LXC « nomad » sur pve) : Plex reste la
// source du catalogue, mais la vidéo est convertie ici, en plusieurs qualités à la fois, pour que
// le lecteur change de qualité segment par segment sans coupure (ABR).
//
// Principe : la playlist annonce le film entier en segments de SEG secondes ; ffmpeg ne fabrique
// que ce qui est demandé, à partir du segment voulu (saut = relance au bon endroit), et se met en
// pause quand il a assez d'avance.
import { spawn, spawnSync, execFile } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export const SEG = 4; // durée d'un segment (s)
const PAUSE_AHEAD = 75; // 300 s d'avance : ffmpeg est mis en pause (SIGSTOP)
const RESUME_AHEAD = 45; // reprise (SIGCONT) quand l'avance retombe sous 180 s
const SEEK_RESTART_GAP = 5; // segment demandé à plus de 20 s devant la production : relance
const SEGMENT_WAIT_MS = 45000;
const IDLE_KILL_MS = 5 * 60 * 1000; // plus aucune requête depuis 5 min : ffmpeg est arrêté
const JOB_TTL_MS = 45 * 60 * 1000; // segments conservés 45 min (reprise, retour en arrière)
const MAX_RUNNING = 3;
const AUDIO_KBPS = 128;

// Paliers produits simultanément (bornés par la taille de la source)
export const RUNGS = [
  { id: "1080p", maxW: 1920, maxH: 1080, kbps: 6000, codecs: "avc1.640028" },
  { id: "720p", maxW: 1280, maxH: 720, kbps: 3000, codecs: "avc1.64001f" },
  { id: "480p", maxW: 854, maxH: 480, kbps: 1200, codecs: "avc1.64001e" },
  { id: "360p", maxW: 640, maxH: 360, kbps: 600, codecs: "avc1.64001e" },
];

const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"]);

export function createTranscoder({ device, cacheDir, driver = "iHD", mediaMap = [] }) {
  const txDir = path.join(cacheDir, "tx");
  const jobs = new Map();
  const probeCache = new Map();

  const hasFfmpeg = spawnSync("ffmpeg", ["-hide_banner", "-version"], { stdio: "ignore" }).status === 0;
  const available = hasFfmpeg && fs.existsSync(device);
  const unavailableReason = !hasFfmpeg ? "ffmpeg absent" : !fs.existsSync(device) ? `${device} absent` : null;

  if (available) {
    // Les sessions d'un précédent démarrage ne servent plus à rien
    fs.rmSync(txDir, { recursive: true, force: true });
    fs.mkdirSync(txDir, { recursive: true });
  }

  // Chemin du fichier tel que vu par Plex -> chemin local
  function localPath(plexPath) {
    for (const [from, to] of mediaMap) {
      if (plexPath.startsWith(from)) return to + plexPath.slice(from.length);
    }
    return plexPath;
  }

  function probe(file) {
    const cached = probeCache.get(file);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      execFile(
        "ffprobe",
        ["-v", "error", "-show_entries",
          "format=duration:stream=index,codec_type,codec_name,profile,pix_fmt,width,height,sample_aspect_ratio,avg_frame_rate,color_transfer,channels",
          "-of", "json", file],
        { timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout) => {
          if (error) return reject(new Error(`ffprobe : ${error.message}`));
          const data = JSON.parse(stdout);
          const streams = data.streams || [];
          const v = streams.find((s) => s.codec_type === "video" && s.codec_name !== "mjpeg" && s.codec_name !== "png");
          if (!v) return reject(new Error("Aucune piste vidéo"));
          const [sarNum, sarDen] = (v.sample_aspect_ratio || "1:1").split(":").map(Number);
          const result = {
            duration: Number(data.format?.duration) || 0,
            video: {
              codec: v.codec_name,
              pixFmt: v.pix_fmt,
              width: v.width,
              height: v.height,
              sar: sarNum > 0 && sarDen > 0 ? sarNum / sarDen : 1,
              hdr: HDR_TRANSFERS.has(v.color_transfer),
            },
            audio: streams.filter((s) => s.codec_type === "audio").map((s) => ({ index: s.index, codec: s.codec_name, channels: s.channels })),
          };
          probeCache.set(file, result);
          resolve(result);
        }
      );
    });
  }

  // Décodage matériel possible sur cet iGPU (Gen9) : H.264 et HEVC 8 bits ; le reste
  // (HEVC 10 bits, AV1…) est décodé par le processeur puis envoyé à l'iGPU
  function canHwDecode(video) {
    if (video.codec === "h264") return video.pixFmt === "yuv420p" || video.pixFmt === "yuvj420p";
    if (video.codec === "hevc") return video.pixFmt === "yuv420p";
    return video.codec === "mpeg2video";
  }

  function variantsFor(video) {
    const dispW = video.width * video.sar;
    const list = [];
    // HDR : conversion des couleurs au processeur, plafonnée à 720p pour tenir le temps réel
    for (const rung of video.hdr ? RUNGS.slice(1) : RUNGS) {
      const fits = dispW >= rung.maxW * 0.9 || video.height >= rung.maxH * 0.9;
      if (!fits && rung !== RUNGS[RUNGS.length - 1]) continue;
      const scale = Math.min(rung.maxW / dispW, rung.maxH / video.height, 1);
      const even = (x) => Math.max(2, Math.round(x / 2) * 2);
      list.push({ ...rung, width: even(dispW * scale), height: even(video.height * scale) });
    }
    return list;
  }

  const segPath = (job, v, n) => path.join(job.dir, `v${v}`, `${n}.ts`);

  // Début du graphe de filtres : images déjà sur l'iGPU (décodage matériel), ou décodées par le
  // processeur puis envoyées à l'iGPU. Une source HDR est d'abord réduite puis convertie en SDR
  // (l'iGPU Gen9 ne sait pas faire cette conversion) : mesuré à 1,4-1,7x le temps réel en 720p.
  function filterPrefix(video, hw, top) {
    if (hw) return "[0:v:0]";
    if (video.hdr) {
      return `[0:v:0]zscale=w=${top.width}:h=${top.height}:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,` +
        "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=nv12,hwupload,";
    }
    return "[0:v:0]format=nv12,hwupload,";
  }

  function buildArgs(job, startSeg) {
    const start = startSeg * SEG;
    const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y"];
    if (job.hwDecode) {
      args.push("-hwaccel", "vaapi", "-hwaccel_device", device, "-hwaccel_output_format", "vaapi");
    } else {
      args.push("-init_hw_device", `vaapi=va:${device}`, "-filter_hw_device", "va");
    }
    // NB : pas de -copyts (ffmpeg 7.1 plante avec -copyts + saut + décodage VAAPI) ; les horodatages
    // sont recalés sur le temps du film avec -output_ts_offset
    if (start > 0) args.push("-ss", String(start));
    args.push("-i", job.file);

    const n = job.variants.length;
    const pre = filterPrefix(job.video, job.hwDecode, job.variants[0]);
    const labels = job.variants.map((_, i) => `[s${i}]`).join("");
    const scales = job.variants
      .map((v, i) => `${n > 1 ? `[s${i}]` : ""}scale_vaapi=w=${v.width}:h=${v.height}:format=nv12[v${i}]`)
      .join(";");
    args.push("-filter_complex", n > 1 ? `${pre}split=${n}${labels};${scales}` : `${pre}${scales}`);

    job.variants.forEach((v, i) => {
      args.push("-map", `[v${i}]`, "-map", `0:${job.audioIndex}`);
      // Pas de -level : forcer le niveau H.264 fait planter l'encodeur de cet iGPU ; il choisit
      // de lui-même ceux annoncés dans CODECS (4.0 en 1080p, 3.1 en 720p, 3.0 en dessous)
      args.push(`-b:v:${i}`, `${v.kbps}k`, `-maxrate:v:${i}`, `${Math.round(v.kbps * 1.5)}k`, `-bufsize:v:${i}`, `${v.kbps * 2}k`);
    });
    args.push(
      "-c:v", "h264_vaapi", "-profile:v", "high", "-bf", "0", "-g", "300",
      // Une image clé exactement au début de chaque segment : les segments s'enchaînent quelle
      // que soit la qualité, et le lecteur peut changer de palier à chaque frontière
      "-force_key_frames", `expr:gte(t,n_forced*${SEG})`,
      "-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`, "-ac", "2",
      "-sn", "-dn", "-max_muxing_queue_size", "2048",
      "-output_ts_offset", String(start),
      "-f", "hls", "-hls_time", String(SEG), "-hls_list_size", "0",
      "-hls_flags", "temp_file+independent_segments", "-hls_segment_type", "mpegts",
      "-start_number", String(startSeg),
      "-hls_segment_filename", path.join(job.dir, "v%v", "%d.ts"),
      "-var_stream_map", job.variants.map((_, i) => `v:${i},a:${i}`).join(" "),
      path.join(job.dir, "v%v", "ffmpeg.m3u8")
    );
    return args;
  }

  // Commande ffmpeg d'une version MP4 compacte (mode hors connexion), au palier demandé ou
  // au plus grand palier possible pour une petite source. Le moov en tête (faststart) permet
  // de lire le fichier dès le début du téléchargement.
  function mp4Args({ file, video, audioIndex, quality, kbps, out }) {
    const variants = variantsFor(video);
    const rung = variants.find((v) => v.id === quality) || variants[0];
    const args = ["-hide_banner", "-nostdin", "-loglevel", "error", "-y"];
    const hw = canHwDecode(video) && !video.hdr;
    if (hw) args.push("-hwaccel", "vaapi", "-hwaccel_device", device, "-hwaccel_output_format", "vaapi");
    else args.push("-init_hw_device", `vaapi=va:${device}`, "-filter_hw_device", "va");
    args.push(
      "-i", file,
      "-filter_complex", `${filterPrefix(video, hw, rung)}scale_vaapi=w=${rung.width}:h=${rung.height}:format=nv12[v]`,
      "-map", "[v]", "-map", `0:${audioIndex}`,
      "-c:v", "h264_vaapi", "-profile:v", "high", "-b:v", `${kbps}k`, "-maxrate", `${Math.round(kbps * 1.5)}k`, "-bufsize", `${kbps * 2}k`,
      "-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`, "-ac", "2",
      "-sn", "-dn", "-movflags", "+faststart",
      "-progress", "pipe:1", "-nostats",
      "-f", "mp4", out
    );
    return { args, width: rung.width, height: rung.height };
  }

  function stopProcess(job) {
    if (!job.proc) return;
    const proc = job.proc;
    job.proc = null;
    try {
      proc.kill("SIGCONT");
      proc.kill("SIGKILL");
    } catch {
      // déjà terminé
    }
  }

  function runningCount() {
    let n = 0;
    for (const j of jobs.values()) if (j.proc) n++;
    return n;
  }

  function launch(job, startSeg) {
    stopProcess(job);
    // Trop de conversions simultanées : on arrête la plus ancienne inactive
    if (runningCount() >= MAX_RUNNING) {
      const oldest = [...jobs.values()].filter((j) => j.proc && j !== job).sort((a, b) => a.lastAccess - b.lastAccess)[0];
      if (oldest) stopProcess(oldest);
    }
    job.variants.forEach((_, i) => fs.mkdirSync(path.join(job.dir, `v${i}`), { recursive: true }));
    const proc = spawn("ffmpeg", buildArgs(job, startSeg), {
      env: { ...process.env, LIBVA_DRIVER_NAME: driver },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    proc.on("exit", (code, signal) => {
      if (job.proc !== proc) return;
      job.proc = null;
      job.paused = false;
      if (code === 0) job.finished = true;
      else if (signal !== "SIGKILL") {
        job.error = stderr.trim().split("\n").slice(-3).join(" | ") || `ffmpeg code ${code}`;
        console.error(`[tx ${job.id}] ffmpeg a échoué au segment ${job.procStart} : ${job.error}`);
      }
    });
    job.proc = proc;
    job.procStart = startSeg;
    job.produced = startSeg - 1;
    job.paused = false;
    job.finished = false;
    job.error = null;
    job.launches.push(Date.now());
  }

  // Dernier segment produit sans trou depuis le début de la conversion en cours
  function refreshProduced(job) {
    const last = job.variants.length - 1;
    while (job.produced + 1 < job.segCount && fs.existsSync(segPath(job, last, job.produced + 1))) job.produced++;
  }

  function throttle(job) {
    if (!job.proc) return;
    refreshProduced(job);
    const ahead = job.produced - job.lastRequest;
    if (!job.paused && ahead > PAUSE_AHEAD) {
      job.proc.kill("SIGSTOP");
      job.paused = true;
    } else if (job.paused && ahead < RESUME_AHEAD) {
      job.proc.kill("SIGCONT");
      job.paused = false;
    }
  }

  async function createJob({ plexFile, audioIndex, startSeconds, durationHintMs }) {
    if (!available) throw Object.assign(new Error(unavailableReason), { status: 503 });
    const file = localPath(plexFile);
    if (!fs.existsSync(file)) throw Object.assign(new Error("Fichier introuvable sur la passerelle"), { status: 404 });
    const info = await probe(file);
    const audio = info.audio.find((a) => a.index === audioIndex) || info.audio[0];
    if (!audio) throw Object.assign(new Error("Aucune piste audio"), { status: 409 });
    const duration = info.duration || (durationHintMs || 0) / 1000;
    if (!duration) throw Object.assign(new Error("Durée inconnue"), { status: 409 });

    const id = crypto.randomBytes(8).toString("hex");
    const job = {
      id,
      file,
      dir: path.join(txDir, id),
      duration,
      segCount: Math.ceil(duration / SEG),
      video: info.video,
      variants: variantsFor(info.video),
      hwDecode: canHwDecode(info.video) && !info.video.hdr,
      audioIndex: audio.index,
      proc: null,
      procStart: 0,
      produced: -1,
      paused: false,
      finished: false,
      error: null,
      lastRequest: 0,
      lastAccess: Date.now(),
      launches: [],
    };
    jobs.set(id, job);
    // Démarrer tout de suite au point de lecture : le premier segment est prêt plus tôt
    const startSeg = Math.min(job.segCount - 1, Math.max(0, Math.floor((startSeconds || 0) / SEG)));
    job.lastRequest = startSeg;
    launch(job, startSeg);
    return job;
  }

  function masterPlaylist(job, preferredIndex = 0) {
    // Safari démarre sur la première variante annoncée : on met en tête celle qui convient au débit connu
    const order = job.variants.map((v, i) => i);
    const first = Math.min(Math.max(0, preferredIndex), order.length - 1);
    order.splice(first, 1);
    order.unshift(first);
    const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-INDEPENDENT-SEGMENTS"];
    for (const i of order) {
      const v = job.variants[i];
      const avg = (v.kbps + AUDIO_KBPS) * 1000;
      const peak = Math.round(v.kbps * 1.5 + AUDIO_KBPS) * 1000;
      lines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${peak},AVERAGE-BANDWIDTH=${avg},RESOLUTION=${v.width}x${v.height},CODECS="${v.codecs},mp4a.40.2",NAME="${v.id}"`,
        `v${i}/index.m3u8`
      );
    }
    return lines.join("\n") + "\n";
  }

  function variantPlaylist(job) {
    const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-PLAYLIST-TYPE:VOD", `#EXT-X-TARGETDURATION:${SEG + 1}`,
      "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-INDEPENDENT-SEGMENTS"];
    for (let n = 0; n < job.segCount; n++) {
      const d = n === job.segCount - 1 ? job.duration - n * SEG : SEG;
      lines.push(`#EXTINF:${d.toFixed(3)},`, `${n}.ts`);
    }
    lines.push("#EXT-X-ENDLIST");
    return lines.join("\n") + "\n";
  }

  // Renvoie le chemin d'un segment prêt, en relançant ou en attendant ffmpeg si besoin
  async function segment(job, v, n) {
    if (v < 0 || v >= job.variants.length || n < 0 || n >= job.segCount) {
      throw Object.assign(new Error("Segment inexistant"), { status: 404 });
    }
    job.lastAccess = Date.now();
    job.lastRequest = n;
    const file = segPath(job, v, n);
    if (fs.existsSync(file)) {
      throttle(job);
      return file;
    }
    refreshProduced(job);
    const coming = job.proc && n >= job.procStart && n <= job.produced + SEEK_RESTART_GAP;
    if (!coming) {
      // Saut dans le film, conversion arrêtée (pause longue) ou plantée : on repart de ce segment.
      // Garde-fou contre les boucles : 6 relances par minute au maximum.
      job.launches = job.launches.filter((t) => Date.now() - t < 60000);
      if (job.launches.length >= 6) throw Object.assign(new Error(job.error || "Conversion instable"), { status: 503 });
      launch(job, n);
    } else if (job.paused) {
      job.proc.kill("SIGCONT");
      job.paused = false;
    }
    const deadline = Date.now() + SEGMENT_WAIT_MS;
    while (Date.now() < deadline) {
      if (fs.existsSync(file)) return file;
      if (!job.proc && (job.error || job.finished)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (fs.existsSync(file)) return file;
    throw Object.assign(new Error(job.error || "Segment pas prêt à temps"), { status: job.error ? 502 : 504 });
  }

  function stopJob(id) {
    const job = jobs.get(id);
    if (!job) return;
    stopProcess(job);
    jobs.delete(id);
    fs.rm(job.dir, { recursive: true, force: true }, () => {});
  }

  // Ménage : conversions abandonnées et vieux segments
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const job of jobs.values()) {
      if (job.proc && now - job.lastAccess > IDLE_KILL_MS) stopProcess(job);
      else throttle(job);
      if (now - job.lastAccess > JOB_TTL_MS) stopJob(job.id);
    }
  }, 15000);
  sweeper.unref();

  function status() {
    return [...jobs.values()].map((j) => ({
      id: j.id,
      file: path.basename(j.file),
      variants: j.variants.map((v) => v.id),
      hwDecode: j.hwDecode,
      running: !!j.proc,
      paused: j.paused,
      procStart: j.procStart,
      produced: j.produced,
      lastRequest: j.lastRequest,
      error: j.error,
    }));
  }

  return {
    available,
    unavailableReason,
    probe,
    localPath,
    canHwDecode,
    variantsFor,
    mp4Args,
    driver,
    createJob,
    getJob: (id) => jobs.get(id),
    masterPlaylist,
    variantPlaylist,
    segment,
    stopJob,
    status,
  };
}
