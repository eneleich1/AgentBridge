# Installation and Development Instructions

This guide explains how to install, run, and develop AgentBridge on Windows.

## Requirements

Install the following software before you begin:

- Node.js 18 or newer. Node.js 20 LTS is recommended.
- npm.
- Codex CLI, Cursor Agent CLI, or both.
- Git if you plan to work with version-controlled projects.

The agent CLIs must be installed and authenticated on the same computer that
runs the AgentBridge backend.

## Install dependencies

Open PowerShell and enter the repository directory:

```powershell
cd C:\path\to\AgentBridgeFramework
```

Install the backend and frontend dependencies:

```powershell
npm install
npm install --prefix web
```

You can use `npm ci` when you want to install the exact dependency versions
recorded in the lockfiles:

```powershell
npm ci
npm ci --prefix web
```

## Run in development mode

Development mode uses two terminals and is intended for development on the
same computer. In this mode, the backend and frontend use different ports. Do
not point a single Cloudflare Tunnel at port `3847` and expect it to serve the
interface: the development interface is served separately on port `5173`.

### Terminal 1: backend

```powershell
cd C:\path\to\AgentBridgeFramework
npm run dev
```

The backend will be available at:

```text
http://127.0.0.1:3847
```

### Terminal 2: frontend

```powershell
cd C:\path\to\AgentBridgeFramework
npm run dev:web
```

Open the development interface at:

```text
http://localhost:5173
```

The development frontend communicates with the backend on port `3847`.

## Run the compiled application

This is the recommended mode for normal use and for access from a phone through
Cloudflare Tunnel. It combines the interface, API, and WebSocket on port `3847`,
so one tunnel exposes the complete application.

To run AgentBridge as an integrated build:

```powershell
cd C:\path\to\AgentBridgeFramework
npm run build:web
npm start
```

Open:

```text
http://127.0.0.1:3847
```

In this mode, Fastify serves both the API and the compiled frontend from the
same origin.

## First-time setup

When you open AgentBridge for the first time:

1. Confirm that the backend appears as connected.
2. Register an existing project directory.
3. Select Codex or Cursor.
4. Confirm that the selected agent appears as installed and authenticated.
5. Create a conversation or submit a task.

AgentBridge can only work with project directories that have been explicitly
registered.

## Configure an access token

For local-only use on `127.0.0.1`, you can initially run without a token.

Before allowing access from another device, configure a long random value:

```powershell
$env:AGENTBRIDGE_ACCESS_TOKEN="replace-this-with-a-long-random-token"
npm start
```

Set the variable in the same terminal that starts the backend. Never commit a
real token to Git.

The `.env.example` file documents the available variables, but Node.js does not
automatically load `.env` files. Export the variables in PowerShell or use your
preferred environment manager.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Backend bind address |
| `PORT` | `3847` | Backend port |
| `AGENTBRIDGE_ACCESS_TOKEN` | Empty | HTTP and WebSocket access token |
| `AGENTBRIDGE_ALLOWED_ORIGINS` | Local Vite origins | Additional origins allowed by CORS |
| `AGENTBRIDGE_DATA_DIR` | The `data/` directory | Private runtime-data location |

Example using a different port:

```powershell
$env:PORT="4000"
npm start
```

## Local runtime data

AgentBridge automatically creates private runtime data under `data/`:

- Agent configuration.
- Registered projects and their absolute paths.
- The SQLite database.
- Task and conversation history.
- Logs.
- Image attachments.

These files are excluded through `.gitignore`. Do not manually add them to the
repository or attach them to public issues without reviewing and redacting
their contents.

## Available commands

| Command | Description |
| --- | --- |
| `npm start` | Start the backend |
| `npm run dev` | Start the backend with file watching |
| `npm run dev:web` | Start the Vite frontend |
| `npm run build:web` | Build the frontend |
| `npm test` | Run the automated tests |
| `npm run audit:public` | Scan for common publication risks |
| `npm run test:codex` | Run the optional Codex CLI integration check |
| `npm run test:cursor` | Run the optional Cursor Agent integration check |

The Codex and Cursor checks invoke locally installed programs. They are not
part of the default test suite.

## Verify before publishing

After installing dependencies, run:

```powershell
npm test
npm run build:web
npm run audit:public
git status
```

Confirm that:

- The automated tests pass.
- The frontend builds without errors.
- The public-repository audit reports no sensitive information.
- `git status` does not show databases, logs, private configuration, or user
  images.

## Remote access

Do not expose port `3847` directly through a router.

### Primary option: Cloudflare URL for phone access

Use the compiled application for this procedure. Development mode runs the
interface on `5173` and the backend on `3847`, which would require separate
tunnels and additional CORS configuration.

#### 1. Install cloudflared on Windows

The following PowerShell commands install the official 64-bit executable for
the current Windows user without requiring a package manager:

```powershell
$cloudflaredDir = Join-Path $env:LOCALAPPDATA "cloudflared"
New-Item -ItemType Directory -Force -Path $cloudflaredDir
Invoke-WebRequest `
  -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
  -OutFile "$cloudflaredDir\cloudflared.exe"
& "$cloudflaredDir\cloudflared.exe" --version
```

#### 2. Build and start AgentBridge

In the first PowerShell terminal, enter the repository, build the web
interface, and start AgentBridge:

```powershell
cd C:\path\to\AgentBridgeFramework
npm run build:web
npm start
```

Keep this terminal open.

#### 3. Create the Cloudflare URL

In a second PowerShell terminal, run:

```powershell
& "$env:LOCALAPPDATA\cloudflared\cloudflared.exe" tunnel --url http://127.0.0.1:3847
```

Keep this terminal open. `cloudflared` prints an HTTPS address similar to:

```text
https://random-words.trycloudflare.com
```

Open that address on the phone. The URL works over mobile data or another
network; the phone does not have to be connected to the same Wi-Fi network.

Quick Tunnel addresses are temporary. Restarting `cloudflared` normally
creates a different `trycloudflare.com` address.

> **Security:** A Quick Tunnel URL is reachable from the public Internet. The
> current phone setup screen does not provide a first-time access-token field,
> so use this zero-configuration workflow only for brief, supervised access and
> stop `cloudflared` with `Ctrl+C` when finished. For regular use, configure the
> protected alternative below.

#### 4. Verify or fix a 404 response

Before opening the Cloudflare URL, this local check should return `200`:

```powershell
(Invoke-WebRequest http://127.0.0.1:3847 -UseBasicParsing).StatusCode
```

If the browser displays `Route GET:/ not found`, the tunnel is reaching the
backend but the compiled frontend was not present when the backend started.
Stop AgentBridge with `Ctrl+C`, then run:

```powershell
npm run build:web
npm start
```

Do not tunnel port `5173` for this primary workflow. Port `5173` is only the
Vite development frontend; port `3847` serves the complete compiled
application.

### Permanent and private alternatives

The Quick Tunnel workflow above is intended for temporary personal access. For
a stable hostname or longer-running access, use a private network or an
identity-protected access layer, such as:

- Tailscale.
- A remotely managed Cloudflare Tunnel combined with Cloudflare Access.
- An equivalent VPN.

Use `AGENTBRIDGE_ACCESS_TOKEN` or Cloudflare Access for any regular or
unattended remote access. Do not leave an unauthenticated Quick Tunnel running.

See `README.md` for the architecture overview and `SECURITY.md` for security
guidance.

## Read 2-APPLICATION-CONFIGURATION.md to continue the configuration inside the application
