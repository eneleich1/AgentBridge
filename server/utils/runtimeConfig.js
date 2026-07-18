const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.AGENTBRIDGE_DATA_DIR
  ? path.resolve(process.env.AGENTBRIDGE_DATA_DIR)
  : path.join(__dirname, "../../data");
const CONFIG_DIR = path.join(DATA_DIR, "config");

function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function configPath(fileName) {
  ensureConfigDir();
  return path.join(CONFIG_DIR, fileName);
}

function readJsonConfig(fileName, defaultValue) {
  const filePath = configPath(fileName);
  if (!fs.existsSync(filePath)) {
    writeJsonConfig(fileName, defaultValue);
    return structuredClone(defaultValue);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function writeJsonConfig(fileName, value) {
  const filePath = configPath(fileName);
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
}

module.exports = {
  DATA_DIR,
  CONFIG_DIR,
  configPath,
  readJsonConfig,
  writeJsonConfig,
};
