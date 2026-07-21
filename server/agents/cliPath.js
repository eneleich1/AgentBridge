const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

let lastRefreshAt = 0;
const REFRESH_TTL_MS = 5000;

function uniquePathEntries(entries) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const value = String(entry || "").trim();
    if (!value) continue;
    const key = process.platform === "win32" ? value.toLowerCase() : value;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function readWindowsEnvPath(scope) {
  try {
    return execSync(
      `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','${scope}')"`,
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
      }
    ).trim();
  } catch {
    return "";
  }
}

function knownCliDirectories() {
  const dirs = [];
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const appData = process.env.APPDATA || "";
    if (localAppData) {
      dirs.push(path.join(localAppData, "cursor-agent"));
    }
    if (appData) {
      dirs.push(path.join(appData, "npm"));
    }
  }
  return dirs.filter((dir) => dir && fs.existsSync(dir));
}

function refreshProcessPath({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastRefreshAt < REFRESH_TTL_MS) {
    return process.env.PATH || "";
  }
  lastRefreshAt = now;

  const current = String(process.env.PATH || "").split(path.delimiter);
  let machine = [];
  let user = [];

  if (process.platform === "win32") {
    machine = readWindowsEnvPath("Machine").split(";");
    user = readWindowsEnvPath("User").split(";");
  }

  const merged = uniquePathEntries([
    ...knownCliDirectories(),
    ...machine,
    ...user,
    ...current,
  ]);

  process.env.PATH = merged.join(path.delimiter);
  return process.env.PATH;
}

function commandExistsOnPath(commandName, searchPath) {
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .map((item) => item.toLowerCase())
      : [""];

  const hasExtension = path.extname(commandName) !== "";
  const names = hasExtension
    ? [commandName]
    : extensions.map((ext) => `${commandName}${ext}`);

  for (const dir of String(searchPath || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function resolveCursorAgentCommand() {
  refreshProcessPath();

  const localAppData = process.env.LOCALAPPDATA || "";
  const directCandidates = [
    path.join(localAppData, "cursor-agent", "agent.cmd"),
    path.join(localAppData, "cursor-agent", "agent.exe"),
    path.join(localAppData, "cursor-agent", "cursor-agent.cmd"),
  ];

  for (const candidate of directCandidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  return (
    commandExistsOnPath("agent", process.env.PATH) ||
    commandExistsOnPath("cursor-agent", process.env.PATH) ||
    "agent"
  );
}

function resolveCodexCommand() {
  refreshProcessPath();
  return commandExistsOnPath("codex", process.env.PATH) ||
    commandExistsOnPath("codex.cmd", process.env.PATH) ||
    "codex";
}

function quoteForCmd(value) {
  const text = String(value || "");
  if (!text) return '""';
  if (!/[\s"]/g.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

module.exports = {
  refreshProcessPath,
  resolveCursorAgentCommand,
  resolveCodexCommand,
  quoteForCmd,
  knownCliDirectories,
};
