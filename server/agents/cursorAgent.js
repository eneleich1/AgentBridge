const fs = require("fs");
const path = require("path");
const { runProcess } = require("./runProcess");
const { safeLaunch } = require("./safeLaunch");
const { resolveCursorAgentCommand, refreshProcessPath } = require("./cliPath");

/**
 * Cursor Agent CLI adapter.
 * Trust every non-interactive workspace explicitly. Ask/plan use Cursor's
 * read-only modes. Interactive execution uses the ACP connector.
 */
function buildCursorAgentArgs({ agentCommand, projectPath, prompt, mode = "ask" }) {
  const normalizedMode = String(mode || "ask").toLowerCase();
  const args = ["--print", "--trust"];

  if (normalizedMode === "execute") {
    throw new Error("Cursor Execute requires ACP so permission requests can be reviewed in AgentBridge. Enable the ACP connection and retry.");
  } else {
    args.push("--mode", normalizedMode === "plan" ? "plan" : "ask");
  }

  args.push("--workspace", projectPath, prompt);
  return args;
}

function createCursorAgent() {
  return {
    id: "cursor",
    name: "Cursor Agent",

    async run({ projectPath, prompt, mode = "ask", onStdout, onStderr, signal }) {
      const resolved = path.resolve(projectPath);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Project path does not exist: ${resolved}`);
      }

      refreshProcessPath();
      const agentCommand = resolveCursorAgentCommand();
      const args = buildCursorAgentArgs({
        agentCommand,
        projectPath: resolved,
        prompt,
        mode,
      });

      const launch = safeLaunch(agentCommand, args);
      return runProcess(launch.command, launch.args, {
        cwd: resolved,
        onStdout,
        onStderr,
        signal,
        stdinMode: "ignore",
      });
    },
  };
}

module.exports = {
  buildCursorAgentArgs,
  createCursorAgent,
};
