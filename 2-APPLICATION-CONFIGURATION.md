# Application Configuration

This guide explains how to configure AgentBridge after the application is
installed and running.

For installation, dependency setup, and startup commands, see
`README-INSTRUCTIONS.md`.

## Before you begin

Confirm that:

- The AgentBridge backend is running.
- The AgentBridge frontend is open in a browser.
- Codex CLI, Cursor Agent CLI, or both are installed on the backend computer.
- The selected agent is authenticated.
- The project directory you want to use exists on the backend computer.

Typical local addresses are:

| Service | Address |
| --- | --- |
| Development frontend | `http://localhost:5173` |
| Backend API | `http://localhost:3847` |
| Compiled application | `http://127.0.0.1:3847` |

## 1. Connect the interface to the backend

Open `Settings` and select `Configure Backend`.

Enter the backend URL:

```text
http://localhost:3847
```

Then:

1. Select `Verify backend`.
2. Wait for the connection confirmation.
3. Select `Use this backend`.

The backend summary may show some system fields as `Unknown`. You can continue
as long as the connection succeeds and the backend version is displayed.

### Understanding "Needs setup"

The `Needs setup` label does not always mean that the backend is unreachable.
AgentBridge considers setup complete only when:

- The interface can reach the backend.
- At least one project has been registered.
- At least one supported agent is ready.

Continue with the agent and project configuration even when the backend row
still displays `Needs setup`.

## 2. Configure Codex CLI

After connecting the backend, select `Codex` when the wizard asks what you want
to configure next.

You can also open `Settings` and select `Configure Codex CLI`.

The Codex wizard contains three checks:

1. `Detect CLI`
2. `Authentication`
3. `Workspace run`

Select `Next` to run each check. The final status should be:

```text
Ready
```

### Verify Codex manually

If the status is not `Ready`, run these commands in PowerShell on the backend
computer:

```powershell
codex --version
codex exec --help
codex login status
```

If authentication is required:

```powershell
codex login
```

Alternatively:

```powershell
codex login --device-auth
```

After installing or authenticating Codex, stop and restart the AgentBridge
backend. The backend only sees the `PATH` and authentication state available
when its process starts.

### Select the execution model

The `Execution model` setting controls the model passed to `codex exec`.
AgentBridge defaults to `gpt-5.6-sol`. The selector also includes
`gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, and `gpt-5.4` so you can choose a
model supported by your signed-in Codex account.

1. Select a model available to your Codex account.
2. Select `Save model` if you changed the value.
3. Select `Re-check`.
4. Confirm that the status remains `Ready`.
5. Select `Done`.

If task execution later reports that a model is unavailable, return to this
screen and select another supported model.

Settings displays configuration and usage only for the currently selected
default agent. Choose `Cursor` or `Codex`, then use the corresponding
`Configure` action.

`Delete configuration` resets the selected agent inside AgentBridge and marks
it as `Needs setup`, so its configuration wizard must be completed again. It
does not uninstall the Cursor or Codex CLI and does not sign out of the CLI
account.

## 3. Register a project

In the sidebar, find the `Projects` heading and select the folder-with-plus
button.

Complete the project wizard:

1. Confirm the active backend.
2. Enter a project name.
3. Enter the absolute path on the backend computer.
4. Allow AgentBridge to validate the directory.
5. Confirm the selected agent.
6. Review the summary.
7. Select `Add project`.

Example project path:

```text
C:\Projects\ExampleApplication
```

The path must refer to the backend computer. A path that exists only on the
phone, laptop, or browser device cannot be registered.

AgentBridge checks whether the directory:

- Exists.
- Is readable.
- Is writable.
- Appears to be a Git repository.

A non-Git directory can still be registered, but using Git is strongly
recommended so that agent changes can be reviewed and reverted.

## 4. Submit the first Codex task

Select the registered project in the sidebar.

In the message composer:

1. Select `Codex`.
2. Select `Execute` mode.
3. Enter a small, controlled prompt.
4. Submit the message.

Recommended first prompt:

```text
Inspect this project and create a file named agentbridge-test.md containing a
short project summary. Do not modify any other files.
```

AgentBridge should:

1. Create a session.
2. Queue the message.
3. Start Codex in the selected project.
4. Stream output through the WebSocket.
5. Display the final response.
6. Mark the session as completed or failed.

Review the result from the project directory:

```powershell
git status
git diff
```

Do not commit agent-generated changes until you have reviewed them.

## 5. Continue an existing conversation

After the first message succeeds, continue writing in the same conversation.
AgentBridge stores the conversation and, when supported, resumes the native
Codex session.

Use a new conversation when:

- You want to change projects.
- You want to use another agent.
- The task is unrelated to the current conversation.
- You want a clean context.

Use the same conversation when:

- You are refining the previous result.
- You want Codex to fix an issue it introduced.
- The next task depends on earlier instructions.

## 6. Choose the appropriate mode

AgentBridge provides prompt modes that add context to the submitted request:

| Mode | Recommended use |
| --- | --- |
| `Ask` | Explanations, investigation, and read-oriented requests |
| `Plan` | Requesting an implementation plan before changing files |
| `Execute` | Asking the agent to edit files or implement a task |

Use `Ask` or `Plan` when you want to inspect a project without immediately
requesting changes.

## 7. Add image attachments

You can attach an image to a message when the selected agent supports image
inputs.

AgentBridge:

- Accepts image data only.
- Limits each image to the configured maximum size.
- Saves attachments under the private runtime-data directory.
- Passes the saved image path to Codex.

Attachments may contain private information. They are ignored by Git, but you
should still remove unnecessary runtime data before sharing logs or backups.

## 8. Troubleshooting

| Status or error | Meaning | Action |
| --- | --- | --- |
| `Needs setup` | A backend, project, or ready agent is missing | Complete all three configuration areas |
| `Not checked` | The agent diagnostic has not completed | Open the agent wizard and select `Next` or `Re-check` |
| `Codex CLI not found on PATH` | The backend process cannot locate Codex | Run `Get-Command codex`, then restart the backend |
| `Needs login` | Codex is installed but not authenticated | Run `codex login`, then restart the backend |
| `Unauthorized` or HTTP `401` | The backend requires a token | Configure the same token for the backend and browser |
| `Project path does not exist` | The path is invalid on the backend computer | Enter an existing absolute backend path |
| Model unavailable | The configured model is not available to the account | Select another model in `Configure Codex CLI` |
| Usage limit reached | The Codex account cannot start another task | Wait for the limit to reset or use another authorized account |
| No live output | The WebSocket is disconnected | Refresh the interface and verify the backend URL |
| Codex works manually but not through AgentBridge | The backend has stale environment state | Restart it from the terminal where `codex --version` works |

### Verify the backend directly

From the backend computer:

```powershell
Invoke-RestMethod http://localhost:3847/api/health
```

A healthy backend returns an object containing:

```text
ok      : True
service : agentbridge
version : 0.1.0
```

## 9. Remote access

Configure local operation successfully before enabling remote access.

### Primary phone-access workflow

The primary documented workflow for temporarily opening AgentBridge from a
phone is a Cloudflare Quick Tunnel. Follow the complete installation and
startup procedure in the **Remote access** section of
`1-README-INSTRUCTIONS.md`.

The important sequence is:

1. Run `npm run build:web`.
2. Run `npm start` so port `3847` serves the interface, API, and WebSocket.
3. In another terminal, run:

```powershell
& "$env:LOCALAPPDATA\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:3847
```

4. Open the generated `https://...trycloudflare.com` URL on the phone.

Do not use a single tunnel to port `3847` while following the development
workflow (`npm run dev`). In development, the interface is on `5173` (or the
next free port) and the backend is on `3847`. The compiled workflow
puts everything on `3847` and is why one Cloudflare URL works.

If the Cloudflare URL displays `Route GET:/ not found`, stop the backend, run
`npm run build:web`, and then restart it with `npm start` before reloading the
URL.

A Quick Tunnel URL is publicly reachable. The current phone setup screen does
not provide a first-time token-entry field, so use this workflow only for
brief, supervised access and stop `cloudflared` when finished. Use the
protected alternatives below for regular or unattended access.

### Permanent and private alternatives

For stable or longer-running remote access, recommended approaches are:

- Tailscale Serve for private access from your own authorized devices.
- A remotely managed Cloudflare Tunnel combined with Cloudflare Access for
  browser-based, identity-protected access.

Do not:

- Forward port `3847` directly from a router.
- Leave a public Quick Tunnel running unattended or treat it as permanent
  access.
- Use Tailscale Funnel for this application unless you have added and verified
  appropriate application-level authentication.
- Commit access tokens, local configuration, databases, logs, or attachments.

See `SECURITY.md` for the security model and deployment precautions.
