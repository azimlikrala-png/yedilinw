// İnsan doğrulaması: Cloudflare Turnstile anahtarları varsa o, yoksa anahtarsız "iş ispatı" (proof-of-work)
const crypto = require("node:crypto");
const { q } = require("./common");
const BITS = 17;

const turnstileOn = () => !!(process.env.TURNSTILE_SECRET && process.env.TURNSTILE_SITEKEY);
const sign = (s) => crypto.createHmac("sha256", process.env.SESSION_SECRET).update("cap:" + s).digest("base64url");

function issue() {
  if (turnstileOn()) return { mode: "turnstile", sitekey: process.env.TURNSTILE_SITEKEY };
  const p = Buffer.from(JSON.stringify({ t: Date.now(), r: crypto.randomBytes(8).toString("hex") })).toString("base64url");
  return { mode: "pow", token: p + "." + sign(p), bits: BITS };
}

function zeroBits(buf) {
  let n = 0;
  for (const b of buf) {
    if (b === 0) { n += 8; continue; }
    n += Math.clz32(b) - 24;
    break;
  }
  return n;
}

async function verify(cap, ip) {
  try {
    if (!cap || typeof cap !== "object") return false;
    if (turnstileOn()) {
      const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET, response: String(cap.ts || ""), remoteip: String(ip || "") }),
      });
      const d = await r.json();
      return !!d.success;
    }
    const token = String(cap.token || ""), nonce = String(cap.nonce || "");
    const i = token.lastIndexOf(".");
    if (i < 1 || !/^[0-9a-z]{1,16}$/.test(nonce)) return false;
    const p = token.slice(0, i), sig = token.slice(i + 1);
    const good = Buffer.from(sign(p)), got = Buffer.from(sig);
    if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return false;
    const info = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    const age = Date.now() - Number(info.t);
    if (!(age >= 0 && age < 10 * 60 * 1000)) return false;
    if (zeroBits(crypto.createHash("sha256").update(token + ":" + nonce).digest()) < BITS) return false;
    // aynı doğrulama bir kez kullanılabilir
    const h = crypto.createHash("sha256").update(token).digest("hex");
    const ins = await q("INSERT INTO yn_used_caps (h, exp) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING h", [h, Date.now() + 15 * 60 * 1000]);
    if (Math.random() < 0.05) q("DELETE FROM yn_used_caps WHERE exp < $1", [Date.now()]).catch(() => {});
    return ins.length === 1;
  } catch (e) {
    return false;
  }
}
module.exports = { issue, verify, BITS };
