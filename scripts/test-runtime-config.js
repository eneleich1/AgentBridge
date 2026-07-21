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
const {
  getAgentConfig,
  getMaxConcurrency,
  resetAgentConfig,
  updateAgentConfig,
} = require("../server/agents/agentFactory");
const { isAgentReady } = require("../server/services/setupService");

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

  const defaultCodex = getAgentConfig("codex");
  assert.equal(defaultCodex.settings.model, "gpt-5.6-sol");
  assert.equal(defaultCodex.settings.configured, false);
  assert.equal(getMaxConcurrency(), 2);

  const updatedCodex = updateAgentConfig("codex", { model: "gpt-5.4" });
  assert.equal(updatedCodex.settings.model, "gpt-5.4");
  assert.equal(updatedCodex.settings.configured, false);

  const configuredCodex = updateAgentConfig("codex", { configured: true });
  assert.equal(configuredCodex.settings.configured, true);
  assert.equal(configuredCodex.settings.model, "gpt-5.4");

  const resetCodex = resetAgentConfig("codex");
  assert.equal(resetCodex.settings.configured, false);
  assert.equal(resetCodex.settings.model, "gpt-5.6-sol");

  const defaultCursor = getAgentConfig("cursor");
  assert.equal(defaultCursor.settings.configured, false);

  const configuredCursor = updateAgentConfig("cursor", { configured: true });
  assert.equal(configuredCursor.settings.configured, true);

  const resetCursor = resetAgentConfig("cursor");
  assert.equal(resetCursor.settings.configured, false);

  assert.equal(isAgentReady("codex", {
    codex: { status: "ready", configured: false },
  }), false);
  assert.equal(isAgentReady("codex", {
    codex: { status: "ready", configured: true },
  }), true);
  assert.equal(isAgentReady("cursor", {
    cursor: { status: "ready", configured: false },
  }), false);
  assert.equal(isAgentReady("cursor", {
    cursor: { status: "ready", configured: true },
  }), true);

  console.log("runtimeConfig tests passed");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
