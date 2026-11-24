import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE = "yn_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 gün

function secretKey() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET eksik veya çok kısa");
  return new TextEncoder().encode(s);
}

export async function createSession(user) {
  const token = await new SignJWT({ u: user.username, n: user.realname })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function getSession() {
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secretKey());
    return { username: payload.u, realname: payload.n };
  } catch {
    return null;
  }
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}
