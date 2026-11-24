import { NextResponse } from "next/server";
import { USERNAME_RE, registerUser, loginUser, changePassword } from "../../../lib/authme";
import { createSession, destroySession, getSession } from "../../../lib/session";

export const dynamic = "force-dynamic";

const fail = (message, status) => NextResponse.json({ ok: false, error: message }, { status });

// Basit deneme sınırı (sunucusuz ortamda tam garanti değildir)
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 5; // dakikada en fazla 5 deneme
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return fail("Geçersiz istek", 400);

    if (body.action === "logout") {
      await destroySession();
      return NextResponse.json({ ok: true });
    }

    const ip =
      (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      "0.0.0.0";
    if (tooMany(ip)) return fail("Çok fazla deneme yaptın, biraz bekle", 429);

    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (password.length > 128) return fail("Şifre çok uzun", 400);

    if (body.action === "changepw") {
      const session = await getSession();
      if (!session) return fail("Önce giriş yapmalısın", 401);
      if (password.length < 8) return fail("Yeni şifre en az 8 karakter olmalı", 400);
      if (password !== String(body.password2 || "")) return fail("Şifreler eşleşmiyor", 400);
      const current = String(body.current || "");
      const user = current.length <= 128 ? await loginUser(session.username, current) : null;
      if (!user) return fail("Mevcut şifre hatalı", 401);
      await changePassword(session.username, password);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "login") {
      if (!USERNAME_RE.test(username) || !password) {
        return fail("Kullanıcı adı veya şifre hatalı", 401);
      }
      const user = await loginUser(username, password);
      if (!user) return fail("Kullanıcı adı veya şifre hatalı", 401);
      await createSession(user);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "register") {
      if (!USERNAME_RE.test(username)) {
        return fail(
          "Kullanıcı adı 4-16 karakter olmalı; harf, rakam ve _ kullanılabilir (Bedrock için başta tek nokta)",
          400
        );
      }
      if (password.length < 8) return fail("Şifre en az 8 karakter olmalı", 400);
      if (password !== String(body.password2 || "")) return fail("Şifreler eşleşmiyor", 400);

      const result = await registerUser(username, password, ip);
      if (!result.ok) return fail("Bu kullanıcı adı alınmış", 409);
      await createSession(result.user);
      return NextResponse.json({ ok: true });
    }

    return fail("Geçersiz istek", 400);
  } catch (error) {
    console.error("[auth]", error && error.message ? error.message : "bilinmeyen hata");
    return fail("Bir hata oluştu, tekrar dene", 500);
  }
}
