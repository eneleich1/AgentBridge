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
