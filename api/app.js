const { q, readSession, send, fail, limited, expireTickets, purgeOld, deleteTickets, notify, PURGE_AFTER } = require("../lib/common");

const CATS = ["account", "report", "bug", "ban", "suggest", "other"];
const ROLES = { rehber: 14, moderator: 15, asistan: 20 }; // soru sayıları
const DAY = 24 * 60 * 60 * 1000;
const MAX_FILES = 5;
const KINDS = { jpg: "image", jpeg: "image", png: "image", webp: "image", gif: "image", mp4: "video", webm: "video", mov: "video" };

const num = (v) => (v === null || v === undefined ? null : Number(v));
const text = (v, max) => String(v === undefined || v === null ? "" : v).trim().slice(0, max);

// İstemciden gelen dosya listesini doğrula: sadece kendi klasöründeki, güvenli adlı dosyalar
function cleanFiles(list, username) {
  if (!Array.isArray(list)) return [];
  const prefix = "tickets/" + username + "/";
  const out = [];
  for (const f of list.slice(0, MAX_FILES)) {
    const p = text(f && f.pathname, 300);
    if (!p.startsWith(prefix) || p.includes("..") || !/^[A-Za-z0-9_.\/-]+$/.test(p)) continue;
    const ext = p.split(".").pop().toLowerCase();
    if (!KINDS[ext]) continue;
    out.push({ p, k: KINDS[ext], n: text(f.name, 120), s: Math.max(0, Math.floor(Number(f.size) || 0)) });
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method !== "POST") return fail(res, 405, "bad_input", "Geçersiz istek");
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const action = String(b.action || "");

    // ---- Herkese açık: duyurular ----
    if (action === "bell") {
      const rows = await q("SELECT id, author_name, title, body, created_at FROM yn_announcements ORDER BY id DESC LIMIT 20");
      return send(res, 200, {
        ok: true,
        items: rows.map((r) => ({ id: num(r.id), author: r.author_name, title: r.title, body: r.body, at: num(r.created_at) })),
      });
    }

    const s = await readSession(req);
    if (!s) return fail(res, 401, "auth", "Önce giriş yapmalısın");

    // ---- Duyuru yönetimi (sadece yetkililer) ----
    if (action === "ann.create") {
      if (!s.staff) return fail(res, 403, "forbidden", "Yetkin yok");
      const title = text(b.title, 100);
      const body = text(b.body, 2000);
      if (!title || !body) return fail(res, 400, "bad_input", "Başlık ve metin gerekli");
      await q("INSERT INTO yn_announcements (author_name, title, body, created_at) VALUES ($1, $2, $3, $4)", [s.realname, title, body, Date.now()]);
      return send(res, 200, { ok: true });
    }
    if (action === "ann.delete") {
      if (!s.staff) return fail(res, 403, "forbidden", "Yetkin yok");
      const id = parseInt(b.id, 10);
      if (!id) return fail(res, 400, "bad_input", "Geçersiz istek");
      await q("DELETE FROM yn_announcements WHERE id = $1", [id]);
      return send(res, 200, { ok: true });
    }

    // ---- Kişisel bildirimler ----
    if (action === "notif.list") {
      await purgeOld();
      const rows = await q("SELECT id, kind, ref, created_at, is_read FROM yn_notifs WHERE owner = $1 ORDER BY id DESC LIMIT 30", [s.username]);
      return send(res, 200, { ok: true, items: rows.map((r) => ({ id: num(r.id), kind: r.kind, ref: num(r.ref), at: num(r.created_at), read: r.is_read })) });
    }
    if (action === "notif.read") {
      await q("UPDATE yn_notifs SET is_read = true WHERE owner = $1 AND is_read = false", [s.username]);
      return send(res, 200, { ok: true });
    }

    // ---- Destek talepleri ----
    if (action === "ticket.create") {
      const category = String(b.category || "");
      const description = text(b.description, 2000);
      if (!CATS.includes(category) || description.length < 5) return fail(res, 400, "bad_input", "Geçersiz istek");
      if (limited("tc:" + s.username, 5, 60 * 60 * 1000)) return fail(res, 429, "rate", "Çok fazla deneme");
      await expireTickets();
      const open = await q("SELECT count(*) AS n FROM yn_tickets WHERE owner = $1 AND status = 'open'", [s.username]);
      if (Number(open[0].n) >= 3) return fail(res, 409, "too_many_open", "En fazla 3 açık talebin olabilir");
      const files = cleanFiles(b.files, s.username);
      const now = Date.now();
      const rows = await q(
        "WITH t AS (INSERT INTO yn_tickets (owner, owner_name, category, created_at, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING id), " +
          "m AS (INSERT INTO yn_ticket_messages (ticket_id, author, author_name, is_staff, body, created_at) SELECT id, $1, $2, false, $6, $4 FROM t RETURNING id, ticket_id), " +
          "a AS (INSERT INTO yn_attachments (ticket_id, message_id, pathname, kind, name, size, created_at) SELECT m.ticket_id, m.id, x->>'p', x->>'k', x->>'n', (x->>'s')::bigint, $4 FROM m, jsonb_array_elements($7::jsonb) x) " +
          "SELECT ticket_id FROM m",
        [s.username, s.realname, category, now, now + DAY, description, JSON.stringify(files)]
      );
      return send(res, 200, { ok: true, id: num(rows[0].ticket_id) });
    }

    if (action === "ticket.list") {
      await expireTickets();
      const all = s.staff && b.scope === "all";
      const rows = await q(
        "SELECT id, owner_name, category, status, closed_reason, created_at, expires_at, closed_at FROM yn_tickets " +
          (all ? "" : "WHERE owner = $1 ") +
          "ORDER BY (status = 'open') DESC, id DESC LIMIT 100",
        all ? [] : [s.username]
      );
      return send(res, 200, {
        ok: true,
        items: rows.map((r) => ({
          id: num(r.id), owner: r.owner_name, category: r.category, status: r.status,
          reason: r.closed_reason, created: num(r.created_at), expires: num(r.expires_at), purge: r.closed_at ? num(r.closed_at) + PURGE_AFTER : null,
        })),
      });
    }

    if (action === "ticket.get") {
      const id = parseInt(b.id, 10);
      if (!id) return fail(res, 400, "bad_input", "Geçersiz istek");
      await expireTickets();
      const t = await q("SELECT id, owner, owner_name, category, status, closed_reason, created_at, expires_at, closed_at FROM yn_tickets WHERE id = $1", [id]);
      if (!t.length || (t[0].owner !== s.username && !s.staff)) return fail(res, 404, "not_found", "Bulunamadı");
      const msgs = await q("SELECT id, author_name, is_staff, body, created_at FROM yn_ticket_messages WHERE ticket_id = $1 ORDER BY id", [id]);
      const files = await q("SELECT message_id, pathname, kind, name, size FROM yn_attachments WHERE ticket_id = $1 ORDER BY id", [id]);
      return send(res, 200, {
        ok: true,
        ticket: {
          id: num(t[0].id), owner: t[0].owner_name, category: t[0].category, status: t[0].status,
          reason: t[0].closed_reason, created: num(t[0].created_at), expires: num(t[0].expires_at), purge: t[0].closed_at ? num(t[0].closed_at) + PURGE_AFTER : null,
          mine: t[0].owner === s.username,
        },
        messages: msgs.map((m) => ({
          id: num(m.id), author: m.author_name, staff: m.is_staff, body: m.body, at: num(m.created_at),
          files: files.filter((f) => num(f.message_id) === num(m.id)).map((f) => ({ path: f.pathname, kind: f.kind, name: f.name, size: num(f.size) })),
        })),
      });
    }

    if (action === "ticket.reply") {
      const id = parseInt(b.id, 10);
      const body = text(b.body, 2000);
      if (!id || body.length < 1) return fail(res, 400, "bad_input", "Geçersiz istek");
      if (limited("tr:" + s.username, 30, 60 * 60 * 1000)) return fail(res, 429, "rate", "Çok fazla deneme");
      await expireTickets();
      const t = await q("SELECT owner, status FROM yn_tickets WHERE id = $1", [id]);
      if (!t.length || (t[0].owner !== s.username && !s.staff)) return fail(res, 404, "not_found", "Bulunamadı");
      if (t[0].status !== "open") return fail(res, 409, "closed", "Bu talep kapalı");
      const files = cleanFiles(b.files, s.username);
      const rows = await q(
        "WITH m AS (INSERT INTO yn_ticket_messages (ticket_id, author, author_name, is_staff, body, created_at) " +
          "SELECT id, $2, $3, $4, $5, $6 FROM yn_tickets WHERE id = $1 AND status = 'open' RETURNING id, ticket_id), " +
          "a AS (INSERT INTO yn_attachments (ticket_id, message_id, pathname, kind, name, size, created_at) SELECT m.ticket_id, m.id, x->>'p', x->>'k', x->>'n', (x->>'s')::bigint, $6 FROM m, jsonb_array_elements($7::jsonb) x) " +
          "SELECT id FROM m",
        [id, s.username, s.realname, s.staff, body, Date.now(), JSON.stringify(files)]
      );
      if (!rows.length) return fail(res, 409, "closed", "Bu talep kapalı");
      if (s.staff && t[0].owner !== s.username) await notify(t[0].owner, "ticket_reply", id);
      return send(res, 200, { ok: true });
    }

    if (action === "ticket.delete") {
      const id = parseInt(b.id, 10);
      if (!id) return fail(res, 400, "bad_input", "Geçersiz istek");
      const t = await q("SELECT owner, status FROM yn_tickets WHERE id = $1", [id]);
      if (!t.length || (t[0].owner !== s.username && !s.staff)) return fail(res, 404, "not_found", "Bulunamadı");
      if (t[0].status !== "closed") return fail(res, 409, "state", "Önce talebi kapat");
      const ok = await deleteTickets([id]);
      return ok ? send(res, 200, { ok: true }) : fail(res, 500, "generic", "Silinemedi, tekrar dene");
    }

    if (action === "ticket.close") {
      const id = parseInt(b.id, 10);
      if (!id) return fail(res, 400, "bad_input", "Geçersiz istek");
      const rows = await q(
        "UPDATE yn_tickets SET status = 'closed', closed_reason = 'manual', closed_at = $2 WHERE id = $1 AND status = 'open' AND (owner = $3 OR $4::boolean) RETURNING id",
        [id, Date.now(), s.username, s.staff]
      );
      if (!rows.length) return fail(res, 404, "not_found", "Bulunamadı");
      return send(res, 200, { ok: true });
    }

    // ---- Yetkili başvuruları ----
    if (action === "app.submit") {
      const role = String(b.role || "");
      if (!ROLES[role] || !Array.isArray(b.answers) || b.answers.length !== ROLES[role]) return fail(res, 400, "bad_input", "Geçersiz istek");
      const answers = b.answers.map((a) => text(a, 1500));
      for (let i = 1; i < answers.length; i++) if (!answers[i]) return fail(res, 400, "bad_input", "Tüm zorunlu soruları yanıtla");
      if (limited("ap:" + s.username, 3, 24 * 60 * 60 * 1000)) return fail(res, 429, "rate", "Çok fazla deneme");
      await purgeOld();
      const now = Date.now();
      // aynı rol için 7 günde bir başvuru (başvuru silinse bile bu kayıt kalır; iptal edilirse kayıt kalkar)
      const gate = await q(
        "INSERT INTO yn_app_cooldown (owner, role, at) VALUES ($1, $2, $3) ON CONFLICT (owner, role) DO UPDATE SET at = $3 WHERE yn_app_cooldown.at < $4 RETURNING owner",
        [s.username, role, now, now - 7 * DAY]
      );
      if (!gate.length) return fail(res, 409, "already", "Bu rol için son 7 günde zaten başvurdun");
      const rows = await q("INSERT INTO yn_applications (owner, owner_name, role, answers, created_at) VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id", [
        s.username, s.realname, role, JSON.stringify({ lang: text(b.lang, 10), a: answers }), now,
      ]);
      return send(res, 200, { ok: true, id: num(rows[0].id) });
    }

    if (action === "app.mine") {
      await purgeOld();
      const rows = await q("SELECT id, role, status, created_at, decided_at FROM yn_applications WHERE owner = $1 ORDER BY id DESC LIMIT 20", [s.username]);
      return send(res, 200, { ok: true, items: rows.map((r) => ({ id: num(r.id), role: r.role, status: r.status, at: num(r.created_at), purge: r.decided_at ? num(r.decided_at) + PURGE_AFTER : null })) });
    }

    if (action === "app.list") {
      if (!s.staff) return fail(res, 403, "forbidden", "Yetkin yok");
      await purgeOld();
      const rows = await q("SELECT id, owner_name, role, status, created_at, decided_at FROM yn_applications ORDER BY (status = 'pending') DESC, id DESC LIMIT 200");
      return send(res, 200, { ok: true, items: rows.map((r) => ({ id: num(r.id), owner: r.owner_name, role: r.role, status: r.status, at: num(r.created_at), purge: r.decided_at ? num(r.decided_at) + PURGE_AFTER : null })) });
    }

    if (action === "app.get") {
      const id = parseInt(b.id, 10);
      if (!id) return fail(res, 400, "bad_input", "Geçersiz istek");
      await purgeOld();
      const rows = await q("SELECT id, owner, owner_name, role, answers, status, decided_by, created_at, decided_at FROM yn_applications WHERE id = $1", [id]);
      if (!rows.length || (rows[0].owner !== s.username && !s.staff)) return fail(res, 404, "not_found", "Bulunamadı");
      const msgs = await q("SELECT id, author_name, body, created_at FROM yn_app_messages WHERE app_id = $1 ORDER BY id", [id]);
      const a = rows[0].answers || {};
      return send(res, 200, {
        ok: true,
        item: {
          id: num(rows[0].id), owner: rows[0].owner_name, role: rows[0].role, status: rows[0].status, decidedBy: rows[0].decided_by,
          at: num(rows[0].created_at), purge: rows[0].decided_at ? num(rows[0].decided_at) + PURGE_AFTER : null,
          mine: rows[0].owner === s.username, lang: a.lang || "", answers: a.a || [],
          messages: msgs.map((m) => ({ id: num(m.id), author: m.author_name, body: m.body, at: num(m.created_at) })),
        },
      });
    }

    // Sadece yetkililer yanıt yazar; başvuru sahibi yanıt veremez
    if (action === "app.reply") {
      if (!s.staff) return fail(res, 403, "forbidden", "Yetkin yok");
      const id = parseInt(b.id, 10);
      const body = text(b.body, 2000);
      if (!id || !body) return fail(res, 400, "bad_input", "Geçersiz istek");
      const rows = await q(
        "INSERT INTO yn_app_messages (app_id, author, author_name, body, created_at) SELECT id, $2, $3, $4, $5 FROM yn_applications WHERE id = $1 AND status = 'pending' RETURNING app_id",
        [id, s.username, s.realname, body, Date.now()]
      );
      if (!rows.length) return fail(res, 409, "closed", "Bu başvuru sonuçlanmış");
      const o = await q("SELECT owner FROM yn_applications WHERE id = $1", [id]);
      if (o.length && o[0].owner !== s.username) await notify(o[0].owner, "app_reply", id);
      return send(res, 200, { ok: true });
    }

    if (action === "app.decide") {
      if (!s.staff) return fail(res, 403, "forbidden", "Yetkin yok");
      const id = parseInt(b.id, 10);
      const decision = String(b.decision || "");
      if (!id || !["accepted", "rejected"].includes(decision)) return fail(res, 400, "bad_input", "Geçersiz istek");
      const note = text(b.note, 2000);
      const rows = await q("UPDATE yn_applications SET status = $2, decided_by = $3, decided_at = $4 WHERE id = $1 AND status = 'pending' RETURNING owner", [id, decision, s.realname, Date.now()]);
      if (!rows.length) return fail(res, 409, "closed", "Bu başvuru zaten sonuçlanmış");
      if (note) await q("INSERT INTO yn_app_messages (app_id, author, author_name, body, created_at) VALUES ($1, $2, $3, $4, $5)", [id, s.username, s.realname, note, Date.now()]);
      if (rows[0].owner !== s.username) await notify(rows[0].owner, decision === "accepted" ? "app_accepted" : "app_rejected", id);
      return send(res, 200, { ok: true });
    }

    // Başvuru sahibi yanlışlıkla açtıysa iptal edebilir (sonuçlanmadan önce)
    if (action === "app.cancel") {
      const id = parseInt(b.id, 10);
      if (!id) return fail(res, 400, "bad_input", "Geçersiz istek");
      const rows = await q("UPDATE yn_applications SET status = 'cancelled', decided_by = $2, decided_at = $3 WHERE id = $1 AND owner = $4 AND status = 'pending' RETURNING role", [id, s.realname, Date.now(), s.username]);
      if (!rows.length) return fail(res, 404, "not_found", "Bulunamadı");
      await q("DELETE FROM yn_app_cooldown WHERE owner = $1 AND role = $2", [s.username, rows[0].role]);
      return send(res, 200, { ok: true });
    }

    return fail(res, 400, "bad_input", "Geçersiz istek");
  } catch (e) {
    console.error("[app]", e && e.message ? e.message : "bilinmeyen hata");
    return fail(res, 500, "generic", "Bir hata oluştu, tekrar dene");
  }
};
