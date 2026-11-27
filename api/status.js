// Sunucu durumu: aktif oyuncu sayısı + son giren oyuncular (herkese açık)
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

async function fetchStatus() {
  const a = await getJson("https://api.mcstatus.io/v2/status/java/" + HOST + ":" + JAVA_PORT);
  if (a && typeof a.online === "boolean") {
    return { online: a.online, players: a.players ? Number(a.players.online) || 0 : 0, max: a.players ? Number(a.players.max) || 0 : 0 };
  }
  const b = await getJson("https://api.mcsrvstat.us/3/" + HOST + ":" + JAVA_PORT);
  if (b && typeof b.online === "boolean") {
    return { online: b.online, players: b.players ? Number(b.players.online) || 0 : 0, max: b.players ? Number(b.players.max) || 0 : 0 };
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
  res.statusCode = 200;
  const st = await fetchStatus();
  if (!st) return res.end(JSON.stringify({ ok: false }));
  const out = { ok: true, online: st.online, players: st.players, max: st.max, joins: [] };
  try {
    // Son girenler: AuthMe'deki gerçek son giriş zamanı
    const j = await q("SELECT realname, lastlogin FROM authme WHERE lastlogin IS NOT NULL ORDER BY lastlogin DESC LIMIT 8");
    out.joins = j.map((r) => ({ name: r.realname, at: Number(r.lastlogin) }));
  } catch (e) {
    console.error("[status]", e && e.message ? e.message : "hata");
  }
  res.end(JSON.stringify(out));
};
