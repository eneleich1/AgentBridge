const fs = require("node:fs");
const path = require("node:path");

// Never pass user-controlled arguments through cmd.exe (including npm shims).
function safeLaunch(command, args = [], platform = process.platform) {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) return { command, args };
  const root = path.dirname(command);
  if (/^(agent|cursor-agent)\.cmd$/i.test(path.basename(command))) {
    const versions = path.join(root, "versions");
    if (fs.existsSync(versions)) {
      const candidates = fs.readdirSync(versions).filter(name => /^\d{4}\.\d{2}\.\d{2}(?:-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/i.test(name)).sort().reverse();
      for (const version of candidates) {
        const dir = path.join(versions, version);
        if (fs.existsSync(path.join(dir, "node.exe")) && fs.existsSync(path.join(dir, "index.js"))) {
          return { command: path.join(dir, "node.exe"), args: [path.join(dir, "index.js"), ...args] };
        }
      }
    }
  }
  if (/^codex\.cmd$/i.test(path.basename(command))) {
    const entry = path.join(root, "node_modules", "@openai", "codex", "bin", "codex.js");
    if (fs.existsSync(entry)) return { command: process.execPath, args: [entry, ...args] };
  }
  throw new Error("Unsafe batch launcher. Configure a native executable locally instead of a .cmd/.bat file.");
}

module.exports = { safeLaunch };
