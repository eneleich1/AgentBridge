import { useState } from "react";
import { api } from "../services/api";

const STEPS = [
  { title: "Connect", description: "Check the currently configured AgentBridge backend." },
  { title: "Project folder", description: "Validate the project folder on that backend." },
  { title: "Agent readiness", description: "Confirm the selected agent can run tasks there." },
  { title: "Register", description: "Add the project after every check passes." },
];

function agentLabel(agent) {
  return agent === "codex" ? "Codex CLI" : "Cursor Agent";
}

function connectionErrorMessage(error, serverUrl) {
  const message = String(error?.message || error);
  if (message === "Failed to fetch") {
    return `Could not reach ${serverUrl}. For LAN access, use http://<desktop-ip>:3847 and confirm AgentBridge is listening on that address. For Cloudflare Tunnel, use the HTTPS tunnel URL without adding :3847.`;
  }
  if (message.includes("404")) {
    return `AgentBridge answered at ${serverUrl}, but the expected API route was not found. Confirm this is the AgentBridge URL. LAN URLs usually include :3847; Cloudflare Tunnel URLs should not.`;
  }
  return message;
}

export default function ProjectSetupWizard({ agent, setupStatus, onRefresh, onComplete, onClose }) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const [health, setHealth] = useState(null);
  const [validation, setValidation] = useState(null);
  const [agentStatus, setAgentStatus] = useState(setupStatus?.[agent] || null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const currentStep = STEPS[stepIndex];
  const serverUrl = api.getServerUrl();

  async function validateConnection() {
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const nextHealth = await api.testConnection();
      setHealth(nextHealth);
      setStatus(`Connected to ${nextHealth.hostname || "desktop"}.`);
      setStepIndex(1);
    } catch (err) {
      setError(connectionErrorMessage(err, serverUrl));
    } finally {
      setLoading(false);
    }
  }

  async function validateFolder() {
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const { validation } = await api.validateProject(path);
      setValidation(validation);
      if (!validation.valid) {
        throw new Error(validation.message);
      }
      if (!validation.writable) {
        throw new Error("Folder is readable but not writable. Pick a folder where the desktop user can write.");
      }
      if (!name.trim()) {
        setName(path.split(/[\\/]/).filter(Boolean).pop() || "Project");
      }
      setStatus(validation.isGitRepo ? "Folder is readable and writable." : "Folder is accessible, but it does not look like a Git repository.");
      setStepIndex(2);
    } catch (err) {
      const validationError = err.data?.validation;
      if (validationError) setValidation(validationError);
      setError(validationError?.message || err.message);
    } finally {
      setLoading(false);
    }
  }

  async function validateAgent() {
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const nextSetupStatus = await api.refreshSetupStatus();
      const nextAgentStatus = nextSetupStatus?.[agent];
      setAgentStatus(nextAgentStatus || null);
      if (onRefresh) await onRefresh();
      if (nextAgentStatus?.configured === false) {
        throw new Error(`${agentLabel(agent)} must be configured in AgentBridge settings first.`);
      }
      if (nextAgentStatus?.status !== "ready") {
        throw new Error(nextAgentStatus?.message || `${agentLabel(agent)} is not ready on the desktop.`);
      }
      setStatus(`${agentLabel(agent)} is ready.`);
      setStepIndex(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function registerProject() {
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const { project } = await api.addProject({ name, path });
      onComplete(project);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleNext() {
    if (stepIndex === 0) return validateConnection();
    if (stepIndex === 1) return validateFolder();
    if (stepIndex === 2) return validateAgent();
    return registerProject();
  }

  function handleBack() {
    setError("");
    setStatus("");
    setStepIndex((current) => Math.max(0, current - 1));
  }

  const nextDisabled =
    loading ||
    (stepIndex === 1 && !path.trim()) ||
    (stepIndex === 3 && !name.trim());

  return (
    <div className="wizard-backdrop" role="dialog" aria-modal="true" aria-label="Add project">
      <div className="agent-wizard">
        <div className="agent-wizard-header">
          <div>
            <h2>Add desktop project</h2>
            <p>{currentStep.description}</p>
          </div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        <ol className="wizard-progress">
          {STEPS.map((step, index) => (
            <li key={step.title} className={index === stepIndex ? "active" : index < stepIndex ? "done" : ""}>
              <span>{index + 1}</span>
              {step.title}
            </li>
          ))}
        </ol>

        {stepIndex === 0 && (
          <div className="setup-form">
            <label>
              Active backend
              <input value={serverUrl} readOnly />
            </label>
            <p className="wizard-note">Projects are added to the backend currently selected for this UI. If this is the wrong machine, close this wizard and change the backend from the connection status in the sidebar first.</p>
          </div>
        )}

        {stepIndex === 1 && (
          <div className="setup-form">
            <label>
              Project name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My project" />
            </label>
            <label>
              Folder path on desktop
              <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\\Users\\you\\Documents\\GitHub\\MyApp" />
            </label>
            <p className="wizard-note">Use the path as the AgentBridge backend sees it. Prefer a local path like C:\Users\...; use \\machine\share only if that backend process can read and write that share.</p>
          </div>
        )}

        {stepIndex === 2 && (
          <div className={`agent-current-status ${agentStatus?.status || "unknown"}`}>
            <strong>{agentLabel(agent)}</strong>
            <span>{agentStatus?.message || "Not checked yet"}</span>
          </div>
        )}

        {stepIndex === 3 && (
          <div className="wizard-summary">
            <div><strong>Desktop</strong><span>{health?.hostname || serverUrl}</span></div>
            <div><strong>Project</strong><span>{name || path}</span></div>
            <div><strong>Path</strong><span>{validation?.path || path}</span></div>
            <div><strong>Agent</strong><span>{agentLabel(agent)}</span></div>
          </div>
        )}

        {status && <div className="success-box">{status}</div>}
        {error && <div className="alert error">{error}</div>}

        <div className="agent-wizard-actions">
          {stepIndex > 0 && <button type="button" className="btn" onClick={handleBack}>Back</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={handleNext} disabled={nextDisabled}>
            {loading ? "Checking..." : stepIndex === STEPS.length - 1 ? "Add project" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
