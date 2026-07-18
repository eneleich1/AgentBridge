const { spawn } = require("child_process");
const fs = require("fs");

const projectPath = process.argv[2];
const prompt = process.argv.slice(3).join(" ");

if (!projectPath || !prompt) {
    console.log("Usage:");
    console.log('node codex-bridge.js "<project-path>" "<prompt>"');
    process.exit(1);
}

if (!fs.existsSync(projectPath)) {
    console.log("[BRIDGE ERROR]");
    console.log(`Project path does not exist: ${projectPath}`);
    process.exit(1);
}

console.log("[BRIDGE]");
console.log(`Project: ${projectPath}`);
console.log(`Prompt: ${prompt}`);
console.log("Command: codex.cmd exec --sandbox workspace-write -");
console.log("");

const codex = spawn(
    "cmd.exe",
    ["/d", "/c", "codex.cmd exec --sandbox workspace-write --skip-git-repo-check -"],
    {
        cwd: projectPath,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
    }
);

codex.stdin.write(prompt + "\n");
codex.stdin.end();

codex.stdout.on("data", (data) => {
    console.log("[CODEX OUTPUT]");
    console.log(data.toString());
});

codex.stderr.on("data", (data) => {
    console.log("[CODEX ERROR]");
    console.log(data.toString());
});

codex.on("error", (error) => {
    console.log("[BRIDGE ERROR]");
    console.log(error.message);
});

codex.on("close", (code) => {
    console.log(`[CODEX EXIT CODE] ${code}`);
});
