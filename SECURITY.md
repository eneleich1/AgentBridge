# Security policy

AgentBridge can ask local coding agents to modify files and run development
tools. Treat the backend as privileged software.

## Safe deployment

- Keep the default `127.0.0.1` binding whenever possible.
- Never expose port `3847` directly to the public internet.
- For remote use, place AgentBridge behind Tailscale, Cloudflare Access, or an
  equivalent authenticated private network.
- Set `AGENTBRIDGE_ACCESS_TOKEN` to a long random value.
- Register only project directories that an agent is allowed to modify.
- Keep `data/` private. It can contain prompts, agent output, local paths,
  images, logs, and session history.
- Review agent-generated changes before committing or deploying them.

## Reporting a vulnerability

Open a private security advisory in the repository rather than publishing
credentials, exploit details, local paths, or user data in a public issue.

## Supported versions

This project is an experimental local-first application. Security fixes are
provided on the latest revision only.
