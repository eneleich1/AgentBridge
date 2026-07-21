const { createCursorAgent } = require("./cursorAgent");
const { createCodexAgent } = require("./codexAgent");
const { createDuelAgent } = require("./duelAgent");
const { readJsonConfig, writeJsonConfig } = require("../utils/runtimeConfig");

const DEFAULT_CODEX_MODEL = "gpt-5.6-sol";

const DEFAULT_CONFIG = {
  agents: [
    {
      id: "cursor",
      name: "Cursor Agent",
      description: "Cursor Agent CLI",
      enabled: true,
      settings: {
        configured: false,
      },
    },
    {
      id: "codex",
      name: "Codex CLI",
      description: "OpenAI Codex CLI",
      enabled: true,
      settings: {
        configured: false,
        model: DEFAULT_CODEX_MODEL,
      },
    },
  ],
  features: {
    agentDuelEnabled: false,
  },
  maxConcurrency: 2,
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
  if (agentType === "duel") {
    const codex = config.agents.find((agent) => agent.id === "codex");
    return createDuelAgent({ model: codex?.settings?.model || DEFAULT_CODEX_MODEL });
  }
  const meta = config.agents.find((a) => a.id === agentType);

  if (!meta || !meta.enabled) {
    throw new Error(`Agent not available: ${agentType}`);
  }

  if (agentType === "cursor") {
    return createCursorAgent();
  }
  if (agentType === "codex") {
    return createCodexAgent({ model: meta.settings?.model || DEFAULT_CODEX_MODEL });
  }

  throw new Error(`Unknown agent type: ${agentType}`);
}

function listAgents() {
  const config = loadAgentsConfig();
  return config.agents.filter((a) => a.enabled);
}

function getMaxConcurrency() {
  const config = loadAgentsConfig();
  return Math.max(1, Number(config.maxConcurrency) || DEFAULT_CONFIG.maxConcurrency);
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
      configured: meta.settings?.configured !== false,
      ...(meta.settings || {}),
    },
  };
}

function isAgentConfigured(agentType) {
  const config = loadAgentsConfig();
  const meta = config.agents.find((a) => a.id === agentType);

  if (!meta) return false;
  return meta.settings?.configured !== false;
}

function configHasConfiguredAgent(config, agentType) {
  const agent = config.agents.find((item) => item.id === agentType);
  return Boolean(agent) && agent.settings?.configured !== false;
}

function getAgentDuelSettings() {
  const config = loadAgentsConfig();
  const cursorConfigured = configHasConfiguredAgent(config, "cursor");
  const codexConfigured = configHasConfiguredAgent(config, "codex");
  return {
    enabled: config.features?.agentDuelEnabled === true,
    canEnable: cursorConfigured && codexConfigured,
  };
}

function updateAgentDuelSettings(nextSettings = {}) {
  if (typeof nextSettings.enabled !== "boolean") {
    const error = new Error("Agent Duel enabled must be true or false.");
    error.code = "invalid_agent_duel_setting";
    throw error;
  }

  const config = loadAgentsConfig();
  const cursorConfigured = configHasConfiguredAgent(config, "cursor");
  const codexConfigured = configHasConfiguredAgent(config, "codex");
  if (nextSettings.enabled && (!cursorConfigured || !codexConfigured)) {
    const error = new Error("Configure both Cursor Agent and Codex CLI before enabling Agent Duel.");
    error.code = "agent_duel_requires_both_agents";
    throw error;
  }

  config.features = {
    ...(config.features || {}),
    agentDuelEnabled: nextSettings.enabled,
  };
  saveAgentsConfig(config);
  return getAgentDuelSettings();
}

function updateAgentConfig(agentType, nextSettings = {}) {
  const config = loadAgentsConfig();
  const index = config.agents.findIndex((a) => a.id === agentType);

  if (index < 0) {
    throw new Error(`Unknown agent type: ${agentType}`);
  }

  const meta = config.agents[index];
  const currentSettings = meta.settings || {};
  const hasConfigured = typeof nextSettings.configured === "boolean";

  if (agentType === "codex") {
    const model = Object.hasOwn(nextSettings, "model")
      ? String(nextSettings.model || "").trim() || DEFAULT_CODEX_MODEL
      : currentSettings.model || DEFAULT_CODEX_MODEL;
    meta.settings = {
      ...currentSettings,
      ...(hasConfigured ? { configured: nextSettings.configured } : {}),
      model,
    };
  } else {
    meta.settings = {
      ...currentSettings,
      ...(hasConfigured ? { configured: nextSettings.configured } : {}),
    };
  }

  config.agents[index] = meta;
  if (meta.settings?.configured === false) {
    config.features = {
      ...(config.features || {}),
      agentDuelEnabled: false,
    };
  }
  saveAgentsConfig(config);
  return getAgentConfig(agentType);
}

function resetAgentConfig(agentType) {
  const config = loadAgentsConfig();
  const index = config.agents.findIndex((a) => a.id === agentType);

  if (index < 0) {
    throw new Error(`Unknown agent type: ${agentType}`);
  }

  const meta = config.agents[index];
  meta.settings = agentType === "codex"
    ? { configured: false, model: DEFAULT_CODEX_MODEL }
    : { configured: false };
  config.agents[index] = meta;
  config.features = {
    ...(config.features || {}),
    agentDuelEnabled: false,
  };
  saveAgentsConfig(config);
  return getAgentConfig(agentType);
}

module.exports = {
  getAgent,
  listAgents,
  getMaxConcurrency,
  getAccessToken,
  getAgentConfig,
  isAgentConfigured,
  getAgentDuelSettings,
  updateAgentDuelSettings,
  updateAgentConfig,
  resetAgentConfig,
};
