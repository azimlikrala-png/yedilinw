// 6 haneli e-posta kodları (10 dk geçerli, en fazla 5 yanlış deneme, 60 sn'de bir yeniden gönderim)
const crypto = require("node:crypto");
const { q } = require("./common");
const { sendCode } = require("./mail");

const hashCode = (owner, purpose, code) => crypto.createHmac("sha256", process.env.SESSION_SECRET).update("code:" + owner + ":" + purpose + ":" + code).digest("hex");

// dönüş: { ok:true, email } | { error: "wait"|"rate"|"mail_off"|"mail_fail" }
async function issueCode(o) {
  const now = Date.now();
  const last = await q("SELECT created_at FROM yn_codes WHERE owner = $1 AND purpose = $2 ORDER BY id DESC LIMIT 1", [o.owner, o.purpose]);
  if (last.length && now - Number(last[0].created_at) < 60000) return { error: "wait" };
  const n = await q("SELECT count(*) AS n FROM yn_codes WHERE owner = $1 AND created_at > $2", [o.owner, now - 3600000]);
  if (Number(n[0].n) >= 10) return { error: "rate" };
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await q("DELETE FROM yn_codes WHERE owner = $1 AND purpose = $2 AND used = false", [o.owner, o.purpose]);
  const row = await q(
    "INSERT INTO yn_codes (owner, purpose, email, code_hash, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    [o.owner, o.purpose, o.email, hashCode(o.owner, o.purpose, code), now + 10 * 60000, now]
  );
  const sent = await sendCode(o.email, code, o.lang);
  if (sent !== true) {
    await q("DELETE FROM yn_codes WHERE id = $1", [row[0].id]);
    return { error: sent === "off" ? "mail_off" : "mail_fail" };
  }
  return { ok: true, email: o.email };
}

// dönüş: { ok:true, email } | { error: "bad_code"|"expired"|"attempts" }
async function verifyCode(owner, purpose, code) {
  const rows = await q("SELECT id, email, code_hash, expires_at, attempts FROM yn_codes WHERE owner = $1 AND purpose = $2 AND used = false ORDER BY id DESC LIMIT 1", [owner, purpose]);
  if (!rows.length || Number(rows[0].expires_at) < Date.now()) return { error: "expired" };
  const r = rows[0];
  if (Number(r.attempts) >= 5) return { error: "attempts" };
  const c = String(code || "").replace(/\s/g, "");
  const good = Buffer.from(r.code_hash), got = Buffer.from(hashCode(owner, purpose, c));
  if (!/^\d{6}$/.test(c) || good.length !== got.length || !crypto.timingSafeEqual(good, got)) {
    await q("UPDATE yn_codes SET attempts = attempts + 1 WHERE id = $1", [r.id]);
    return { error: "bad_code" };
  }
  const ok = await q("UPDATE yn_codes SET used = true WHERE id = $1 AND used = false RETURNING id", [r.id]);
  if (!ok.length) return { error: "expired" };
  return { ok: true, email: r.email };
}

// yeniden gönderim için son kullanılmamış kodun hedef e-postası
async function pendingEmail(owner, purpose) {
  const r = await q("SELECT email, expires_at FROM yn_codes WHERE owner = $1 AND purpose = $2 AND used = false ORDER BY id DESC LIMIT 1", [owner, purpose]);
  return r.length ? r[0].email : null;
}
module.exports = { issueCode, verifyCode, pendingEmail };
