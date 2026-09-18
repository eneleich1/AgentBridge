const {
  createAgentConnection,
  createAgentFallbackConnection,
  getAgentConnectionConfig,
} = require("../agents/agentFactory");
const { ConnectionMode, AgentEventType } = require("../connections/types");
const { TerminalBuffer } = require("./terminalBuffer");
const {
  normalizeChunk,
  classifyAgentError,
  buildSessionReplayPrompt,
  updateSessionSummary,
} = require("./messageParser");

const DUEL_OUTPUT_PREFIX = "[[agentbridge:duel-output]]";
const DUEL_RESULT_PREFIX = "[[agentbridge:duel-result]]";

class AgentSession {
  constructor(manager, session) {
    this.manager = manager;
    this.session = session;
    this.abortController = null;
    this.connection = null;
  }

  async getConnection() {
    const config = getAgentConnectionConfig(this.session.agentType);
    if (this.connection) {
      const status = await this.connection.getStatus().catch(() => null);
      const live = Boolean(status && status.status !== "disconnected");
      const mustUseAcp = config.connectionMode === ConnectionMode.ACP;
      if (live && (!mustUseAcp || status.protocol === "acp")) return this.connection;
      await this.connection.closeSession?.().catch(() => {});
      this.connection = null;
    }
    try {
      this.connection = createAgentConnection(this.session.agentType);
      await this.connection.connect({ cwd: this.session.projectPath });
      return this.connection;
    } catch (error) {
      await this.connection?.closeSession().catch(() => {});
      this.connection = null;
      if (config.connectionMode !== ConnectionMode.AUTO) throw error;
      this.manager.appendSessionLog(
        this.session.id,
        "system",
        `Auto connection fallback: ACP unavailable (${error.message}); using AgentBridge protocol.\n`
      );
      this.connection = createAgentFallbackConnection(this.session.agentType);
      await this.connection.connect({ cwd: this.session.projectPath });
      return this.connection;
    }
  }

  async sendMessage(userMessage, attachments = [], queuedAgentMessage = null) {
    const sessionId = this.session.id;
    const agentMessage = queuedAgentMessage
      ? this.manager.setMessageStatus(queuedAgentMessage.id, "running")
      : this.manager.createMessage({ sessionId, role: "agent", content: "", raw: "", status: "running" });
    const terminal = new TerminalBuffer();
    this.abortController = new AbortController();
    let pendingContent = "";
    let pendingRaw = "";
    let pendingStdout = "";
    let pendingStderr = "";
    const pendingDuelOutput = new Map();
    let messageFlushTimer = null;
    let outputFlushTimer = null;
    let result = null;
    let activeConnection = null;

    const flushMessage = () => {
      if (messageFlushTimer) clearTimeout(messageFlushTimer);
      messageFlushTimer = null;
      if (!pendingContent && !pendingRaw) return;
      this.manager.appendMessageChunks(agentMessage.id, { content: pendingContent, raw: pendingRaw });
      pendingContent = "";
      pendingRaw = "";
    };
    const scheduleMessageFlush = () => {
      if (!messageFlushTimer) messageFlushTimer = setTimeout(flushMessage, 100);
    };
    const flushOutput = () => {
      if (outputFlushTimer) clearTimeout(outputFlushTimer);
      outputFlushTimer = null;
      if (pendingStdout) {
        this.manager.emitSessionEvent("agent_output", sessionId, {
          messageId: agentMessage.id, stream: "stdout", text: pendingStdout,
        }, this.session);
        pendingStdout = "";
      }
      if (pendingStderr) {
        this.manager.emitSessionEvent("agent_output", sessionId, {
          messageId: agentMessage.id, stream: "stderr", text: pendingStderr,
        }, this.session);
        pendingStderr = "";
      }
      for (const [key, output] of pendingDuelOutput) {
        pendingDuelOutput.delete(key);
        this.manager.emitSessionEvent("duel_output", sessionId, {
          messageId: agentMessage.id, ...output,
        }, this.session);
      }
    };
    const scheduleOutputFlush = () => {
      if (!outputFlushTimer) outputFlushTimer = setTimeout(flushOutput, 50);
    };
    const appendText = (text, stream = "stdout") => {
      const chunk = normalizeChunk(text);
      if (!chunk) return;
      terminal.append(stream, chunk);
      this.manager.appendSessionLog(sessionId, stream, chunk);
      pendingRaw += chunk;
      if (stream === "stdout") {
        pendingContent += chunk;
        pendingStdout += chunk;
      } else pendingStderr += chunk;
      scheduleMessageFlush();
      scheduleOutputFlush();
    };

    this.session = this.manager.markSessionRunning(sessionId) || this.session;
    this.manager.emitSessionEvent("message_added", sessionId, { message: agentMessage }, this.session);

    try {
      activeConnection = await this.getConnection();
      let status = await activeConnection.getStatus();
      const canAttemptResume = Boolean(status.capabilities?.supportsSessionResume && this.session.nativeSessionId);
      let providerSession;
      try {
        providerSession = canAttemptResume
          ? await activeConnection.resumeSession({
            sessionId, providerSessionId: this.session.nativeSessionId, projectPath: this.session.projectPath,
          })
          : await activeConnection.createSession({ sessionId, projectPath: this.session.projectPath, mode: this.session.mode });
      } catch (error) {
        const config = getAgentConnectionConfig(this.session.agentType);
        if (config.connectionMode !== ConnectionMode.AUTO || status.protocol !== "acp") throw error;
        this.manager.appendSessionLog(
          sessionId,
          "system",
          `Auto connection fallback: ACP session setup failed (${error.message}); using AgentBridge protocol.\n`
        );
        await activeConnection.closeSession().catch(() => {});
        this.connection = createAgentFallbackConnection(this.session.agentType);
        activeConnection = this.connection;
        await activeConnection.connect({ cwd: this.session.projectPath });
        status = await activeConnection.getStatus();
        providerSession = await activeConnection.createSession({
          sessionId, projectPath: this.session.projectPath, mode: this.session.mode,
        });
      }
      if (providerSession?.resumeError) {
        this.manager.appendSessionLog(
          sessionId,
          "system",
          `ACP session resume failed (${providerSession.resumeError}); opened a new ACP session.\n`
        );
      }
      const usedNativeResume = providerSession?.resumed === true;
      const previousMessages = usedNativeResume
        ? []
        : this.manager.listRecentMessages(sessionId, 8, userMessage.id);
      const prompt = usedNativeResume
        ? userMessage.content
        : buildSessionReplayPrompt(this.session, previousMessages, userMessage.content);
      const providerSessionId = providerSession.providerSessionId || this.session.nativeSessionId || null;
      this.session = this.manager.updateSession(sessionId, {
        nativeSessionId: providerSessionId,
        providerSessionId,
        connectionMode: getAgentConnectionConfig(this.session.agentType).connectionMode,
        protocol: status.protocol,
        transport: status.transport,
        sessionMode: usedNativeResume ? "native-resume" : "context-replay",
        lastActivityAt: new Date().toISOString(),
      }) || this.session;

      for await (const event of activeConnection.sendPrompt({
        projectPath: this.session.projectPath,
        prompt,
        mode: this.session.mode || "ask",
        attachments,
        providerSessionId,
        signal: this.abortController.signal,
      })) {
        if (event.type === AgentEventType.TEXT_DELTA) appendText(event.text, "stdout");
        else if (event.type === AgentEventType.PERMISSION_REQUESTED) {
          const requestId = this.manager.registerPermissionRequest(sessionId, event.requestId, activeConnection, event.permission);
          this.manager.emitSessionEvent("permission_requested", sessionId, {
            messageId: agentMessage.id,
            requestId,
            permission: event.permission,
          }, this.session);
          pendingRaw += `${JSON.stringify(event.raw || event.permission)}\n`;
          scheduleMessageFlush();
        } else if (event.type === "permission_resolved") {
          this.manager.resolveProviderPermission(sessionId, event.requestId, activeConnection);
        } else if (event.type === AgentEventType.RAW) {
          if (event.duelOutput) {
            const output = event.duelOutput;
            const chunk = normalizeChunk(output.text);
            const stream = output.stream === "stderr" ? "stderr" : "stdout";
            pendingRaw += `${DUEL_OUTPUT_PREFIX}${JSON.stringify({ agentId: output.agentId, stream, text: chunk })}\n`;
            this.manager.appendSessionLog(sessionId, `${output.agentId}:${stream}`, chunk);
            const key = `${output.agentId}:${stream}`;
            const current = pendingDuelOutput.get(key);
            pendingDuelOutput.set(key, { agentId: output.agentId, stream, text: `${current?.text || ""}${chunk}` });
            scheduleMessageFlush();
            scheduleOutputFlush();
          } else if (event.stream === "stderr") appendText(event.text, "stderr");
          else if (event.providerSessionId) {
            this.session = this.manager.updateSession(sessionId, {
              nativeSessionId: event.providerSessionId,
              providerSessionId: event.providerSessionId,
              lastActivityAt: new Date().toISOString(),
            }) || this.session;
          } else if (event.raw) {
            pendingRaw += `${JSON.stringify(event.raw)}\n`;
            scheduleMessageFlush();
          }
        } else if (event.type === AgentEventType.ERROR) {
          throw event.error || new Error("Agent connector failed.");
        } else if (event.type === AgentEventType.COMPLETED) {
          result = event.result || { exitCode: 0, cancelled: false, providerSessionId };
        } else {
          this.manager.emitSessionEvent("agent_event", sessionId, { messageId: agentMessage.id, event }, this.session);
          if (event.raw) {
            pendingRaw += `${JSON.stringify(event.raw)}\n`;
            scheduleMessageFlush();
          }
        }
      }

      flushMessage();
      flushOutput();
      result = result || { exitCode: 0, cancelled: false, providerSessionId };
      const { stdout, stderr } = terminal.toJSON();
      const rawStdout = result.rawStdout || stdout;
      const duelResult = result.duelResults ? `${DUEL_RESULT_PREFIX}${JSON.stringify(result.duelResults)}` : null;
      const error = result.exitCode === 0 || result.cancelled
        ? null
        : classifyAgentError(this.session.agentType, `${stdout}\n${rawStdout}`, stderr || result.stderr || "");
      const finalStatus = result.cancelled ? "cancelled" : result.exitCode === 0 ? "completed" : "failed";
      const updatedMessage = this.manager.finishAgentMessage(agentMessage.id, {
        content: duelResult || stdout || (stderr ? error?.userMessage || stderr : ""),
        raw: duelResult || `${rawStdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`,
        status: finalStatus,
        error,
      });
      this.session = this.manager.updateSession(sessionId, {
        status: finalStatus === "failed" ? "failed" : "ready",
        nativeSessionId: result.providerSessionId || providerSessionId || this.session.nativeSessionId,
        providerSessionId: result.providerSessionId || providerSessionId || this.session.nativeSessionId,
        sessionMode: result.providerSessionId || providerSessionId ? "native-resume" : this.session.sessionMode,
        lastActivityAt: new Date().toISOString(),
        summary: updateSessionSummary(this.session.summary, this.manager.listRecentAgentMessages(sessionId, 2)),
      });
      await this.manager.finalizeSessionLog(sessionId, { status: finalStatus, exitCode: result.exitCode });
      this.manager.emitSessionEvent(error ? "agent_error" : "session_completed", sessionId,
        error ? { message: updatedMessage, error } : { message: updatedMessage }, this.session);
      return updatedMessage;
    } catch (error) {
      flushMessage();
      flushOutput();
      const parsed = classifyAgentError(this.session.agentType, "", error.message);
      const failedMessage = this.manager.finishAgentMessage(agentMessage.id, {
        content: parsed.userMessage, raw: error.message, status: "failed", error: parsed,
      });
      this.session = this.manager.updateSession(sessionId, { status: "failed", lastActivityAt: new Date().toISOString() });
      await this.manager.finalizeSessionLog(sessionId, { status: "failed", exitCode: null });
      this.manager.emitSessionEvent("agent_error", sessionId, { message: failedMessage, error: parsed }, this.session);
      return failedMessage;
    } finally {
      flushMessage();
      flushOutput();
      this.abortController = null;
      this.manager.clearPermissionRequests(sessionId);
      this.session = this.manager.getSessionById(sessionId);
    }
  }

  async respondToPermission(requestId, decision, optionId) {
    if (!this.connection?.respondToPermission) throw new Error("This session has no active permission-capable connection.");
    await this.connection.respondToPermission({ requestId, decision, optionId });
  }

  cancel() {
    this.abortController?.abort();
    this.connection?.cancel({ providerSessionId: this.session.nativeSessionId }).catch(() => {});
  }
}

module.exports = { AgentSession };
