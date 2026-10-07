const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Fastify = require("fastify");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentbridge-auth-"));
process.env.AGENTBRIDGE_DATA_DIR = temporaryRoot;
process.env.AGENTBRIDGE_AUTH_SECRET = "test-only-encryption-key";
let account;
const dbPath = require.resolve("../server/auth/db");
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  async query(sql, params) {
    if (sql.startsWith("INSERT")) {
      account = { username: params[0], email: params[1], password_hash: params[2], totp_secret_encrypted: params[3] };
    } else if (sql.startsWith("UPDATE auth_account SET password_hash")) {
      account.password_hash = params[0];
    }
    return { rows: account ? [account] : [] };
  },
} };
const auth = require("../server/auth/authService");
const { writeJsonConfig } = require("../server/utils/runtimeConfig");
const app = Fastify();
app.register(require("../server/routes/auth.routes"));

function currentCode(secret) {
  const bits = [...secret].map(char => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}

async function main() {
  assert.equal(auth.getAuthSettings().authenticationCodeEnabled, false);
  // Existing settings and accounts also default to code disabled.
  writeJsonConfig("auth-settings.json", { idleTimeoutMinutes: 960 });
  assert.deepEqual(auth.getAuthSettings(), { idleTimeoutMinutes: 960, authenticationCodeEnabled: false });
  const setup = await auth.setupAccount({ username: "tester", password: "test-password" });
  const encryptedSecret = account.totp_secret_encrypted;
  let response = await app.inject({ method: "GET", url: "/api/auth/status" });
  assert.equal(response.json().authenticationCodeEnabled, false);
  response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "tester", password: "wrong" } });
  assert.equal(response.statusCode, 401);
  response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "tester", password: "test-password" } });
  assert.equal(response.statusCode, 200);
  const token = response.json().token;
  assert.equal(auth.validateSession(token), true);
  assert.equal((await auth.changePassword({ currentPassword: "wrong", newPassword: "new-password" })).ok, false);
  response = await app.inject({ method: "POST", url: "/api/auth/change-password", payload: { currentPassword: "test-password", newPassword: "new-password" } });
  assert.equal(response.statusCode, 200);
  response = await app.inject({ method: "PUT", url: "/api/auth/settings", payload: { authenticationCodeEnabled: true } });
  assert.deepEqual(response.json(), { authenticationCodeEnabled: true, idleTimeoutMinutes: 960 });
  assert.equal(account.totp_secret_encrypted, encryptedSecret);
  assert.equal(auth.validateSession(token), true);
  auth.updateAuthSettings({ idleTimeoutMinutes: 60 });
  assert.equal(auth.getAuthSettings().authenticationCodeEnabled, true);
  for (const value of ["false", null, 1]) {
    response = await app.inject({ method: "PUT", url: "/api/auth/settings", payload: { authenticationCodeEnabled: value } });
    assert.equal(response.statusCode, 400);
  }
  for (const totpToken of [undefined, "invalid"]) {
    response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "tester", password: "new-password", totpToken } });
    assert.equal(response.statusCode, 401);
    assert.equal((await auth.changePassword({ currentPassword: "new-password", newPassword: "another-password", totpToken })).ok, false);
  }
  response = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "tester", password: "new-password", totpToken: currentCode(setup.totpSecret) } });
  assert.equal(response.statusCode, 200);
  assert.equal((await auth.changePassword({ currentPassword: "new-password", newPassword: "another-password", totpToken: currentCode(setup.totpSecret) })).ok, true);
  auth.updateAuthSettings({ authenticationCodeEnabled: false });
  assert.equal((await auth.login({ username: "tester", password: "another-password" })).ok, true);
  assert.equal(account.totp_secret_encrypted, encryptedSecret);
  auth.revokeSession(token);
  assert.equal(auth.validateSession(token), false);
  console.log("auth tests passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await app.close();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});
