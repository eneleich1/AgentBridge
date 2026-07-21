const fs = require("fs");
const path = require("path");
const { runProcess } = require("./runProcess");
const { resolveCursorAgentCommand, refreshProcessPath } = require("./cliPath");

/**
 * Cursor Agent CLI adapter.
 * Ask/plan use read-only CLI modes. Execute keeps tool access with --trust/--force.
 */
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
      const normalizedMode = String(mode || "ask").toLowerCase();

      const args = ["/d", "/c", agentCommand, "--print"];

      if (normalizedMode === "plan") {
        args.push("--mode", "plan");
      } else if (normalizedMode === "execute") {
        args.push("--trust", "--force");
      } else {
        args.push("--mode", "ask");
      }

      args.push("--workspace", resolved, prompt);

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
  createCursorAgent,
};
