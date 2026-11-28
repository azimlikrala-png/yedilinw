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

const HOUR = 60 * 60 * 1000;
const PURGE_AFTER = 10 * HOUR; // kapanan talep / karara bağlanan başvuru 10 saat sonra silinir
const ids = (list) => JSON.stringify(list.map(Number));

// Talepleri (mesajlar ve dosyalarla birlikte) siler. Dosyalar silinemezse talep de silinmez, sonra tekrar denenir.
async function deleteTickets(list) {
  if (!list.length) return false;
  const files = await q("SELECT pathname FROM yn_attachments WHERE ticket_id IN (SELECT x::bigint FROM jsonb_array_elements_text($1::jsonb) x)", [ids(list)]);
  if (files.length) {
    try {
      const { del } = await import("@vercel/blob");
      await del(files.map((f) => f.pathname));
    } catch (e) {
      console.error("[purge] dosya silinemedi");
      return false;
    }
  }
  await q("DELETE FROM yn_attachments WHERE ticket_id IN (SELECT x::bigint FROM jsonb_array_elements_text($1::jsonb) x)", [ids(list)]);
  await q("DELETE FROM yn_ticket_messages WHERE ticket_id IN (SELECT x::bigint FROM jsonb_array_elements_text($1::jsonb) x)", [ids(list)]);
  await q("DELETE FROM yn_tickets WHERE id IN (SELECT x::bigint FROM jsonb_array_elements_text($1::jsonb) x)", [ids(list)]);
  return true;
}

let lastPurge = 0;
async function purgeOld() {
  const now = Date.now();
  if (now - lastPurge < 60000) return;
  lastPurge = now;
  try {
    const old = await q("SELECT id FROM yn_tickets WHERE status = 'closed' AND closed_at < $1 ORDER BY id LIMIT 50", [now - PURGE_AFTER]);
    if (old.length) await deleteTickets(old.map((r) => r.id));
    await q("DELETE FROM yn_applications WHERE status <> 'pending' AND decided_at < $1", [now - PURGE_AFTER]); // mesajlar da silinir
    await q("DELETE FROM yn_notifs WHERE created_at < $1", [now - 7 * 24 * HOUR]);
  } catch (e) {
    console.error("[purge]", e && e.message ? e.message : "hata");
  }
}

// 24 saati dolan açık talepleri otomatik kapat, eski kayıtları temizle
async function expireTickets() {
  await q(
    "UPDATE yn_tickets SET status = 'closed', closed_reason = 'expired', closed_at = expires_at WHERE status = 'open' AND expires_at < $1",
    [Date.now()]
  );
  await purgeOld();
}

const notify = (owner, kind, ref) =>
  q("INSERT INTO yn_notifs (owner, kind, ref, created_at) VALUES ($1, $2, $3, $4)", [owner, kind, ref, Date.now()]);

module.exports = { STAFF, PURGE_AFTER, q, readSession, send, fail, limited, expireTickets, purgeOld, deleteTickets, notify };
