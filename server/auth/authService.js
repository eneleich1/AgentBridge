const crypto = require("crypto");
const db = require("./db");

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ENCRYPTION_SALT = "agentbridge-auth-salt";

const sessions = new Map(); // token -> expiresAt (ms epoch)

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || "").split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, salt, 64);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function getEncryptionKey() {
  const secret = process.env.AGENTBRIDGE_AUTH_SECRET;
  if (!secret) {
    throw new Error("AGENTBRIDGE_AUTH_SECRET is not set. Add it to your .env file.");
  }
  return crypto.scryptSync(secret, ENCRYPTION_SALT, 32);
}

function encryptSecret(plainText) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decryptSecret(encoded) {
  const key = getEncryptionKey();
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function base32Encode(buffer) {
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder) {
    const chunk = bits.slice(bits.length - remainder).padEnd(5, "0");
    output += BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return output;
}

function base32Decode(text) {
  const clean = String(text || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function totpUri(secret, username, issuer = "AgentBridge") {
  const label = encodeURIComponent(`${issuer}:${username}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

function hotpCode(secretBuffer, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function verifyTotpToken(secret, token, windowSteps = 1) {
  const clean = String(token || "").trim();
  if (!/^\d{6}$/.test(clean)) return false;
  const secretBuffer = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  for (let drift = -windowSteps; drift <= windowSteps; drift += 1) {
    if (hotpCode(secretBuffer, counter + drift) === clean) return true;
  }
  return false;
}

async function loadAccountRow() {
  const { rows } = await db.query("SELECT * FROM auth_account WHERE id = 1");
  return rows[0] || null;
}

async function isAccountConfigured() {
  return Boolean(await loadAccountRow());
}

async function setupAccount({ username, email = "", password }) {
  const totpSecret = generateTotpSecret();
  const encrypted = encryptSecret(totpSecret);
  const passwordHash = hashPassword(password);
  await db.query(
    `INSERT INTO auth_account (id, username, email, password_hash, totp_secret_encrypted, updated_at)
     VALUES (1, $1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       email = EXCLUDED.email,
       password_hash = EXCLUDED.password_hash,
       totp_secret_encrypted = EXCLUDED.totp_secret_encrypted,
       updated_at = now()`,
    [username, email, passwordHash, encrypted]
  );
  return { username, email, totpSecret, otpauthUrl: totpUri(totpSecret, username) };
}

async function getAccountInfo() {
  const row = await loadAccountRow();
  if (!row) return null;
  return { username: row.username, email: row.email || "" };
}

async function updateEmail(email) {
  const row = await loadAccountRow();
  if (!row) throw new Error("No account configured.");
  await db.query("UPDATE auth_account SET email = $1, updated_at = now() WHERE id = 1", [email]);
  return { username: row.username, email };
}

async function login({ username, password, totpToken }) {
  const row = await loadAccountRow();
  if (!row) {
    return { ok: false, error: "No account configured. Run: npm run setup:auth" };
  }
  if (username !== row.username || !verifyPassword(password, row.password_hash)) {
    return { ok: false, error: "Invalid username or password" };
  }
  const totpSecret = decryptSecret(row.totp_secret_encrypted);
  if (!verifyTotpToken(totpSecret, totpToken)) {
    return { ok: false, error: "Invalid authentication code" };
  }
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return { ok: true, token };
}

async function changePassword({ currentPassword, totpToken, newPassword }) {
  const row = await loadAccountRow();
  if (!row) return { ok: false, error: "No account configured." };
  if (!verifyPassword(currentPassword, row.password_hash)) {
    return { ok: false, error: "Current password is incorrect." };
  }
  const totpSecret = decryptSecret(row.totp_secret_encrypted);
  if (!verifyTotpToken(totpSecret, totpToken)) {
    return { ok: false, error: "Invalid authentication code." };
  }
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: "New password must be at least 8 characters." };
  }
  await db.query("UPDATE auth_account SET password_hash = $1, updated_at = now() WHERE id = 1", [
    hashPassword(newPassword),
  ]);
  return { ok: true };
}

function validateSession(token) {
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function revokeSession(token) {
  sessions.delete(token);
}

module.exports = {
  isAccountConfigured,
  setupAccount,
  getAccountInfo,
  updateEmail,
  changePassword,
  login,
  validateSession,
  revokeSession,
  generateTotpSecret,
  totpUri,
  verifyTotpToken,
  hashPassword,
  verifyPassword,
};
