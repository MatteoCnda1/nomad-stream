// fetchPlex face à une connexion périmée : Plex envoie les en-têtes puis coupe avant le premier
// octet du corps (UND_ERR_SOCKET). La requête doit être refaite, sans que l'appelant le voie.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetchPlex } from "../plex.js";

const BODY = Buffer.alloc(1024 * 1024, 7); // 1 Mo, plusieurs morceaux
let server;
let base;
let cutFirst = 0; // nombre de prochaines requêtes à couper après les en-têtes
let requests = 0;

before(async () => {
  server = http.createServer((req, res) => {
    requests++;
    res.writeHead(206, { "content-type": "audio/mpeg", "content-length": BODY.length });
    if (cutFirst > 0) {
      cutFirst--;
      res.flushHeaders();
      setImmediate(() => res.socket.destroy());
      return;
    }
    res.end(BODY);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test("corps coupé avant le premier octet : la requête est refaite, le corps arrive entier", async () => {
  cutFirst = 1;
  requests = 0;
  const res = await fetchPlex(`${base}/library/parts/1/2/file.mp3`, { timeoutMs: 5000 });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-length"), String(BODY.length));
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), BODY);
  assert.equal(requests, 2);
});

test("même sans nouvelle tentative demandée (retries = 0), deux connexions périmées de suite sont absorbées", async () => {
  cutFirst = 2;
  requests = 0;
  const res = await fetchPlex(`${base}/a`, { timeoutMs: 5000, retries: 0 });
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), BODY);
  assert.equal(requests, 3);
});

test("Plex qui coupe à chaque fois : erreur après 3 essais, pas de boucle", async () => {
  cutFirst = 10;
  requests = 0;
  await assert.rejects(fetchPlex(`${base}/b`, { timeoutMs: 5000, retries: 0 }));
  assert.equal(requests, 3);
  cutFirst = 0;
});

test("réponse normale : corps intact et annulation possible", async () => {
  const res = await fetchPlex(`${base}/c`, { timeoutMs: 5000 });
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), BODY);
  const again = await fetchPlex(`${base}/d`, { timeoutMs: 5000 });
  await again.body.cancel();
});
