# Security and interactive permissions

AgentBridge resolves supported Windows CLI shims to native runtimes and passes
arguments directly, without `cmd.exe`. Unknown batch launchers fail closed.
Custom executable paths, arguments, authentication methods, and environment
variables must be configured on the workstation in `data/config/agents.json`;
the browser cannot change those fields.

Remote API access requires an account or access token. Unauthenticated access
is limited to a loopback-bound server and loopback clients. Request logging
omits query strings and redacts authentication headers.

Normal Codex sessions use the native app-server connection. Ask and Plan set a
read-only sandbox for each turn, including resumed conversations; Execute uses
workspace-write. Command, file-change, and permission-profile approvals are
forwarded to the shared approval interface. Unsupported interactive request
types receive an explicit protocol error rather than an automatic approval.

Cursor uses ACP for interactive execution. The compatibility process adapter
supports Ask and Plan, but refuses Execute because its non-interactive force
option would bypass approval. ACP modes are negotiated with the provider;
Ask/Plan fail explicitly if the provider does not advertise the requested mode.

Pending permissions have unique public IDs, are scoped to a session and live
connection, and are queued in the UI. Reconnecting WebSocket clients receive a
complete pending-permission snapshot. The authenticated `GET /api/permissions`
endpoint also exposes this live list. Approval and rejection apply once, using
the provider's offered option IDs. Simultaneous answers cannot approve twice.

Pending approvals belong to a live agent process: restarting the backend does
not preserve that process or make its old requests valid. Reconnect recovery
applies while the backend is alive. After a backend restart, retry interrupted
work to receive fresh approvals. Do not auto-approve historical requests from
conversation logs. HTTP text-only model connectors have no local tool approvals.

The project allowlist controls the selected working directory; it is not an
operating-system sandbox. Use provider sandboxing and review agent changes.

Implementation reference: https://developers.openai.com/codex/app-server

These changes require manual validation: multi-line and metacharacter prompts,
multiple pending approvals, browser reconnect, approve/reject, cancellation,
resumed read-only turns, and remote authentication. Automated checks were not
completed at the user's request.
