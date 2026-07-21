const projectService = require("./projectService");
const { diagnoseCursor, diagnoseCodex } = require("../agents/diagnostics");
const { isAgentConfigured } = require("../agents/agentFactory");

const VERSION = require("../../package.json").version;
const SETUP_CACHE_TTL_MS = 10000;

let setupCache = {
  value: null,
  expiresAt: 0,
};
let setupInFlight = null;
let setupGeneration = 0;

function getHealth() {
  return {
    ok: true,
    service: "agentbridge",
    version: VERSION,
  };
}

function buildSetupStatus(cursor, codex) {
  const projects = projectService.listProjects();
  const hasProject = projects.length > 0;
  const cursorStatus = {
    ...cursor,
    configured: isAgentConfigured("cursor"),
  };
  const codexStatus = {
    ...codex,
    configured: isAgentConfigured("codex"),
  };
  const hasReadyAgent =
    (cursorStatus.configured && cursorStatus.status === "ready") ||
    (codexStatus.configured && codexStatus.status === "ready");

  return {
    cursor: cursorStatus,
    codex: codexStatus,
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
  const request = Promise.all([diagnoseCursor(), diagnoseCodex()])
    .then(([cursor, codex]) => {
      const status = buildSetupStatus(cursor, codex);
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
        ? `Configure ${agentType === "codex" ? "Codex CLI" : "Cursor Agent"} in AgentBridge settings before running tasks.`
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
