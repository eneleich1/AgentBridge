# Architecture

AgentBridge is split into a browser client and a privileged local backend.

## Request flow

1. The React client sends a task or session message to the Fastify API.
2. The backend validates the selected project against its local allowlist.
3. The task or message is persisted in SQLite and placed in a bounded queue.
4. An agent adapter converts it into the argument and input format expected by
   the selected CLI.
5. The process runner captures standard output, standard error, cancellation,
   and exit state.
6. The backend persists state transitions and broadcasts updates over the
   WebSocket.
7. The React client merges the updates into the current task or conversation.

## Backend boundaries

### Routes

Routes translate HTTP requests into service calls and consistent error
responses. They do not execute command strings supplied by the browser.

### Services

Services own project registration, task persistence, setup diagnostics,
attachments, logging, and system metrics.

### Sessions

The session layer preserves conversations and serializes messages. When an
agent exposes a native session identifier, AgentBridge stores it and resumes
the native session rather than replaying an entire conversation.

Agent Duel is an opt-in, proposal-only session type. It stays disabled until
the user enables it in Settings, which requires both agent configurations. It
sends the same contextual prompt to Cursor and Codex concurrently, streams each
response independently, stores the structured comparison in the normal message
history, and persists the
winner selected for each completed round. Codex runs with its read-only sandbox
for duel rounds; both contestants also receive explicit no-edit instructions.

### Agent adapters

Adapters isolate CLI-specific arguments, output parsing, diagnostics, and
session behavior. The process runner provides the shared lifecycle:

- spawn;
- optional standard input;
- streaming output callbacks;
- graceful handling of output arriving after process exit;
- cancellation, including Windows process-tree termination;
- normalized exit information.

## Persistence

SQLite contains tasks, sessions, and messages. JSON files under `data/config/`
contain the local project allowlist and agent preferences. Image attachments
and logs are also stored under `data/`.

Every runtime path is ignored by Git because it can contain personal data,
absolute filesystem paths, prompts, generated output, and access tokens.

Set `AGENTBRIDGE_DATA_DIR` to place all runtime state outside the repository.

## Trust model

The browser is a control surface, not a security boundary. The backend runs
with the permissions of its operating-system account, and coding agents may
modify any registered project available to that account.

The intended boundary consists of:

- localhost binding by default;
- a private network or authenticated access proxy for remote use;
- bearer-token authentication;
- explicit CORS origins;
- an allowlist of project directories;
- no arbitrary shell-command endpoint;
- review of generated changes before deployment.

## Unified agent connections

The orchestration layer communicates through a connector contract rather than
directly through a provider CLI. A connection owns protocol negotiation,
transport, provider session identifiers, cancellation, permissions, and the
translation of provider output into normalized `AgentEvent` values. AgentBridge
continues to own the browser UI, its own session ID, persistence, projects,
voice input, comparison, and remote access.

The current command adapters are preserved in `AgentBridgeProtocolConnection`.
They remain the compatibility fallback for providers that do not expose a
native protocol. `ACPConnection` is provider-neutral JSON-RPC over stdio; the
Cursor configuration simply supplies `agent acp`. `OpenAICompatibleConnection`
is the local HTTP extension point for Ollama, LM Studio, vLLM, and similar
servers. A native SDK mode is deliberately an extension point until there is a
real SDK integration to register.

Connection mode, protocol, and transport are separate fields. For example,
Cursor can use `auto` mode, select ACP as protocol, and use stdio as transport;
Codex can use the AgentBridge protocol over a process transport. The selected
protocol and the provider session ID are persisted on the AgentBridge session
without replacing its stable AgentBridge session ID.

### ACP and MCP have different jobs

ACP is the client-to-coding-agent protocol. AgentBridge uses it to create or
resume a session, send prompts, stream updates, request permission decisions,
and cancel work. MCP is not a replacement for ACP: it is the tool/context
protocol used by an agent to reach tools, databases, and other services. An ACP
agent may itself use MCP servers, but raw ACP or MCP messages are never exposed
as the web UI contract; connectors translate them into normalized events.
