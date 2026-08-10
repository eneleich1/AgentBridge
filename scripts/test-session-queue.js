const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentbridge-session-queue-"));
process.env.AGENTBRIDGE_DATA_DIR = temporaryRoot;

const setupService = require("../server/services/setupService");
setupService.assertCanRunTask = async () => ({ checks: { hasProject: true } });
const sessionManager = require("../server/sessions/sessionManager");

async function main() {
  sessionManager.init();
  const now = new Date().toISOString();

  const insertSession = sessionManager.db.prepare(`
    INSERT INTO sessions (
      id, project_id, project_path, project_name, agent_type, mode, session_mode,
      status, process_id, native_session_id, summary, created_at, updated_at, last_activity_at
    ) VALUES (
      @id, @projectId, @projectPath, @projectName, @agentType, @mode, @sessionMode,
      @status, @processId, @nativeSessionId, @summary, @createdAt, @updatedAt, @lastActivityAt
    )
  `);
  insertSession.run({
    id: "queued-session",
    projectId: "project-1",
    projectPath: temporaryRoot,
    projectName: "Test project",
    agentType: "codex",
    mode: "execute",
    sessionMode: "native-resume",
    status: "ready",
    processId: null,
    nativeSessionId: null,
    summary: "",
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  });

  sessionManager.activeRuns.add("occupied-slot");
  sessionManager.projectLocks.set("project-1", "occupied-slot");
  const queued = await sessionManager.enqueueMessage("queued-session", {
    content: "Wait for the active session.",
  });

  assert.equal(queued.status, "queued");
  assert.equal(sessionManager.getSessionById("queued-session").status, "queued");
  assert.equal(sessionManager.queue.length, 1);
  const pendingMessages = sessionManager.listMessages("queued-session");
  assert.equal(pendingMessages.length, 2);
  assert.equal(pendingMessages[0].role, "user");
  assert.equal(pendingMessages[1].role, "agent");
  assert.equal(pendingMessages[1].status, "queued");
  assert.equal(pendingMessages[1].replyToMessageId, pendingMessages[0].id);
  assert.equal(queued.queuedMessageId, pendingMessages[1].id);

  await assert.rejects(
    sessionManager.enqueueMessage("queued-session", { content: "Duplicate" }),
    /already has a message running or queued/
  );

  const cancelled = sessionManager.cancelSession("queued-session");
  assert.equal(cancelled.status, "ready");
  assert.equal(sessionManager.queue.length, 0);
  assert.equal(sessionManager.getMessageById(queued.queuedMessageId).status, "cancelled");

  const executeSession = sessionManager.setSessionMode("queued-session", "execute");
  assert.equal(executeSession.mode, "execute");
  assert.throws(
    () => sessionManager.setSessionMode("queued-session", "invalid"),
    /Mode must be ask, plan, or execute/
  );

  sessionManager.runtimeSessions.set("queued-session", { stale: true });
  const cursorSession = await sessionManager.setSessionAgent("queued-session", "cursor");
  assert.equal(cursorSession.agentType, "cursor");
  assert.equal(cursorSession.sessionMode, "context-replay");
  assert.equal(cursorSession.nativeSessionId, null);
  assert.equal(sessionManager.runtimeSessions.has("queued-session"), false);
  await assert.rejects(
    sessionManager.setSessionAgent("queued-session", "duel"),
    /switch only between Cursor and Codex/
  );

  sessionManager.updateSession("queued-session", { status: "running" });
  assert.throws(
    () => sessionManager.setSessionMode("queued-session", "ask"),
    /finish before changing mode/
  );
  await assert.rejects(
    sessionManager.setSessionAgent("queued-session", "codex"),
    /finish before changing agents/
  );
  sessionManager.updateSession("queued-session", { status: "ready" });

  insertSession.run({
    id: "legacy-session",
    projectId: "project-2",
    projectPath: temporaryRoot,
    projectName: "Legacy project",
    agentType: "codex",
    mode: "ask",
    sessionMode: "native-resume",
    status: "ready",
    processId: null,
    nativeSessionId: null,
    summary: "",
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  });
  const legacyUserMessage = sessionManager.createMessage({
    sessionId: "legacy-session",
    role: "user",
    content: "Recover this instruction.",
    raw: "Recover this instruction.",
  });

  sessionManager.restorePendingQueue();
  assert.equal(sessionManager.queue.length, 1);
  assert.equal(sessionManager.queue[0].messageId, legacyUserMessage.id);
  assert.equal(sessionManager.getSessionById("legacy-session").status, "queued");
  const legacyMessages = sessionManager.listMessages("legacy-session");
  assert.equal(legacyMessages.at(-1).role, "agent");
  assert.equal(legacyMessages.at(-1).status, "queued");

  sessionManager.queue = [];
  sessionManager.restorePendingQueue();
  assert.equal(sessionManager.queue.length, 1);
  assert.equal(sessionManager.queue[0].messageId, legacyUserMessage.id);

  sessionManager.cancelSession("legacy-session");

  insertSession.run({
    id: "interrupted-session",
    projectId: "project-3",
    projectPath: temporaryRoot,
    projectName: "Interrupted project",
    agentType: "codex",
    mode: "ask",
    sessionMode: "native-resume",
    status: "running",
    processId: 1234,
    nativeSessionId: null,
    summary: "",
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  });
  const interruptedUser = sessionManager.createMessage({
    sessionId: "interrupted-session",
    role: "user",
    content: "Interrupted instruction.",
    raw: "Interrupted instruction.",
  });
  const interruptedAgent = sessionManager.createMessage({
    sessionId: "interrupted-session",
    role: "agent",
    content: "Partial work.",
    raw: "Partial work.",
    status: "running",
    replyToMessageId: interruptedUser.id,
  });

  sessionManager.restorePendingQueue();
  assert.equal(sessionManager.getSessionById("interrupted-session").status, "failed");
  assert.equal(sessionManager.getMessageById(interruptedAgent.id).status, "failed");

  console.log("session queue tests passed");
}

main()
  .finally(() => {
    sessionManager.db?.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
