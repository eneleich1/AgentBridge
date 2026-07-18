const path = require("path");
const fs = require("fs");
const { createCursorAgent } = require("../server/agents/cursorAgent");

const projectPath = process.argv[2] || process.cwd();
const prompt = process.argv.slice(3).join(" ") || "List the files in the project root.";

if (!fs.existsSync(projectPath)) {
  console.error(`Project path does not exist: ${projectPath}`);
  process.exit(1);
}

console.log("[test-cursor]");
console.log(`Project: ${projectPath}`);
console.log(`Prompt: ${prompt}`);
console.log("");

const agent = createCursorAgent();

agent
  .run({
    projectPath: path.resolve(projectPath),
    prompt,
    onStdout: (text) => process.stdout.write(text),
    onStderr: (text) => process.stderr.write(text),
  })
  .then((result) => {
    console.log(`\n[exit code] ${result.exitCode}`);
    process.exit(result.exitCode === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
