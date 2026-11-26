const { neon } = require("@neondatabase/serverless");
const { jwtVerify } = require("jose");

// Yetkililer (küçük harf). Sadece bu hesaplar tüm talepleri/başvuruları görür, duyuru yazar.
const STAFF = ["geckocraft88117", "eren_6331", ".alemdevenom"];
const COOKIE = "yn_session";

let _sql = null;
function db() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL tanımlı değil");
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}
const q = (text, params) => db().query(text, params || []);

function secretKey() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET eksik veya çok kısa");
  return new TextEncoder().encode(s);
}

async function readSession(req) {
  try {
    const m = (req.headers.cookie || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
    if (!m) return null;
    const { payload } = await jwtVerify(m[1], secretKey());
    const username = String(payload.u || "").toLowerCase();
    return { username, realname: String(payload.n || username), staff: STAFF.includes(username) };
  } catch (e) {
    return null;
  }
}

const send = (res, status, obj) => res.status(status).json(obj);
const fail = (res, status, code, msg) => send(res, status, { ok: false, code, error: msg });

// Basit hız sınırı (sunucusuz ortamda her örnekte ayrı sayılır)
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return list.length > max;
}

// 24 saati dolan açık talepleri otomatik kapat
async function expireTickets() {
  await q(
    "UPDATE yn_tickets SET status = 'closed', closed_reason = 'expired', closed_at = expires_at WHERE status = 'open' AND expires_at < $1",
    [Date.now()]
  );
}

module.exports = { STAFF, q, readSession, send, fail, limited, expireTickets };
