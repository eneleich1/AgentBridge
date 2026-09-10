const { AsyncEventQueue } = require("./asyncEventQueue");
const {
  AgentEventType,
  AgentProtocol,
  AgentTransport,
  createCapabilities,
} = require("./types");

/**
 * Compatibility connector for the original AgentBridge process adapters.
 * It intentionally wraps, rather than replaces, the battle-tested Cursor and
 * Codex command implementations while exposing the same event contract as ACP
 * and HTTP connectors.
 */
class AgentBridgeProtocolConnection {
  constructor({ agent, config = {} }) {
    this.agent = agent;
    this.config = config;
    this.capabilities = createCapabilities({
      supportsSessions: true,
      supportsSessionResume: Boolean(agent?.supportsNativeResume),
      supportsStreaming: true,
      supportsCancellation: true,
      supportsPlanMode: true,
      supportsAskMode: true,
      supportsAgentMode: true,
      supportsModelSelection: Boolean(config.model),
    });
  }

  async connect() {
    return this.getInfo("connected");
  }

  async createSession({ sessionId }) {
    return { providerSessionId: null, sessionId };
  }

  async resumeSession({ providerSessionId, sessionId }) {
    return { providerSessionId: providerSessionId || null, sessionId };
  }

  async *sendPrompt({ projectPath, prompt, mode, attachments, providerSessionId, signal }) {
    const events = new AsyncEventQueue();
    let result;
    let failure;
    const run = this.agent.run({
      projectPath,
      prompt,
      mode,
      attachments,
      nativeSessionId: providerSessionId || null,
      signal,
      onNativeSession: (nativeSessionId) => events.push({
        type: AgentEventType.RAW,
        raw: { source: "agentbridge_protocol", nativeSessionId },
        providerSessionId: nativeSessionId,
      }),
      onStdout: (text) => events.push({
        type: AgentEventType.TEXT_DELTA,
        text,
        raw: { source: "stdout", text },
      }),
      onStderr: (text) => events.push({
        type: AgentEventType.RAW,
        raw: { source: "stderr", text },
        stream: "stderr",
        text,
      }),
      onDuelOutput: (output) => events.push({
        type: AgentEventType.RAW,
        raw: { source: "duel", ...output },
        duelOutput: output,
      }),
    });

    run.then((value) => {
      result = value;
      events.push({
        type: AgentEventType.COMPLETED,
        result: {
          exitCode: value.exitCode,
          cancelled: Boolean(value.cancelled),
          providerSessionId: value.nativeSessionId || providerSessionId || null,
          rawStdout: value.rawStdout || value.stdout || "",
          stderr: value.stderr || "",
          duelResults: value.duelResults || null,
        },
      });
      events.close();
    }).catch((error) => {
      failure = error;
      events.push({ type: AgentEventType.ERROR, error, raw: { source: "agentbridge_protocol" } });
      events.close();
    });

    for await (const event of events) yield event;
    if (failure) throw failure;
    return result;
  }

  async respondToPermission() {
    const error = new Error("The AgentBridge compatibility protocol does not expose interactive permissions.");
    error.code = "unsupported_operation";
    throw error;
  }

  async cancel() {
    // Cancellation is driven by the AbortSignal supplied to sendPrompt.
  }

  async getStatus() {
    return this.getInfo("ready");
  }

  async closeSession() {}

  getInfo(status) {
    return {
      status,
      protocol: AgentProtocol.AGENTBRIDGE,
      transport: AgentTransport.PROCESS,
      capabilities: this.capabilities,
      fallbackAvailable: false,
    };
  }
}

module.exports = { AgentBridgeProtocolConnection };
