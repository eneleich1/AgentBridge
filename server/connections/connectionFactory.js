const { createCursorAgent } = require("../agents/cursorAgent");
const { createCodexAgent } = require("../agents/codexAgent");
const { createDuelAgent } = require("../agents/duelAgent");
const { resolveCursorAgentCommand } = require("../agents/cliPath");
const { AgentBridgeProtocolConnection } = require("./agentBridgeProtocolConnection");
const { ACPConnection } = require("./acpConnection");
const { CodexConnection } = require("./codexConnection");
const { OpenAICompatibleConnection } = require("./openAICompatibleConnection");
const { ConnectionMode, AgentProtocol, AgentTransport, normalizeConnectionMode } = require("./types");

function legacyAgentFor(agentId, settings = {}) {
  if (agentId === "cursor") return createCursorAgent();
  if (agentId === "codex") return createCodexAgent({ model: settings.model });
  if (agentId === "duel") return createDuelAgent({ model: settings.model });
  throw new Error(`No AgentBridge protocol adapter exists for ${agentId}.`);
}

function buildConnectionConfig(agent, settings = {}) {
  const mode = normalizeConnectionMode(settings.connectionMode);
  const base = {
    agentId: agent.id,
    connectionMode: mode,
    protocol: settings.protocol || null,
    transport: settings.transport || null,
    executablePath: settings.executablePath || null,
    endpoint: settings.endpoint || null,
    arguments: Array.isArray(settings.arguments) ? settings.arguments : [],
    environmentVariables: settings.environmentVariables || {},
    capabilities: settings.capabilities || {},
    metadata: settings.metadata || {},
    model: settings.model || null,
  };

  if (agent.id === "cursor") {
    return {
      ...base,
      protocol: base.protocol || AgentProtocol.ACP,
      transport: base.transport || AgentTransport.STDIO,
      acp: {
        protocol: AgentProtocol.ACP,
        transport: AgentTransport.STDIO,
        executablePath: settings.executablePath || resolveCursorAgentCommand(),
        arguments: settings.arguments?.length ? settings.arguments : ["acp"],
        environmentVariables: settings.environmentVariables || {},
        authMethod: settings.authMethod === undefined ? "cursor_login" : settings.authMethod,
      },
      fallback: { protocol: AgentProtocol.AGENTBRIDGE, transport: AgentTransport.PROCESS },
    };
  }
  if (mode === ConnectionMode.OPENAI_COMPATIBLE || mode === ConnectionMode.OLLAMA_HTTP) {
    return {
      ...base,
      protocol: mode === ConnectionMode.OLLAMA_HTTP ? AgentProtocol.OLLAMA : AgentProtocol.OPENAI_COMPATIBLE,
      transport: AgentTransport.HTTP,
    };
  }
  return {
    ...base,
    protocol: AgentProtocol.AGENTBRIDGE,
    transport: AgentTransport.PROCESS,
    fallback: { protocol: AgentProtocol.AGENTBRIDGE, transport: AgentTransport.PROCESS },
  };
}

/**
 * Resolves a configured connection. Auto prefers ACP for Cursor, but only
 * commits to it after its initialize/auth handshake succeeds; callers can
 * transparently fall back to the current process protocol.
 */
class AgentConnectionFactory {
  create(agent, settings = {}, options = {}) {
    const config = buildConnectionConfig(agent, settings);
    const mode = config.connectionMode;
    if (agent.id === "codex" && [ConnectionMode.AUTO, ConnectionMode.AGENTBRIDGE_PROTOCOL, ConnectionMode.NATIVE_SDK].includes(mode)) {
      return new CodexConnection({ config });
    }
    if (mode === ConnectionMode.ACP) return new ACPConnection({ config: config.acp || config });
    if (mode === ConnectionMode.OPENAI_COMPATIBLE || mode === ConnectionMode.OLLAMA_HTTP) {
      return new OpenAICompatibleConnection({ config, protocol: config.protocol });
    }
    if (mode === ConnectionMode.NATIVE_SDK) {
      const error = new Error("Native SDK is an extension point; no native SDK connector is registered for this agent.");
      error.code = "native_sdk_not_available";
      throw error;
    }
    if (mode === ConnectionMode.AUTO && agent.id === "cursor") {
      return new ACPConnection({ config: config.acp });
    }
    return new AgentBridgeProtocolConnection({
      agent: legacyAgentFor(agent.id, settings),
      config,
    });
  }

  createFallback(agent, settings = {}) {
    return new AgentBridgeProtocolConnection({
      agent: legacyAgentFor(agent.id, settings),
      config: buildConnectionConfig(agent, { ...settings, connectionMode: ConnectionMode.AGENTBRIDGE_PROTOCOL }),
    });
  }
}

const agentConnectionFactory = new AgentConnectionFactory();

module.exports = {
  AgentConnectionFactory,
  agentConnectionFactory,
  buildConnectionConfig,
};
