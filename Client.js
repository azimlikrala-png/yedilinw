"use client";

import { useState } from "react";

export function AuthForms() {
  const [tab, setTab] = useState("login");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setMsg("");
    const f = new FormData(e.currentTarget);
    const body = {
      action: tab,
      username: f.get("username"),
      password: f.get("password"),
      password2: f.get("password2"),
    };
    setBusy(true);
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        window.location.reload();
        return;
      }
      setMsg(d.error || "Bir hata oluştu, tekrar dene");
    } catch {
      setMsg("Bir hata oluştu, tekrar dene");
    }
    setBusy(false);
  }

  function pick(t) {
    setTab(t);
    setMsg("");
  }

  return (
    <div className="authcard">
      <img className="logo" src="/logo.jpg" alt="Yedili Network" />
      <h1>YEDİLİ NETWORK</h1>
      <div className="tabs">
        <button type="button" className={tab === "login" ? "on" : ""} onClick={() => pick("login")}>
          Giriş Yap
        </button>
        <button type="button" className={tab === "register" ? "on" : ""} onClick={() => pick("register")}>
          Kayıt Ol
        </button>
      </div>

      <form key={tab} onSubmit={submit}>
        <label htmlFor="username">Kullanıcı adı</label>
        <input
          id="username"
          name="username"
          required
          maxLength={16}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        {tab === "register" && (
          <div className="hint">4-16 karakter; harf, rakam ve _ . Bedrock oyuncuları başa tek nokta (.) koyabilir.</div>
        )}

        <label htmlFor="password">Şifre</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={tab === "register" ? 8 : undefined}
          autoComplete={tab === "register" ? "new-password" : "current-password"}
        />

        {tab === "register" && (
          <>
            <label htmlFor="password2">Şifre tekrar</label>
            <input id="password2" name="password2" type="password" required minLength={8} autoComplete="new-password" />
            <div className="hint">Şifre en az 8 karakter olmalı. Oyundaki /login şifren de bu olacak.</div>
          </>
        )}

        {msg && <div className="msg">{msg}</div>}
        <button type="submit" disabled={busy}>
          {busy ? "Bekle..." : tab === "login" ? "Giriş Yap" : "Kayıt Ol"}
        </button>
      </form>
    </div>
  );
}

export function LogoutButton() {
  async function out() {
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
    } catch {}
    window.location.href = "/";
  }
  return (
    <button type="button" onClick={out}>
      Çıkış
    </button>
  );
}

export function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  }
  return (
    <button type="button" onClick={copy}>
      {done ? "Kopyalandı!" : "Adresi Kopyala"}
    </button>
  );
}
