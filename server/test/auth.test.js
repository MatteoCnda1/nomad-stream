import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createAuth } from "../auth.js";
import { launch } from "./helpers.js";

// Faux objets Express minimalistes pour tester le module sans serveur
function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

function login(auth, code, headers = {}) {
  const res = fakeRes();
  auth.handleLogin({ body: { code }, headers, secure: false }, res);
  return res;
}

const tokenOf = (res) => /nomad_auth=([^;]*)/.exec(res.headers["set-cookie"] || "")?.[1];

// true si le middleware laisse passer la requête
function passes(auth, path, cookie) {
  let ok = false;
  auth.middleware({ path, headers: cookie ? { cookie: `nomad_auth=${cookie}` } : {} }, fakeRes(), () => (ok = true));
  return ok;
}

describe("createAuth (unitaire)", () => {
  test("désactivée sans ACCESS_CODE : tout passe", () => {
    const auth = createAuth({});
    assert.equal(auth.enabled, false);
    assert.equal(passes(auth, "/api/movies"), true);
    const res = fakeRes();
    auth.handleCheck({ headers: {} }, res);
    assert.deepEqual(res.body, { enabled: false, authed: true });
  });

  test("bon code : cookie HttpOnly + SameSite=Lax, sans Secure en HTTP", () => {
    const res = login(createAuth({ accessCode: "abc" }), "abc");
    assert.equal(res.statusCode, 200);
    const cookie = res.headers["set-cookie"];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /Secure/);
  });

  test("derrière HTTPS (tailscale serve) : cookie Secure", () => {
    const res = login(createAuth({ accessCode: "abc" }), "abc", { "x-forwarded-proto": "https" });
    assert.match(res.headers["set-cookie"], /; Secure/);
  });

  test("mauvais code ou code vide : 401 et aucun cookie", () => {
    const auth = createAuth({ accessCode: "abc" });
    for (const code of ["abd", "", "abcd"]) {
      const res = login(auth, code);
      assert.equal(res.statusCode, 401);
      assert.equal(res.headers["set-cookie"], undefined);
    }
  });

  test("middleware : cookie valide accepté, absent ou falsifié refusé", () => {
    const auth = createAuth({ accessCode: "abc" });
    const token = tokenOf(login(auth, "abc"));
    assert.equal(passes(auth, "/api/movies", token), true);
    assert.equal(passes(auth, "/api/movies"), false);
    const [exp, mac] = token.split(".");
    const tampered = mac.slice(0, -1) + (mac.at(-1) === "A" ? "B" : "A");
    assert.equal(passes(auth, "/api/movies", `${exp}.${tampered}`), false);
    assert.equal(passes(auth, "/api/movies", `${Number(exp) + 1}.${mac}`), false);
  });

  test("un cookie signé avec un autre code est refusé", () => {
    const token = tokenOf(login(createAuth({ accessCode: "ancien" }), "ancien"));
    assert.equal(passes(createAuth({ accessCode: "nouveau" }), "/api/movies", token), false);
  });

  test("cookie expiré après 90 jours", (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const auth = createAuth({ accessCode: "abc" });
    const token = tokenOf(login(auth, "abc"));
    t.mock.timers.tick(89 * 24 * 3600 * 1000);
    assert.equal(passes(auth, "/api/movies", token), true);
    t.mock.timers.tick(2 * 24 * 3600 * 1000);
    assert.equal(passes(auth, "/api/movies", token), false);
  });

  test("routes d'auth et shell PWA non gardés", () => {
    const auth = createAuth({ accessCode: "abc" });
    for (const p of ["/api/auth", "/api/auth/check", "/", "/assets/index.js", "/sw.js"]) {
      assert.equal(passes(auth, p), true, p);
    }
  });

  test("logout efface le cookie", () => {
    const res = fakeRes();
    createAuth({ accessCode: "abc" }).handleLogout({ headers: {} }, res);
    assert.match(res.headers["set-cookie"], /nomad_auth=;.*Max-Age=0/);
  });
});

describe("auth via HTTP (passerelle réelle, ACCESS_CODE défini)", () => {
  let gw;
  let cookie;

  before(async () => {
    gw = await launch({ ACCESS_CODE: "code-test" });
  });

  after(() => gw?.stop());

  test("API, images et flux refusés sans cookie (401)", async () => {
    for (const p of ["/api/movies", "/api/image?path=/x", "/api/stream/audio?key=/library/parts/1"]) {
      assert.equal((await fetch(`${gw.base}${p}`)).status, 401, p);
    }
  });

  test("le shell PWA reste accessible pour afficher l'écran de code", async () => {
    assert.equal((await fetch(`${gw.base}/`)).status, 200);
    const res = await fetch(`${gw.base}/api/auth/check`);
    assert.deepEqual(await res.json(), { enabled: true, authed: false });
  });

  test("mauvais code refusé, bon code pose le cookie", async () => {
    const post = (code) =>
      fetch(`${gw.base}/api/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
    assert.equal((await post("faux")).status, 401);
    const ok = await post("code-test");
    assert.equal(ok.status, 200);
    cookie = ok.headers.getSetCookie()[0].split(";")[0];
    assert.match(cookie, /^nomad_auth=/);
  });

  test("avec le cookie, les requêtes franchissent la porte", async () => {
    const check = await fetch(`${gw.base}/api/auth/check`, { headers: { cookie } });
    assert.deepEqual(await check.json(), { enabled: true, authed: true });
    // 502 et non 401 : la requête est passée, seul Plex (injoignable) manque
    const status = await fetch(`${gw.base}/api/status`, { headers: { cookie } });
    assert.equal(status.status, 502);
  });
});
