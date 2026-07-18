# Bridge prototypes (archived)

These scripts were the original proof-of-concept bridges before AgentBridge.

Their logic now lives in:

- `server/agents/codexAgent.js` — migrated from `Codex-Connector/codex-bridge/bridge.js`
- `server/agents/cursorAgent.js` — migrated from `Cursor-Connector/cursor-bridge/cursorBridge.js`

Use the main test scripts instead:

```powershell
npm run test:codex -- "C:\path\to\project" "your prompt"
npm run test:cursor -- "C:\path\to\project" "your prompt"
```

These files are kept for reference only.
