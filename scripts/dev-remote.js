const path = require("node:path");
const readline = require("node:readline");
const { spawn, spawnSync } = require("node:child_process");

const { killProcessTree } = require("../server/agents/runProcess");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 3847;
const HOST = process.env.HOST || "127.0.0.1";

const children = new Set();
let shuttingDown = false;

function pipeWithPrefix(stream, label, target) {
  readline.createInterface({ input: stream }).on("line", (line) => {
    target.write(`${label} ${line}\n`);
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  if (children.size === 0) process.exit(exitCode);
  for (const child of children) killProcessTree(child, spawn);
}

function buildWeb() {
  console.log("[dev-remote] Building frontend...");
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:web"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) {
    throw new Error(`Frontend build failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Frontend build failed (exit code ${result.status}).`);
  }
}

function startServer() {
  const child = spawn(process.execPath, ["--env-file-if-exists=.env", path.join("server", "index.js")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST, FORCE_COLOR: "1" },
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: true,
  });
  children.add(child);
  pipeWithPrefix(child.stdout, "[server]", process.stdout);
  pipeWithPrefix(child.stderr, "[server]", process.stderr);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(`[server] exited (${signal || `code ${code}`}); stopping the rest.`);
      shutdown(code || 1);
    } else if (children.size === 0) {
      process.exit(process.exitCode || 0);
    }
  });
  return child;
}

function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://${HOST}:${PORT}/health`;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const response = await fetch(url);
        if (response.ok) return resolve();
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) return reject(new Error("Server did not become healthy in time."));
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

function startTunnel() {
  const child = spawn("cloudflared", ["tunnel", "--url", `http://${HOST}:${PORT}`], {
    cwd: ROOT,
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: true,
  });
  children.add(child);

  let urlPrinted = false;
  const urlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

  function watchForUrl(line) {
    if (urlPrinted) return;
    const match = line.match(urlPattern);
    if (match) {
      urlPrinted = true;
      console.log("\n[dev-remote] ============================================");
      console.log(`[dev-remote] Public URL: ${match[0]}`);
      console.log("[dev-remote] ============================================\n");
    }
  }

  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    process.stdout.write(`[tunnel] ${line}\n`);
    watchForUrl(line);
  });
  readline.createInterface({ input: child.stderr }).on("line", (line) => {
    process.stderr.write(`[tunnel] ${line}\n`);
    watchForUrl(line);
  });

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(`[tunnel] exited (${signal || `code ${code}`}); stopping the rest.`);
      shutdown(code || 1);
    } else if (children.size === 0) {
      process.exit(process.exitCode || 0);
    }
  });
  return child;
}

async function main() {
  buildWeb();
  startServer();
  await waitForServer();
  console.log(`[dev-remote] Server up at http://${HOST}:${PORT}`);
  startTunnel();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

main().catch((error) => {
  console.error(`[dev-remote] ${error.message}`);
  shutdown(1);
});
