const projectService = require("./projectService");
const { diagnoseCursor, diagnoseCodex } = require("../agents/diagnostics");

const VERSION = require("../../package.json").version;
const SETUP_CACHE_TTL_MS = 10000;

let setupCache = {
  value: null,
  expiresAt: 0,
};
let setupInFlight = null;

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
  const hasReadyAgent =
    cursor.status === "ready" || codex.status === "ready";

  return {
    cursor,
    codex,
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

  if (!forceRefresh && setupCache.value && setupCache.expiresAt > now) {
    return setupCache.value;
  }

  if (!forceRefresh && setupInFlight) {
    return setupInFlight;
  }

  setupInFlight = Promise.all([diagnoseCursor(), diagnoseCodex()])
    .then(([cursor, codex]) => {
      const status = buildSetupStatus(cursor, codex);
      setupCache = {
        value: status,
        expiresAt: Date.now() + SETUP_CACHE_TTL_MS,
      };
      return status;
    })
    .finally(() => {
      setupInFlight = null;
    });

  return setupInFlight;
}

function isAgentReady(agentType, setupStatus) {
  if (!setupStatus) return false;
  if (agentType === "cursor") return setupStatus.cursor.status === "ready";
  if (agentType === "codex") return setupStatus.codex.status === "ready";
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
      agentInfo?.message || `${agentType} is not ready on the desktop.`
    );
    err.code = "agent_not_ready";
    err.agent = agentType;
    err.setup = setup;
    throw err;
  }

  return setup;
}

function invalidateSetupStatusCache() {
  setupCache = {
    value: null,
    expiresAt: 0,
  };
}

module.exports = {
  getHealth,
  getSetupStatus,
  isAgentReady,
  assertCanRunTask,
  invalidateSetupStatusCache,
};
