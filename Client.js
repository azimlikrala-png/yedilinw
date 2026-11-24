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

export function UserMenu({ name }) {
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function logout() {
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
    } catch {}
    window.location.href = "/";
  }

  async function changePw(e) {
    e.preventDefault();
    setMsg("");
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "changepw",
          current: f.get("current"),
          password: f.get("password"),
          password2: f.get("password2"),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) {
        setDone(true);
      } else {
        setMsg(d.error || "Bir hata oluştu, tekrar dene");
      }
    } catch {
      setMsg("Bir hata oluştu, tekrar dene");
    }
    setBusy(false);
  }

  function closePw() {
    setPwOpen(false);
    setMsg("");
    setDone(false);
  }

  return (
    <div className="umenu">
      <button type="button" className="avatarbtn" onClick={() => setOpen(!open)} aria-label="Hesap menüsü">
        {broken ? (
          <span>{name.replace(/^\./, "").charAt(0).toUpperCase()}</span>
        ) : (
          <img
            src={"https://mc-heads.net/avatar/" + encodeURIComponent(name) + "/64"}
            alt={name}
            width="40"
            height="40"
            onError={() => setBroken(true)}
          />
        )}
      </button>

      {open && (
        <>
          <div className="overlay" onClick={() => setOpen(false)} />
          <div className="dropdown">
            <div className="dname">{name}</div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setPwOpen(true);
              }}
            >
              Şifre Değiştir
            </button>
            <button type="button" onClick={logout}>
              Çıkış Yap
            </button>
          </div>
        </>
      )}

      {pwOpen && (
        <div className="modal" onClick={closePw}>
          <div className="authcard" onClick={(e) => e.stopPropagation()}>
            <h1 style={{ fontSize: "1.3rem" }}>Şifre Değiştir</h1>
            {done ? (
              <>
                <p className="lead" style={{ marginTop: 16 }}>
                  Şifren değiştirildi. Oyunda yeni şifrenle giriş yapabilirsin.
                </p>
                <button type="button" onClick={closePw}>
                  Tamam
                </button>
              </>
            ) : (
              <form onSubmit={changePw}>
                <label htmlFor="current">Mevcut şifre</label>
                <input id="current" name="current" type="password" required autoComplete="current-password" />
                <label htmlFor="npw">Yeni şifre</label>
                <input id="npw" name="password" type="password" required minLength={8} autoComplete="new-password" />
                <label htmlFor="npw2">Yeni şifre tekrar</label>
                <input id="npw2" name="password2" type="password" required minLength={8} autoComplete="new-password" />
                <div className="hint">Yeni şifre en az 8 karakter olmalı.</div>
                {msg && <div className="msg">{msg}</div>}
                <button type="submit" disabled={busy}>
                  {busy ? "Bekle..." : "Şifreyi Güncelle"}
                </button>
                <button type="button" className="ghost" onClick={closePw}>
                  Vazgeç
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
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
