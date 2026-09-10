const { createCursorAgent } = require("./cursorAgent");
const { createCodexAgent } = require("./codexAgent");
const { createDuelAgent } = require("./duelAgent");
const { readJsonConfig, writeJsonConfig } = require("../utils/runtimeConfig");
const { agentConnectionFactory, buildConnectionConfig } = require("../connections/connectionFactory");
const { DuelConnection } = require("../connections/duelConnection");
const { ConnectionMode, normalizeConnectionMode } = require("../connections/types");

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
        connectionMode: ConnectionMode.AUTO,
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
        connectionMode: ConnectionMode.AGENTBRIDGE_PROTOCOL,
      },
    },
    {
      id: "local",
      name: "Local Model",
      description: "Ollama or OpenAI-compatible local endpoint",
      enabled: true,
      settings: {
        configured: false,
        connectionMode: ConnectionMode.OLLAMA_HTTP,
        endpoint: "http://127.0.0.1:11434/v1",
        model: "gpt-oss-20b",
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
  const config = readJsonConfig("agents.json", DEFAULT_CONFIG);
  const knownIds = new Set((config.agents || []).map((agent) => agent.id));
  const missingDefaults = DEFAULT_CONFIG.agents.filter((agent) => !knownIds.has(agent.id));
  if (missingDefaults.length) {
    config.agents = [...(config.agents || []), ...structuredClone(missingDefaults)];
    saveAgentsConfig(config);
  }
  return config;
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

function defaultConnectionMode(agentType) {
  if (agentType === "cursor") return ConnectionMode.AUTO;
  if (agentType === "local") return ConnectionMode.OLLAMA_HTTP;
  return ConnectionMode.AGENTBRIDGE_PROTOCOL;
}

function normalizeAgentSettings(agentType, settings = {}) {
  return {
    ...(agentType === "codex" ? { model: DEFAULT_CODEX_MODEL } : {}),
    ...(agentType === "local" ? { endpoint: "http://127.0.0.1:11434/v1", model: "gpt-oss-20b" } : {}),
    ...(settings || {}),
    configured: settings.configured !== false,
    connectionMode: normalizeConnectionMode(settings.connectionMode, defaultConnectionMode(agentType)),
  };
}

function getAgentMeta(agentType) {
  const config = loadAgentsConfig();
  const meta = config.agents.find((agent) => agent.id === agentType);
  if (!meta || !meta.enabled) throw new Error(`Agent not available: ${agentType}`);
  return { ...meta, settings: normalizeAgentSettings(agentType, meta.settings) };
}

function createAgentConnection(agentType, options = {}) {
  if (agentType === "duel") {
    return new DuelConnection({ createConnection: (contestant) => createAgentConnection(contestant, options) });
  }
  const meta = getAgentMeta(agentType);
  return agentConnectionFactory.create(meta, meta.settings, options);
}

function createAgentFallbackConnection(agentType) {
  const meta = getAgentMeta(agentType);
  return agentConnectionFactory.createFallback(meta, meta.settings);
}

function getAgentConnectionConfig(agentType) {
  if (agentType === "duel") {
    return { connectionMode: ConnectionMode.AGENTBRIDGE_PROTOCOL, protocol: "agentbridge", transport: "in_process" };
  }
  const meta = getAgentMeta(agentType);
  return buildConnectionConfig(meta, meta.settings);
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

  const settings = normalizeAgentSettings(agentType, meta.settings);
  const publicSettings = {
    ...settings,
    ...(settings.apiKey ? { apiKey: "configured" } : {}),
  };
  return {
    id: meta.id,
    name: meta.name,
    settings: publicSettings,
    connection: getAgentConnectionConfig(agentType),
  };
}

function isAgentConfigured(agentType) {
  const config = loadAgentsConfig();
  const meta = config.agents.find((a) => a.id === agentType);

  if (!meta) return false;
  return normalizeAgentSettings(agentType, meta.settings).configured !== false;
}

function configHasConfiguredAgent(config, agentType) {
  const agent = config.agents.find((item) => item.id === agentType);
  return Boolean(agent) && normalizeAgentSettings(agentType, agent.settings).configured !== false;
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
  const currentSettings = normalizeAgentSettings(agentType, meta.settings);
  const hasConfigured = typeof nextSettings.configured === "boolean";
  const connectionMode = Object.hasOwn(nextSettings, "connectionMode")
    ? normalizeConnectionMode(nextSettings.connectionMode, defaultConnectionMode(agentType))
    : currentSettings.connectionMode;
  const connectionFields = [
    "protocol", "transport", "executablePath", "endpoint", "arguments",
    "environmentVariables", "capabilities", "metadata", "authMethod", "headers", "apiKey",
  ];
  const nextConnectionSettings = connectionFields.reduce((result, key) => {
    if (Object.hasOwn(nextSettings, key)) result[key] = nextSettings[key];
    return result;
  }, {});

  if (agentType === "codex" || agentType === "local") {
    const model = Object.hasOwn(nextSettings, "model")
      ? String(nextSettings.model || "").trim() || DEFAULT_CODEX_MODEL
      : currentSettings.model || (agentType === "local" ? "gpt-oss-20b" : DEFAULT_CODEX_MODEL);
    meta.settings = {
      ...currentSettings,
      ...(hasConfigured ? { configured: nextSettings.configured } : {}),
      model,
      connectionMode,
      ...nextConnectionSettings,
    };
  } else {
    meta.settings = {
      ...currentSettings,
      ...(hasConfigured ? { configured: nextSettings.configured } : {}),
      connectionMode,
      ...nextConnectionSettings,
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
    ? { configured: false, model: DEFAULT_CODEX_MODEL, connectionMode: defaultConnectionMode(agentType) }
    : agentType === "local"
      ? { configured: false, endpoint: "http://127.0.0.1:11434/v1", model: "gpt-oss-20b", connectionMode: defaultConnectionMode(agentType) }
    : { configured: false, connectionMode: defaultConnectionMode(agentType) };
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
  createAgentConnection,
  createAgentFallbackConnection,
  getAgentConnectionConfig,
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
