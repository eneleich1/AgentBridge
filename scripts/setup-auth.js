const readline = require("node:readline");
const { setupAccount } = require("../server/auth/authService");
const { pool } = require("../server/auth/db");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt(question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer.trim())));
}

function promptHidden(question) {
  const stdin = process.stdin;
  if (!stdin.isTTY) return prompt(question); // e.g. piped input; no raw mode available

  rl.pause();
  return new Promise((resolve) => {
    process.stdout.write(question);

    let value = "";
    const onData = (char) => {
      char = char.toString("utf8");
      if (char === "\r" || char === "\n") {
        stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        rl.resume();
        resolve(value);
        return;
      }
      if (char === "") process.exit(1); // Ctrl+C
      if (char === "" || char === "\b") {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };

    stdin.setRawMode(true);
    stdin.on("data", onData);
  });
}

function formatSecret(secret) {
  return secret.match(/.{1,4}/g).join(" ");
}

async function main() {
  console.log("AgentBridge - account setup\n");
  console.log("This creates the single account used to log into the AgentBridge UI.");
  console.log("It overwrites any existing account.\n");

  const username = await prompt("Username: ");
  if (!username) throw new Error("Username cannot be empty.");

  const email = await prompt("Email (optional, for future password recovery): ");

  const password = await promptHidden("Password: ");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  const confirmPassword = await promptHidden("Confirm password: ");
  if (password !== confirmPassword) throw new Error("Passwords do not match.");

  const { totpSecret, otpauthUrl } = await setupAccount({ username, email, password });

  console.log("\nAccount created.\n");
  console.log("Scan this into Google Authenticator (or a compatible app), or enter the secret manually:\n");
  console.log(`  Secret: ${formatSecret(totpSecret)}`);
  console.log(`  otpauth URL: ${otpauthUrl}\n`);
  console.log("You can now log into the AgentBridge UI with this username, password, and a code from the app.");
}

main()
  .catch((error) => {
    console.error(`\nSetup failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
    pool.end();
  });
