/**
 * Connector vocabulary deliberately separates a provider (agent), the protocol
 * spoken to it, and the transport used to carry that protocol.  These values
 * are persisted in agent configuration and session records, so keep them
 * stable and backwards-compatible.
 */
const ConnectionMode = Object.freeze({
  AUTO: "auto",
  ACP: "acp",
  AGENTBRIDGE_PROTOCOL: "agentbridge_protocol",
  NATIVE_SDK: "native_sdk",
  OPENAI_COMPATIBLE: "openai_compatible",
  OLLAMA_HTTP: "ollama_http",
});

const AgentProtocol = Object.freeze({
  ACP: "acp",
  AGENTBRIDGE: "agentbridge",
  NATIVE_SDK: "native_sdk",
  OPENAI_COMPATIBLE: "openai_compatible",
  OLLAMA: "ollama",
});

const AgentTransport = Object.freeze({
  STDIO: "stdio",
  PROCESS: "process",
  HTTP: "http",
  WEBSOCKET: "websocket",
  IN_PROCESS: "in_process",
});

const AgentEventType = Object.freeze({
  TEXT_DELTA: "text_delta",
  REASONING_STATUS: "reasoning_status",
  TOOL_STARTED: "tool_started",
  TOOL_COMPLETED: "tool_completed",
  FILE_CHANGED: "file_changed",
  COMMAND_STARTED: "command_started",
  COMMAND_COMPLETED: "command_completed",
  PERMISSION_REQUESTED: "permission_requested",
  USAGE_UPDATED: "usage_updated",
  ERROR: "error",
  COMPLETED: "completed",
  RAW: "raw",
});

function createCapabilities(overrides = {}) {
  return {
    supportsSessions: false,
    supportsSessionResume: false,
    supportsStreaming: true,
    supportsCancellation: true,
    supportsPermissions: false,
    supportsPlanMode: true,
    supportsAskMode: true,
    supportsAgentMode: true,
    supportsStructuredOutput: false,
    supportsToolEvents: false,
    supportsUsageReporting: false,
    supportsModelSelection: false,
    ...overrides,
  };
}

function normalizeConnectionMode(value, fallback = ConnectionMode.AUTO) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.values(ConnectionMode).includes(normalized) ? normalized : fallback;
}

module.exports = {
  ConnectionMode,
  AgentProtocol,
  AgentTransport,
  AgentEventType,
  createCapabilities,
  normalizeConnectionMode,
};
