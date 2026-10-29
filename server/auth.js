import crypto from "crypto";

// Authentification légère de la passerelle par code d'accès partagé.
//
// Choix du cookie (et non d'un en-tête Authorization) : les vignettes (<img>),
// les flux (<video>/<audio>), les segments HLS et l'artwork Media Session sont
// chargés via des URLs directes qui ne peuvent pas porter d'en-tête. Seul un
// cookie est renvoyé automatiquement par le navigateur sur toutes ces requêtes.
//
// Opt-in : tant que ACCESS_CODE n'est pas défini, l'auth est désactivée et tout
// passe comme avant (aucune régression sur une installation existante).

const COOKIE = "nomad_auth";
const TTL_DAYS = 90;
const TTL_MS = TTL_DAYS * 24 * 3600 * 1000;

function hash(secret, value) {
  return crypto.createHmac("sha256", secret).update(String(value)).digest("base64url");
}

// Comparaison à temps constant, robuste aux longueurs différentes.
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function sign(exp, secret) {
  return `${exp}.${hash(secret, exp)}`;
}

function verify(token, secret) {
  if (!token || typeof token !== "string") return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!/^\d+$/.test(exp)) return false;
  if (!safeEqual(mac, hash(secret, exp))) return false;
  return Number(exp) > Date.now();
}

function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export function createAuth({ accessCode, secret } = {}) {
  const enabled = typeof accessCode === "string" && accessCode.length > 0;
  // Secret de signature : fourni explicitement, sinon dérivé du code (stable
  // entre redémarrages ; changer le code invalide les sessions, ce qui est voulu).
  const signingSecret = secret || (enabled ? hash("nomad-derived-secret", accessCode) : "disabled");

  // Vérifie le cookie sur toutes les routes /api (sauf l'auth elle-même).
  function middleware(req, res, next) {
    if (!enabled) return next();
    if (!req.path.startsWith("/api/")) return next(); // le shell PWA se charge librement
    if (req.path === "/api/auth" || req.path === "/api/auth/check") return next();
    if (verify(getCookie(req, COOKIE), signingSecret)) return next();
    return res.status(401).json({ error: "Authentification requise" });
  }

  function handleCheck(req, res) {
    if (!enabled) return res.json({ enabled: false, authed: true });
    res.json({ enabled: true, authed: verify(getCookie(req, COOKIE), signingSecret) });
  }

  function handleLogin(req, res) {
    if (!enabled) return res.json({ ok: true, enabled: false });
    const code = String(req.body?.code || "");
    if (code.length === 0 || !safeEqual(code, accessCode)) {
      return res.status(401).json({ error: "Code d'accès invalide" });
    }
    const exp = Date.now() + TTL_MS;
    const token = sign(exp, signingSecret);
    // Secure uniquement derrière HTTPS (tailscale serve) : sinon le cookie ne
    // serait jamais posé en dev local http://localhost.
    const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TTL_DAYS * 24 * 3600}${secure ? "; Secure" : ""}`
    );
    res.json({ ok: true, enabled: true });
  }

  function handleLogout(req, res) {
    res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.json({ ok: true });
  }

  return { enabled, middleware, handleCheck, handleLogin, handleLogout };
}
