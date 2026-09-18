const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { ACPConnection } = require("./acpConnection");
const { AsyncEventQueue } = require("./asyncEventQueue");
const { AgentEventType, createCapabilities } = require("./types");
const { resolveCodexCommand } = require("../agents/cliPath");
const { safeLaunch } = require("../agents/safeLaunch");

// Codex app-server uses JSON-RPC lines, but its lifecycle is distinct from ACP:
// turn/start acknowledges immediately; turn/completed ends the stream.
class CodexConnection extends ACPConnection {
  async connect({ cwd } = {}) {
    if (this.child && !this.child.killed) return this.getStatus();
    const launch = safeLaunch(resolveCodexCommand(), ["app-server"]);
    this.child = spawn(launch.command, launch.args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child.on("error", error => this.failPending(error));
    this.child.on("exit", code => this.failPending(new Error(`Codex disconnected (${code}).`)));
    this.child.stderr.on("data", chunk => { this.stderr = (this.stderr + chunk).slice(-16000); });
    readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on("line", line => this.handleLine(line));
    await this.request("initialize", { clientInfo: { name: "agentbridge", version: "0.1.0" }, capabilities: {} });
    this.child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    this.capabilities = createCapabilities({ supportsSessions: true, supportsSessionResume: true, supportsPermissions: true, supportsToolEvents: true });
    return this.getStatus();
  }

  async getStatus() {
    return { ...(await super.getStatus()), protocol: "codex_app_server" };
  }

  async createSession({ projectPath, mode = "ask" }) {
    const result = await this.request("thread/start", { cwd: projectPath, model: this.config.model || null,
      approvalPolicy: "on-request", sandbox: mode === "execute" ? "workspace-write" : "read-only" });
    return { providerSessionId: result.thread.id, resumed: false };
  }

  async resumeSession({ providerSessionId, projectPath }) {
    const result = await this.request("thread/resume", { threadId: providerSessionId, cwd: projectPath,
      approvalPolicy: "on-request", sandbox: "read-only" });
    return { providerSessionId: result.thread.id, resumed: true };
  }

  async *sendPrompt({ providerSessionId, projectPath, prompt, mode = "ask", attachments = [] }) {
    const queue = new AsyncEventQueue();
    this.eventQueue = queue;
    this.threadId = providerSessionId;
    this.turnId = null;
    this.items = new Map();
    try {
      const result = await this.request("turn/start", { threadId: providerSessionId, cwd: projectPath,
        input: [{ type: "text", text: prompt }, ...attachments.filter(a => a.path).map(a => ({ type: "localImage", path: a.path }))],
        approvalPolicy: "on-request",
        sandboxPolicy: mode === "execute" ? { type: "workspaceWrite", writableRoots: [projectPath], networkAccess: false } : { type: "readOnly" },
        ...(this.config.model ? { model: this.config.model } : {}),
      });
      this.turnId = result.turn.id;
      for await (const event of queue) yield event;
    } finally {
      if (this.eventQueue === queue) this.eventQueue = null;
      this.pendingPermissions.clear();
      this.turnId = null;
    }
  }

  handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (Object.hasOwn(message, "result") || Object.hasOwn(message, "error")) return super.handleLine(line);
    const p = message.params || {};
    if (Object.hasOwn(message, "id")) {
      const supported = ["item/commandExecution/requestApproval", "item/fileChange/requestApproval", "item/permissions/requestApproval"];
      if (!supported.includes(message.method) || p.threadId !== this.threadId || !this.eventQueue) {
        this.respondError(message.id, -32601, "This interactive request is not supported by AgentBridge.");
        this.eventQueue?.push({ type: AgentEventType.RAW, stream: "stderr", text: `Unsupported interactive request: ${message.method}\n` });
        return;
      }
      const requestId = String(message.id);
      this.pendingPermissions.set(requestId, message);
      this.eventQueue.push({ type: AgentEventType.PERMISSION_REQUESTED, requestId, permission: {
        message: p.command || p.reason || "Codex requests permission",
        details: JSON.stringify({ cwd: p.cwd, reason: p.reason, grantRoot: p.grantRoot, permissions: p.permissions,
          network: p.networkApprovalContext, additionalPermissions: p.additionalPermissions,
          changes: this.items?.get(p.itemId)?.changes }, null, 2),
      } });
      return;
    }
    if (p.threadId && p.threadId !== this.threadId) return;
    if (message.method === "serverRequest/resolved") {
      this.pendingPermissions.delete(String(p.requestId));
      this.eventQueue?.push({ type: "permission_resolved", requestId: String(p.requestId) });
    }
    if (message.method === "item/started") this.items?.set(p.item.id, p.item);
    if (message.method === "item/agentMessage/delta") this.eventQueue?.push({ type: AgentEventType.TEXT_DELTA, text: p.delta || "" });
    if (message.method === "turn/completed") {
      this.eventQueue?.push(p.turn?.error ? { type: AgentEventType.ERROR, error: new Error(p.turn.error.message) } : {
        type: AgentEventType.COMPLETED, result: { exitCode: p.turn?.status === "failed" ? 1 : 0,
          cancelled: p.turn?.status === "interrupted", providerSessionId: this.threadId },
      });
      this.eventQueue?.close();
    }
  }

  async respondToPermission({ requestId, decision }) {
    const message = this.pendingPermissions.get(String(requestId));
    if (!message) throw new Error("Permission request is no longer pending.");
    if (!["approve", "reject"].includes(decision)) throw new Error("Invalid permission decision.");
    const result = message.method === "item/permissions/requestApproval"
      ? { permissions: decision === "approve" ? message.params.permissions : {}, scope: "turn" }
      : { decision: decision === "approve" ? "accept" : "decline" };
    await this.respond(message.id, result);
    this.pendingPermissions.delete(String(requestId));
  }

  async cancel() {
    // Terminating this connection also resolves pending approvals and streams.
    await this.closeSession();
  }

  failPending(error) {
    super.failPending(error);
    this.eventQueue?.push({ type: AgentEventType.ERROR, error });
    this.eventQueue?.close();
  }
}

module.exports = { CodexConnection };
