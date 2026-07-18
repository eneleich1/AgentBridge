const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { v4: uuidv4 } = require("uuid");
const { parseAgentError } = require("../utils/agentErrors");
const { getAgent, getMaxConcurrency } = require("../agents/agentFactory");
const setupService = require("./setupService");
const projectService = require("./projectService");
const logService = require("./logService");
const attachmentService = require("./attachmentService");
const { broadcast } = require("../realtime/websocket");
const { DATA_DIR } = require("../utils/runtimeConfig");

const DB_PATH = path.join(DATA_DIR, "agentbridge.sqlite");

let db;
const runningTasks = new Map();
const abortControllers = new Map();
let activeCount = 0;
const queue = [];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  logService.ensureLogsDir();
}

function initDb() {
  ensureDataDir();
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      project_id TEXT,
      project_path TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      stdout TEXT DEFAULT '',
      stderr TEXT DEFAULT '',
      exit_code INTEGER,
      log_file TEXT,
      attachments TEXT,
      error_type TEXT,
      user_guidance TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL
    )
  `);

  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN error_type TEXT`);
  } catch { /* column exists */ }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN user_guidance TEXT`);
  } catch { /* column exists */ }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN attachments TEXT`);
  } catch { /* column exists */ }
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN conversation_id TEXT`);
  } catch { /* column exists */ }

  db.exec(`UPDATE tasks SET conversation_id = id WHERE conversation_id IS NULL`);
}

function parseAttachments(value) {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function rowToTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id || row.id,
    projectId: row.project_id,
    projectPath: row.project_path,
    agentType: row.agent_type,
    prompt: row.prompt,
    status: row.status,
    stdout: row.stdout,
    stderr: row.stderr,
    exitCode: row.exit_code,
    logFile: row.log_file,
    attachments: parseAttachments(row.attachments),
    errorType: row.error_type,
    userGuidance: row.user_guidance,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

function insertTask(task) {
  const stmt = db.prepare(`
    INSERT INTO tasks (
      id, project_id, project_path, agent_type, prompt, status,
      conversation_id,
      stdout, stderr, exit_code, log_file, error_type, user_guidance,
      attachments, started_at, finished_at, created_at
    ) VALUES (
      @id, @projectId, @projectPath, @agentType, @prompt, @status,
      @conversationId,
      @stdout, @stderr, @exitCode, @logFile, @errorType, @userGuidance,
      @attachments, @startedAt, @finishedAt, @createdAt
    )
  `);

  stmt.run({
    id: task.id,
    projectId: task.projectId || null,
    projectPath: task.projectPath,
    agentType: task.agentType,
    prompt: task.prompt,
    status: task.status,
    conversationId: task.conversationId || task.id,
    stdout: task.stdout || "",
    stderr: task.stderr || "",
    exitCode: task.exitCode ?? null,
    logFile: task.logFile || null,
    attachments: JSON.stringify(task.attachments || []),
    errorType: task.errorType || null,
    userGuidance: task.userGuidance || null,
    startedAt: task.startedAt || null,
    finishedAt: task.finishedAt || null,
    createdAt: task.createdAt,
  });
}

function updateTask(id, fields) {
  const current = getTaskById(id);
  if (!current) return null;

  const merged = { ...current, ...fields };
  const stmt = db.prepare(`
    UPDATE tasks SET
      status = @status,
      stdout = @stdout,
      stderr = @stderr,
      exit_code = @exitCode,
      log_file = @logFile,
      error_type = @errorType,
      user_guidance = @userGuidance,
      started_at = @startedAt,
      finished_at = @finishedAt
    WHERE id = @id
  `);

  stmt.run({
    id,
    status: merged.status,
    stdout: merged.stdout,
    stderr: merged.stderr,
    exitCode: merged.exitCode ?? null,
    logFile: merged.logFile || null,
    errorType: merged.errorType || null,
    userGuidance: merged.userGuidance || null,
    startedAt: merged.startedAt || null,
    finishedAt: merged.finishedAt || null,
  });

  return getTaskById(id);
}

function getTaskById(id) {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  return rowToTask(row);
}

function listTasks(limit = 50, projectId = null) {
  if (projectId) {
    const rows = db
      .prepare(
        "SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
      )
      .all(projectId, limit);
    return rows.map(rowToTask);
  }
  const rows = db
    .prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?")
    .all(limit);
  return rows.map(rowToTask);
}

function deleteTask(taskId) {
  const task = getTaskById(taskId);
  if (!task) return null;

  if (task.status === "queued") {
    const index = queue.indexOf(taskId);
    if (index >= 0) queue.splice(index, 1);
  }

  if (task.status === "running") {
    const controller = abortControllers.get(taskId);
    if (controller) controller.abort();
  }

  db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);

  if (task.logFile && fs.existsSync(task.logFile)) {
    try {
      fs.unlinkSync(task.logFile);
    } catch {
      // ignore log deletion errors
    }
  }

  emitTaskEvent("task:deleted", task);
  return task;
}

function deleteTasksForProject(projectId) {
  const tasks = listTasks(1000, projectId);
  for (const task of tasks) {
    deleteTask(task.id);
  }
  return tasks.length;
}

function deleteConversation(conversationId) {
  const existing = getTaskById(conversationId);
  const resolvedConversationId = existing?.conversationId || conversationId;
  const rows = db
    .prepare(
      "SELECT * FROM tasks WHERE conversation_id = ? OR id = ? ORDER BY created_at DESC"
    )
    .all(resolvedConversationId, resolvedConversationId);

  const tasks = rows.map(rowToTask);
  for (const task of tasks) {
    deleteTask(task.id);
  }

  return tasks;
}

function emitTaskEvent(type, task, extra = {}) {
  broadcast({ type, task, ...extra });
}

function processQueue() {
  const maxConcurrency = getMaxConcurrency();

  while (activeCount < maxConcurrency && queue.length > 0) {
    const taskId = queue.shift();
    executeTask(taskId);
  }
}

async function executeTask(taskId) {
  const task = getTaskById(taskId);
  if (!task || task.status !== "queued") return;

  activeCount++;
  runningTasks.set(taskId, true);

  const startedAt = new Date().toISOString();
  const abortController = new AbortController();
  abortControllers.set(taskId, abortController);

  let stdout = "";
  let stderr = "";

  const logFile = logService.writeLogHeader(taskId, {
    agentType: task.agentType,
    projectPath: task.projectPath,
    prompt: task.prompt,
    startedAt,
  });

  updateTask(taskId, { status: "running", startedAt, logFile });
  const running = getTaskById(taskId);
  emitTaskEvent("task:started", running);

  try {
    const agent = getAgent(task.agentType);
    const result = await agent.run({
      projectPath: task.projectPath,
      prompt: task.prompt,
      signal: abortController.signal,
      onStdout: (text) => {
        stdout += text;
        logService.appendLog(taskId, "stdout", text);
        emitTaskEvent("task:output", getTaskById(taskId), { stream: "stdout", text });
      },
      attachments: task.attachments || [],
      onStderr: (text) => {
        stderr += text;
        logService.appendLog(taskId, "stderr", text);
        emitTaskEvent("task:output", getTaskById(taskId), { stream: "stderr", text });
      },
    });

    const finishedAt = new Date().toISOString();
    let status = "completed";
    let errorType = null;
    let userGuidance = null;

    if (result.cancelled) {
      status = "cancelled";
    } else if (result.exitCode !== 0) {
      status = "failed";
      const parsed = parseAgentError(task.agentType, stdout, stderr);
      if (parsed) {
        errorType = parsed.type;
        userGuidance = parsed.userGuidance;
      }
    }

    await logService.finalizeLog(taskId, {
      finishedAt,
      exitCode: result.exitCode,
      status,
    });

    const finalTask = updateTask(taskId, {
      status,
      stdout,
      stderr,
      exitCode: result.exitCode,
      finishedAt,
      logFile,
      errorType,
      userGuidance,
    });

    emitTaskEvent("task:finished", finalTask);
  } catch (error) {
    const finishedAt = new Date().toISOString();
    stderr += (stderr ? "\n" : "") + error.message;
    logService.appendLog(taskId, "stderr", error.message + "\n");

    await logService.finalizeLog(taskId, {
      finishedAt,
      exitCode: null,
      status: "failed",
    });

    const finalTask = updateTask(taskId, {
      status: "failed",
      stdout,
      stderr,
      exitCode: null,
      finishedAt,
      logFile,
    });

    emitTaskEvent("task:finished", finalTask);
  } finally {
    activeCount--;
    runningTasks.delete(taskId);
    abortControllers.delete(taskId);
    processQueue();
  }
}

async function createTask({ projectId, projectPath, agentType, prompt, attachments = [], conversationId = null }) {
  await setupService.assertCanRunTask({ agentType, projectId });

  const resolvedPath = projectService.resolveProjectPath(projectId || projectPath);

  if (!resolvedPath) {
    throw new Error("Project path is not allowed or does not exist");
  }

  if (!projectService.isAllowedProjectPath(resolvedPath)) {
    throw new Error("Project path is not in the allowed list");
  }

  if (!agentType || (!prompt?.trim() && attachments.length === 0)) {
    throw new Error("agentType and prompt or attachments are required");
  }

  const project = projectService.getProjectById(projectId) || { id: null };
  const taskId = uuidv4();
  const conversationTask = conversationId ? getTaskById(conversationId) : null;
  const resolvedConversationId =
    conversationTask?.conversationId || conversationTask?.id || taskId;
  const savedAttachments = attachmentService.saveTaskAttachments(taskId, attachments);
  const promptText = prompt?.trim() || "Review the attached image.";
  const attachmentPrompt =
    agentType === "codex"
      ? ""
      : attachmentService.buildAttachmentPrompt(savedAttachments);

  const task = {
    id: taskId,
    conversationId: resolvedConversationId,
    projectId: project.id,
    projectPath: resolvedPath,
    agentType,
    prompt: `${promptText}${attachmentPrompt}`,
    status: "queued",
    stdout: "",
    stderr: "",
    exitCode: null,
    logFile: null,
    attachments: savedAttachments,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date().toISOString(),
  };

  insertTask(task);
  queue.push(task.id);
  processQueue();

  const created = getTaskById(task.id);
  emitTaskEvent("task:created", created);
  return created;
}

function cancelTask(taskId) {
  const task = getTaskById(taskId);
  if (!task) return null;

  if (task.status === "queued") {
    const index = queue.indexOf(taskId);
    if (index >= 0) queue.splice(index, 1);
    const finishedAt = new Date().toISOString();
    const updated = updateTask(taskId, { status: "cancelled", finishedAt });
    emitTaskEvent("task:finished", updated);
    return updated;
  }

  if (task.status === "running") {
    const controller = abortControllers.get(taskId);
    if (controller) controller.abort();
    return getTaskById(taskId);
  }

  return task;
}

module.exports = {
  initDb,
  createTask,
  getTaskById,
  listTasks,
  cancelTask,
  deleteTask,
  deleteConversation,
  deleteTasksForProject,
};
