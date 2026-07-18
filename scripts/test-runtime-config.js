const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentbridge-config-"));
process.env.AGENTBRIDGE_DATA_DIR = temporaryRoot;

const {
  CONFIG_DIR,
  readJsonConfig,
  writeJsonConfig,
} = require("../server/utils/runtimeConfig");

try {
  const defaults = {
    projects: [],
  };

  const initialized = readJsonConfig("projects.json", defaults);
  assert.deepEqual(initialized, defaults);
  assert.notEqual(initialized, defaults);
  assert.equal(fs.existsSync(path.join(CONFIG_DIR, "projects.json")), true);

  initialized.projects.push({ id: "example", path: "example" });
  writeJsonConfig("projects.json", initialized);

  const reloaded = readJsonConfig("projects.json", defaults);
  assert.deepEqual(reloaded, initialized);
  assert.equal(fs.existsSync(path.join(CONFIG_DIR, "projects.json.tmp")), false);

  console.log("runtimeConfig tests passed");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
