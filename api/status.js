// Sunucu durumu: aktif oyuncu sayısı + son giren / son çıkan oyuncular (herkese açık)
const { q } = require("../lib/common");
const HOST = "yedilinw.mangoohost.live";
const JAVA_PORT = 21350;

async function getJson(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 5000);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { "User-Agent": "YedilinwSite/1.0" } });
    return r.ok ? await r.json() : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function namesOf(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const p of list) {
    const n = String((p && (p.name_clean || p.name || p.name_raw)) || "").trim();
    if (/^[A-Za-z0-9_.]{2,17}$/.test(n)) out.push(n);
  }
  return out;
}

async function fetchStatus() {
  const a = await getJson("https://api.mcstatus.io/v2/status/java/" + HOST + ":" + JAVA_PORT);
  if (a && typeof a.online === "boolean") {
    return { online: a.online, players: a.players ? Number(a.players.online) || 0 : 0, max: a.players ? Number(a.players.max) || 0 : 0, names: a.players ? namesOf(a.players.list) : null };
  }
  const b = await getJson("https://api.mcsrvstat.us/3/" + HOST + ":" + JAVA_PORT);
  if (b && typeof b.online === "boolean") {
    return { online: b.online, players: b.players ? Number(b.players.online) || 0 : 0, max: b.players ? Number(b.players.max) || 0 : 0, names: b.players ? namesOf(b.players.list) : null };
  }
  return null;
}

// Çevrimiçi listesini karşılaştırıp giriş/çıkış olaylarını kaydeder
async function sync(st) {
  if (!st.online) {
    // sunucu kapalıysa herkes çıkmış sayılır (olay yazmadan listeyi temizle)
    await q("DELETE FROM yn_online");
    return;
  }
  if (!st.names) return;                          // sunucu isimleri paylaşmıyor
  if (st.names.length === 0 && st.players > 0) return; // isim listesi gizli/eksik
  const now = Date.now();
  const prev = (await q("SELECT name FROM yn_online")).map((r) => r.name);
  const seeded = prev.length > 0 || (await q("SELECT 1 FROM yn_events LIMIT 1")).length > 0;
  const cur = st.names;
  const left = prev.filter((n) => !cur.includes(n));
  const joined = cur.filter((n) => !prev.includes(n));
  if (left.length) {
    const rows = await q("DELETE FROM yn_online WHERE name = ANY($1::text[]) RETURNING name", [left]);
    for (const r of rows) await q("INSERT INTO yn_events (name, kind, at) VALUES ($1, 'leave', $2)", [r.name, now]);
  }
  if (joined.length) {
    const rows = await q("INSERT INTO yn_online (name, since) SELECT x, $2 FROM unnest($1::text[]) x ON CONFLICT DO NOTHING RETURNING name", [joined, now]);
    if (seeded) for (const r of rows) await q("INSERT INTO yn_events (name, kind, at) VALUES ($1, 'join', $2)", [r.name, now]);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
  res.statusCode = 200;
  const st = await fetchStatus();
  if (!st) return res.end(JSON.stringify({ ok: false }));
  const out = { ok: true, online: st.online, players: st.players, max: st.max, joins: [], leaves: [], tracking: !!st.names };
  try {
    await sync(st);
    // Son girenler: AuthMe'deki gerçek son giriş zamanı
    const j = await q("SELECT realname, lastlogin FROM authme WHERE lastlogin IS NOT NULL ORDER BY lastlogin DESC LIMIT 8");
    out.joins = j.map((r) => ({ name: r.realname, at: Number(r.lastlogin) }));
    const l = await q("SELECT name, at FROM yn_events WHERE kind = 'leave' ORDER BY id DESC LIMIT 8");
    out.leaves = l.map((r) => ({ name: r.name, at: Number(r.at) }));
  } catch (e) {
    console.error("[status]", e && e.message ? e.message : "hata");
  }
  res.end(JSON.stringify(out));
};
