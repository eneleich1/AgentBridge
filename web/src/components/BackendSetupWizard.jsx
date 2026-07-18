import { useMemo, useState } from "react";
import { api } from "../services/api";

const STEPS = [
  { title: "Backend", description: "Choose the AgentBridge backend you want this UI to control." },
  { title: "Verify", description: "Confirm the target answers like a valid AgentBridge backend." },
  { title: "Next", description: "Choose what to configure on that backend next." },
];

function connectionErrorMessage(error, serverUrl) {
  const message = String(error?.message || error);
  if (message.startsWith("Failed to fetch ")) {
    return `Could not reach ${serverUrl}. Check the URL, confirm the backend is running there, and verify firewall/tunnel access if this is remote.`;
  }
  if (message.includes("404")) {
    return `The server at ${serverUrl} answered, but it does not look like an AgentBridge API.`;
  }
  if (message.includes("401")) {
    return `The backend at ${serverUrl} requires a token that this UI does not have yet.`;
  }
  return message;
}

export default function BackendSetupWizard({
  initialUrl,
  onConnected,
  onClose,
}) {
  const [backendUrl, setBackendUrl] = useState(initialUrl || api.getSuggestedBackendOrigin());
  const [stepIndex, setStepIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [health, setHealth] = useState(null);

  const normalizedUrl = useMemo(
    () => api.normalizeBackendOrigin(backendUrl),
    [backendUrl]
  );
  const currentStep = STEPS[stepIndex];

  async function verifyBackend() {
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const nextHealth = await api.testConnection(normalizedUrl);
      setHealth(nextHealth);
      setStatus(`Connected to ${nextHealth.hostname || normalizedUrl}.`);
      setStepIndex(1);
    } catch (err) {
      setError(connectionErrorMessage(err, normalizedUrl || backendUrl));
    } finally {
      setLoading(false);
    }
  }

  async function confirmBackend() {
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const nextHealth = await api.getHealth(normalizedUrl);
      api.setBackendOrigin(normalizedUrl);
      setHealth(nextHealth);
      setStatus(`Backend saved: ${nextHealth.hostname || normalizedUrl}.`);
      setStepIndex(2);
      if (onConnected) {
        await onConnected(normalizedUrl);
      }
    } catch (err) {
      setError(connectionErrorMessage(err, normalizedUrl || backendUrl));
    } finally {
      setLoading(false);
    }
  }

  function handleNextAction(nextAction) {
    if (onConnected) onConnected(normalizedUrl, nextAction);
  }

  const nextDisabled =
    loading ||
    (stepIndex === 0 && !normalizedUrl) ||
    (stepIndex === 1 && !health);

  return (
    <div className="wizard-backdrop" role="dialog" aria-modal="true" aria-label="Backend setup">
      <div className="agent-wizard">
        <div className="agent-wizard-header">
          <div>
            <h2>Connect AgentBridge Backend</h2>
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
              Backend URL
              <input
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
                placeholder="http://localhost:3847 or https://name.trycloudflare.com"
              />
            </label>
            <p className="wizard-note">Use the full AgentBridge backend origin. Local backends usually use port `3847`; tunnels usually use HTTPS without a port.</p>
          </div>
        )}

        {stepIndex === 1 && (
          <div className="wizard-summary">
            <div><strong>Backend</strong><span>{normalizedUrl}</span></div>
            <div><strong>Hostname</strong><span>{health?.hostname || "Unknown"}</span></div>
            <div><strong>Version</strong><span>{health?.version || "Unknown"}</span></div>
            <div><strong>Platform</strong><span>{health?.platform || "Unknown"}</span></div>
          </div>
        )}

        {stepIndex === 2 && (
          <div className="settings-section">
            <div className="settings-label">What do you want to configure now?</div>
            <div className="settings-choice-row">
              <button type="button" className="settings-choice" onClick={() => handleNextAction("project")}>
                Project
              </button>
              <button type="button" className="settings-choice" onClick={() => handleNextAction("cursor")}>
                Cursor
              </button>
              <button type="button" className="settings-choice" onClick={() => handleNextAction("codex")}>
                Codex
              </button>
            </div>
            <p className="wizard-note">This UI is now connected to `{health?.hostname || normalizedUrl}`.</p>
          </div>
        )}

        {status && <div className="success-box">{status}</div>}
        {error && <div className="alert error">{error}</div>}

        <div className="agent-wizard-actions">
          {stepIndex === 2 ? (
            <button type="button" className="btn" onClick={onClose}>Done</button>
          ) : (
            <>
              {stepIndex > 0 && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setError("");
                    setStatus("");
                    setStepIndex((current) => Math.max(0, current - 1));
                  }}
                >
                  Back
                </button>
              )}
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="btn primary"
                onClick={stepIndex === 0 ? verifyBackend : confirmBackend}
                disabled={nextDisabled}
              >
                {loading ? "Checking..." : stepIndex === 0 ? "Verify backend" : "Use this backend"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
