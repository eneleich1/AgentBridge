const { AsyncEventQueue } = require("./asyncEventQueue");
const { AgentEventType, AgentProtocol, AgentTransport, createCapabilities } = require("./types");

function contestantResult(agentId, result, error, text) {
  if (error) return { agentId, status: "failed", stdout: text, stderr: error.message, exitCode: null };
  return {
    agentId,
    status: result?.cancelled ? "cancelled" : result?.exitCode === 0 ? "completed" : "failed",
    stdout: text,
    stderr: result?.stderr || "",
    exitCode: result?.exitCode ?? null,
  };
}

/** Runs comparison contestants through the same connector abstraction. */
class DuelConnection {
  constructor({ createConnection }) {
    this.createConnection = createConnection;
    this.connections = new Map();
    this.capabilities = createCapabilities({
      supportsSessions: true,
      supportsStreaming: true,
      supportsCancellation: true,
      supportsPlanMode: true,
      supportsAskMode: false,
      supportsAgentMode: false,
      supportsToolEvents: true,
    });
  }

  async connect() { return this.getStatus(); }
  async createSession({ sessionId }) { return { providerSessionId: null, sessionId }; }
  async resumeSession({ sessionId }) { return { providerSessionId: null, sessionId }; }

  async *sendPrompt({ projectPath, prompt, signal }) {
    const queue = new AsyncEventQueue();
    const runContestant = async (agentId) => {
      const connection = this.createConnection(agentId);
      this.connections.set(agentId, connection);
      let text = "";
      try {
        await connection.connect({ cwd: projectPath });
        const session = await connection.createSession({ sessionId: `${agentId}-duel`, projectPath, mode: "plan" });
        let result = null;
        for await (const event of connection.sendPrompt({
          projectPath,
          prompt,
          mode: "plan",
          providerSessionId: session.providerSessionId,
          signal,
        })) {
          if (event.type === AgentEventType.TEXT_DELTA) {
            text += event.text || "";
            queue.push({ type: AgentEventType.RAW, duelOutput: { agentId, stream: "stdout", text: event.text || "" } });
          } else if (event.type === AgentEventType.RAW && event.stream === "stderr") {
            queue.push({ type: AgentEventType.RAW, duelOutput: { agentId, stream: "stderr", text: event.text || "" } });
          } else if (event.type === AgentEventType.COMPLETED) {
            result = event.result;
          } else if (event.type === AgentEventType.ERROR) {
            throw event.error;
          }
        }
        return contestantResult(agentId, result || { exitCode: 0 }, null, text);
      } catch (error) {
        return contestantResult(agentId, null, error, text);
      }
    };

    const completion = Promise.all([runContestant("cursor"), runContestant("codex")]).then((results) => {
      const duelResults = Object.fromEntries(results.map((result) => [result.agentId, result]));
      const completed = results.filter((result) => result.status === "completed").length;
      queue.push({
        type: AgentEventType.COMPLETED,
        result: {
          exitCode: completed > 0 ? 0 : 1,
          cancelled: signal?.aborted === true,
          duelResults,
        },
      });
      queue.close();
    });
    completion.catch((error) => {
      queue.push({ type: AgentEventType.ERROR, error });
      queue.close();
    });
    for await (const event of queue) yield event;
  }

  async respondToPermission() {
    const error = new Error("Agent Duel does not relay interactive permission requests.");
    error.code = "unsupported_operation";
    throw error;
  }

  async cancel() {
    await Promise.all([...this.connections.values()].map((connection) => connection.cancel({}).catch(() => {})));
  }

  async getStatus() {
    return { status: "ready", protocol: AgentProtocol.AGENTBRIDGE, transport: AgentTransport.IN_PROCESS, capabilities: this.capabilities };
  }
  async closeSession() { await this.cancel(); }
}

module.exports = { DuelConnection };
