const fs = require("fs");
const path = require("path");
const { runProcess } = require("./runProcess");

/**
 * Cursor Agent CLI adapter.
 * Command (from cursor-bridge prototype):
 *   agent --print --trust --force --workspace <projectPath> <prompt>
 */
function createCursorAgent() {
  return {
    id: "cursor",
    name: "Cursor Agent",

    async run({ projectPath, prompt, onStdout, onStderr, signal }) {
      const resolved = path.resolve(projectPath);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Project path does not exist: ${resolved}`);
      }

      const args = [
        "/d",
        "/c",
        "agent",
        "--print",
        "--trust",
        "--force",
        "--workspace",
        resolved,
        prompt,
      ];

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
