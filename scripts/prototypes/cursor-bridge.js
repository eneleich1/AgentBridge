const { spawn } = require("child_process");
const fs = require("fs");

const projectPath = process.argv[2];
const prompt = process.argv.slice(3).join(" ");

if (!projectPath || !prompt) {
    console.log("Usage:");
    console.log('node cursor-bridge.js "<project-path>" "<prompt>"');
    process.exit(1);
}

if (!fs.existsSync(projectPath)) {
    console.log("[BRIDGE ERROR]");
    console.log(`Project path does not exist: ${projectPath}`);
    process.exit(1);
}

console.log("[CURSOR BRIDGE]");
console.log(`Project: ${projectPath}`);
console.log(`Prompt: ${prompt}`);
console.log("");

const cursor = spawn(
    "cmd.exe",
    [
        "/d",
        "/c",
        "agent",
        "--print",
        "--trust",
        "--force",
        "--workspace",
        projectPath,
        prompt
    ],
    {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
    }
);

cursor.stdout.on("data", (data) => {
    console.log("[CURSOR OUTPUT]");
    console.log(data.toString());
});

cursor.stderr.on("data", (data) => {
    console.log("[CURSOR ERROR]");
    console.log(data.toString());
});

cursor.on("error", (error) => {
    console.log("[BRIDGE ERROR]");
    console.log(error.message);
});

cursor.on("close", (code) => {
    console.log(`[CURSOR EXIT CODE] ${code}`);
});
