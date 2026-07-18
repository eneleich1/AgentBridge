const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const SKIPPED_FILES = new Set(["package-lock.json", "web/package-lock.json"]);
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ps1",
  ".txt",
  ".yml",
  ".yaml",
]);

const secretPatterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/],
  ["GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}\b/],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ["credential in URL", /https?:\/\/[^/\s:@]+:[^/\s@]+@/],
  ["absolute Windows user path", /\b[A-Za-z]:\\Users\\[^\\\s"'<>]+\\/i],
  ["absolute macOS user path", /\/Users\/[^/\s"'<>]+\//],
  ["absolute Linux home path", /\/home\/[^/\s"'<>]+\//],
];

function trackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return output.split("\0").filter(Boolean);
}

function isForbiddenRuntimeFile(file) {
  const normalized = file.replaceAll("\\", "/");
  if (normalized.startsWith("data/config/")) return true;
  if (normalized.startsWith("data/uploads/")) return true;
  if (/^data\/agentbridge\.sqlite(?:-|$)/.test(normalized)) return true;
  if (/^server\/config\/.*\.json$/.test(normalized) && !normalized.endsWith(".example.json")) {
    return true;
  }
  if (/^\.env(?:\.|$)/.test(normalized) && normalized !== ".env.example") return true;
  return false;
}

const findings = [];

for (const file of trackedFiles()) {
  if (isForbiddenRuntimeFile(file)) {
    findings.push(`${file}: tracked runtime or credential file`);
    continue;
  }

  if (SKIPPED_FILES.has(file)) continue;

  const absolutePath = path.join(ROOT, file);
  const stat = fs.statSync(absolutePath);
  if (stat.size > MAX_TEXT_FILE_BYTES) continue;
  if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()) && !file.startsWith(".")) continue;

  const contents = fs.readFileSync(absolutePath, "utf8");
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(contents)) {
      findings.push(`${file}: ${label}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Public-repository audit failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("Public-repository audit passed");
