import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// 4-16 karakter: harf, rakam, _ ; Bedrock için yalnızca ilk karakter nokta olabilir (toplam en fazla 16)
export const USERNAME_RE = /^(\.[A-Za-z0-9_]{3,15}|[A-Za-z0-9_]{4,16})$/;

const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// AuthMe SHA256: $SHA$tuz$hash , hash = sha256( sha256(şifre) + tuz )
export function makeHash(password) {
  const salt = randomBytes(8).toString("hex"); // 16 hex karakter
  return "$SHA$" + salt + "$" + sha256hex(sha256hex(password) + salt);
}

export function checkPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$"); // ["", "SHA", tuz, hash]
  if (parts.length !== 4 || parts[1] !== "SHA") return false;
  const calc = Buffer.from(sha256hex(sha256hex(password) + parts[2]));
  const real = Buffer.from(parts[3]);
  return calc.length === real.length && timingSafeEqual(calc, real);
}

// ---------- Veritabanı ----------
let _sql = null;
async function getSql() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL tanımlı değil");
    const { neon } = await import("@neondatabase/serverless");
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

const q = (name) => '"' + String(name).replace(/"/g, '""') + '"';

let _cols = null;
// authme tablosunun gerçek sütunlarını information_schema.columns'tan okur
async function getColumns(sql) {
  if (_cols) return _cols;
  const rows = await sql.query(
    "SELECT column_name, data_type, is_nullable, column_default " +
      "FROM information_schema.columns " +
      "WHERE table_schema = current_schema() AND table_name = $1 " +
      "ORDER BY ordinal_position",
    ["authme"]
  );
  if (!rows.length) throw new Error("authme tablosu bulunamadı");
  _cols = rows;
  return rows;
}

function colName(cols, lower) {
  const c = cols.find((x) => x.column_name.toLowerCase() === lower);
  return c ? c.column_name : null;
}

export async function loginUser(username, password) {
  const sql = await getSql();
  const cols = await getColumns(sql);
  const uCol = colName(cols, "username");
  const pCol = colName(cols, "password");
  const rCol = colName(cols, "realname");
  if (!uCol || !pCol) throw new Error("authme tablosunda username/password sütunu yok");

  const rows = await sql.query(
    "SELECT " + q(pCol) + " AS pw" + (rCol ? ", " + q(rCol) + " AS rn" : "") +
      " FROM authme WHERE " + q(uCol) + " = $1 LIMIT 1",
    [username.toLowerCase()]
  );
  if (!rows.length) return null;
  if (!checkPassword(password, rows[0].pw)) return null;
  return { username: username.toLowerCase(), realname: rows[0].rn || username };
}

export async function changePassword(username, newPassword) {
  const sql = await getSql();
  const cols = await getColumns(sql);
  const uCol = colName(cols, "username");
  const pCol = colName(cols, "password");
  if (!uCol || !pCol) throw new Error("authme tablosunda username/password sütunu yok");
  await sql.query(
    "UPDATE authme SET " + q(pCol) + " = $1 WHERE " + q(uCol) + " = $2",
    [makeHash(newPassword), username.toLowerCase()]
  );
}

export async function registerUser(realname, password, ip) {
  const sql = await getSql();
  const cols = await getColumns(sql);
  const uCol = colName(cols, "username");
  if (!uCol) throw new Error("authme tablosunda username sütunu yok");
  const lower = realname.toLowerCase();

  const exists = await sql.query(
    "SELECT 1 FROM authme WHERE " + q(uCol) + " = $1 LIMIT 1",
    [lower]
  );
  if (exists.length) return { ok: false, reason: "taken" };

  const known = {
    username: lower,
    realname: realname,
    password: makeHash(password),
    ip: ip,
    regip: ip,
    regdate: Date.now(),
    lastlogin: null, // NOT NULL ise aşağıda 0 yapılır
    x: 0,
    y: 0,
    z: 0,
    world: "world",
    yaw: 0,
    pitch: 0,
    email: "your@email.com",
    islogged: 0,
    hassession: 0,
  };

  const names = [];
  const params = [];
  for (const c of cols) {
    const key = c.column_name.toLowerCase();
    const notNull = c.is_nullable === "NO";
    let value;
    if (key in known) {
      value = known[key];
      if (value === null && notNull) value = 0;
    } else if (notNull && c.column_default === null) {
      // Bilmediğimiz NOT NULL sütun: tipine göre boş değer ver
      const t = c.data_type;
      if (/int|numeric|double|real|decimal|serial/.test(t)) value = 0;
      else if (t === "boolean") value = false;
      else value = "";
    } else {
      continue; // varsayılanı olan veya boş bırakılabilen sütun
    }
    names.push(q(c.column_name));
    params.push(value);
  }

  const marks = params.map((_, i) => "$" + (i + 1)).join(", ");
  try {
    await sql.query(
      "INSERT INTO authme (" + names.join(", ") + ") VALUES (" + marks + ")",
      params
    );
  } catch (e) {
    if (e && e.code === "23505") return { ok: false, reason: "taken" };
    throw e;
  }
  return { ok: true, user: { username: lower, realname } };
}
