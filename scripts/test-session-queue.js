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

  const mappedSession = sessionManager.updateSession("queued-session", {
    providerSessionId: "provider-session-1",
    nativeSessionId: "provider-session-1",
    connectionMode: "acp",
    protocol: "acp",
    transport: "stdio",
    connectionMetadata: { test: true },
  });
  assert.equal(mappedSession.providerSessionId, "provider-session-1");
  assert.equal(mappedSession.protocol, "acp");
  assert.equal(mappedSession.transport, "stdio");

  let permissionDecision = null;
  const publicPermissionId = sessionManager.registerPermissionRequest("queued-session", "request-1", {
    respondToPermission: async (value) => { permissionDecision = value; },
  });
  await sessionManager.respondToPermission("queued-session", publicPermissionId, { decision: "approve" });
  assert.deepEqual(permissionDecision, { requestId: "request-1", decision: "approve", optionId: undefined });
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

  // Reopen a persisted chat with a fresh connector, as after a backend restart.
  const { AgentSession } = require("../server/sessions/agentSession");
  const { AgentEventType } = require("../server/connections/types");
  for (const scenario of ["missing", "resumed", "protocol-changed", "no-provider-id"]) {
    const saved = sessionManager.updateSession("legacy-session", {
      agentType: "codex", mode: "execute", status: "ready",
      nativeSessionId: "saved-thread", providerSessionId: "saved-thread",
      protocol: scenario === "protocol-changed" ? "acp" : "codex_app_server",
    });
    sessionManager.createMessage({ sessionId: saved.id, role: "agent", content: "Saved conversation context" });
    const user = sessionManager.createMessage({ sessionId: saved.id, role: "user", content: "Current instruction" });
    let resumeCalls = 0;
    let createCalls = 0;
    let sent;
    const runtime = new AgentSession(sessionManager, saved);
    runtime.getConnection = async () => ({
      getStatus: async () => ({ protocol: "codex_app_server", transport: "stdio", capabilities: { supportsSessionResume: true } }),
      resumeSession: async (params) => {
        resumeCalls++;
        assert.equal(params.mode, "execute");
        assert.equal(params.providerSessionId, "saved-thread");
        if (scenario !== "resumed") throw new Error("Thread no longer available");
        return { providerSessionId: "saved-thread", resumed: true };
      },
      createSession: async () => {
        createCalls++;
        return { providerSessionId: scenario === "no-provider-id" ? null : "replacement-thread", resumed: false };
      },
      sendPrompt: async function* (params) {
        sent = params;
        yield { type: AgentEventType.TEXT_DELTA, text: "Recovered answer" };
        yield { type: AgentEventType.COMPLETED, result: { exitCode: 0, providerSessionId: params.providerSessionId } };
      },
    });
    const response = await runtime.sendMessage(user);
    assert.equal(response.status, "completed");
    assert.equal(sessionManager.getSessionById(saved.id).status, "ready");
    assert.equal(resumeCalls, scenario === "protocol-changed" ? 0 : 1);
    assert.equal(createCalls, scenario === "resumed" ? 0 : 1);
    assert.match(response.raw, /\[\[agentbridge:progress\]\]/);
    assert.match(sent.prompt, /Provide brief progress updates/);
    if (scenario === "resumed") assert.ok(sent.prompt.startsWith(user.content));
    else {
      assert.match(sent.prompt, /Saved conversation context/);
      assert.match(sent.prompt, /Current instruction/);
      assert.equal(sent.providerSessionId, scenario === "no-provider-id" ? null : "replacement-thread");
    }
    assert.equal(sessionManager.getSessionById(saved.id).nativeSessionId, sent.providerSessionId);
  }

  await sessionManager.finalizeSessionLog("queued-session", { status: "cancelled", exitCode: null });
  console.log("session queue tests passed");
}

main()
  .finally(() => {
    require("../server/services/notificationService").close();
    sessionManager.db?.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
