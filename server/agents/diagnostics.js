const { runProcess } = require("./runProcess");

async function runCmd(commandLine, timeoutMs = 15000) {
  try {
    const result = await runProcess(
      "cmd.exe",
      ["/d", "/c", commandLine],
      { stdinMode: "ignore", timeoutMs }
    );
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();

    if (result.timedOut) {
      return {
        ok: false,
        exitCode: null,
        stdout,
        stderr: stderr || `Command timed out after ${timeoutMs}ms: ${commandLine}`,
        timedOut: true,
      };
    }

    return {
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout,
      stderr,
      timedOut: false,
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: error.message,
    };
  }
}

function needsCursorLogin(text) {
  const lower = text.toLowerCase();
  return (
    lower.includes("authentication required") ||
    lower.includes("agent login") ||
    lower.includes("cursor_api_key")
  );
}

function hasUsageLimit(text) {
  const lower = text.toLowerCase();
  return (
    lower.includes("usage limit") ||
    lower.includes("rate limit") ||
    lower.includes("quota exceeded")
  );
}

function needsCodexLogin(text) {
  const lower = text.toLowerCase();
  return (
    lower.includes("not logged in") ||
    lower.includes("login required") ||
    lower.includes("please login") ||
    lower.includes("authentication required")
  );
}

function isAccessDenied(text) {
  const lower = text.toLowerCase();
  return (
    lower.includes("spawn eperm") ||
    lower.includes("access is denied") ||
    lower.includes("permission denied")
  );
}

async function diagnoseCursor() {
  const version = await runCmd("agent --version");
  if (!version.ok && needsCursorLogin(version.stderr + version.stdout)) {
    return {
      installed: true,
      version: null,
      authenticated: false,
      status: "needs_login",
      message: "Cursor Agent CLI found but not authenticated.",
    };
  }

  if (
    !version.ok &&
    (version.stderr.includes("not recognized") ||
      version.stderr.includes("not found") ||
      version.stdout.includes("not recognized"))
  ) {
    return {
      installed: false,
      version: null,
      authenticated: false,
      status: "missing",
      message: "Cursor Agent CLI (agent) not found on PATH.",
    };
  }

  const status = await runCmd("agent status");
  const authText = `${status.stdout} ${status.stderr}`;
  if (status.timedOut) {
    return {
      installed: true,
      version: version.stdout || version.stderr || null,
      authenticated: false,
      status: "blocked",
      message: "Cursor Agent CLI did not answer in time. Check authentication and local CLI health.",
    };
  }
  if (needsCursorLogin(authText)) {
    return {
      installed: true,
      version: version.stdout || version.stderr || null,
      authenticated: false,
      status: "needs_login",
      message: "Run 'agent login' on the desktop or set CURSOR_API_KEY.",
    };
  }

  if (status.ok || status.stdout.length > 0) {
    return {
      installed: true,
      version: version.stdout || version.stderr || null,
      authenticated: true,
      status: "ready",
      message: "Cursor Agent CLI is ready.",
    };
  }

  return {
    installed: true,
    version: version.stdout || version.stderr || null,
    authenticated: !needsCursorLogin(authText),
    status: needsCursorLogin(authText) ? "needs_login" : "ready",
    message: needsCursorLogin(authText)
      ? "Run 'agent login' on the desktop or set CURSOR_API_KEY."
      : "Cursor Agent CLI detected.",
  };
}

async function diagnoseCodex() {
  const version = await runCmd("codex --version");
  const versionText = `${version.stdout} ${version.stderr}`;

  if (isAccessDenied(versionText)) {
    return {
      installed: true,
      version: version.stdout || version.stderr || null,
      authenticated: false,
      status: "blocked",
      message: "Codex CLI is installed but Windows blocked execution.",
    };
  }

  if (
    !version.ok &&
    (versionText.includes("not recognized") || versionText.includes("not found"))
  ) {
    return {
      installed: false,
      version: null,
      authenticated: false,
      status: "missing",
      message: "Codex CLI (codex) not found on PATH.",
    };
  }

  if (hasUsageLimit(versionText)) {
    return {
      installed: true,
      version: version.stdout || null,
      authenticated: false,
      status: "usage_limit",
      message: "Codex usage limit reached.",
    };
  }

  const login = await runCmd("codex login status");
  const loginText = `${login.stdout} ${login.stderr}`;

  if (needsCodexLogin(loginText)) {
    return {
      installed: true,
      version: version.stdout || version.stderr || null,
      authenticated: false,
      status: "needs_login",
      message: "Run 'codex login' or 'codex login --device-auth' on the backend machine.",
    };
  }

  const help = await runCmd("codex exec --help");
  const helpText = `${help.stdout} ${help.stderr}`;

  if (help.timedOut) {
    return {
      installed: true,
      version: version.stdout || version.stderr || null,
      authenticated: false,
      status: "blocked",
      message: "Codex CLI did not answer in time. Check the desktop CLI installation and auth state.",
    };
  }

  if (isAccessDenied(helpText)) {
    return {
      installed: true,
      version: version.stdout || null,
      authenticated: false,
      status: "blocked",
      message: "Codex CLI is installed but cannot be executed by AgentBridge.",
    };
  }

  if (hasUsageLimit(helpText)) {
    return {
      installed: true,
      version: version.stdout || null,
      authenticated: false,
      status: "usage_limit",
      message: "Codex usage limit reached.",
    };
  }

  return {
    installed: true,
    version: version.stdout || version.stderr || null,
    authenticated: true,
    status: "ready",
    message: "Codex CLI is ready.",
  };
}

function parseLabelValueLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((acc, line) => {
      const match = line.match(/^([^:]+):\s+(.+)$/);
      if (match) {
        acc[match[1].trim()] = match[2].trim();
      }
      return acc;
    }, {});
}

async function getCursorUsage() {
  const diagnostic = await diagnoseCursor();
  const about = await runCmd("agent about");
  const aboutFields = parseLabelValueLines(about.stdout);
  const model = aboutFields.Model || null;
  const plan = aboutFields["Subscription Tier"] || null;

  return {
    agentId: "cursor",
    status: diagnostic.status,
    available: diagnostic.status === "ready",
    supportsExactRemaining: false,
    headline: diagnostic.status === "ready" ? "Usage available" : "Usage unavailable",
    summary:
      diagnostic.status === "ready"
        ? "Cursor CLI is authenticated, but the local CLI does not expose an exact remaining quota."
        : diagnostic.message,
    remaining: null,
    unit: null,
    resetAt: null,
    details: [
      {
        label: "Remaining",
        value: "Not exposed by Cursor CLI",
      },
      {
        label: "Status",
        value: diagnostic.message,
      },
      {
        label: "Model",
        value: model || "Unknown",
      },
      {
        label: "Plan",
        value: plan || "Unknown",
      },
    ],
  };
}

async function getCodexUsage() {
  const diagnostic = await diagnoseCodex();
  const login = await runCmd("codex login status");
  const loginText = `${login.stdout} ${login.stderr}`.trim();

  return {
    agentId: "codex",
    status: diagnostic.status,
    available: diagnostic.status === "ready",
    supportsExactRemaining: false,
    headline: diagnostic.status === "ready" ? "Usage available" : "Usage unavailable",
    summary:
      diagnostic.status === "ready"
        ? "Codex CLI is authenticated, but the local CLI does not expose an exact remaining quota."
        : diagnostic.message,
    remaining: null,
    unit: null,
    resetAt: null,
    details: [
      {
        label: "Remaining",
        value: "Not exposed by Codex CLI",
      },
      {
        label: "Status",
        value: diagnostic.message,
      },
      {
        label: "Authentication",
        value: loginText || "Unknown",
      },
      {
        label: "Version",
        value: diagnostic.version || "Unknown",
      },
    ],
  };
}

module.exports = {
  diagnoseCursor,
  diagnoseCodex,
  getCursorUsage,
  getCodexUsage,
};
