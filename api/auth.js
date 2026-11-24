const crypto = require("node:crypto");
const { neon } = require("@neondatabase/serverless");
const { SignJWT, jwtVerify } = require("jose");

// 4-16 karakter: harf, rakam, _ ; Bedrock için yalnızca ilk karakter nokta olabilir
const USERNAME_RE = /^(\.[A-Za-z0-9_]{3,15}|[A-Za-z0-9_]{4,16})$/;
const COOKIE = "yn_session";
const MAX_AGE = 60 * 60 * 24 * 7;

// ---------- Şifre (AuthMe SHA256) ----------
const sha256hex = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

function makeHash(password) {
  const salt = crypto.randomBytes(8).toString("hex"); // 16 hex karakter
  return "$SHA$" + salt + "$" + sha256hex(sha256hex(password) + salt);
}

function checkPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const p = stored.split("$"); // ["", "SHA", tuz, hash]
  if (p.length !== 4 || p[1] !== "SHA") return false;
  const calc = Buffer.from(sha256hex(sha256hex(password) + p[2]));
  const real = Buffer.from(p[3]);
  return calc.length === real.length && crypto.timingSafeEqual(calc, real);
}

// ---------- Veritabanı ----------
let _sql = null;
function getSql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL tanımlı değil");
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}
const q = (n) => '"' + String(n).replace(/"/g, '""') + '"';

let _cols = null;
async function getColumns(sql) {
  if (_cols) return _cols;
  const rows = await sql.query(
    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns " +
      "WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position",
    ["authme"]
  );
  if (!rows.length) throw new Error("authme tablosu bulunamadı");
  _cols = rows;
  return rows;
}
const colName = (cols, lower) => {
  const c = cols.find((x) => x.column_name.toLowerCase() === lower);
  return c ? c.column_name : null;
};

async function loginUser(username, password) {
  const sql = getSql();
  const cols = await getColumns(sql);
  const uCol = colName(cols, "username");
  const pCol = colName(cols, "password");
  const rCol = colName(cols, "realname");
  if (!uCol || !pCol) throw new Error("authme tablosunda username/password sütunu yok");
  const rows = await sql.query(
    "SELECT " + q(pCol) + " AS pw" + (rCol ? ", " + q(rCol) + " AS rn" : "") +
      " FROM authme WHERE " + q(uCol) + " = $1 LIMIT 1",
    [username.toLowerCase()]
  );
  if (!rows.length || !checkPassword(password, rows[0].pw)) return null;
  return { username: username.toLowerCase(), realname: rows[0].rn || username };
}

async function changePassword(username, newPassword) {
  const sql = getSql();
  const cols = await getColumns(sql);
  const uCol = colName(cols, "username");
  const pCol = colName(cols, "password");
  if (!uCol || !pCol) throw new Error("authme tablosunda username/password sütunu yok");
  await sql.query("UPDATE authme SET " + q(pCol) + " = $1 WHERE " + q(uCol) + " = $2", [
    makeHash(newPassword),
    username.toLowerCase(),
  ]);
}

async function registerUser(realname, password, ip) {
  const sql = getSql();
  const cols = await getColumns(sql);
  const uCol = colName(cols, "username");
  if (!uCol) throw new Error("authme tablosunda username sütunu yok");
  const lower = realname.toLowerCase();

  const exists = await sql.query("SELECT 1 FROM authme WHERE " + q(uCol) + " = $1 LIMIT 1", [lower]);
  if (exists.length) return { ok: false };

  const known = {
    username: lower, realname: realname, password: makeHash(password),
    ip: ip, regip: ip, regdate: Date.now(), lastlogin: null,
    x: 0, y: 0, z: 0, world: "world", yaw: 0, pitch: 0,
    email: "your@email.com", islogged: 0, hassession: 0,
  };
  const names = [];
  const params = [];
  for (const c of cols) {
    const key = c.column_name.toLowerCase();
    const notNull = c.is_nullable === "NO";
    let value;
    if (key in known) {
      value = known[key];
      if (value === null && notNull) value = 0;
    } else if (notNull && c.column_default === null) {
      const t = c.data_type;
      if (/int|numeric|double|real|decimal|serial/.test(t)) value = 0;
      else if (t === "boolean") value = false;
      else value = "";
    } else continue;
    names.push(q(c.column_name));
    params.push(value);
  }
  const marks = params.map((_, i) => "$" + (i + 1)).join(", ");
  try {
    await sql.query("INSERT INTO authme (" + names.join(", ") + ") VALUES (" + marks + ")", params);
  } catch (e) {
    if (e && e.code === "23505") return { ok: false };
    throw e;
  }
  return { ok: true, user: { username: lower, realname } };
}

// ---------- Oturum (JWT çerezi) ----------
function secretKey() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET eksik veya çok kısa");
  return new TextEncoder().encode(s);
}
async function setSession(res, user) {
  const token = await new SignJWT({ u: user.username, n: user.realname })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(secretKey());
  res.setHeader("Set-Cookie", COOKIE + "=" + token + "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=" + MAX_AGE);
}
function clearSession(res) {
  res.setHeader("Set-Cookie", COOKIE + "=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
}
async function readSession(req) {
  try {
    const m = (req.headers.cookie || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
    if (!m) return null;
    const { payload } = await jwtVerify(m[1], secretKey());
    return { username: payload.u, realname: payload.n };
  } catch (e) {
    return null;
  }
}

// ---------- Deneme sınırı: dakikada en fazla 5 ----------
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 5;
}

const send = (res, status, obj) => res.status(status).json(obj);
const fail = (res, status, msg) => send(res, status, { ok: false, error: msg });

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") return fail(res, 405, "Geçersiz istek");
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const action = body.action;

    if (action === "me") {
      const s = await readSession(req);
      return send(res, 200, { ok: true, user: s ? { realname: s.realname } : null });
    }
    if (action === "logout") {
      clearSession(res);
      return send(res, 200, { ok: true });
    }

    const ip =
      String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.headers["x-real-ip"] || "0.0.0.0";
    if (tooMany(ip)) return fail(res, 429, "Çok fazla deneme yaptın, biraz bekle");

    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (password.length > 128) return fail(res, 400, "Şifre çok uzun");

    if (action === "changepw") {
      const s = await readSession(req);
      if (!s) return fail(res, 401, "Önce giriş yapmalısın");
      if (password.length < 8) return fail(res, 400, "Yeni şifre en az 8 karakter olmalı");
      if (password !== String(body.password2 || "")) return fail(res, 400, "Şifreler eşleşmiyor");
      const cur = String(body.current || "");
      const u = cur.length <= 128 ? await loginUser(s.username, cur) : null;
      if (!u) return fail(res, 401, "Mevcut şifre hatalı");
      await changePassword(s.username, password);
      return send(res, 200, { ok: true });
    }

    if (action === "login") {
      if (!USERNAME_RE.test(username) || !password) return fail(res, 401, "Kullanıcı adı veya şifre hatalı");
      const u = await loginUser(username, password);
      if (!u) return fail(res, 401, "Kullanıcı adı veya şifre hatalı");
      await setSession(res, u);
      return send(res, 200, { ok: true });
    }

    if (action === "register") {
      if (!USERNAME_RE.test(username))
        return fail(res, 400, "Kullanıcı adı 4-16 karakter olmalı; harf, rakam ve _ kullanılabilir (Bedrock için başta tek nokta)");
      if (password.length < 8) return fail(res, 400, "Şifre en az 8 karakter olmalı");
      if (password !== String(body.password2 || "")) return fail(res, 400, "Şifreler eşleşmiyor");
      const r = await registerUser(username, password, ip);
      if (!r.ok) return fail(res, 409, "Bu kullanıcı adı alınmış");
      await setSession(res, r.user);
      return send(res, 200, { ok: true });
    }

    return fail(res, 400, "Geçersiz istek");
  } catch (e) {
    console.error("[auth]", e && e.message ? e.message : "bilinmeyen hata");
    return fail(res, 500, "Bir hata oluştu, tekrar dene");
  }
};
