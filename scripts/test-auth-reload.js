const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

async function main() {
  const { resolveAuthStatus } = await import(pathToFileURL(path.join(__dirname, "../web/src/services/authStatus.js")));
  let token = "saved-token";
  const api = {
    getAuthStatus: async () => ({ configured: true }),
    getToken: () => token,
    setToken: value => { token = value; },
    checkSession: async () => ({ ok: true }),
  };
  assert.equal(await resolveAuthStatus(api), "app");
  assert.equal(await resolveAuthStatus(api), "app");
  for (const error of [new TypeError("Failed to fetch"), Object.assign(new Error("Unavailable"), { status: 503 })]) {
    api.checkSession = async () => { throw error; };
    await assert.rejects(resolveAuthStatus(api), candidate => candidate === error);
    assert.equal(token, "saved-token");
  }
  api.checkSession = async () => { throw Object.assign(new Error("Unauthorized"), { status: 401 }); };
  assert.equal(await resolveAuthStatus(api), "login");
  assert.equal(token, "");
  api.checkSession = async () => { throw new Error("Must not check a missing token"); };
  assert.equal(await resolveAuthStatus(api), "login");
  api.getAuthStatus = async () => ({ configured: false });
  assert.equal(await resolveAuthStatus(api), "app");
  console.log("auth reload tests passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
