const assert = require("node:assert/strict");

const { buildCursorAgentArgs } = require("../server/agents/cursorAgent");
const {
  buildSessionReplayPrompt,
  classifyAgentError,
} = require("../server/sessions/messageParser");

function argsFor(mode) {
  return buildCursorAgentArgs({
    agentCommand: "agent",
    projectPath: "C:\\projects\\NeedA",
    prompt: "Test prompt",
    mode,
  });
}

function main() {
  const ask = argsFor("ask");
  assert.deepEqual(ask, [
    "--print", "--trust", "--mode", "ask",
    "--workspace", "C:\\projects\\NeedA", "Test prompt",
  ]);
  assert.equal(ask.includes("--force"), false);

  const plan = argsFor("plan");
  assert.equal(plan.includes("--trust"), true);
  assert.equal(plan.at(plan.indexOf("--mode") + 1), "plan");
  assert.equal(plan.includes("--force"), false);

  assert.throws(() => argsFor("execute"), /requires ACP/);

  const fallback = argsFor("unexpected");
  assert.equal(fallback.at(fallback.indexOf("--mode") + 1), "ask");

  const trustError = classifyAgentError(
    "cursor",
    "",
    "Workspace Trust Required\nDo you trust the contents of this directory?"
  );
  assert.equal(trustError.type, "workspace_trust");

  const replayPrompt = buildSessionReplayPrompt(
    {
      projectId: "project-1",
      projectName: "NeedA",
      projectPath: "C:\\projects\\NeedA",
      agentType: "cursor",
      summary: "An implementation task is unfinished.",
    },
    [
      { role: "user", content: "Implement the pending designs." },
      { role: "agent", content: "Switch to Execute mode and ask me to continue." },
    ],
    "hola"
  );
  assert.match(replayPrompt, /Current user request:\nhola/);
  assert.match(
    replayPrompt,
    /Do not resume or execute unfinished work.*unless the current user request explicitly asks/
  );
  assert.match(
    replayPrompt,
    /A greeting, acknowledgement, or mode change is not authorization/
  );

  console.log("cursor agent tests passed");
}

main();
