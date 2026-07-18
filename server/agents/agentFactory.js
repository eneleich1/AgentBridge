const { createCursorAgent } = require("./cursorAgent");
const { createCodexAgent } = require("./codexAgent");
const { readJsonConfig, writeJsonConfig } = require("../utils/runtimeConfig");

const DEFAULT_CONFIG = {
  agents: [
    {
      id: "cursor",
      name: "Cursor Agent",
      description: "Cursor Agent CLI",
      enabled: true,
      settings: {},
    },
    {
      id: "codex",
      name: "Codex CLI",
      description: "OpenAI Codex CLI",
      enabled: true,
      settings: {
        model: "gpt-5.4",
      },
    },
  ],
  maxConcurrency: 1,
  accessToken: "",
};

function loadAgentsConfig() {
  return readJsonConfig("agents.json", DEFAULT_CONFIG);
}

function saveAgentsConfig(config) {
  writeJsonConfig("agents.json", config);
}

function getAgent(agentType) {
  const config = loadAgentsConfig();
  const meta = config.agents.find((a) => a.id === agentType);

  if (!meta || !meta.enabled) {
    throw new Error(`Agent not available: ${agentType}`);
  }

  if (agentType === "cursor") {
    return createCursorAgent();
  }
  if (agentType === "codex") {
    return createCodexAgent({ model: meta.settings?.model || "gpt-5.4" });
  }

  throw new Error(`Unknown agent type: ${agentType}`);
}

function listAgents() {
  const config = loadAgentsConfig();
  return config.agents.filter((a) => a.enabled);
}

function getMaxConcurrency() {
  const config = loadAgentsConfig();
  return config.maxConcurrency || 1;
}

function getAccessToken() {
  const config = loadAgentsConfig();
  return process.env.AGENTBRIDGE_ACCESS_TOKEN || config.accessToken || "";
}

function getAgentConfig(agentType) {
  const config = loadAgentsConfig();
  const meta = config.agents.find((a) => a.id === agentType);

  if (!meta) {
    throw new Error(`Unknown agent type: ${agentType}`);
  }

  return {
    id: meta.id,
    name: meta.name,
    settings: {
      ...(meta.settings || {}),
    },
  };
}

function updateAgentConfig(agentType, nextSettings = {}) {
  const config = loadAgentsConfig();
  const index = config.agents.findIndex((a) => a.id === agentType);

  if (index < 0) {
    throw new Error(`Unknown agent type: ${agentType}`);
  }

  const meta = config.agents[index];
  const currentSettings = meta.settings || {};

  if (agentType === "codex") {
    const model = String(nextSettings.model || "").trim() || "gpt-5.4";
    meta.settings = {
      ...currentSettings,
      model,
    };
  } else {
    meta.settings = {
      ...currentSettings,
    };
  }

  config.agents[index] = meta;
  saveAgentsConfig(config);
  return getAgentConfig(agentType);
}

module.exports = {
  getAgent,
  listAgents,
  getMaxConcurrency,
  getAccessToken,
  getAgentConfig,
  updateAgentConfig,
};
