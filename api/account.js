// E-posta, güvenlik (2 adımlı doğrulama), şifremi unuttum
const { q, readSession, send, fail, limited } = require("../lib/common");
const A = require("../lib/authme");
const captcha = require("../lib/captcha");
const { issueCode, verifyCode, pendingEmail } = require("../lib/codes");

const ipOf = (req) => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.headers["x-real-ip"] || "0.0.0.0";
const MSG = {
  captcha: "İnsan doğrulaması başarısız", bad_email: "Geçerli bir e-posta yaz", email_taken: "Bu e-posta başka bir hesapta kullanılıyor",
  no_email: "Önce hesabına e-posta eklemelisin", has_email: "Hesabında zaten e-posta var", bad_code: "Kod hatalı", expired: "Kodun süresi doldu",
  attempts: "Çok fazla yanlış kod", wait: "Biraz bekleyip tekrar dene", rate: "Çok fazla deneme", mail_off: "E-posta sistemi henüz kurulmadı",
  mail_fail: "E-posta gönderilemedi", state: "Bu işlem şu an yapılamaz", bad_input: "Geçersiz istek", auth: "Önce giriş yapmalısın",
  bad_user_email: "Bu kullanıcı adı bu e-postaya ait değil", short_pw: "Şifre en az 8 karakter olmalı", mismatch: "Şifreler eşleşmiyor", generic: "Bir hata oluştu, tekrar dene",
};
const bad = (res, code, status) => fail(res, status || 400, code, MSG[code] || MSG.generic);
const codeFail = (res, e) => bad(res, e, e === "wait" || e === "rate" ? 429 : e === "mail_fail" || e === "mail_off" ? 503 : 400);

async function twofaOn(username) {
  const r = await q("SELECT twofa FROM yn_security WHERE username = $1", [username]);
  return !!(r.length && r[0].twofa);
}
async function setTwofa(username, on) {
  await q("INSERT INTO yn_security (username, twofa, updated_at) VALUES ($1, $2, $3) ON CONFLICT (username) DO UPDATE SET twofa = $2, updated_at = $3", [username, on, Date.now()]);
}
const lang = (b) => String(b.lang || "tr").slice(0, 8);

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") return bad(res, "bad_input", 405);
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const action = String(b.action || "");
    const ip = ipOf(req);
    if (limited("acc:" + ip, 40, 60000)) return bad(res, "rate", 429);

    if (action === "cap.new") return send(res, 200, Object.assign({ ok: true }, captcha.issue()));

    // ---------------- Herkese açık: giriş 2. adım ----------------
    if (action === "login2" || action === "login2.resend") {
      const t = await A.readToken(b.ticket, "login2");
      if (!t) return bad(res, "expired");
      const acc = await A.getAccount(t.u);
      if (!acc || !acc.email) return bad(res, "expired");
      if (action === "login2.resend") {
        const r = await issueCode({ owner: acc.username, purpose: "login2", email: acc.email, lang: lang(b) });
        return r.ok ? send(res, 200, { ok: true }) : codeFail(res, r.error);
      }
      const v = await verifyCode(acc.username, "login2", b.code);
      if (!v.ok) return codeFail(res, v.error);
      await A.setSession(res, { username: acc.username, realname: acc.realname });
      return send(res, 200, { ok: true });
    }

    // ---------------- Herkese açık: şifremi unuttum ----------------
    if (action === "forgot.start") {
      const email = A.cleanEmail(b.email);
      if (!email) return bad(res, "bad_email");
      if (!(await captcha.verify(b.cap, ip))) return bad(res, "captcha");
      const acc = await A.findByEmail(email);
      if (acc) await issueCode({ owner: "reset:" + email, purpose: "reset", email, lang: lang(b) }); // hata olsa da cevap aynı
      return send(res, 200, { ok: true });
    }
    if (action === "forgot.resend") {
      const email = A.cleanEmail(b.email);
      if (!email) return bad(res, "bad_email");
      const acc = await A.findByEmail(email);
      if (acc) await issueCode({ owner: "reset:" + email, purpose: "reset", email, lang: lang(b) });
      return send(res, 200, { ok: true });
    }
    if (action === "forgot.verify") {
      const email = A.cleanEmail(b.email);
      if (!email) return bad(res, "bad_email");
      const v = await verifyCode("reset:" + email, "reset", b.code);
      if (!v.ok) return codeFail(res, v.error);
      const token = await A.signToken({ k: "reset", em: email }, 10);
      return send(res, 200, { ok: true, token });
    }
    if (action === "forgot.finish") {
      const t = await A.readToken(b.token, "reset");
      if (!t) return bad(res, "expired");
      const password = String(b.password || "");
      if (password.length < 8) return bad(res, "short_pw");
      if (password.length > 128 || password !== String(b.password2 || "")) return bad(res, "mismatch");
      const username = String(b.username || "").trim();
      if (!A.USERNAME_RE.test(username)) return bad(res, "bad_user_email");
      const acc = await A.getAccount(username);
      if (!acc || acc.email !== t.em) return bad(res, "bad_user_email");
      const used = await q("INSERT INTO yn_used_caps (h, exp) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING h", ["reset:" + String(b.token).slice(-40), Date.now() + 20 * 60000]);
      if (!used.length) return bad(res, "expired");
      await A.changePassword(acc.username, password);
      return send(res, 200, { ok: true });
    }

    // ---------------- Giriş gerektirenler ----------------
    const s = await readSession(req);
    if (!s) return bad(res, "auth", 401);
    const acc = await A.getAccount(s.username);
    if (!acc) return bad(res, "auth", 401);
    const need = async () => captcha.verify(b.cap, ip);

    if (action === "email.start") {
      if (acc.email) return bad(res, "has_email");
      const email = A.cleanEmail(b.email);
      if (!email) return bad(res, "bad_email");
      if (!(await need())) return bad(res, "captcha");
      if (await A.emailInUse(email, acc.username)) return bad(res, "email_taken");
      const r = await issueCode({ owner: acc.username, purpose: "emailadd", email, lang: lang(b) });
      return r.ok ? send(res, 200, { ok: true, to: A.maskEmail(email) }) : codeFail(res, r.error);
    }
    if (action === "email.confirm") {
      if (acc.email) return bad(res, "has_email");
      const v = await verifyCode(acc.username, "emailadd", b.code);
      if (!v.ok) return codeFail(res, v.error);
      if (await A.emailInUse(v.email, acc.username)) return bad(res, "email_taken");
      await A.setEmail(acc.username, v.email);
      return send(res, 200, { ok: true });
    }

    if (action === "twofa.start" || action === "twofa.off.start") {
      const turningOn = action === "twofa.start";
      if (!acc.email) return bad(res, "no_email");
      if ((await twofaOn(acc.username)) === turningOn) return bad(res, "state");
      if (!(await need())) return bad(res, "captcha");
      const r = await issueCode({ owner: acc.username, purpose: turningOn ? "twofa_on" : "twofa_off", email: acc.email, lang: lang(b) });
      return r.ok ? send(res, 200, { ok: true, to: A.maskEmail(acc.email) }) : codeFail(res, r.error);
    }
    if (action === "twofa.confirm" || action === "twofa.off.confirm") {
      const turningOn = action === "twofa.confirm";
      const v = await verifyCode(acc.username, turningOn ? "twofa_on" : "twofa_off", b.code);
      if (!v.ok) return codeFail(res, v.error);
      await setTwofa(acc.username, turningOn);
      return send(res, 200, { ok: true });
    }

    if (action === "chg.start") {
      if (!acc.email) return bad(res, "no_email");
      if (!(await need())) return bad(res, "captcha");
      const r = await issueCode({ owner: acc.username, purpose: "chg_old", email: acc.email, lang: lang(b) });
      return r.ok ? send(res, 200, { ok: true, to: A.maskEmail(acc.email) }) : codeFail(res, r.error);
    }
    if (action === "chg.verifyold") {
      const v = await verifyCode(acc.username, "chg_old", b.code);
      if (!v.ok) return codeFail(res, v.error);
      return send(res, 200, { ok: true, stage: await A.signToken({ k: "chg", u: acc.username }, 15) });
    }
    if (action === "chg.new") {
      const st = await A.readToken(b.stage, "chg");
      if (!st || st.u !== acc.username) return bad(res, "expired");
      const email = A.cleanEmail(b.email);
      if (!email) return bad(res, "bad_email");
      if (await A.emailInUse(email, acc.username)) return bad(res, "email_taken");
      const r = await issueCode({ owner: acc.username, purpose: "chg_new", email, lang: lang(b) });
      return r.ok ? send(res, 200, { ok: true, to: A.maskEmail(email) }) : codeFail(res, r.error);
    }
    if (action === "chg.confirm") {
      const st = await A.readToken(b.stage, "chg");
      if (!st || st.u !== acc.username) return bad(res, "expired");
      const v = await verifyCode(acc.username, "chg_new", b.code);
      if (!v.ok) return codeFail(res, v.error);
      if (await A.emailInUse(v.email, acc.username)) return bad(res, "email_taken");
      await A.setEmail(acc.username, v.email);
      return send(res, 200, { ok: true });
    }

    if (action === "code.resend") {
      const map = { emailadd: "emailadd", twofa_on: "twofa_on", twofa_off: "twofa_off", chg_old: "chg_old", chg_new: "chg_new" };
      const purpose = map[String(b.flow)];
      if (!purpose) return bad(res, "bad_input");
      const email = await pendingEmail(acc.username, purpose);
      if (!email) return bad(res, "expired");
      const r = await issueCode({ owner: acc.username, purpose, email, lang: lang(b) });
      return r.ok ? send(res, 200, { ok: true }) : codeFail(res, r.error);
    }

    return bad(res, "bad_input");
  } catch (e) {
    console.error("[account]", e && e.message ? e.message : "hata");
    return bad(res, "generic", 500);
  }
};
