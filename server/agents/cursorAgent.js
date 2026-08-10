const fs = require("fs");
const path = require("path");
const { runProcess } = require("./runProcess");
const { resolveCursorAgentCommand, refreshProcessPath } = require("./cliPath");

/**
 * Cursor Agent CLI adapter.
 * Trust every non-interactive workspace explicitly. Ask/plan use Cursor's
 * read-only modes; execute omits --mode and force-approves tool calls.
 */
function buildCursorAgentArgs({ agentCommand, projectPath, prompt, mode = "ask" }) {
  const normalizedMode = String(mode || "ask").toLowerCase();
  const args = ["/d", "/c", agentCommand, "--print", "--trust"];

  if (normalizedMode === "execute") {
    // Cursor CLI only accepts ask/plan as explicit --mode values. Its default
    // --print mode has write/shell tools, and --force makes it headless.
    args.push("--force");
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

      return runProcess("cmd.exe", args, {
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
