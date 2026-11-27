// E-posta gönderimi: Brevo (BREVO_API_KEY) veya Resend (RESEND_API_KEY). Gönderen adres: MAIL_FROM
async function post(url, headers, body) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 8000);
  try {
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: c.signal });
    if (!r.ok) console.error("[mail]", r.status);
    return r.ok;
  } catch (e) {
    console.error("[mail] hata");
    return false;
  } finally {
    clearTimeout(t);
  }
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// dönüş: true | false | "off" (e-posta sistemi kurulmamış)
async function sendCode(to, code, lang) {
  const from = process.env.MAIL_FROM, name = process.env.MAIL_NAME || "Yedili Network";
  const en = lang && lang !== "tr";
  const subject = (en ? "Your Yedili Network code: " : "Yedili Network doğrulama kodun: ") + code;
  const intro = en ? "Your verification code is:" : "Doğrulama kodun:";
  const warn = en ? "It is valid for 10 minutes. If you did not request it, ignore this email and never share the code." : "10 dakika geçerlidir. Sen istemediysen bu e-postayı yok say ve kodu kimseyle paylaşma.";
  const text = intro + " " + code + "\n\n" + warn;
  const html = '<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:20px;border:1px solid #cddcf5;border-radius:12px"><h2 style="color:#1f6fe0;margin:0 0 12px">Yedili Network</h2><p>' + esc(intro) + '</p><p style="font-size:34px;letter-spacing:8px;font-weight:800;margin:12px 0">' + esc(code) + "</p><p style=\"color:#586a8c;font-size:13px\">" + esc(warn) + "</p></div>";
  if (process.env.BREVO_API_KEY && from) {
    return post("https://api.brevo.com/v3/smtp/email", { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
      { sender: { name, email: from }, to: [{ email: to }], subject, textContent: text, htmlContent: html });
  }
  if (process.env.RESEND_API_KEY && from) {
    return post("https://api.resend.com/emails", { Authorization: "Bearer " + process.env.RESEND_API_KEY, "content-type": "application/json" },
      { from: name + " <" + from + ">", to: [to], subject, text, html });
  }
  return "off";
}
module.exports = { sendCode };
