const { spawn } = require("child_process");
const readline = require("readline");
const { AsyncEventQueue } = require("./asyncEventQueue");
const {
  AgentEventType,
  AgentProtocol,
  AgentTransport,
  createCapabilities,
} = require("./types");

function protocolError(error) {
  const detail = error?.data?.details || error?.data?.message || "";
  const message = `${error?.message || "ACP request failed"}${detail ? `: ${detail}` : ""}`;
  const wrapped = new Error(message);
  wrapped.code = "acp_error";
  wrapped.details = error;
  return wrapped;
}

function normalizeAcpUpdate(update) {
  const kind = String(update?.sessionUpdate || update?.type || "");
  const content = update?.content || {};
  if (kind === "agent_message_chunk") {
    return { type: AgentEventType.TEXT_DELTA, text: content.text || update.text || "" };
  }
  if (/tool.*start|tool_call$/.test(kind)) return { type: AgentEventType.TOOL_STARTED, tool: update };
  if (/tool.*(complete|update|result)/.test(kind)) return { type: AgentEventType.TOOL_COMPLETED, tool: update };
  if (/command.*start|terminal.*start/.test(kind)) return { type: AgentEventType.COMMAND_STARTED, command: update };
  if (/command.*(complete|output)|terminal.*output/.test(kind)) return { type: AgentEventType.COMMAND_COMPLETED, command: update };
  if (/file/.test(kind)) return { type: AgentEventType.FILE_CHANGED, file: update };
  if (/usage/.test(kind)) return { type: AgentEventType.USAGE_UPDATED, usage: update };
  return { type: AgentEventType.RAW, raw: { source: "acp", update } };
}

/** Generic JSON-RPC/stdio Agent Client Protocol connector. */
class ACPConnection {
  constructor({ config = {} }) {
    this.config = config;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.pendingPermissions = new Map();
    this.eventQueue = null;
    this.providerCapabilities = {};
    this.stderr = "";
    this.capabilities = createCapabilities({
      supportsSessions: true,
      supportsSessionResume: true,
      supportsStreaming: true,
      supportsCancellation: true,
      supportsPermissions: true,
      supportsToolEvents: true,
      supportsModelSelection: true,
    });
  }

  async connect({ cwd } = {}) {
    if (this.child && !this.child.killed) return this.getStatus();
    const executable = this.config.executablePath || "agent";
    const args = Array.isArray(this.config.arguments) && this.config.arguments.length
      ? this.config.arguments
      : ["acp"];
    const env = { ...process.env, ...(this.config.environmentVariables || {}) };

    // .cmd launchers need cmd.exe on Windows; normal executables remain direct.
    const useCmd = process.platform === "win32" && /\.cmd$/i.test(executable);
    this.child = useCmd
      ? spawn("cmd.exe", ["/d", "/c", executable, ...args], {
        cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      })
      : spawn(executable, args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });

    this.child.on("error", (error) => this.failPending(error));
    this.child.on("exit", (code) => this.failPending(new Error(`ACP process exited (${code ?? "unknown"}).`)));
    this.child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      this.stderr += text;
      this.eventQueue?.push({ type: AgentEventType.RAW, stream: "stderr", text, raw: { source: "acp-stderr", text } });
    });
    const lines = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.handleLine(line));

    const initialized = await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "AgentBridge", title: "AgentBridge", version: require("../../package.json").version },
    });
    this.providerCapabilities = initialized?.agentCapabilities || {};
    this.capabilities = createCapabilities({
      ...this.capabilities,
      supportsSessionResume: Boolean(
        this.providerCapabilities.loadSession || this.providerCapabilities.resumeSession || this.providerCapabilities.sessionResume
      ),
      supportsModelSelection: Boolean(this.providerCapabilities?.configOptions || this.providerCapabilities?.models),
    });

    // Cursor ACP currently documents this v1 authentication method. Other ACP
    // agents can omit authMethod and skip it entirely.
    if (this.config.authMethod) {
      await this.request("authenticate", { methodId: this.config.authMethod });
    }
    return this.getStatus();
  }

  async createSession({ projectPath }) {
    const result = await this.request("session/new", {
      cwd: projectPath,
      mcpServers: [],
    });
    return { providerSessionId: result?.sessionId || result?.id || null, raw: result };
  }

  async resumeSession({ providerSessionId, projectPath }) {
    if (!providerSessionId) return this.createSession({ projectPath });
    const method = this.providerCapabilities.loadSession ? "session/load" : "session/resume";
    const result = await this.request(method, { sessionId: providerSessionId, cwd: projectPath });
    return { providerSessionId: result?.sessionId || providerSessionId, raw: result };
  }

  async *sendPrompt({ providerSessionId, prompt, attachments = [] }) {
    if (!providerSessionId) throw new Error("ACP session is required before sending a prompt.");
    const queue = new AsyncEventQueue();
    this.eventQueue = queue;
    const content = [{ type: "text", text: prompt }];
    for (const attachment of attachments) {
      if (attachment?.dataUrl) content.push({ type: "image", data: attachment.dataUrl });
    }

    this.request("session/prompt", { sessionId: providerSessionId, prompt: content })
      .then((result) => {
        queue.push({
          type: AgentEventType.COMPLETED,
          result: { exitCode: 0, cancelled: result?.stopReason === "cancelled", providerSessionId, acp: result },
        });
        queue.close();
      })
      .catch((error) => {
        queue.push({ type: AgentEventType.ERROR, error: protocolError(error), raw: { source: "acp" } });
        queue.close();
      });

    for await (const event of queue) yield event;
    if (this.eventQueue === queue) this.eventQueue = null;
  }

  async respondToPermission({ requestId, decision, optionId }) {
    const pending = this.pendingPermissions.get(String(requestId));
    if (!pending) {
      const error = new Error("The permission request is no longer pending.");
      error.code = "permission_not_found";
      throw error;
    }
    this.pendingPermissions.delete(String(requestId));
    const selected = optionId || (decision === "approve" ? "allow-once" : "reject-once");
    this.respond(pending.id, { outcome: { outcome: "selected", optionId: selected } });
  }

  async cancel({ providerSessionId }) {
    if (providerSessionId) await this.request("session/cancel", { sessionId: providerSessionId });
  }

  async getStatus() {
    return {
      status: this.child && !this.child.killed ? "connected" : "disconnected",
      protocol: AgentProtocol.ACP,
      transport: AgentTransport.STDIO,
      capabilities: this.capabilities,
      providerCapabilities: this.providerCapabilities,
      lastError: this.stderr || null,
    };
  }

  async closeSession() {
    if (!this.child || this.child.killed) return;
    this.child.stdin.end();
    this.child.kill();
    this.child = null;
  }

  request(method, params) {
    if (!this.child?.stdin?.writable) return Promise.reject(new Error("ACP transport is not connected."));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${payload}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  respond(id, result) {
    if (this.child?.stdin?.writable) this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.eventQueue?.push({ type: AgentEventType.RAW, raw: { source: "acp-malformed", line } });
      return;
    }
    if (Object.hasOwn(message, "id") && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(protocolError(message.error));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === "session/update") {
      this.eventQueue?.push({ ...normalizeAcpUpdate(message.params?.update), raw: { source: "acp", message } });
      return;
    }
    if (message.method === "session/request_permission") {
      const requestId = String(message.id);
      this.pendingPermissions.set(requestId, message);
      this.eventQueue?.push({
        type: AgentEventType.PERMISSION_REQUESTED,
        requestId,
        permission: message.params || {},
        raw: { source: "acp", message },
      });
      return;
    }
    // Extension requests are never auto-approved. The UI can expose these as
    // future specialized prompts without leaking raw ACP details.
    if (Object.hasOwn(message, "id")) {
      this.respondError(message.id, -32601, "AgentBridge does not support this ACP client request yet.");
      this.eventQueue?.push({ type: AgentEventType.RAW, raw: { source: "acp-request", message } });
      return;
    }
    this.eventQueue?.push({ type: AgentEventType.RAW, raw: { source: "acp", message } });
  }

  respondError(id, code, message) {
    if (this.child?.stdin?.writable) this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
  }

  failPending(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}

module.exports = { ACPConnection, normalizeAcpUpdate };
