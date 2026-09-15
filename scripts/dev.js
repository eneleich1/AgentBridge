const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const { killProcessTree } = require("../server/agents/runProcess");

const ROOT = path.join(__dirname, "..");
const WEB_DIR = path.join(ROOT, "web");
const VITE_BIN = path.join(WEB_DIR, "node_modules", "vite", "bin", "vite.js");
const SERVER_ENTRY = path.join("server", "index.js");
const SERVER_DIR = path.join(ROOT, "server");
const SERVER_RESTART_DEBOUNCE_MS = 200;
// Windows doesn't always release a killed process's listening socket
// instantly; give the OS a moment before the replacement process binds.
const SERVER_RESPAWN_DELAY_MS = 400;
const SERVER_PORT = Number(process.env.PORT) || 3847;
const SERVER_HOST = process.env.HOST || "127.0.0.1";
const PREFERRED_WEB_PORT = Number(process.env.AGENTBRIDGE_WEB_PORT) || 5173;
const WEB_PORT_ATTEMPTS = 200;

// Windows can reserve whole port ranges (Hyper-V, WSL, Docker), which makes
// Vite fail with EACCES instead of EADDRINUSE, so probe before starting it.
function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "localhost" }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findWebPort() {
  if (process.env.AGENTBRIDGE_WEB_PORT) return PREFERRED_WEB_PORT;

  for (let offset = 0; offset < WEB_PORT_ATTEMPTS; offset += 1) {
    const port = PREFERRED_WEB_PORT + offset;
    if (await canListen(port)) return port;
  }
  throw new Error(
    `No free port found between ${PREFERRED_WEB_PORT} and ${PREFERRED_WEB_PORT + WEB_PORT_ATTEMPTS - 1}. ` +
      "Set AGENTBRIDGE_WEB_PORT to choose one.",
  );
}

function getBackendOrigin() {
  const host = ["0.0.0.0", "::"].includes(SERVER_HOST)
    ? "127.0.0.1"
    : SERVER_HOST.includes(":")
      ? `[${SERVER_HOST}]`
      : SERVER_HOST;
  return `http://${host}:${SERVER_PORT}`;
}

function webEnvDefinesApiOrigin() {
  return [".env", ".env.local", ".env.development", ".env.development.local"].some((name) => {
    try {
      return /^\s*VITE_AGENTBRIDGE_API_ORIGIN\s*=/m.test(
        fs.readFileSync(path.join(WEB_DIR, name), "utf8"),
      );
    } catch {
      return false;
    }
  });
}

const children = new Set();
let shuttingDown = false;

function pipeWithPrefix(stream, label, target) {
  readline.createInterface({ input: stream }).on("line", (line) => {
    target.write(`${label} ${line}\n`);
  });
}

function start(label, args, options) {
  const child = spawn(process.execPath, args, {
    ...options,
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: true,
  });
  children.add(child);
  pipeWithPrefix(child.stdout, label, process.stdout);
  pipeWithPrefix(child.stderr, label, process.stderr);

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(`${label} exited (${signal || `code ${code}`}); stopping the rest.`);
      shutdown(code || 1);
    } else if (children.size === 0) {
      process.exit(process.exitCode || 0);
    }
  });
  return child;
}

// node --watch restarts by tearing down and recreating the Environment/Isolate
// inside the same OS process. better-sqlite3's native cleanup hooks don't
// survive that and crash the process ("Assertion failed: (env) != nullptr").
// So the server gets its own watcher here that respawns a fresh OS process
// instead, the same way nodemon does.
function watchServerFiles(onChange) {
  let debounceTimer = null;
  const notify = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(onChange, SERVER_RESTART_DEBOUNCE_MS);
  };

  try {
    fs.watch(SERVER_DIR, { recursive: true }, (_eventType, filename) => {
      if (filename) notify();
    });
    return;
  } catch (error) {
    if (error.code !== "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM") throw error;
  }

  // Recursive fs.watch isn't available on this platform (e.g. Linux); watch
  // each directory individually and pick up new subdirectories as they appear.
  const watched = new Set();
  function watchDir(dir) {
    if (watched.has(dir)) return;
    watched.add(dir);
    fs.watch(dir, (_eventType, filename) => {
      notify();
      if (!filename) return;
      const full = path.join(dir, filename);
      fs.stat(full, (err, stat) => {
        if (!err && stat.isDirectory()) watchDir(full);
      });
    });
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) watchDir(path.join(dir, entry.name));
    }
  }
  watchDir(SERVER_DIR);
}

function startServerWithWatch(env) {
  let child = null;
  let restarting = false;
  let restartQueued = false;

  function spawnServer() {
    child = spawn(process.execPath, ["--env-file-if-exists=.env", SERVER_ENTRY], {
      cwd: ROOT,
      env,
      stdio: ["inherit", "pipe", "pipe"],
      windowsHide: true,
    });
    children.add(child);
    pipeWithPrefix(child.stdout, "[server]", process.stdout);
    pipeWithPrefix(child.stderr, "[server]", process.stderr);

    child.on("exit", (code, signal) => {
      children.delete(child);
      if (restarting) {
        setTimeout(() => {
          restarting = false;
          spawnServer();
          if (restartQueued) {
            restartQueued = false;
            restart();
          }
        }, SERVER_RESPAWN_DELAY_MS);
        return;
      }
      if (!shuttingDown) {
        console.error(`[server] exited (${signal || `code ${code}`}); stopping the rest.`);
        shutdown(code || 1);
      } else if (children.size === 0) {
        process.exit(process.exitCode || 0);
      }
    });
  }

  function restart() {
    if (restarting) {
      restartQueued = true;
      return;
    }
    restarting = true;
    console.log("[server] File change detected, restarting...");
    killProcessTree(child, spawn);
  }

  watchServerFiles(restart);
  spawnServer();
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  if (children.size === 0) process.exit(exitCode);
  for (const child of children) killProcessTree(child, spawn);
}

async function main() {
  if (!fs.existsSync(VITE_BIN)) {
    throw new Error("Frontend dependencies are missing. Run: npm install --prefix web");
  }

  const webPort = await findWebPort();
  const webOrigins = [`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`];
  const allowedOrigins = [process.env.AGENTBRIDGE_ALLOWED_ORIGINS, ...webOrigins]
    .filter(Boolean)
    .join(",");

  const webEnv = { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR || "1" };
  if (!process.env.VITE_AGENTBRIDGE_API_ORIGIN && !webEnvDefinesApiOrigin()) {
    webEnv.VITE_AGENTBRIDGE_API_ORIGIN = getBackendOrigin();
  }

  if (webPort !== PREFERRED_WEB_PORT) {
    console.log(`[dev] Port ${PREFERRED_WEB_PORT} is unavailable; using ${webPort} for the frontend.`);
  }
  console.log(`[dev] Backend:  ${getBackendOrigin()}`);
  console.log(`[dev] Frontend: http://localhost:${webPort}`);

  startServerWithWatch({
    ...process.env,
    AGENTBRIDGE_ALLOWED_ORIGINS: allowedOrigins,
    FORCE_COLOR: "1",
  });
  start("[web]", [VITE_BIN, "--port", String(webPort), "--strictPort"], {
    cwd: WEB_DIR,
    env: webEnv,
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

main().catch((error) => {
  console.error(`[dev] ${error.message}`);
  shutdown(1);
});
