// AuthMe tablosu ile çalışan ortak işlemler (oyundaki hesapla aynı veri)
const crypto = require("node:crypto");
const { neon } = require("@neondatabase/serverless");
const { SignJWT, jwtVerify } = require("jose");

const USERNAME_RE = /^(\.[A-Za-z0-9_]{3,15}|[A-Za-z0-9_]{4,16})$/;
const PLACEHOLDER = "your@email.com";
const COOKIE = "yn_session";
const MAX_AGE = 60 * 60 * 24 * 7;

const sha256hex = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
function makeHash(password) {
  const salt = crypto.randomBytes(8).toString("hex");
  return "$SHA$" + salt + "$" + sha256hex(sha256hex(password) + salt);
}
function checkPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const p = stored.split("$");
  if (p.length !== 4 || p[1] !== "SHA") return false;
  const calc = Buffer.from(sha256hex(sha256hex(password) + p[2]));
  const real = Buffer.from(p[3]);
  return calc.length === real.length && crypto.timingSafeEqual(calc, real);
}

let _sql = null;
function getSql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL tanımlı değil");
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}
const qi = (n) => '"' + String(n).replace(/"/g, '""') + '"';

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
async function names() {
  const sql = getSql();
  const cols = await getColumns(sql);
  const u = colName(cols, "username"), p = colName(cols, "password"), r = colName(cols, "realname"), e = colName(cols, "email");
  if (!u || !p) throw new Error("authme tablosunda username/password sütunu yok");
  return { sql, cols, u, p, r, e };
}

// ---- e-posta yardımcıları ----
const hasEmail = (v) => !!v && String(v).trim() !== "" && String(v).trim().toLowerCase() !== PLACEHOLDER;
function cleanEmail(v) {
  const e = String(v || "").trim().toLowerCase();
  if (e.length > 100 || !/^[^\s@,;<>"]{1,64}@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/.test(e) || e === PLACEHOLDER) return null;
  return e;
}
function maskEmail(e) {
  const [l, d] = String(e).split("@");
  return (l[0] || "") + "***@" + d;
}

// ---- hesap sorguları ----
async function loginByIdentifier(identifier, password) {
  const { sql, u, p, r, e } = await names();
  const id = String(identifier).trim().toLowerCase();
  let rows;
  if (id.includes("@")) {
    if (!e) return null;
    rows = await sql.query("SELECT " + qi(u) + " AS un, " + qi(p) + " AS pw" + (r ? ", " + qi(r) + " AS rn" : "") + " FROM authme WHERE lower(" + qi(e) + ") = $1 LIMIT 2", [id]);
    if (rows.length !== 1) return null; // aynı e-posta birden fazla hesapta ise e-postayla giriş yok
  } else {
    rows = await sql.query("SELECT " + qi(u) + " AS un, " + qi(p) + " AS pw" + (r ? ", " + qi(r) + " AS rn" : "") + " FROM authme WHERE " + qi(u) + " = $1 LIMIT 1", [id]);
  }
  if (!rows.length || !checkPassword(password, rows[0].pw)) return null;
  return { username: String(rows[0].un).toLowerCase(), realname: rows[0].rn || rows[0].un };
}
async function getAccount(username) {
  const { sql, u, r, e } = await names();
  const rows = await sql.query("SELECT " + qi(u) + " AS un" + (r ? ", " + qi(r) + " AS rn" : "") + (e ? ", " + qi(e) + " AS em" : "") + " FROM authme WHERE " + qi(u) + " = $1 LIMIT 1", [String(username).toLowerCase()]);
  if (!rows.length) return null;
  return { username: rows[0].un, realname: rows[0].rn || rows[0].un, email: hasEmail(rows[0].em) ? String(rows[0].em).toLowerCase() : null };
}
async function findByEmail(email) {
  const { sql, u, r, e } = await names();
  if (!e) return null;
  const rows = await sql.query("SELECT " + qi(u) + " AS un" + (r ? ", " + qi(r) + " AS rn" : "") + " FROM authme WHERE lower(" + qi(e) + ") = $1 LIMIT 2", [email.toLowerCase()]);
  if (rows.length !== 1) return null;
  return { username: String(rows[0].un).toLowerCase(), realname: rows[0].rn || rows[0].un };
}
async function emailInUse(email, exceptUsername) {
  const { sql, u, e } = await names();
  if (!e) return false;
  const rows = await sql.query("SELECT 1 FROM authme WHERE lower(" + qi(e) + ") = $1 AND " + qi(u) + " <> $2 LIMIT 1", [email.toLowerCase(), String(exceptUsername || "").toLowerCase()]);
  return rows.length > 0;
}
async function setEmail(username, email) {
  const { sql, u, e } = await names();
  if (!e) throw new Error("authme tablosunda email sütunu yok");
  await sql.query("UPDATE authme SET " + qi(e) + " = $1 WHERE " + qi(u) + " = $2", [email.toLowerCase(), String(username).toLowerCase()]);
}
async function changePassword(username, newPassword) {
  const { sql, u, p } = await names();
  await sql.query("UPDATE authme SET " + qi(p) + " = $1 WHERE " + qi(u) + " = $2", [makeHash(newPassword), String(username).toLowerCase()]);
}
async function registerUser(realname, password, ip, email) {
  const sql = getSql();
  const cols = await getColumns(sql);
  const uCol = colName(cols, "username");
  if (!uCol) throw new Error("authme tablosunda username sütunu yok");
  const lower = realname.toLowerCase();
  const exists = await sql.query("SELECT 1 FROM authme WHERE " + qi(uCol) + " = $1 LIMIT 1", [lower]);
  if (exists.length) return { ok: false };
  const known = {
    username: lower, realname: realname, password: makeHash(password),
    ip: ip, regip: ip, regdate: Date.now(), lastlogin: null,
    x: 0, y: 0, z: 0, world: "world", yaw: 0, pitch: 0,
    email: email || PLACEHOLDER, islogged: 0, hassession: 0,
  };
  const nm = [], params = [];
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
    nm.push(qi(c.column_name));
    params.push(value);
  }
  const marks = params.map((_, i) => "$" + (i + 1)).join(", ");
  try {
    await sql.query("INSERT INTO authme (" + nm.join(", ") + ") VALUES (" + marks + ")", params);
  } catch (e) {
    if (e && e.code === "23505") return { ok: false };
    throw e;
  }
  return { ok: true, user: { username: lower, realname } };
}

// ---- oturum ----
function secretKey() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET eksik veya çok kısa");
  return new TextEncoder().encode(s);
}
async function setSession(res, user) {
  const token = await new SignJWT({ u: user.username, n: user.realname }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(secretKey());
  res.setHeader("Set-Cookie", COOKIE + "=" + token + "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=" + MAX_AGE);
}
function clearSession(res) {
  res.setHeader("Set-Cookie", COOKIE + "=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
}
// Kısa ömürlü imzalı jeton (2FA bileti, e-posta değiştirme aşaması, şifre sıfırlama)
async function signToken(payload, minutes) {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(minutes + "m").sign(secretKey());
}
async function readToken(token, kind) {
  try {
    const { payload } = await jwtVerify(String(token || ""), secretKey());
    return payload.k === kind ? payload : null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  USERNAME_RE, hasEmail, cleanEmail, maskEmail, loginByIdentifier, getAccount, findByEmail, emailInUse, setEmail,
  changePassword, registerUser, setSession, clearSession, signToken, readToken, getSql,
};
