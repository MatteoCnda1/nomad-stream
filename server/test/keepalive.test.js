// Connexions persistantes : `tailscale serve` réutilise une connexion vers la passerelle jusqu'à
// 90 s après la dernière requête. La passerelle ne doit pas la fermer avant (502 au hasard sinon).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { launch } from "./helpers.js";

let gw;

before(async () => {
  gw = await launch();
});

after(() => gw?.stop());

// Envoie une requête sur la connexion et renvoie la réponse brute (en-têtes + corps)
function request(socket, path) {
  return new Promise((resolve, reject) => {
    let data = "";
    const onData = (chunk) => {
      data += chunk;
      const end = data.indexOf("\r\n\r\n");
      if (end === -1) return;
      const length = Number(/content-length: (\d+)/i.exec(data.slice(0, end))?.[1] || 0);
      if (data.length >= end + 4 + length) {
        socket.off("data", onData);
        resolve(data);
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
    socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n`);
  });
}

test("une connexion inactive depuis plusieurs secondes sert encore la requête suivante", async () => {
  const { port } = new URL(gw.base);
  const socket = net.connect(Number(port), "127.0.0.1");
  socket.setEncoding("utf8");
  await new Promise((resolve) => socket.once("connect", resolve));
  let closed = false;
  socket.once("close", () => {
    closed = true;
  });

  const first = await request(socket, "/api/inconnue");
  assert.match(first, /^HTTP\/1\.1 404/);
  assert.match(first, /keep-alive: timeout=120/i);

  // Plus que les 5 s par défaut de Node, qui fermait la connexion sous les pieds du proxy
  await new Promise((resolve) => setTimeout(resolve, 6000));
  assert.equal(closed, false, "la passerelle a fermé une connexion inactive depuis 6 s");

  const second = await request(socket, "/api/inconnue");
  assert.match(second, /^HTTP\/1\.1 404/);
  socket.destroy();
});
