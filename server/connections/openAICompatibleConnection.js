const {
  AgentEventType,
  AgentProtocol,
  AgentTransport,
  createCapabilities,
} = require("./types");

function chatCompletionsUrl(endpoint) {
  const base = String(endpoint || "").replace(/\/$/, "");
  if (!base) throw new Error("An OpenAI-compatible endpoint is required.");
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/** Generic local HTTP connector for OpenAI-compatible servers and Ollama's v1 API. */
class OpenAICompatibleConnection {
  constructor({ config = {}, protocol = AgentProtocol.OPENAI_COMPATIBLE }) {
    this.config = config;
    this.protocol = protocol;
    this.capabilities = createCapabilities({
      supportsSessions: false,
      supportsStreaming: false,
      supportsCancellation: true,
      supportsAskMode: true,
      supportsPlanMode: true,
      supportsAgentMode: false,
      supportsModelSelection: true,
      supportsUsageReporting: true,
    });
  }

  async connect() {
    if (!this.config.endpoint) throw new Error("Configure a local model endpoint before connecting.");
    return this.getStatus();
  }

  async createSession({ sessionId }) {
    return { providerSessionId: null, sessionId };
  }

  async resumeSession({ sessionId }) {
    return { providerSessionId: null, sessionId };
  }

  async *sendPrompt({ prompt, signal }) {
    const endpoint = chatCompletionsUrl(this.config.endpoint);
    const headers = { "Content-Type": "application/json", ...(this.config.headers || {}) };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model: this.config.model || "default",
        stream: false,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || payload?.error || `HTTP connector failed (${response.status}).`);
      error.code = "http_agent_error";
      throw error;
    }
    const text = payload?.choices?.[0]?.message?.content || payload?.message?.content || "";
    if (text) yield { type: AgentEventType.TEXT_DELTA, text, raw: { source: "openai-compatible", payload } };
    if (payload?.usage) yield { type: AgentEventType.USAGE_UPDATED, usage: payload.usage, raw: { source: "openai-compatible", payload } };
    yield { type: AgentEventType.COMPLETED, result: { exitCode: 0, cancelled: false, providerSessionId: null } };
  }

  async respondToPermission() {
    const error = new Error("This HTTP connector does not expose interactive permission requests.");
    error.code = "unsupported_operation";
    throw error;
  }

  async cancel() {}

  async getStatus() {
    return {
      status: this.config.endpoint ? "configured" : "not_configured",
      protocol: this.protocol,
      transport: AgentTransport.HTTP,
      capabilities: this.capabilities,
    };
  }

  async closeSession() {}
}

module.exports = { OpenAICompatibleConnection, chatCompletionsUrl };
