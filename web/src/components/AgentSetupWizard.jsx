import { useMemo, useState } from "react";
import { api } from "../services/api";
import { CODEX_MODEL_OPTIONS, DEFAULT_CODEX_MODEL } from "../constants/codexModels";

const CHECK_STEPS = [
  { title: "Detect CLI", description: "Confirm the agent command is installed and visible to AgentBridge." },
  { title: "Authentication", description: "Confirm the CLI can run under the desktop account." },
  { title: "Workspace run", description: "Confirm the same command shape AgentBridge uses for project work." },
];

const AGENT_GUIDES = {
  cursor: {
    name: "Cursor Agent",
    steps: [
      {
        title: "Detect Cursor Agent CLI",
        body: "AgentBridge needs the separate Cursor Agent CLI command `agent`. Installing the Cursor IDE app is not enough.",
        checks: "AgentBridge runs `agent --version` (and also looks in %LOCALAPPDATA%\\cursor-agent).",
        manualCommand: "agent --version",
        installTitle: "Install the Cursor Agent CLI on the backend PC",
        installSteps: [
          "Open PowerShell on the PC that runs AgentBridge (not on your phone).",
          "Run the official Windows installer command below.",
          "Open a NEW PowerShell window and confirm `agent --version` prints a version.",
          "Then press Test here. You normally do not need to restart AgentBridge anymore.",
        ],
        installCommand:
          "irm 'https://cursor.com/install?win32=true' | iex\n\n# Open a NEW PowerShell window:\nagent --version",
        failHints: {
          missing: [
            "AgentBridge still cannot find `agent`.",
            "Install with: irm 'https://cursor.com/install?win32=true' | iex",
            "Confirm in a new PowerShell: agent --version",
            "If PowerShell works but Test still fails, restart AgentBridge once so it reloads environment variables.",
          ],
          blocked: [
            "Windows may be blocking the CLI. Run PowerShell as the same user that starts AgentBridge.",
            "Try `agent --version` manually. If it fails with access denied, fix permissions or antivirus exclusions.",
          ],
        },
      },
      {
        title: "Authenticate Cursor Agent",
        body: "Sign in on the backend machine. The browser login opens there, not inside this UI.",
        checks: "AgentBridge runs `agent status` and requires output like `Logged in as you@email.com`.",
        manualCommand: "agent login\nagent status",
        installTitle: "If authentication fails",
        installSteps: [
          "On the backend PC, run `agent login` and finish the browser sign-in.",
          "Confirm `agent status` prints Logged in as your email.",
          "Or set a `CURSOR_API_KEY` environment variable for the AgentBridge process.",
          "Press Test again in this wizard. Do not continue until Test is green.",
        ],
        installCommand: "agent login\nagent status",
        failHints: {
          needs_login: [
            "The CLI is installed but not authenticated. Test only passes when `agent status` shows Logged in as ...",
            "Run `agent login` on the backend PC, complete sign-in, then press Test again.",
          ],
          missing: [
            "Finish step 1 first: install the Cursor Agent CLI with irm 'https://cursor.com/install?win32=true' | iex",
          ],
        },
      },
      {
        title: "Verify workspace-style execution",
        body: "This matches the print/trust style AgentBridge uses when sending prompts into a project folder.",
        checks: "Manual check from the backend PC (replace the project path):",
        manualCommand:
          'agent --print --trust --force --workspace "C:\\path\\to\\your\\project" "List files"',
        installTitle: "If this step fails",
        installSteps: [
          "Confirm steps 1 and 2 already pass (CLI found + authenticated).",
          "Use a real project folder path that exists on the backend PC.",
          "If the command works in PowerShell but AgentBridge still fails, restart the backend once.",
          "Do not reinstall the Cursor IDE unless `agent --version` is still missing.",
        ],
        installCommand:
          'agent --print --trust --force --workspace "C:\\path\\to\\your\\project" "List files"',
        failHints: {
          needs_login: [
            "Authentication is incomplete. Go back to step 2 and run `agent login`.",
          ],
          missing: [
            "Cursor Agent CLI is still missing. Go back to step 1 and install with irm 'https://cursor.com/install?win32=true' | iex",
          ],
          ready_required: [
            "Cursor must report Ready before AgentBridge can save this configuration.",
            "Fix the CLI/auth issue on the backend PC, then press Test again.",
          ],
        },
      },
    ],
  },
  codex: {
    name: "Codex CLI",
    steps: [
      {
        title: "Detect Codex CLI",
        body: "AgentBridge looks for the `codex` command on the Windows PATH of the machine running the backend.",
        checks: "AgentBridge runs `codex --version`.",
        manualCommand: "codex --version\ncodex exec --help",
        installTitle: "If the CLI is missing, install Codex on the backend PC",
        installSteps: [
          "Install Node.js 18+ if needed: https://nodejs.org/",
          "In PowerShell on the backend PC, install the Codex CLI globally.",
          "Open a new PowerShell window and confirm `codex --version`.",
          "Then press Test here. Restart AgentBridge only if Test still cannot see `codex`.",
        ],
        installCommand:
          "npm install -g @openai/codex\ncodex --version\ncodex exec --help",
        failHints: {
          missing: [
            "The backend cannot find `codex` on PATH.",
            "Run `npm install -g @openai/codex`, verify in a new PowerShell window, then press Test again.",
          ],
          blocked: [
            "Windows blocked Codex execution. Run the same PowerShell user that starts AgentBridge.",
            "If you see access denied, allow `codex` / Node in antivirus or Controlled Folder Access.",
          ],
        },
      },
      {
        title: "Authenticate Codex",
        body: "Sign in on the backend machine. Device-auth is useful when the normal browser flow is inconvenient.",
        checks: "AgentBridge runs `codex login status`.",
        manualCommand: "codex login\n# or\ncodex login --device-auth\n\ncodex login status",
        installTitle: "If authentication fails",
        installSteps: [
          "On the backend PC, run `codex login` and finish the browser flow.",
          "Or run `codex login --device-auth` and enter the code at the printed URL.",
          "Confirm with `codex login status`.",
          "Press Test again in this wizard.",
        ],
        installCommand: "codex login\n# or\ncodex login --device-auth\n\ncodex login status",
        failHints: {
          needs_login: [
            "Codex is installed but not logged in for the AgentBridge account.",
            "Run `codex login` or `codex login --device-auth` on the backend PC, then press Test again.",
          ],
          missing: [
            "Finish step 1 first: install Codex so `codex` is on PATH.",
          ],
          usage_limit: [
            "Codex reports a usage limit. Wait for reset or switch accounts, then Test again.",
          ],
        },
      },
      {
        title: "Verify workspace-style execution",
        body: "This matches the non-interactive `codex exec` mode AgentBridge uses for tasks.",
        checks: "Manual check from the backend PC:",
        manualCommand: "echo hello | codex exec --sandbox workspace-write --skip-git-repo-check -",
        installTitle: "If this step fails",
        installSteps: [
          "Confirm steps 1 and 2 already pass (CLI found + authenticated).",
          "Run the manual `codex exec` command in PowerShell on the backend PC.",
          "If PowerShell works but AgentBridge fails, restart the backend process once.",
          "If a model is unavailable later, pick another model in this wizard and save it.",
        ],
        installCommand: "echo hello | codex exec --sandbox workspace-write --skip-git-repo-check -",
        failHints: {
          needs_login: [
            "Authentication is incomplete. Go back to step 2 and run `codex login`.",
          ],
          missing: [
            "Codex is still missing from PATH. Go back to step 1.",
          ],
          usage_limit: [
            "Usage limit is blocking execution. Wait or switch account, then Test again.",
          ],
          ready_required: [
            "Codex must report Ready before AgentBridge can save this configuration.",
            "Fix the CLI/auth issue on the backend PC, then press Test again.",
          ],
        },
      },
    ],
  },
  local: {
    name: "Local Model",
    steps: [
      {
        title: "Detect local endpoint",
        body: "AgentBridge checks the OpenAI-compatible endpoint from this backend PC. Ollama works through its v1 compatibility API.",
        checks: "AgentBridge requests GET /v1/models from the configured endpoint.",
        manualCommand: "Invoke-RestMethod http://127.0.0.1:11434/v1/models",
        installTitle: "If it is unavailable",
        installSteps: ["Start Ollama, LM Studio, vLLM, or another local server on the backend PC.", "Confirm the endpoint and port below match that server.", "Press Test again."],
        installCommand: "ollama serve\nollama pull gpt-oss-20b",
        failHints: { not_ready: ["The local endpoint could not be reached. Start the model server, verify its port, and press Test again."] },
      },
      {
        title: "Verify model API",
        body: "The connector uses the standard Chat Completions contract, not a provider-specific CLI.",
        checks: "The endpoint must expose /v1/chat/completions.",
        manualCommand: "Invoke-RestMethod http://127.0.0.1:11434/v1/models",
        installTitle: "If the endpoint is not compatible",
        installSteps: ["Use an OpenAI-compatible endpoint, or point Ollama at its /v1 endpoint.", "Set a model available on that server."],
        installCommand: "ollama list",
        failHints: { not_ready: ["The endpoint did not report ready. Confirm it supports the OpenAI-compatible v1 API."] },
      },
      {
        title: "Confirm local worker",
        body: "Once saved, this local model can use the same sessions, voice prompts, comparison workflow, and remote UI as CLI agents.",
        checks: "AgentBridge confirms the endpoint is reachable before saving.",
        manualCommand: "ollama list",
        installTitle: "Ready to save",
        installSteps: ["Keep the local server running on the backend PC.", "Choose the exact model name exposed by the server.", "Save this configuration."],
        installCommand: "ollama pull gpt-oss-20b",
        failHints: { not_ready: ["Start the endpoint and press Test before saving."] },
      },
    ],
  },
};

function statusText(info) {
  if (!info) return "Not checked yet";
  return info.message || info.status || "Not checked yet";
}

function connectionErrorMessage(error) {
  const message = String(error?.message || error);
  const serverUrl = api.getServerUrl();

  if (message.startsWith("Failed to fetch ") || message === "Failed to fetch") {
    return `Could not reach ${serverUrl}. Confirm the AgentBridge backend is running and reachable from this UI.`;
  }

  return message;
}

function stepPasses(stepIndex, info) {
  if (!info) return false;
  if (stepIndex === 0) {
    return info.status !== "missing" && info.installed !== false;
  }
  if (stepIndex === 1) {
    return info.authenticated === true && info.status === "ready";
  }
  return info.authenticated === true && info.status === "ready";
}

function buildFailureGuidance(step, info, agentName) {
  const status = info?.status || "unknown";
  const hints = step.failHints?.[status] || step.failHints?.ready_required || [
    `${agentName} did not pass this check.`,
    info?.message || "Review the manual commands below on the backend PC, then press Test again.",
  ];
  return hints;
}

export default function AgentSetupWizard({
  agent,
  setupStatus,
  agentConfig,
  onRefresh,
  onSaveAgentConfig,
  onClose,
}) {
  const guide = AGENT_GUIDES[agent] || AGENT_GUIDES.cursor;
  const steps = guide.steps;
  const agentName = guide.name;

  const [stepIndex, setStepIndex] = useState(0);
  const [localStatus, setLocalStatus] = useState(setupStatus || null);
  const [selectedModel, setSelectedModel] = useState(agentConfig?.settings?.model || (agent === "local" ? "gpt-oss-20b" : DEFAULT_CODEX_MODEL));
  const [localEndpoint, setLocalEndpoint] = useState(agentConfig?.settings?.endpoint || "http://127.0.0.1:11434/v1");
  const [connectionMode, setConnectionMode] = useState(
    agentConfig?.settings?.connectionMode || (agent === "local" ? "ollama_http" : agent === "cursor" ? "auto" : "agentbridge_protocol")
  );
  const [checking, setChecking] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [error, setError] = useState("");
  const [fixHints, setFixHints] = useState([]);
  const [testPassed, setTestPassed] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [completed, setCompleted] = useState(false);

  const info = (localStatus || setupStatus)?.[agent];
  const step = steps[stepIndex] || steps[0];
  const checkStep = CHECK_STEPS[stepIndex] || CHECK_STEPS[0];
  const isLastStep = stepIndex >= steps.length - 1;

  const statusLabel = useMemo(() => {
    if (info?.configured === false && !testPassed) return "Needs setup";
    if (info?.status === "ready") return "Ready";
    return info?.status || "Not checked";
  }, [info, testPassed]);

  function resetStepResult() {
    setError("");
    setFixHints([]);
    setTestPassed(false);
    setTestMessage("");
  }

  async function runTest() {
    setChecking(true);
    resetStepResult();
    try {
      if (agent === "local" && onSaveAgentConfig) {
        await onSaveAgentConfig(agent, {
          configured: false,
          model: selectedModel.trim(),
          endpoint: localEndpoint.trim(),
          connectionMode,
        });
      }
      const nextStatus = await api.refreshSetupStatus();
      setLocalStatus(nextStatus);
      if (onRefresh) await onRefresh();

      const nextInfo = nextStatus?.[agent];
      if (!stepPasses(stepIndex, nextInfo)) {
        const hints = buildFailureGuidance(step, nextInfo, agentName);
        setFixHints(hints);
        throw new Error(nextInfo?.message || `${agentName} failed the ${checkStep.title} check.`);
      }

      setTestPassed(true);
      setTestMessage(
        stepIndex === 0
          ? `${agentName} CLI detected${nextInfo?.version ? `: ${nextInfo.version}` : "."}`
          : stepIndex === 1
            ? `${agentName} authentication looks good.`
            : `${agentName} is ready for workspace runs.`
      );
    } catch (err) {
      setError(connectionErrorMessage(err));
      setTestPassed(false);
    } finally {
      setChecking(false);
    }
  }

  function goNext() {
    if (!testPassed || isLastStep) return;
    setStepIndex((current) => current + 1);
    resetStepResult();
    setCompleted(false);
  }

  function goBack() {
    setStepIndex((current) => Math.max(0, current - 1));
    resetStepResult();
    setCompleted(false);
  }

  async function saveConfiguration() {
    if (!testPassed || !onSaveAgentConfig) return;
    setSavingConfig(true);
    setError("");
    try {
      const settings = agent === "codex"
        ? { configured: true, model: selectedModel, connectionMode }
        : agent === "local"
          ? { configured: true, model: selectedModel, endpoint: localEndpoint.trim(), connectionMode }
        : { configured: true, connectionMode };
      await onSaveAgentConfig(agent, settings);
      setLocalStatus((current) => ({
        ...(current || setupStatus || {}),
        [agent]: {
          ...(current || setupStatus)?.[agent],
          configured: true,
          status: "ready",
        },
      }));
      setCompleted(true);
      setTestMessage(`${agentName} configuration saved.`);
    } catch (err) {
      setError(connectionErrorMessage(err));
    } finally {
      setSavingConfig(false);
    }
  }

  async function saveCodexModel() {
    if (agent !== "codex" || !onSaveAgentConfig) return;
    setSavingModel(true);
    setError("");
    try {
      await onSaveAgentConfig(agent, { model: selectedModel });
    } catch (err) {
      setError(connectionErrorMessage(err));
    } finally {
      setSavingModel(false);
    }
  }

  return (
    <div className="wizard-backdrop" role="dialog" aria-modal="true" aria-label={`${agentName} setup`}>
      <div className="agent-wizard">
        <div className="agent-wizard-header">
          <div>
            <h2>Configure {agentName}</h2>
            <p>{checkStep.description}</p>
          </div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        <ol className="wizard-progress">
          {CHECK_STEPS.map((item, index) => (
            <li key={item.title} className={index === stepIndex ? "active" : index < stepIndex ? "done" : ""}>
              <span>{index + 1}</span>
              {item.title}
            </li>
          ))}
        </ol>

        <div className={`agent-current-status ${info?.configured === false ? "needs_setup" : info?.status || "unknown"}`}>
          <strong>{statusLabel}</strong>
          <span>
            {info?.version ? `Version: ${info.version}` : statusText(info)}
          </span>
        </div>

        {agent === "codex" && (
          <div className="wizard-step-card">
            <strong>Execution model</strong>
            <p>Choose the model AgentBridge will pass to `codex exec`. This does not affect Cursor.</p>
            <div className="wizard-form-row">
              <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                {CODEX_MODEL_OPTIONS.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn primary"
                onClick={saveCodexModel}
                disabled={savingModel || selectedModel === (agentConfig?.settings?.model || DEFAULT_CODEX_MODEL)}
              >
                {savingModel ? "Saving..." : "Save model"}
              </button>
            </div>
          </div>
        )}

        {agent === "local" && (
          <div className="wizard-step-card">
            <strong>Local endpoint and model</strong>
            <p>Use an Ollama /v1 endpoint or any OpenAI-compatible server running on this PC.</p>
            <div className="wizard-form-row">
              <input value={localEndpoint} onChange={(e) => setLocalEndpoint(e.target.value)} placeholder="http://127.0.0.1:11434/v1" />
              <input value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="gpt-oss-20b" />
            </div>
          </div>
        )}

        <div className="wizard-step-card">
          <strong>Connection method</strong>
          <p>
            AgentBridge keeps the agent and model separate from the way it communicates with the agent.
            Auto uses the recommended protocol and retains the current AgentBridge CLI protocol as a fallback.
          </p>
          <div className="wizard-form-row">
            <select value={connectionMode} onChange={(e) => setConnectionMode(e.target.value)}>
              <option value="auto">Auto (recommended)</option>
              {agent === "cursor" && <option value="acp">ACP / stdio</option>}
              {agent === "local" && <option value="ollama_http">Ollama / OpenAI-compatible HTTP</option>}
              {agent === "local" && <option value="openai_compatible">OpenAI-compatible HTTP</option>}
              {agent !== "local" && <option value="agentbridge_protocol">AgentBridge CLI Protocol</option>}
            </select>
          </div>
          <p className="wizard-guide-label">
            {connectionMode === "acp"
              ? "ACP uses JSON-RPC over the agent process standard input and output."
              : connectionMode === "agentbridge_protocol"
                ? "Uses the existing command-line adapter for this agent."
                : agent === "cursor"
                  ? "Auto tries ACP first, then falls back to the current Cursor CLI adapter if ACP cannot connect."
                  : "Auto selects the current supported protocol for this agent."}
          </p>
        </div>

        {step && (
          <div className="wizard-step-card">
            <strong>{step.title}</strong>
            <p>{step.body}</p>

            <div className="wizard-guide-block">
              <span className="wizard-guide-label">What AgentBridge tests</span>
              <p>{step.checks}</p>
            </div>

            <div className="wizard-guide-block">
              <span className="wizard-guide-label">Check it yourself in PowerShell (backend PC)</span>
              <code>{step.manualCommand}</code>
            </div>

            <div className="wizard-guide-block">
              <span className="wizard-guide-label">{step.installTitle}</span>
              <ol className="wizard-fix-list">
                {step.installSteps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
              <code>{step.installCommand}</code>
            </div>
          </div>
        )}

        {testPassed && testMessage && <div className="success-box">{testMessage}</div>}
        {error && <div className="alert error">{error}</div>}
        {fixHints.length > 0 && (
          <div className="wizard-step-card wizard-fix-card">
            <strong>What to do next</strong>
            <ol className="wizard-fix-list">
              {fixHints.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </div>
        )}
        {completed && (
          <div className="success-box">
            {agentName} configuration saved. You can close this wizard.
          </div>
        )}

        <div className="agent-wizard-actions">
          {stepIndex > 0 && (
            <button type="button" className="btn" onClick={goBack} disabled={checking || savingConfig}>
              Back
            </button>
          )}
          <button type="button" className="btn" onClick={onClose} disabled={checking || savingConfig}>
            {completed ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={runTest}
            disabled={checking || savingConfig || completed}
          >
            {checking ? "Testing..." : "Test"}
          </button>
          {!isLastStep ? (
            <button
              type="button"
              className="btn primary"
              onClick={goNext}
              disabled={!testPassed || checking || savingConfig}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={saveConfiguration}
              disabled={!testPassed || checking || savingConfig || completed}
            >
              {savingConfig ? "Saving..." : completed ? "Configured" : "Save configuration"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
