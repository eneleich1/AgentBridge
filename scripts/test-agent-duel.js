const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentbridge-duel-"));
process.env.AGENTBRIDGE_DATA_DIR = temporaryRoot;

const { createDuelAgent } = require("../server/agents/duelAgent");
const { updateAgentConfig, updateAgentDuelSettings } = require("../server/agents/agentFactory");
const sessionManager = require("../server/sessions/sessionManager");

function fakeAgent(id, result, receivedPrompts) {
  return {
    async run({ prompt, onStdout, onStderr }) {
      receivedPrompts.push({ id, prompt });
      if (result.throw) throw new Error(result.throw);
      if (result.stdout) onStdout(result.stdout);
      if (result.stderr) onStderr(result.stderr);
      return {
        exitCode: result.exitCode,
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        cancelled: false,
      };
    },
  };
}

async function testRunsTheSameSafePromptForBothAgents() {
  const receivedPrompts = [];
  const streamed = [];
  const duel = createDuelAgent({
    cursorAgent: fakeAgent("cursor", { exitCode: 0, stdout: "Cursor proposal" }, receivedPrompts),
    codexAgent: fakeAgent("codex", { exitCode: 0, stdout: "Codex proposal" }, receivedPrompts),
  });

  const result = await duel.run({
    projectPath: temporaryRoot,
    prompt: "Design a project search feature.",
    onDuelOutput: (output) => streamed.push(output),
  });

  assert.equal(receivedPrompts.length, 2);
  assert.equal(receivedPrompts[0].prompt, receivedPrompts[1].prompt);
  assert.match(receivedPrompts[0].prompt, /proposal-only/i);
  assert.match(receivedPrompts[0].prompt, /Design a project search feature/);
  assert.equal(result.exitCode, 0);
  assert.equal(result.duelResults.cursor.content, "Cursor proposal");
  assert.equal(result.duelResults.codex.content, "Codex proposal");
  assert.deepEqual(streamed.map((output) => output.agentId).sort(), ["codex", "cursor"]);
}

async function testKeepsTheSuccessfulProposalWhenOneAgentFails() {
  const receivedPrompts = [];
  const duel = createDuelAgent({
    cursorAgent: fakeAgent("cursor", { throw: "Cursor unavailable" }, receivedPrompts),
    codexAgent: fakeAgent("codex", { exitCode: 0, stdout: "Fallback proposal" }, receivedPrompts),
  });

  const result = await duel.run({
    projectPath: temporaryRoot,
    prompt: "Compare approaches.",
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.duelResults.cursor.status, "failed");
  assert.match(result.duelResults.cursor.error, /Cursor unavailable/);
  assert.equal(result.duelResults.codex.status, "completed");
}

function insertDuelSession() {
  const timestamp = new Date().toISOString();
  sessionManager.db.prepare(`
    INSERT INTO sessions (
      id, project_id, project_path, project_name, agent_type, mode, session_mode,
      status, process_id, native_session_id, duel_winner, summary,
      created_at, updated_at, last_activity_at
    ) VALUES (
      @id, @projectId, @projectPath, @projectName, @agentType, @mode, @sessionMode,
      @status, @processId, @nativeSessionId, @duelWinner, @summary,
      @createdAt, @updatedAt, @lastActivityAt
    )
  `).run({
    id: "duel-session",
    projectId: "project-1",
    projectPath: temporaryRoot,
    projectName: "Duel test",
    agentType: "duel",
    mode: "plan",
    sessionMode: "context-replay",
    status: "ready",
    processId: null,
    nativeSessionId: null,
    duelWinner: null,
    summary: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastActivityAt: timestamp,
  });
}

async function testPersistsAndResetsTheSelectedWinner() {
  updateAgentConfig("cursor", { configured: true });
  updateAgentConfig("codex", { configured: true });
  updateAgentDuelSettings({ enabled: true });
  sessionManager.init();
  insertDuelSession();
  const duelMessage = sessionManager.createMessage({
    sessionId: "duel-session",
    role: "agent",
    content: '[[agentbridge:duel-result]]{"cursor":{"status":"completed"},"codex":{"status":"completed"}}',
    raw: '[[agentbridge:duel-result]]{"cursor":{"status":"completed"},"codex":{"status":"completed"}}',
    status: "completed",
  });

  const selected = sessionManager.selectDuelWinner("duel-session", duelMessage.id, "codex");
  assert.equal(selected.session.duelWinner, "codex");
  assert.equal(selected.message.duelWinner, "codex");
  assert.throws(
    () => sessionManager.selectDuelWinner("duel-session", duelMessage.id, "other"),
    /Winner must be cursor or codex/
  );

  sessionManager.activeRuns.add("occupied-slot-1");
  sessionManager.activeRuns.add("occupied-slot-2");
  await sessionManager.enqueueMessage("duel-session", { content: "Start another round." });
  assert.equal(sessionManager.getSessionById("duel-session").duelWinner, null);
  assert.equal(sessionManager.getMessageById(duelMessage.id).duelWinner, "codex");
  sessionManager.cancelSession("duel-session");
}

async function main() {
  await testRunsTheSameSafePromptForBothAgents();
  await testKeepsTheSuccessfulProposalWhenOneAgentFails();
  await testPersistsAndResetsTheSelectedWinner();
  console.log("Agent Duel tests passed");
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
