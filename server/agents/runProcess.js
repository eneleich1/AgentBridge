const { spawn } = require("child_process");

function killProcessTree(child, killImpl) {
  if (!child || child.killed) return;

  if (process.platform === "win32" && Number.isInteger(child.pid)) {
    killImpl("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    }).on("error", () => {});
    return;
  }

  child.kill();
}

/**
 * Shared child_process wrapper for agent CLIs on Windows.
 * Migrated from the original Codex/Cursor bridge prototypes.
 */
function runProcess(command, args, options = {}) {
  const {
    cwd,
    onStdout,
    onStderr,
    signal,
    stdinData,
    stdinMode = "pipe",
    shell = false,
    timeoutMs = 0,
    spawnImpl = spawn,
    killImpl = spawn,
    closeGraceMs = 250,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, {
      cwd,
      shell,
      windowsHide: true,
      stdio: [stdinMode, "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeoutId = null;
    let closeGraceId = null;
    let exitCode = null;
    let exitSeen = false;
    let stdoutEnded = false;
    let stderrEnded = false;
    let abortHandler = null;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (closeGraceId) clearTimeout(closeGraceId);
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const tryFinishAfterExit = () => {
      if (!exitSeen || settled) return;
      if (stdoutEnded && stderrEnded) {
        finish({ exitCode, stdout, stderr });
        return;
      }
      if (!closeGraceId) {
        closeGraceId = setTimeout(() => {
          finish({ exitCode, stdout, stderr });
        }, closeGraceMs);
      }
    };

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      if (onStdout) onStdout(text);
    });
    child.stdout.on("end", () => {
      stdoutEnded = true;
      tryFinishAfterExit();
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      if (onStderr) onStderr(text);
    });
    child.stderr.on("end", () => {
      stderrEnded = true;
      tryFinishAfterExit();
    });

    child.on("error", (error) => {
      fail(error);
    });

    child.on("exit", (code) => {
      exitSeen = true;
      exitCode = code;
      tryFinishAfterExit();
    });

    child.on("close", (exitCode) => {
      finish({ exitCode, stdout, stderr });
    });

    if (stdinMode === "pipe") {
      if (stdinData !== undefined) {
        child.stdin.write(stdinData);
      }
      child.stdin.end();
    }

    if (signal) {
      if (signal.aborted) {
        killProcessTree(child, killImpl);
        finish({ exitCode: null, stdout, stderr, cancelled: true });
        return;
      }
      abortHandler = () => {
        killProcessTree(child, killImpl);
        finish({ exitCode: null, stdout, stderr, cancelled: true });
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        killProcessTree(child, killImpl);
        finish({ exitCode: null, stdout, stderr, timedOut: true });
      }, timeoutMs);
    }
  });
}

module.exports = { runProcess, killProcessTree };
