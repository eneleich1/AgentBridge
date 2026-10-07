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
      supportsStreaming: true,
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
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(payload?.error?.message || payload?.error || `HTTP connector failed (${response.status}).`);
      error.code = "http_agent_error";
      throw error;
    }
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      // SSE frames may span transport chunks. Only surface public content;
      // reasoning_content and other private provider fields are ignored.
      const decoder = new TextDecoder();
      let buffer = '';
      const readFrame = (frame) => {
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') return [];
        const payload = JSON.parse(data);
        if (payload.error) throw new Error(payload.error.message || 'HTTP model stream failed.');
        const events = [];
        const text = payload.choices?.[0]?.delta?.content;
        if (typeof text === 'string' && text) events.push({ type: AgentEventType.TEXT_DELTA, text });
        if (payload.usage) events.push({ type: AgentEventType.USAGE_UPDATED, usage: payload.usage });
        return events;
      };
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        // Normalize only after joining chunks, including a split CRLF pair.
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          for (const event of readFrame(frame)) yield event;
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) for (const event of readFrame(buffer)) yield event;
      yield { type: AgentEventType.COMPLETED, result: { exitCode: 0, cancelled: false, providerSessionId: null } };
      return;
    }
    // Some compatible servers return a JSON response even when streaming
    // was requested; keep those endpoints usable.
    const payload = await response.json();
    const text = payload?.choices?.[0]?.message?.content || payload?.message?.content || "";
    if (text) yield { type: AgentEventType.TEXT_DELTA, text };
    if (payload?.usage) yield { type: AgentEventType.USAGE_UPDATED, usage: payload.usage };
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
