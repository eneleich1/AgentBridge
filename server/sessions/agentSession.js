const { getAgent } = require("../agents/agentFactory");
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
  }

  async sendMessage(userMessage, attachments = [], queuedAgentMessage = null) {
    const sessionId = this.session.id;
    const agentMessage = queuedAgentMessage
      ? this.manager.setMessageStatus(queuedAgentMessage.id, "running")
      : this.manager.createMessage({
          sessionId,
          role: "agent",
          content: "",
          raw: "",
          status: "running",
        });

    const terminal = new TerminalBuffer();
    const agent = getAgent(this.session.agentType);
    const canNativeResume = Boolean(agent.supportsNativeResume);
    const shouldResumeNative = canNativeResume && Boolean(this.session.nativeSessionId);
    const previousMessages = shouldResumeNative
      ? []
      : this.manager.listRecentMessages(sessionId, 8, userMessage.id);
    const prompt = shouldResumeNative
      ? userMessage.content
      : buildSessionReplayPrompt(this.session, previousMessages, userMessage.content);
    this.abortController = new AbortController();
    let pendingContent = "";
    let pendingRaw = "";
    let pendingStdout = "";
    let pendingStderr = "";
    const pendingDuelOutput = new Map();
    let messageFlushTimer = null;
    let outputFlushTimer = null;

    const flushMessage = () => {
      if (messageFlushTimer) {
        clearTimeout(messageFlushTimer);
        messageFlushTimer = null;
      }
      if (!pendingContent && !pendingRaw) return;
      const content = pendingContent;
      const raw = pendingRaw;
      pendingContent = "";
      pendingRaw = "";
      this.manager.appendMessageChunks(agentMessage.id, { content, raw });
    };

    const scheduleMessageFlush = () => {
      if (!messageFlushTimer) {
        messageFlushTimer = setTimeout(flushMessage, 100);
      }
    };

    const flushOutput = () => {
      if (outputFlushTimer) {
        clearTimeout(outputFlushTimer);
        outputFlushTimer = null;
      }
      if (pendingStdout) {
        const text = pendingStdout;
        pendingStdout = "";
        this.manager.emitSessionEvent("agent_output", sessionId, {
          messageId: agentMessage.id,
          stream: "stdout",
          text,
        }, this.session);
      }
      if (pendingStderr) {
        const text = pendingStderr;
        pendingStderr = "";
        this.manager.emitSessionEvent("agent_output", sessionId, {
          messageId: agentMessage.id,
          stream: "stderr",
          text,
        }, this.session);
      }
      for (const [key, output] of pendingDuelOutput) {
        pendingDuelOutput.delete(key);
        this.manager.emitSessionEvent("duel_output", sessionId, {
          messageId: agentMessage.id,
          agentId: output.agentId,
          stream: output.stream,
          text: output.text,
        }, this.session);
      }
    };

    const scheduleOutputFlush = () => {
      if (!outputFlushTimer) {
        outputFlushTimer = setTimeout(flushOutput, 50);
      }
    };

    this.session = this.manager.markSessionRunning(sessionId) || this.session;
    this.manager.emitSessionEvent("message_added", sessionId, { message: agentMessage }, this.session);

    try {
      const result = await agent.run({
        projectPath: this.session.projectPath,
        prompt,
        mode: this.session.mode || "ask",
        attachments,
        nativeSessionId: shouldResumeNative ? this.session.nativeSessionId : null,
        signal: this.abortController.signal,
        onNativeSession: (nativeSessionId) => {
          this.session = this.manager.updateSession(sessionId, {
            nativeSessionId,
            sessionMode: "native-resume",
            lastActivityAt: new Date().toISOString(),
          }) || this.session;
        },
        onStdout: (text) => {
          const chunk = normalizeChunk(text);
          terminal.append("stdout", chunk);
          this.manager.appendSessionLog(sessionId, "stdout", chunk);
          pendingContent += chunk;
          pendingRaw += chunk;
          pendingStdout += chunk;
          scheduleMessageFlush();
          scheduleOutputFlush();
        },
        onStderr: (text) => {
          const chunk = normalizeChunk(text);
          terminal.append("stderr", chunk);
          this.manager.appendSessionLog(sessionId, "stderr", chunk);
          pendingRaw += chunk;
          pendingStderr += chunk;
          scheduleMessageFlush();
          scheduleOutputFlush();
        },
        onDuelOutput: ({ agentId, stream, text }) => {
          const chunk = normalizeChunk(text);
          if (!chunk) return;
          const normalizedStream = stream === "stderr" ? "stderr" : "stdout";
          const marker = `${DUEL_OUTPUT_PREFIX}${JSON.stringify({
            agentId,
            stream: normalizedStream,
            text: chunk,
          })}\n`;
          this.manager.appendSessionLog(sessionId, `${agentId}:${normalizedStream}`, chunk);
          pendingRaw += marker;
          const key = `${agentId}:${normalizedStream}`;
          const current = pendingDuelOutput.get(key);
          pendingDuelOutput.set(key, {
            agentId,
            stream: normalizedStream,
            text: `${current?.text || ""}${chunk}`,
          });
          scheduleMessageFlush();
          scheduleOutputFlush();
        },
      });

      flushMessage();
      flushOutput();

      const { stdout, stderr } = terminal.toJSON();
      const rawStdout = result.rawStdout || stdout;
      const duelResult = result.duelResults
        ? `${DUEL_RESULT_PREFIX}${JSON.stringify(result.duelResults)}`
        : null;
      const error = result.exitCode === 0 || result.cancelled
        ? null
        : classifyAgentError(this.session.agentType, `${stdout}\n${rawStdout}`, stderr);

      const finalStatus = result.cancelled ? "cancelled" : result.exitCode === 0 ? "completed" : "failed";
      const updatedMessage = this.manager.finishAgentMessage(agentMessage.id, {
        content: duelResult || stdout || (stderr ? error?.userMessage || stderr : ""),
        raw: duelResult || `${rawStdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`,
        status: finalStatus,
        error,
      });

      this.session = this.manager.updateSession(sessionId, {
        status: finalStatus === "completed" ? "ready" : finalStatus === "cancelled" ? "ready" : "failed",
        nativeSessionId: result.nativeSessionId || this.session.nativeSessionId,
        sessionMode: result.nativeSessionId || this.session.nativeSessionId
          ? "native-resume"
          : this.session.sessionMode,
        lastActivityAt: new Date().toISOString(),
        summary: updateSessionSummary(
          this.session.summary,
          this.manager.listRecentAgentMessages(sessionId, 2)
        ),
      });
      await this.manager.finalizeSessionLog(sessionId, {
        status: finalStatus,
        exitCode: result.exitCode,
      });
      this.manager.emitSessionEvent(
        error ? "agent_error" : "session_completed",
        sessionId,
        error ? { message: updatedMessage, error } : { message: updatedMessage },
        this.session
      );
      return updatedMessage;
    } catch (error) {
      flushMessage();
      flushOutput();
      const parsed = classifyAgentError(this.session.agentType, "", error.message);
      const failedMessage = this.manager.finishAgentMessage(agentMessage.id, {
        content: parsed.userMessage,
        raw: error.message,
        status: "failed",
        error: parsed,
      });
      this.session = this.manager.updateSession(sessionId, {
        status: "failed",
        lastActivityAt: new Date().toISOString(),
      });
      await this.manager.finalizeSessionLog(sessionId, {
        status: "failed",
        exitCode: null,
      });
      this.manager.emitSessionEvent("agent_error", sessionId, {
        message: failedMessage,
        error: parsed,
      }, this.session);
      return failedMessage;
    } finally {
      flushMessage();
      flushOutput();
      this.abortController = null;
      this.session = this.manager.getSessionById(sessionId);
    }
  }

  cancel() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}

module.exports = {
  AgentSession,
};
