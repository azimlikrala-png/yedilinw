// Sunucudaki aktif oyuncu sayısı (herkese açık, giriş gerekmez)
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

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
  let out = null;
  const a = await getJson("https://api.mcstatus.io/v2/status/java/" + HOST + ":" + JAVA_PORT);
  if (a && typeof a.online === "boolean") {
    out = { online: a.online, players: a.players ? Number(a.players.online) || 0 : 0, max: a.players ? Number(a.players.max) || 0 : 0 };
  }
  if (!out) {
    const b = await getJson("https://api.mcsrvstat.us/3/" + HOST + ":" + JAVA_PORT);
    if (b && typeof b.online === "boolean") {
      out = { online: b.online, players: b.players ? Number(b.players.online) || 0 : 0, max: b.players ? Number(b.players.max) || 0 : 0 };
    }
  }
  res.statusCode = 200;
  res.end(JSON.stringify(out ? Object.assign({ ok: true }, out) : { ok: false }));
};
