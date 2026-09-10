const projectService = require("./projectService");
const { diagnoseCursor, diagnoseCodex } = require("../agents/diagnostics");
const { getAgentDuelSettings, isAgentConfigured, getAgentConnectionConfig } = require("../agents/agentFactory");

const VERSION = require("../../package.json").version;
const SETUP_CACHE_TTL_MS = 10000;

let setupCache = {
  value: null,
  expiresAt: 0,
};
let setupInFlight = null;
let setupGeneration = 0;

async function diagnoseLocalModel() {
  const connection = getAgentConnectionConfig("local");
  const endpoint = connection.endpoint;
  if (!endpoint) {
    return { installed: false, authenticated: false, status: "missing", message: "Configure a local model endpoint." };
  }
  const modelsUrl = `${String(endpoint).replace(/\/$/, "").replace(/\/v1$/i, "")}/v1/models`;
  try {
    const response = await fetch(modelsUrl, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) {
      return { installed: true, authenticated: false, status: "not_ready", message: `Local endpoint responded with HTTP ${response.status}.` };
    }
    const payload = await response.json().catch(() => ({}));
    const models = Array.isArray(payload.data) ? payload.data.map((model) => model.id).filter(Boolean) : [];
    return {
      installed: true,
      authenticated: true,
      status: "ready",
      version: models.length ? `${models.length} model${models.length === 1 ? "" : "s"}` : "Connected",
      models,
      message: "Local OpenAI-compatible endpoint is ready.",
    };
  } catch (error) {
    return {
      installed: false,
      authenticated: false,
      status: "not_ready",
      message: `Cannot reach local model endpoint: ${error.message}`,
    };
  }
}

function getHealth() {
  return {
    ok: true,
    service: "agentbridge",
    version: VERSION,
  };
}

function buildSetupStatus(cursor, codex, local) {
  const projects = projectService.listProjects();
  const hasProject = projects.length > 0;
  const cursorStatus = {
    ...cursor,
    configured: isAgentConfigured("cursor"),
    connection: getAgentConnectionConfig("cursor"),
  };
  const codexStatus = {
    ...codex,
    configured: isAgentConfigured("codex"),
    connection: getAgentConnectionConfig("codex"),
  };
  const localStatus = {
    ...local,
    configured: isAgentConfigured("local"),
    connection: getAgentConnectionConfig("local"),
  };
  const duelSettings = getAgentDuelSettings();
  const hasReadyAgent =
    (cursorStatus.configured && cursorStatus.status === "ready") ||
    (codexStatus.configured && codexStatus.status === "ready") ||
    (localStatus.configured && localStatus.status === "ready");
  const duelStatus = {
    enabled: duelSettings.enabled,
    canEnable: duelSettings.canEnable,
    configured: cursorStatus.configured && codexStatus.configured,
    authenticated: cursorStatus.authenticated && codexStatus.authenticated,
    installed: cursorStatus.installed && codexStatus.installed,
    status: !duelSettings.enabled
      ? "disabled"
      : cursorStatus.configured && codexStatus.configured &&
      cursorStatus.status === "ready" && codexStatus.status === "ready"
        ? "ready"
        : "needs_setup",
    message: !duelSettings.enabled
      ? "Enable Agent Duel in Settings after configuring both agents."
      : cursorStatus.configured && codexStatus.configured &&
      cursorStatus.status === "ready" && codexStatus.status === "ready"
        ? "Codex CLI and Cursor Agent are ready for Agent Duel."
        : "Configure both Codex CLI and Cursor Agent before starting Agent Duel.",
  };

  return {
    cursor: cursorStatus,
    codex: codexStatus,
    local: localStatus,
    duel: duelStatus,
    projects,
    setupComplete: hasProject && hasReadyAgent,
    checks: {
      hasProject,
      hasReadyAgent,
    },
  };
}

async function getSetupStatus(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  const now = Date.now();

  if (forceRefresh) {
    setupGeneration += 1;
    setupCache = { value: null, expiresAt: 0 };
    setupInFlight = null;
  }

  if (!forceRefresh && setupCache.value && setupCache.expiresAt > now) {
    return setupCache.value;
  }

  if (!forceRefresh && setupInFlight) {
    return setupInFlight;
  }

  const requestGeneration = setupGeneration;
  const request = Promise.all([diagnoseCursor(), diagnoseCodex(), diagnoseLocalModel()])
    .then(([cursor, codex, local]) => {
      const status = buildSetupStatus(cursor, codex, local);
      if (requestGeneration === setupGeneration) {
        setupCache = {
          value: status,
          expiresAt: Date.now() + SETUP_CACHE_TTL_MS,
        };
      }
      return status;
    })
    .finally(() => {
      if (setupInFlight === request) {
        setupInFlight = null;
      }
    });

  setupInFlight = request;
  return request;
}

function isAgentReady(agentType, setupStatus) {
  if (!setupStatus) return false;
  if (agentType === "cursor") {
    return setupStatus.cursor.configured !== false && setupStatus.cursor.status === "ready";
  }
  if (agentType === "codex") {
    return setupStatus.codex.configured !== false && setupStatus.codex.status === "ready";
  }
  if (agentType === "local") {
    return setupStatus.local.configured !== false && setupStatus.local.status === "ready";
  }
  if (agentType === "duel") {
    return setupStatus.duel?.enabled === true &&
      setupStatus.duel.configured === true &&
      setupStatus.duel.status === "ready";
  }
  return false;
}

async function assertCanRunTask({ agentType, projectId }) {
  const setup = await getSetupStatus();

  if (!setup.checks.hasProject) {
    const err = new Error("Add and validate a project before running tasks.");
    err.code = "setup_incomplete";
    err.setup = setup;
    throw err;
  }

  if (!projectId || !projectService.getProjectById(projectId)) {
    const err = new Error("Select a valid project before running tasks.");
    err.code = "setup_incomplete";
    err.setup = setup;
    throw err;
  }

  if (!isAgentReady(agentType, setup)) {
    const agentInfo = setup[agentType];
    const err = new Error(
      agentInfo?.configured === false
        ? agentType === "duel"
          ? "Configure both Codex CLI and Cursor Agent in AgentBridge settings before starting Agent Duel."
          : `Configure ${agentType === "codex" ? "Codex CLI" : agentType === "local" ? "Local Model" : "Cursor Agent"} in AgentBridge settings before running tasks.`
        : agentInfo?.message || `${agentType} is not ready on the desktop.`
    );
    err.code = agentInfo?.configured === false ? "agent_not_configured" : "agent_not_ready";
    err.agent = agentType;
    err.setup = setup;
    throw err;
  }

  return setup;
}

function invalidateSetupStatusCache() {
  setupGeneration += 1;
  setupCache = {
    value: null,
    expiresAt: 0,
  };
  setupInFlight = null;
}

module.exports = {
  getHealth,
  getSetupStatus,
  isAgentReady,
  assertCanRunTask,
  invalidateSetupStatusCache,
};
