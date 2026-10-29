// Faux Plex Media Server pour les tests : quelques réponses JSON et images, avec pannes
// et lenteurs programmables, et la liste des chemins réellement demandés à "Plex".
import http from "node:http";

const movie = (id, title) => ({
  ratingKey: String(id),
  key: `/library/metadata/${id}`,
  type: "movie",
  title,
  year: 2020,
  duration: 6_000_000,
  thumb: `/library/metadata/${id}/thumb/1700000000`,
  Media: [{ container: "mp4", videoCodec: "h264", audioCodec: "aac", Part: [{ id: 10 + id, key: `/library/parts/${10 + id}/file.mp4` }] }],
});

const IMAGE = Buffer.from("FAUSSE-IMAGE");

function respond(url, res) {
  const json = (data) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ MediaContainer: data }));
  };
  const p = url.pathname;
  if (p === "/") return json({ friendlyName: "Faux Plex", version: "1.0.0" });
  if (p === "/library/sections/1/all") return json({ totalSize: 2, Metadata: [movie(1, "Alpha"), movie(2, "Bravo")] });
  if (p === "/library/sections/2/all") return json({ totalSize: 0, Metadata: [] });
  if (/^\/library\/metadata\/\d+$/.test(p)) return json({ Metadata: [movie(Number(p.split("/")[3]), "Alpha")] });
  if (p === "/photo/:/transcode") {
    res.writeHead(200, { "Content-Type": `image/${url.searchParams.get("format") || "jpeg"}` });
    return res.end(IMAGE);
  }
  if (/^\/library\/metadata\/\d+\/thumb\/\d+$/.test(p)) {
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    return res.end(IMAGE);
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
