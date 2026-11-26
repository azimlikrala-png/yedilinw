const { q, readSession } = require("../lib/common");

// Özel depodaki dosyayı sadece talebin sahibine veya yetkililere gösterir.
module.exports = async (req, res) => {
  try {
    const s = await readSession(req);
    if (!s) return res.status(401).send("auth");
    const p = String((req.query && req.query.p) || "");
    if (!p || p.includes("..") || !/^[A-Za-z0-9_.\/-]+$/.test(p)) return res.status(400).send("bad");

    const rows = await q(
      "SELECT a.kind, t.owner FROM yn_attachments a JOIN yn_tickets t ON t.id = a.ticket_id WHERE a.pathname = $1",
      [p]
    );
    if (!rows.length || (rows[0].owner !== s.username && !s.staff)) return res.status(404).send("not found");

    const { get } = await import("@vercel/blob");
    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range; // Safari video için
    const r = await get(p, { access: "private", headers });
    if (!r || !r.stream) return res.status(404).send("not found");

    const up = r.headers;
    res.status(r.statusCode === 206 ? 206 : 200);
    res.setHeader("Content-Type", (r.blob && r.blob.contentType) || "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("Accept-Ranges", "bytes");
    for (const h of ["content-range", "content-length"]) {
      const v = up && up.get && up.get(h);
      if (v) res.setHeader(h, v);
    }
    const reader = r.stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) {
    console.error("[file]", e && e.message ? e.message : "hata");
    if (!res.headersSent) return res.status(500).send("error");
    res.end();
  }
};
