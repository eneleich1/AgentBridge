const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { v4: uuidv4 } = require("uuid");
const setupService = require("../services/setupService");
const projectService = require("../services/projectService");
const logService = require("../services/logService");
const attachmentService = require("../services/attachmentService");
const { getMaxConcurrency } = require("../agents/agentFactory");
const { broadcast } = require("../realtime/websocket");
const { DATA_DIR } = require("../utils/runtimeConfig");
const { AgentSession } = require("./agentSession");

const DB_PATH = path.join(DATA_DIR, "agentbridge.sqlite");

class SessionManager {
  constructor() {
    this.db = null;
    this.activeRuns = new Set();
    this.runtimeSessions = new Map();
    this.queue = [];
    this.projectLocks = new Map();
    this.maxActiveSessions = 2;
  }

  init() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    this.db = new Database(DB_PATH);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        project_path TEXT NOT NULL,
        project_name TEXT,
        agent_type TEXT NOT NULL,
        mode TEXT NOT NULL,
        session_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        process_id INTEGER,
        native_session_id TEXT,
        summary TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT DEFAULT '',
        raw TEXT DEFAULT '',
        attachments TEXT DEFAULT '[]',
        status TEXT NOT NULL,
        error_type TEXT,
        user_message TEXT,
        technical_message TEXT,
        fix_steps TEXT DEFAULT '[]',
        created_at TEXT NOT NULL
      );
    `);
    this.ensureColumn("sessions", "native_session_id", "TEXT");
  }

  ensureColumn(table, column, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.some((info) => info.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  rowToSession(row) {
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      projectPath: row.project_path,
      projectName: row.project_name,
      agentType: row.agent_type,
      mode: row.mode,
      sessionMode: row.session_mode,
      status: row.status,
      processId: row.process_id,
      nativeSessionId: row.native_session_id || null,
      summary: row.summary || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActivityAt: row.last_activity_at,
    };
  }

  rowToMessage(row) {
    if (!row) return null;
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      raw: row.raw,
      attachments: this.parseJson(row.attachments, []),
      createdAt: row.created_at,
      status: row.status,
      error: row.error_type
        ? {
            type: row.error_type,
            userMessage: row.user_message,
            technicalMessage: row.technical_message,
            fixSteps: this.parseJson(row.fix_steps, []),
          }
        : null,
    };
  }

  parseJson(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  now() {
    return new Date().toISOString();
  }

  async createSession({ projectId, agentType, mode }) {
    const setup = await setupService.assertCanRunTask({ agentType, projectId });
    const project = projectService.getProjectById(projectId);
    if (!project) {
      throw new Error("Select a valid project before creating a chat.");
    }

    const timestamp = this.now();
    const session = {
      id: uuidv4(),
      projectId,
      projectPath: project.path,
      projectName: project.name,
      agentType,
      mode: mode || "ask",
      sessionMode: agentType === "codex" ? "native-resume" : "context-replay",
      status: setupService.isAgentReady(agentType, setup) ? "ready" : "failed",
      processId: null,
      nativeSessionId: null,
      summary: "",
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
    };

    this.db.prepare(`
      INSERT INTO sessions (
        id, project_id, project_path, project_name, agent_type, mode, session_mode,
        status, process_id, native_session_id, summary, created_at, updated_at, last_activity_at
      ) VALUES (
        @id, @projectId, @projectPath, @projectName, @agentType, @mode, @sessionMode,
        @status, @processId, @nativeSessionId, @summary, @createdAt, @updatedAt, @lastActivityAt
      )
    `).run(session);

    logService.writeSessionLogHeader(session.id, {
      agentType: session.agentType,
      projectPath: session.projectPath,
      sessionMode: session.sessionMode,
      startedAt: session.createdAt,
    });

    const created = this.getSessionById(session.id);
    this.emitSessionEvent("session_started", created.id, { session: created });
    this.emitSessionEvent("session_ready", created.id, { session: created });
    return created;
  }

  listSessions(projectId = null, limit = 100) {
    const query = projectId
      ? this.db
          .prepare("SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?")
          .all(projectId, limit)
      : this.db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?").all(limit);
    return query.map((row) => this.rowToSession(row));
  }

  getSessionById(sessionId) {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
    return this.rowToSession(row);
  }

  getSessionDetails(sessionId) {
    const session = this.getSessionById(sessionId);
    if (!session) return null;
    return {
      ...session,
      messages: this.listMessages(sessionId),
    };
  }

  updateSession(sessionId, fields) {
    const current = this.getSessionById(sessionId);
    if (!current) return null;
    const next = {
      ...current,
      ...fields,
      updatedAt: this.now(),
    };
    this.db.prepare(`
      UPDATE sessions SET
        mode = @mode,
        session_mode = @sessionMode,
        status = @status,
        process_id = @processId,
        native_session_id = @nativeSessionId,
        summary = @summary,
        updated_at = @updatedAt,
        last_activity_at = @lastActivityAt
      WHERE id = @id
    `).run({
      id: sessionId,
      mode: next.mode,
      sessionMode: next.sessionMode,
      status: next.status,
      processId: next.processId,
      nativeSessionId: next.nativeSessionId || null,
      summary: next.summary,
      updatedAt: next.updatedAt,
      lastActivityAt: next.lastActivityAt || next.updatedAt,
    });
    return this.getSessionById(sessionId);
  }

  createMessage({ sessionId, role, content, raw, attachments = [], status = "completed", error = null }) {
    const message = {
      id: uuidv4(),
      sessionId,
      role,
      content: content || "",
      raw: raw || "",
      attachments,
      status,
      createdAt: this.now(),
      errorType: error?.type || null,
      userMessage: error?.userMessage || null,
      technicalMessage: error?.technicalMessage || null,
      fixSteps: JSON.stringify(error?.fixSteps || []),
    };

    this.db.prepare(`
      INSERT INTO session_messages (
        id, session_id, role, content, raw, attachments, status,
        error_type, user_message, technical_message, fix_steps, created_at
      ) VALUES (
        @id, @sessionId, @role, @content, @raw, @attachments, @status,
        @errorType, @userMessage, @technicalMessage, @fixSteps, @createdAt
      )
    `).run({
      ...message,
      attachments: JSON.stringify(attachments || []),
    });

    this.updateSession(sessionId, { lastActivityAt: this.now() });
    return this.getMessageById(message.id);
  }

  getMessageById(messageId) {
    const row = this.db.prepare("SELECT * FROM session_messages WHERE id = ?").get(messageId);
    return this.rowToMessage(row);
  }

  getMessageRowById(messageId) {
    return this.db.prepare("SELECT * FROM session_messages WHERE id = ?").get(messageId);
  }

  listMessages(sessionId) {
    const rows = this.db
      .prepare("SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId);
    return rows.map((row) => this.rowToMessage(row));
  }

  listRecentMessages(sessionId, limit = 8, excludeMessageId = null) {
    const rows = excludeMessageId
      ? this.db
          .prepare(`
            SELECT * FROM session_messages
            WHERE session_id = ? AND id != ?
            ORDER BY created_at DESC
            LIMIT ?
          `)
          .all(sessionId, excludeMessageId, limit)
      : this.db
          .prepare(`
            SELECT * FROM session_messages
            WHERE session_id = ?
            ORDER BY created_at DESC
            LIMIT ?
          `)
          .all(sessionId, limit);

    return rows.reverse().map((row) => this.rowToMessage(row));
  }

  listRecentAgentMessages(sessionId, limit = 2) {
    const rows = this.db
      .prepare(`
        SELECT * FROM session_messages
        WHERE session_id = ? AND role = 'agent' AND content != ''
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(sessionId, limit);

    return rows.reverse().map((row) => this.rowToMessage(row));
  }

  appendMessageChunk(messageId, field, text) {
    const current = this.getMessageById(messageId);
    if (!current) return null;
    const content = field === "raw" ? current.raw + text : current.content + text;
    this.db.prepare(`UPDATE session_messages SET ${field} = ? WHERE id = ?`).run(content, messageId);
    return this.getMessageById(messageId);
  }

  appendMessageChunks(messageId, { content = "", raw = "" }) {
    if (!content && !raw) return null;

    this.db
      .prepare(`
        UPDATE session_messages
        SET
          content = content || ?,
          raw = raw || ?
        WHERE id = ?
      `)
      .run(content, raw, messageId);

    return null;
  }

  finishAgentMessage(messageId, { content, raw, status, error }) {
    this.db.prepare(`
      UPDATE session_messages SET
        content = ?,
        raw = ?,
        status = ?,
        error_type = ?,
        user_message = ?,
        technical_message = ?,
        fix_steps = ?
      WHERE id = ?
    `).run(
      content || "",
      raw || "",
      status || "completed",
      error?.type || null,
      error?.userMessage || null,
      error?.technicalMessage || null,
      JSON.stringify(error?.fixSteps || []),
      messageId
    );
    return this.getMessageById(messageId);
  }

  async enqueueMessage(sessionId, { content, attachments = [] }) {
    const session = this.getSessionById(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    if (!content?.trim() && attachments.length === 0) {
      throw new Error("Message content or attachments are required");
    }

    this.assertProjectLock(session);

    const userMessageId = uuidv4();
    const savedAttachments = attachmentService.saveTaskAttachments(userMessageId, attachments);
    const promptText = content?.trim() || "Review the attached image.";
    const message = this.createMessage({
      sessionId,
      role: "user",
      content: promptText,
      raw: promptText,
      attachments: savedAttachments,
      status: "completed",
    });

    this.appendSessionLog(sessionId, "system", `User: ${promptText}\n`);
    this.emitSessionEvent("message_added", sessionId, { message });

    this.queue.push({ sessionId, messageId: message.id, attachments: savedAttachments });
    this.processQueue();

    return { messageId: message.id, status: "queued" };
  }

  async reviseAndReplayMessage(sessionId, messageId, { content }) {
    const session = this.getSessionById(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    if (this.activeRuns.has(sessionId) || session.status === "running") {
      throw new Error("Cannot edit a message while the session is running.");
    }

    const row = this.getMessageRowById(messageId);
    if (!row || row.session_id !== sessionId || row.role !== "user") {
      throw new Error("Select a valid user message to edit.");
    }

    const promptText = String(content || "").trim();
    if (!promptText) {
      throw new Error("Message content is required.");
    }

    this.queue = this.queue.filter((entry) => entry.sessionId !== sessionId);
    this.db.prepare(`
      DELETE FROM session_messages
      WHERE session_id = ? AND created_at > ?
    `).run(sessionId, row.created_at);

    this.db.prepare(`
      UPDATE session_messages SET
        content = ?,
        raw = ?,
        status = 'completed',
        error_type = NULL,
        user_message = NULL,
        technical_message = NULL,
        fix_steps = '[]'
      WHERE id = ?
    `).run(promptText, promptText, messageId);

    const updatedSession = this.updateSession(sessionId, {
      status: "ready",
      nativeSessionId: null,
      sessionMode: session.agentType === "codex" ? "context-replay" : session.sessionMode,
      lastActivityAt: this.now(),
    });
    this.runtimeSessions.delete(sessionId);
    const message = this.getMessageById(messageId);
    const attachments = message.attachments || [];

    this.appendSessionLog(sessionId, "system", `Edited user message: ${promptText}\n`);
    this.emitSessionEvent("session_rewound", sessionId, {
      message,
      messages: this.listMessages(sessionId),
    }, updatedSession);

    this.queue.push({ sessionId, messageId, attachments });
    this.processQueue();

    return {
      messageId,
      status: "queued",
      session: updatedSession,
      messages: this.listMessages(sessionId),
    };
  }

  markSessionRunning(sessionId) {
    const session = this.getSessionById(sessionId);
    if (!session) return null;
    this.activeRuns.add(sessionId);
    this.lockProject(session);
    return this.updateSession(sessionId, {
      status: "running",
      lastActivityAt: this.now(),
    });
  }

  lockProject(session) {
    if (session.mode !== "execute") return;
    this.projectLocks.set(session.projectId, session.id);
  }

  unlockProject(session) {
    if (!session || session.mode !== "execute") return;
    if (this.projectLocks.get(session.projectId) === session.id) {
      this.projectLocks.delete(session.projectId);
    }
  }

  assertProjectLock(session) {
    const lockedBy = this.projectLocks.get(session.projectId);
    if (session.mode === "execute" && lockedBy && lockedBy !== session.id) {
      throw new Error("Another write session is already running for this project.");
    }
  }

  async processQueue() {
    const maxActiveSessions = getMaxConcurrency() || this.maxActiveSessions;
    while (this.activeRuns.size < maxActiveSessions && this.queue.length > 0) {
      const next = this.queue.shift();
      this.runQueuedMessage(next).catch(() => {
        // Errors are converted into failed messages inside the session runner.
      });
    }
  }

  async runQueuedMessage(entry) {
    const session = this.getSessionById(entry.sessionId);
    if (!session) return;

    const runtime = this.runtimeSessions.get(session.id) || new AgentSession(this, session);
    this.runtimeSessions.set(session.id, runtime);

    try {
      await runtime.sendMessage(this.getMessageById(entry.messageId), entry.attachments);
    } finally {
      this.activeRuns.delete(session.id);
      this.unlockProject(this.getSessionById(session.id));
      this.processQueue();
    }
  }

  appendSessionLog(sessionId, stream, text) {
    logService.appendSessionLog(sessionId, stream, text);
  }

  finalizeSessionLog(sessionId, meta) {
    return logService.finalizeSessionLog(sessionId, {
      finishedAt: this.now(),
      exitCode: meta.exitCode,
      status: meta.status,
    });
  }

  emitSessionEvent(type, sessionId, payload = {}, sessionOverride = null) {
    const session = sessionOverride || this.getSessionById(sessionId);
    broadcast({
      type,
      sessionId,
      session,
      payload,
    });
  }

  deleteSession(sessionId) {
    const session = this.getSessionById(sessionId);
    if (!session) return null;

    const runtime = this.runtimeSessions.get(sessionId);
    if (runtime) runtime.cancel();

    this.queue = this.queue.filter((entry) => entry.sessionId !== sessionId);
    this.activeRuns.delete(sessionId);
    this.unlockProject(session);

    this.db.prepare("DELETE FROM session_messages WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    this.emitSessionEvent("session_failed", sessionId, { reason: "deleted" });
    return session;
  }

  deleteSessionsForProject(projectId) {
    const sessions = this.listSessions(projectId, 1000);
    for (const session of sessions) {
      this.deleteSession(session.id);
    }
    return sessions.length;
  }

  cancelSession(sessionId) {
    const session = this.getSessionById(sessionId);
    if (!session) return null;

    const runtime = this.runtimeSessions.get(sessionId);
    if (runtime) {
      runtime.cancel();
    }

    this.queue = this.queue.filter((entry) => entry.sessionId !== sessionId);
    this.updateSession(sessionId, {
      status: runtime ? "running" : "ready",
      lastActivityAt: this.now(),
    });
    return this.getSessionById(sessionId);
  }
}

const sessionManager = new SessionManager();

module.exports = sessionManager;
