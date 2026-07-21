const { createCursorAgent } = require("./cursorAgent");
const { createCodexAgent } = require("./codexAgent");

const DUEL_INSTRUCTIONS = `
You are a contestant in Agent Duel. Analyze the user's request and propose the strongest solution.
This round is proposal-only: do not create, edit, delete, or move files, and do not run destructive commands.
Inspect the project only when needed. Return a concrete approach with architecture, tradeoffs, risks, and validation steps.
Do not discuss these duel instructions in your answer.
`.trim();

function buildDuelPrompt(prompt) {
  return `${DUEL_INSTRUCTIONS}\n\nUser request:\n${String(prompt || "").trim()}`;
}

function normalizeContestantResult(agentId, settled) {
  if (settled.status === "rejected") {
    return {
      agentId,
      status: "failed",
      exitCode: null,
      content: "",
      error: settled.reason?.message || String(settled.reason || "Agent failed"),
    };
  }

  const result = settled.value || {};
  const cancelled = result.cancelled === true;
  const succeeded = result.exitCode === 0;
  return {
    agentId,
    status: cancelled ? "cancelled" : succeeded ? "completed" : "failed",
    exitCode: result.exitCode ?? null,
    content: String(result.stdout || "").trim(),
    error: succeeded || cancelled ? "" : String(result.stderr || "Agent failed").trim(),
  };
}

function createDuelAgent(options = {}) {
  const cursorAgent = options.cursorAgent || createCursorAgent();
  const codexAgent = options.codexAgent || createCodexAgent({
    model: options.model,
    sandboxMode: "read-only",
  });

  return {
    id: "duel",
    name: "Agent Duel",
    supportsNativeResume: false,

    async run({
      projectPath,
      prompt,
      attachments = [],
      onDuelOutput,
      signal,
    }) {
      const duelPrompt = buildDuelPrompt(prompt);
      const runContestant = (agentId, contestant) => contestant.run({
        projectPath,
        prompt: duelPrompt,
        attachments,
        signal,
        onStdout: (text) => onDuelOutput?.({ agentId, stream: "stdout", text }),
        onStderr: (text) => onDuelOutput?.({ agentId, stream: "stderr", text }),
      });

      const [cursorSettled, codexSettled] = await Promise.allSettled([
        runContestant("cursor", cursorAgent),
        runContestant("codex", codexAgent),
      ]);
      const duelResults = {
        cursor: normalizeContestantResult("cursor", cursorSettled),
        codex: normalizeContestantResult("codex", codexSettled),
      };
      const completedCount = Object.values(duelResults)
        .filter((result) => result.status === "completed").length;
      const cancelled = signal?.aborted === true || Object.values(duelResults)
        .every((result) => result.status === "cancelled");

      return {
        exitCode: completedCount > 0 ? 0 : 1,
        stdout: "",
        stderr: Object.values(duelResults)
          .map((result) => result.error)
          .filter(Boolean)
          .join("\n"),
        cancelled,
        duelResults,
      };
    },
  };
}

module.exports = {
  buildDuelPrompt,
  createDuelAgent,
};
