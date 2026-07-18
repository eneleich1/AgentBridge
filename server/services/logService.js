const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("../utils/runtimeConfig");

const LOGS_DIR = path.join(DATA_DIR, "logs");
const SESSION_LOGS_DIR = path.join(LOGS_DIR, "sessions");
const pendingWrites = new Map();
const FLUSH_DELAY_MS = 40;

function getWriteState(filePath) {
  let state = pendingWrites.get(filePath);
  if (!state) {
    state = {
      buffer: "",
      timer: null,
      writeChain: Promise.resolve(),
    };
    pendingWrites.set(filePath, state);
  }
  return state;
}

function appendFileAsync(filePath, text) {
  return fs.promises.appendFile(filePath, text, "utf8");
}

function flushBufferedWrites(filePath) {
  const state = pendingWrites.get(filePath);
  if (!state) return Promise.resolve();

  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  if (!state.buffer) {
    return state.writeChain;
  }

  const chunk = state.buffer;
  state.buffer = "";
  state.writeChain = state.writeChain.then(() => appendFileAsync(filePath, chunk));
  return state.writeChain;
}

function queueBufferedWrite(filePath, text) {
  const state = getWriteState(filePath);
  state.buffer += text;
  if (!state.timer) {
    state.timer = setTimeout(() => {
      flushBufferedWrites(filePath).catch(() => {
        // Keep request flow alive even if the log file cannot be written.
      });
    }, FLUSH_DELAY_MS);
  }
}

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
  if (!fs.existsSync(SESSION_LOGS_DIR)) {
    fs.mkdirSync(SESSION_LOGS_DIR, { recursive: true });
  }
}

function getLogFilePath(taskId) {
  ensureLogsDir();
  return path.join(LOGS_DIR, `${taskId}.log`);
}

function writeLogHeader(taskId, meta) {
  const filePath = getLogFilePath(taskId);
  const header = [
    `# AgentBridge Task Log`,
    `# Task ID: ${taskId}`,
    `# Agent: ${meta.agentType}`,
    `# Project: ${meta.projectPath}`,
    `# Started: ${meta.startedAt}`,
    `# Prompt:`,
    meta.prompt,
    "",
    "---",
    "",
  ].join("\n");
  fs.writeFileSync(filePath, header, "utf8");
  return filePath;
}

function appendLog(taskId, stream, text) {
  const filePath = getLogFilePath(taskId);
  const prefix = stream === "stderr" ? "[stderr] " : "";
  queueBufferedWrite(filePath, prefix + text);
}

async function finalizeLog(taskId, meta) {
  const filePath = getLogFilePath(taskId);
  const footer = [
    "",
    "---",
    `# Finished: ${meta.finishedAt}`,
    `# Exit code: ${meta.exitCode ?? "null"}`,
    `# Status: ${meta.status}`,
  ].join("\n");
  await flushBufferedWrites(filePath);
  await appendFileAsync(filePath, footer);
  pendingWrites.delete(filePath);
  return filePath;
}

function readLog(taskId) {
  const filePath = getLogFilePath(taskId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

function getSessionLogFilePath(sessionId) {
  ensureLogsDir();
  return path.join(SESSION_LOGS_DIR, `${sessionId}.log`);
}

function writeSessionLogHeader(sessionId, meta) {
  const filePath = getSessionLogFilePath(sessionId);
  const header = [
    "# AgentBridge Session Log",
    `# Session ID: ${sessionId}`,
    `# Agent: ${meta.agentType}`,
    `# Project: ${meta.projectPath}`,
    `# Session mode: ${meta.sessionMode}`,
    `# Started: ${meta.startedAt}`,
    "",
    "---",
    "",
  ].join("\n");
  fs.writeFileSync(filePath, header, "utf8");
  return filePath;
}

function appendSessionLog(sessionId, stream, text) {
  const filePath = getSessionLogFilePath(sessionId);
  const prefix = stream === "stderr" ? "[stderr] " : stream === "system" ? "[system] " : "";
  queueBufferedWrite(filePath, prefix + text);
}

async function finalizeSessionLog(sessionId, meta) {
  const filePath = getSessionLogFilePath(sessionId);
  const footer = [
    "",
    "---",
    `# Finished: ${meta.finishedAt}`,
    `# Exit code: ${meta.exitCode ?? "null"}`,
    `# Status: ${meta.status}`,
  ].join("\n");
  await flushBufferedWrites(filePath);
  await appendFileAsync(filePath, footer);
  pendingWrites.delete(filePath);
  return filePath;
}

module.exports = {
  ensureLogsDir,
  getLogFilePath,
  writeLogHeader,
  appendLog,
  finalizeLog,
  readLog,
  getSessionLogFilePath,
  writeSessionLogHeader,
  appendSessionLog,
  finalizeSessionLog,
};
