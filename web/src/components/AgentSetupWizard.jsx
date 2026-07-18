import { useState } from "react";
import { api } from "../services/api";

const AGENT_STEPS = {
  cursor: [
    {
      title: "Verify Cursor Agent on Windows",
      body: "Open PowerShell on the desktop running AgentBridge. Do not check this from the browser client.",
      command: "agent --version",
    },
    {
      title: "Authenticate Cursor",
      body: "Run this on the backend machine. Cursor Agent opens the browser sign-in flow there. Complete that sign-in, then come back here and re-check.",
      command: "agent login",
    },
    {
      title: "Verify workspace execution",
      body: "Run this from the desktop. If it fails, fix Cursor CLI/auth first; do not reinstall unless `agent` is truly missing from PATH.",
      command: "agent --print --trust --force --workspace <project> \"List files\"",
    },
  ],
  codex: [
    {
      title: "Verify Codex CLI on Windows",
      body: "Open PowerShell on the desktop running AgentBridge. The working command is `codex`, even if npm also exposes codex.cmd.",
      command: "codex --version\ncodex exec --help",
    },
    {
      title: "Authenticate Codex",
      body: "Run one of these on the backend machine. `codex login` uses the normal login flow; `codex login --device-auth` prints a device-auth URL and code if you prefer that flow. Finish the auth there, then re-check here.",
      command: "codex login\n# or\ncodex login --device-auth",
    },
    {
      title: "Verify workspace execution",
      body: "This is the same mode AgentBridge uses. If this works in the desktop terminal but not in AgentBridge, restart the backend.",
      command: "echo hello | codex exec --sandbox workspace-write --skip-git-repo-check -",
    },
  ],
};

const CHECK_STEPS = [
  { title: "Detect CLI", description: "Verify the command is visible to the AgentBridge backend." },
  { title: "Authentication", description: "Confirm the CLI can run under the desktop account." },
  { title: "Workspace run", description: "Show the same command shape AgentBridge uses for project work." },
];

function statusText(info) {
  if (!info) return "Not checked yet";
  return info.message || info.status || "Not checked yet";
}

function connectionErrorMessage(error) {
  const message = String(error?.message || error);
  const serverUrl = api.getServerUrl();

  if (message.startsWith("Failed to fetch ")) {
    return `Could not reach ${serverUrl}. Confirm the configured AgentBridge backend is running and reachable from this UI.`;
  }

  if (message === "Failed to fetch") {
    return `Could not reach ${serverUrl}. Confirm the AgentBridge backend is running and reachable from this browser.`;
  }

  return message;
}

const CODEX_MODEL_OPTIONS = ["gpt-5.4", "gpt-5.5"];

export default function AgentSetupWizard({
  agent,
  setupStatus,
  agentConfig,
  onRefresh,
  onSaveAgentConfig,
  onClose,
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [localStatus, setLocalStatus] = useState(setupStatus || null);
  const [selectedModel, setSelectedModel] = useState(agentConfig?.settings?.model || "gpt-5.4");
  const [checking, setChecking] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [error, setError] = useState("");
  const info = (localStatus || setupStatus)?.[agent];
  const steps = AGENT_STEPS[agent] || [];
  const step = steps[stepIndex] || steps[0];
  const checkStep = CHECK_STEPS[stepIndex] || CHECK_STEPS[0];
  const agentName = agent === "codex" ? "Codex CLI" : "Cursor Agent";

  async function runCheck() {
    setChecking(true);
    setError("");
    try {
      const nextStatus = await api.getSetupStatus();
      setLocalStatus(nextStatus);
      if (onRefresh) await onRefresh();
      const nextInfo = nextStatus?.[agent];
      if (stepIndex === 0 && nextInfo?.status === "missing") {
        throw new Error(nextInfo.message || `${agentName} was not found on PATH.`);
      }
      if (stepIndex === 1 && nextInfo?.status !== "ready") {
        throw new Error(nextInfo?.message || `${agentName} is not authenticated or cannot run yet.`);
      }
      if (stepIndex < steps.length - 1) {
        setStepIndex((current) => current + 1);
      } else if (nextInfo?.status !== "ready") {
        throw new Error(nextInfo?.message || `${agentName} is not ready.`);
      }
    } catch (err) {
      setError(connectionErrorMessage(err));
    } finally {
      setChecking(false);
    }
  }

  function goBack() {
    setError("");
    setStepIndex((current) => Math.max(0, current - 1));
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

        <div className={`agent-current-status ${info?.status || "unknown"}`}>
          <strong>{info?.status === "ready" ? "Ready" : info?.status || "Not checked"}</strong>
          <span>{info?.version ? `Version: ${info.version}` : statusText(info)}</span>
        </div>

        {agent === "codex" && (
          <div className="wizard-step-card">
            <strong>Execution model</strong>
            <p>Choose the model AgentBridge will pass to `codex exec`. This does not affect Cursor.</p>
            <div className="wizard-form-row">
              <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                {CODEX_MODEL_OPTIONS.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn primary"
                onClick={saveCodexModel}
                disabled={savingModel || selectedModel === (agentConfig?.settings?.model || "gpt-5.4")}
              >
                {savingModel ? "Saving..." : "Save model"}
              </button>
            </div>
          </div>
        )}

        {step && (
          <div className="wizard-step-card">
            <strong>{step.title}</strong>
            <p>{step.body}</p>
            <code>{step.command}</code>
          </div>
        )}

        {error && <div className="alert error">{error}</div>}

        <div className="agent-wizard-actions">
          {stepIndex > 0 && <button type="button" className="btn" onClick={goBack}>Back</button>}
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
          <button type="button" className="btn primary" onClick={runCheck} disabled={checking}>
            {checking ? "Checking..." : stepIndex === steps.length - 1 ? "Re-check" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
