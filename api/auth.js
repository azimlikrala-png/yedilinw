const A = require("../lib/authme");
const captcha = require("../lib/captcha");
const { issueCode } = require("../lib/codes");
const { q: dbq, readSession, STAFF } = require("../lib/common");
const USERNAME_RE = A.USERNAME_RE;
const send = (res, status, obj) => res.status(status).json(obj);
const fail = (res, status, msg, code) => send(res, status, { ok: false, code: code || "generic", error: msg });

// ---------- Deneme sınırı: dakikada en fazla 8 ----------
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 8;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") return fail(res, 405, "Geçersiz istek", "bad_input");
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const action = body.action;

    if (action === "me") {
      const s = await readSession(req);
      if (!s) return send(res, 200, { ok: true, user: null });
      const acc = await A.getAccount(s.username);
      if (!acc) return send(res, 200, { ok: true, user: null });
      const sec = await dbq("SELECT twofa FROM yn_security WHERE username = $1", [acc.username]);
      return send(res, 200, {
        ok: true,
        user: { realname: s.realname, staff: STAFF.includes(String(s.username).toLowerCase()), email: acc.email ? A.maskEmail(acc.email) : null, twofa: !!(sec.length && sec[0].twofa) },
      });
    }
    if (action === "logout") {
      A.clearSession(res);
      return send(res, 200, { ok: true });
    }

    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.headers["x-real-ip"] || "0.0.0.0";
    if (tooMany(ip)) return fail(res, 429, "Çok fazla deneme yaptın, biraz bekle", "rate");

    const identifier = String(body.username || "").trim();
    const password = String(body.password || "");
    if (password.length > 128) return fail(res, 400, "Şifre çok uzun", "bad_input");

    if (action === "changepw") {
      const s = await readSession(req);
      if (!s) return fail(res, 401, "Önce giriş yapmalısın", "auth");
      if (password.length < 8) return fail(res, 400, "Yeni şifre en az 8 karakter olmalı", "short_pw");
      if (password !== String(body.password2 || "")) return fail(res, 400, "Şifreler eşleşmiyor", "mismatch");
      const cur = String(body.current || "");
      const u = cur.length <= 128 ? await A.loginByIdentifier(s.username, cur) : null;
      if (!u) return fail(res, 401, "Mevcut şifre hatalı", "bad_current");
      await A.changePassword(s.username, password);
      return send(res, 200, { ok: true });
    }

    if (action === "login") {
      if (!identifier || identifier.length > 100 || !password) return fail(res, 401, "Kullanıcı adı veya şifre hatalı", "bad_creds");
      if (!(await captcha.verify(body.cap, ip))) return fail(res, 400, "İnsan doğrulaması başarısız", "captcha");
      if (!identifier.includes("@") && !USERNAME_RE.test(identifier)) return fail(res, 401, "Kullanıcı adı veya şifre hatalı", "bad_creds");
      const u = await A.loginByIdentifier(identifier, password);
      if (!u) return fail(res, 401, "Kullanıcı adı veya şifre hatalı", "bad_creds");
      const acc = await A.getAccount(u.username);
      const sec = await dbq("SELECT twofa FROM yn_security WHERE username = $1", [u.username]);
      if (acc && acc.email && sec.length && sec[0].twofa) {
        const r = await issueCode({ owner: u.username, purpose: "login2", email: acc.email, lang: String(body.lang || "tr").slice(0, 8) });
        if (!r.ok && r.error !== "wait") return fail(res, r.error === "rate" ? 429 : 503, "Kod gönderilemedi", r.error === "rate" ? "rate" : "mail_fail");
        const ticket = await A.signToken({ k: "login2", u: u.username }, 10);
        return send(res, 200, { ok: true, need2fa: true, ticket, to: A.maskEmail(acc.email) });
      }
      await A.setSession(res, u);
      return send(res, 200, { ok: true });
    }

    if (action === "register") {
      if (!USERNAME_RE.test(identifier))
        return fail(res, 400, "Kullanıcı adı 4-16 karakter olmalı; harf, rakam ve _ kullanılabilir (Bedrock için başta tek nokta)", "bad_user");
      const email = A.cleanEmail(body.email);
      if (!email) return fail(res, 400, "Geçerli bir e-posta yaz", "bad_email");
      if (password.length < 8) return fail(res, 400, "Şifre en az 8 karakter olmalı", "short_pw");
      if (password !== String(body.password2 || "")) return fail(res, 400, "Şifreler eşleşmiyor", "mismatch");
      if (!(await captcha.verify(body.cap, ip))) return fail(res, 400, "İnsan doğrulaması başarısız", "captcha");
      if (await A.emailInUse(email, "")) return fail(res, 409, "Bu e-posta başka bir hesapta kullanılıyor", "email_taken");
      const r = await A.registerUser(identifier, password, ip, email);
      if (!r.ok) return fail(res, 409, "Bu kullanıcı adı alınmış", "taken");
      await A.setSession(res, r.user);
      return send(res, 200, { ok: true });
    }

    return fail(res, 400, "Geçersiz istek", "bad_input");
  } catch (e) {
    console.error("[auth]", e && e.message ? e.message : "bilinmeyen hata");
    return fail(res, 500, "Bir hata oluştu, tekrar dene", "generic");
  }
};
