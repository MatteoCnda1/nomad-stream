// Faux Plex Media Server pour les tests : quelques réponses JSON et images, avec pannes
// et lenteurs programmables, et la liste des chemins réellement demandés à "Plex".
import http from "node:http";

const movie = (id, title) => ({
  ratingKey: String(id),
  key: `/library/metadata/${id}`,
  type: "movie",
  title,
  summary: `Résumé de ${title}, que seule la fiche affiche.`,
  year: 2020,
  duration: 6_000_000,
  thumb: `/library/metadata/${id}/thumb/1700000000`,
  Media: [{ container: "mp4", videoCodec: "h264", audioCodec: "aac", Part: [{ id: 10 + id, key: `/library/parts/${10 + id}/file.mp4` }] }],
});

// Bibliothèque musicale : artistes (type 8), albums (9) et titres (10)
const artist = (id, title, genres = [], similar = []) => ({
  ratingKey: String(id),
  key: `/library/metadata/${id}/children`,
  type: "artist",
  title,
  Genre: genres.map((tag) => ({ tag })),
  Similar: similar.map((tag) => ({ tag })),
});
const ARTIST_IDS = { "Daft Punk": 100, "Beyoncé": 101, "AC/DC": 102, Justice: 103, "Kavinsky": 104 };
const album = (id, title, artistName) => ({ ratingKey: String(id), type: "album", title, parentTitle: artistName });
const track = (id, title, artistName, albumName, viewCount = 0) => ({
  ratingKey: String(id),
  type: "track",
  title,
  grandparentTitle: artistName,
  grandparentRatingKey: String(ARTIST_IDS[artistName]),
  parentTitle: albumName,
  viewCount,
  duration: 240_000,
  Media: [{ Part: [{ id: 1000 + id, key: `/library/parts/${1000 + id}/file.mp3` }] }],
});
export const MUSIC = {
  8: [
    artist(100, "Daft Punk", ["Electronic"], ["Justice", "Inconnu au bataillon"]),
    artist(101, "Beyoncé", ["R&B"]),
    artist(102, "AC/DC", ["Rock"]),
    artist(103, "Justice", ["Electronic"]),
    artist(104, "Kavinsky", ["Electronic"]),
  ],
  9: [album(110, "Random Access Memories", "Daft Punk"), album(111, "Highway to Hell", "AC/DC")],
  10: [
    track(120, "Get Lucky (feat. Pharrell Williams)", "Daft Punk", "Random Access Memories", 5),
    track(121, "Instant Crush", "Daft Punk", "Random Access Memories"),
    track(122, "Highway to Hell", "AC/DC", "Highway to Hell"),
    track(123, "Crazy In Love (feat. JAY-Z)", "Beyoncé", "Dangerously In Love"),
    track(124, "D.A.N.C.E.", "Justice", "†"),
    track(125, "Genesis", "Justice", "†"),
    track(126, "Nightcall", "Kavinsky", "OutRun"),
    track(127, "Get Lucky (Radio Edit)", "Daft Punk", "Get Lucky - Single"),
  ],
};

const IMAGE = Buffer.from("FAUSSE-IMAGE");
// JPEG minimal en niveaux de gris (JFIF + en-tête de trame à 1 composante), comme les pochettes
// qui font planter le transcodeur photo de Plex : image brute de /library/metadata/50/…
export const GRAY_JPEG = Buffer.from("ffd8ffe000104a46494600010101012c012c0000ffc0000b080010001001011100ffd9", "hex");

function respond(url, res) {
  const json = (data) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ MediaContainer: data }));
  };
  const p = url.pathname;
  if (p === "/") return json({ friendlyName: "Faux Plex", version: "1.0.0" });
  if (p === "/library/sections/1/all") return json({ totalSize: 2, Metadata: [movie(1, "Alpha"), movie(2, "Bravo")] });
  if (p === "/library/sections/2/all") return json({ totalSize: 0, Metadata: [] });
  if (p === "/library/sections/5/all") {
    const items = MUSIC[url.searchParams.get("type")] || MUSIC[8];
    return json({ totalSize: items.length, Metadata: items });
  }
  // Recherche de Plex : un film trouvé par l'un de ses acteurs
  if (p === "/hubs/search") {
    const byActor = /brad/i.test(url.searchParams.get("query") || "")
      ? [{ ...movie(3, "Charlie"), reason: "actor", reasonTitle: "Brad Pitt" }]
      : [];
    return json({ Hub: [{ type: "movie", Metadata: byActor }] });
  }
  if (p === "/transcode/sessions") {
    return json({
      TranscodeSession: [
        { key: "/transcode/sessions/nomad-autre", speed: 9.9, throttled: true },
        { key: "/transcode/sessions/nomad-test123", speed: 2.4, throttled: false, videoDecision: "transcode" },
      ],
    });
  }
  if (/^\/library\/metadata\/\d+$/.test(p)) {
    const id = p.split("/")[3];
    const music = Object.values(MUSIC).flat().find((m) => m.ratingKey === id);
    return json({ Metadata: [music || movie(Number(id), "Alpha")] });
  }
  if (p === "/photo/:/transcode") {
    res.writeHead(200, { "Content-Type": `image/${url.searchParams.get("format") || "jpeg"}` });
    return res.end(IMAGE);
  }
  if (/^\/library\/metadata\/\d+\/thumb\/\d+$/.test(p)) {
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    return res.end(p.startsWith("/library/metadata/50/") ? GRAY_JPEG : IMAGE);
  }
  res.writeHead(404);
  res.end();
}

export async function startFakePlex() {
  const requests = [];
  const transcoded = []; // images demandées au transcodeur photo
  const transcodes = { active: 0, peak: 0 }; // transcodages photo simultanés
  const behaviors = new Map();
  let down = false;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://plex");
    requests.push(url.pathname);
    const inner = url.pathname === "/photo/:/transcode" ? url.searchParams.get("url")?.split("?")[0] : null;
    if (inner) transcoded.push(inner);
    if (down) return req.socket.destroy(); // planté : connexions coupées jusqu'à restart()
    const b = behaviors.get(`transcode ${inner}`) ?? behaviors.get(url.pathname);
    if (b?.crash) {
      down = true;
      return req.socket.destroy();
    }
    if (b?.drop > 0) {
      b.drop--;
      return req.socket.destroy();
    }
    if (b?.hang) return; // ne répond jamais
    if (b?.fail > 0) {
      b.fail--;
      res.writeHead(500);
      return res.end();
    }
    if (inner) {
      transcodes.peak = Math.max(transcodes.peak, ++transcodes.active);
      res.on("close", () => transcodes.active--);
    }
    if (b?.delayMs) return setTimeout(() => respond(url, res), b.delayMs);
    respond(url, res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    image: IMAGE,
    requests,
    transcoded,
    transcodes,
    // { fail: n } : n réponses 500 avant de répondre normalement ; { hang: true } : jamais de réponse ;
    // { drop: n } : n connexions coupées sans réponse ; { delayMs } : réponse retardée
    behave: (pathname, behavior) => behaviors.set(pathname, behavior),
    // Comportement du transcodeur photo pour une image donnée ; { crash: true } : Plex plante
    // (toutes les connexions coupées) chaque fois qu'on lui demande cette image
    onTranscode: (imagePath, behavior) => behaviors.set(`transcode ${imagePath}`, behavior),
    restart: () => (down = false),
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
