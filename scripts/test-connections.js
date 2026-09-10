const assert = require("node:assert/strict");
const { ACPConnection, normalizeAcpUpdate } = require("../server/connections/acpConnection");
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

  const http = new OpenAICompatibleConnection({ config: { endpoint: "http://127.0.0.1:11434", model: "gpt-oss" } });
  const httpStatus = await http.getStatus();
  assert.equal(httpStatus.protocol, AgentProtocol.OPENAI_COMPATIBLE);
  assert.equal(httpStatus.capabilities.supportsSessions, false);
  assert.equal(chatCompletionsUrl("http://localhost:1234/v1/"), "http://localhost:1234/v1/chat/completions");

  const local = { id: "local", name: "Local Model", enabled: true };
  const localConnection = agentConnectionFactory.create(local, {
    configured: true,
    connectionMode: "ollama_http",
    endpoint: "http://127.0.0.1:11434/v1",
    model: "gpt-oss-20b",
  });
  assert.ok(localConnection instanceof OpenAICompatibleConnection);
  assert.equal((await localConnection.getStatus()).transport, "http");

  console.log("connection architecture tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
