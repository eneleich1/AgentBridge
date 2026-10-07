const assert = require("node:assert/strict");
const { ACPConnection, normalizeAcpUpdate, protocolError, buildAcpSessionParams, selectPermissionOptionId } = require("../server/connections/acpConnection");
const { AgentBridgeProtocolConnection } = require("../server/connections/agentBridgeProtocolConnection");
const { OpenAICompatibleConnection, chatCompletionsUrl } = require("../server/connections/openAICompatibleConnection");
const { agentConnectionFactory, buildConnectionConfig } = require("../server/connections/connectionFactory");
const { AgentEventType, AgentProtocol } = require("../server/connections/types");

async function main() {
  const cursor = {
    id: "cursor",
    name: "Cursor Agent",
    enabled: true,
    settings: { configured: true, connectionMode: "auto" },
  };
  const autoConfig = buildConnectionConfig(cursor, cursor.settings);
  assert.equal(autoConfig.acp.protocol, AgentProtocol.ACP);
  assert.deepEqual(autoConfig.acp.arguments, ["acp"]);
  assert.equal(autoConfig.fallback.protocol, AgentProtocol.AGENTBRIDGE);
  assert.ok(agentConnectionFactory.create(cursor, cursor.settings) instanceof ACPConnection);

  const manualProtocol = agentConnectionFactory.create(cursor, {
    configured: true,
    connectionMode: "agentbridge_protocol",
  });
  assert.ok(manualProtocol instanceof AgentBridgeProtocolConnection);
  assert.equal((await manualProtocol.getStatus()).capabilities.supportsStreaming, true);

  const text = normalizeAcpUpdate({
    sessionUpdate: "agent_message_chunk",
    content: { text: "Hello" },
  });
  assert.equal(text.type, AgentEventType.TEXT_DELTA);
  assert.equal(text.text, "Hello");
  assert.equal(normalizeAcpUpdate({ sessionUpdate: "tool_call" }).type, AgentEventType.TOOL_STARTED);
  assert.equal(normalizeAcpUpdate({ sessionUpdate: "file_update" }).type, AgentEventType.FILE_CHANGED);
  const thought = normalizeAcpUpdate({ sessionUpdate: "agent_thought_chunk", content: { text: "Private reasoning" } });
  assert.equal(thought.type, AgentEventType.REASONING_STATUS);
  assert.ok(!JSON.stringify(thought).includes('Private reasoning'));
  const { describeActivity } = require('../server/sessions/activity');
  assert.equal(describeActivity(thought).label, 'Working');
  assert.equal(describeActivity({ type: AgentEventType.TEXT_DELTA, text: 'answer' }), null);
  assert.equal(describeActivity({ type: AgentEventType.TOOL_STARTED, tool: { title: 'Read project files' } }).text, 'Read project files');

  const http = new OpenAICompatibleConnection({ config: { endpoint: "http://127.0.0.1:11434", model: "gpt-oss" } });
  const httpStatus = await http.getStatus();
  assert.equal(httpStatus.protocol, AgentProtocol.OPENAI_COMPATIBLE);
  assert.equal(httpStatus.capabilities.supportsSessions, false);
  assert.equal(chatCompletionsUrl("http://localhost:1234/v1/"), "http://localhost:1234/v1/chat/completions");

  assert.deepEqual(buildAcpSessionParams({ projectPath: "C:\\proj" }), {
    cwd: "C:\\proj",
    mcpServers: [],
  });
  assert.deepEqual(buildAcpSessionParams({ projectPath: "C:\\proj", providerSessionId: "sess-1" }), {
    cwd: "C:\\proj",
    mcpServers: [],
    sessionId: "sess-1",
  });
  assert.match(
    protocolError({
      message: "Internal error",
      data: [{ expected: "array", code: "invalid_type", path: ["mcpServers"], message: "Invalid input" }],
    }).message,
    /Invalid input \(mcpServers\)/
  );
  assert.equal(
    selectPermissionOptionId([{ optionId: "allow-once", kind: "allow_once" }], "approve"),
    "allow-once"
  );
  assert.equal(selectPermissionOptionId([], "approve"), "allow-once");

  const disconnected = new ACPConnection({});
  disconnected.child = { killed: false, exitCode: 1, signalCode: null };
  assert.equal((await disconnected.getStatus()).status, "disconnected");
  disconnected.child = { killed: false, exitCode: null, signalCode: "SIGTERM" };
  assert.equal((await disconnected.getStatus()).status, "disconnected");
  disconnected.child = { killed: false, exitCode: null, signalCode: null };
  assert.equal((await disconnected.getStatus()).status, "connected");
  disconnected.child = null;

  const { CodexConnection } = require("../server/connections/codexConnection");
  const codex = new CodexConnection({ config: { model: "configured-model" } });
  const activityEvents = [];
  codex.threadId = 'activity-thread';
  codex.items = new Map();
  codex.eventQueue = { push: event => activityEvents.push(event) };
  for (const [method, type] of [['item/started', 'commandExecution'], ['item/completed', 'fileChange'], ['item/started', 'reasoning']]) {
    codex.handleLine(JSON.stringify({ method, params: { threadId: 'activity-thread', item: { id: type, type, text: 'Private reasoning' } } }));
  }
  assert.deepEqual(activityEvents.map(event => event.type), [AgentEventType.COMMAND_STARTED, AgentEventType.FILE_CHANGED, AgentEventType.REASONING_STATUS]);
  assert.ok(!JSON.stringify(activityEvents).includes('Private reasoning'));
  codex.eventQueue = null;
  let resumeParams;
  codex.request = async (method, params) => {
    assert.equal(method, "thread/resume");
    resumeParams = params;
    return { thread: { id: "saved-thread" } };
  };
  await codex.resumeSession({ providerSessionId: "saved-thread", projectPath: "C:\\proj", mode: "execute" });
  assert.equal(resumeParams.sandbox, "workspace-write");
  assert.equal(resumeParams.model, "configured-model");
  await codex.resumeSession({ providerSessionId: "saved-thread", projectPath: "C:\\proj", mode: "ask" });
  assert.equal(resumeParams.sandbox, "read-only");

  const local = { id: "local", name: "Local Model", enabled: true };
  const localConnection = agentConnectionFactory.create(local, {
    configured: true,
    connectionMode: "ollama_http",
    endpoint: "http://127.0.0.1:11434/v1",
    model: "gpt-oss-20b",
  });
  assert.ok(localConnection instanceof OpenAICompatibleConnection);
  assert.equal((await localConnection.getStatus()).transport, "http");

  const originalFetch = global.fetch;
  try {
    const encoder = new TextEncoder();
    const frames = 'data: {"choices":[{"delta":{"reasoning_content":"Private reasoning"}}]}\r\n\r\n'
      + 'data: {"choices":[{"delta":{"content":"Hola 🌍"}}]}\r\n\r\n'
      + 'data: {"choices":[],"usage":{"total_tokens":12}}\r\n\r\n'
      + 'data: [DONE]\r\n\r\n';
    const bytes = encoder.encode(frames);
    global.fetch = async (_url, options) => {
      assert.equal(JSON.parse(options.body).stream, true);
      return new Response(new ReadableStream({ start(controller) {
        // Split every byte, exercising partial SSE frames and UTF-8 decoding.
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      } }), { headers: { 'content-type': 'text/event-stream' } });
    };
    const events = [];
    for await (const event of localConnection.sendPrompt({ prompt: 'hello' })) events.push(event);
    assert.equal(events[0].text, 'Hola 🌍');
    assert.equal(events[1].usage.total_tokens, 12);
    assert.equal(events.at(-1).type, AgentEventType.COMPLETED);
    assert.ok(!JSON.stringify(events).includes('Private reasoning'));

    global.fetch = async () => Response.json({ choices: [{ message: { content: 'JSON fallback', reasoning_content: 'Private reasoning' } }] });
    const fallback = [];
    for await (const event of localConnection.sendPrompt({ prompt: 'hello' })) fallback.push(event);
    assert.equal(fallback[0].text, 'JSON fallback');
    assert.ok(!JSON.stringify(fallback).includes('Private reasoning'));
    global.fetch = async () => new Response('data: {"error":{"message":"Stream failed"}}\n\n', { headers: { 'content-type': 'text/event-stream' } });
    await assert.rejects(async () => { for await (const event of localConnection.sendPrompt({ prompt: 'hello' })) {} }, /Stream failed/);
  } finally {
    global.fetch = originalFetch;
  }

  console.log("connection architecture tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
