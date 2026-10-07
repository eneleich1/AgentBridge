import { useEffect, useMemo, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import PushNotificationSettings from "./PushNotificationSettings";
import { api } from "../services/api";

function statusText(info) {
  if (!info) return "Not checked";
  if (info.configured === false) return "Needs setup";
  if (info.status === "ready") return "Ready";
  if (info.status === "missing") return "Missing";
  if (info.status === "needs_login") return "Needs login";
  if (info.status === "usage_limit") return "Usage limit";
  if (info.status === "blocked") return "Blocked";
  return info.status || "Check needed";
}

function usageTone(usage) {
  if (!usage) return "neutral";
  if (usage.status === "ready") return "good";
  if (usage.status === "usage_limit") return "warn";
  if (usage.status === "needs_login" || usage.status === "missing" || usage.status === "blocked") return "bad";
  return "neutral";
}

function agentUsageLabel(usage) {
  if (!usage) return "Check usage";
  if (usage.remaining) return usage.remaining;
  if (usage.supportsExactRemaining) return "Unavailable";
  return "Not exposed by CLI";
}

function UsageDisclosure({ agentId, usage, loading, onRefresh }) {
  const [open, setOpen] = useState(false);
  const tone = usageTone(usage);
  const details = useMemo(() => usage?.details || [], [usage]);

  return (
    <div className={`settings-usage-card ${open ? "open" : ""}`} data-tone={tone}>
      <button
        type="button"
        className="settings-usage-trigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <div className="settings-usage-trigger-copy">
          <span className="settings-usage-kicker">{agentId === "codex" ? "Codex CLI" : agentId === "local" ? "Local Model" : "Cursor Agent"}</span>
          <strong>Usage remaining</strong>
          <small>{loading ? "Checking usage..." : usage?.headline || "Usage data unavailable"}</small>
        </div>
        <div className="settings-usage-trigger-meta">
          <span className="settings-usage-pill">{loading ? "Loading" : agentUsageLabel(usage)}</span>
          <span className={`settings-chevron ${open ? "open" : ""}`} aria-hidden="true">
            v
          </span>
        </div>
      </button>

      {open && (
        <div className="settings-usage-panel">
          <p className="settings-usage-summary">
            {loading ? "Checking current agent availability..." : usage?.summary || "No usage details available."}
          </p>
          <div className="settings-usage-grid">
            {details.map((detail) => (
              <div className="settings-usage-metric" key={`${agentId}-${detail.label}`}>
                <span>{detail.label}</span>
                <strong>{detail.value}</strong>
              </div>
            ))}
          </div>
          <button type="button" className="settings-inline-action" onClick={onRefresh}>
            Refresh usage
          </button>
        </div>
      )}
    </div>
  );
}

export default function SettingsMenu({
  anchorRect,
  setupStatus,
  defaultAgent,
  theme,
  codexModel,
  connectionSummary,
  agentUsage,
  agentUsageLoading,
  agentDuelEnabled,
  canEnableAgentDuel,
  onRefreshUsage,
  onConfigureBackend,
  onDefaultAgentChange,
  onThemeChange,
  onConfigureAgent,
  onDeleteAgentConfig,
  onAgentDuelEnabledChange,
  onClose,
}) {
  const [deleteError, setDeleteError] = useState("");
  const [deleteNotice, setDeleteNotice] = useState("");
  const [deletingAgent, setDeletingAgent] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [updatingDuel, setUpdatingDuel] = useState(false);
  const [duelError, setDuelError] = useState("");
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState("");
  const [savedIdleTimeoutMinutes, setSavedIdleTimeoutMinutes] = useState(null);
  const [authenticationCodeEnabled, setAuthenticationCodeEnabled] = useState(false);
  const [authSettingsLoading, setAuthSettingsLoading] = useState(true);
  const [authSettingsSaving, setAuthSettingsSaving] = useState(false);
  const [authSettingsError, setAuthSettingsError] = useState("");
  const [authSettingsNotice, setAuthSettingsNotice] = useState("");
  const selectedAgentName = defaultAgent === "codex" ? "Codex CLI" : defaultAgent === "local" ? "Local Model" : "Cursor Agent";
  const selectedAgentStatus = setupStatus?.[defaultAgent];
  const selectedAgentConfigured = selectedAgentStatus?.configured === true;

  useEffect(() => {
    setDeleteError("");
    setDeleteNotice("");
    setConfirmDeleteOpen(false);
  }, [defaultAgent]);

  useEffect(() => {
    let active = true;
    api.getAuthSettings()
      .then(({ idleTimeoutMinutes: minutes, authenticationCodeEnabled: enabled }) => {
        if (!active) return;
        setIdleTimeoutMinutes(String(minutes));
        setSavedIdleTimeoutMinutes(minutes);
        setAuthenticationCodeEnabled(enabled === true);
      })
      .catch((error) => {
        if (active) setAuthSettingsError(String(error?.message || error));
      })
      .finally(() => {
        if (active) setAuthSettingsLoading(false);
      });
    return () => { active = false; };
  }, []);

  const popoverStyle = useMemo(() => {
    if (!anchorRect || typeof window === "undefined") return undefined;
    const panelWidth = 360;
    const gap = 8;
    const left = Math.min(anchorRect.right + gap, window.innerWidth - panelWidth - 12);
    const top = Math.max(anchorRect.top - 8, 12);

    return {
      left: `${Math.max(left, 12)}px`,
      top: `${top}px`,
      bottom: "auto",
      maxHeight: "none",
      overflow: "visible",
    };
  }, [anchorRect]);

  async function handleDeleteAgentConfig() {
    if (!onDeleteAgentConfig || !selectedAgentConfigured) return;

    setDeletingAgent(true);
    setDeleteError("");
    setDeleteNotice("");
    try {
      await onDeleteAgentConfig(defaultAgent);
      setConfirmDeleteOpen(false);
      setDeleteNotice(`${selectedAgentName} configuration deleted. Setup is required before using it again.`);
    } catch (error) {
      setDeleteError(String(error?.message || error));
    } finally {
      setDeletingAgent(false);
    }
  }

  async function handleAgentDuelToggle() {
    if (updatingDuel || (!agentDuelEnabled && !canEnableAgentDuel)) return;
    setUpdatingDuel(true);
    setDuelError("");
    try {
      await onAgentDuelEnabledChange(!agentDuelEnabled);
    } catch (error) {
      setDuelError(String(error?.message || error));
    } finally {
      setUpdatingDuel(false);
    }
  }

  async function handleSaveIdleTimeout(event) {
    event.preventDefault();
    const minutes = Number(idleTimeoutMinutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
      setAuthSettingsError("Enter a whole number from 5 to 1440 minutes.");
      return;
    }
    setAuthSettingsSaving(true);
    setAuthSettingsError("");
    setAuthSettingsNotice("");
    try {
      const settings = await api.updateAuthSettings({ idleTimeoutMinutes: minutes });
      setIdleTimeoutMinutes(String(settings.idleTimeoutMinutes));
      setSavedIdleTimeoutMinutes(settings.idleTimeoutMinutes);
      setAuthSettingsNotice("Session timeout saved.");
    } catch (error) {
      setAuthSettingsError(String(error?.message || error));
    } finally {
      setAuthSettingsSaving(false);
    }
  }

  async function handleAuthenticationCodeToggle() {
    if (authSettingsLoading || authSettingsSaving) return;
    setAuthSettingsSaving(true);
    setAuthSettingsError("");
    setAuthSettingsNotice("");
    try {
      const settings = await api.updateAuthSettings({ authenticationCodeEnabled: !authenticationCodeEnabled });
      setAuthenticationCodeEnabled(settings.authenticationCodeEnabled);
      setAuthSettingsNotice(settings.authenticationCodeEnabled ? "Authenticator code enabled." : "Authenticator code disabled.");
    } catch (error) {
      setAuthSettingsError(String(error?.message || error));
    } finally {
      setAuthSettingsSaving(false);
    }
  }

  return (
    <>
      <div className="settings-popover" role="dialog" aria-label="Settings" style={popoverStyle}>
        <div className="settings-popover-header">
          <div>
            <strong>AgentBridge settings</strong>
            <small>Theme, backend, and selected agent</small>
          </div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-label">Theme</div>
          <div className="settings-choice-row theme-choice-row">
            {["dark", "light", "system"].map((item) => (
              <button
                type="button"
                key={item}
                className={`settings-choice ${theme === item ? "active" : ""}`}
                onClick={() => onThemeChange(item)}
              >
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section settings-config-list">
          <div className="settings-label">Backend</div>
          <button type="button" className="settings-menu-item" onClick={onConfigureBackend}>
            <span>Configure Backend</span>
            <small>{setupStatus?.setupComplete ? "Connected" : "Needs setup"}</small>
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-label">Security</div>
          <div className="settings-feature-row">
            <div className="settings-feature-copy">
              <strong>Authenticator code</strong>
              <small>Require your authenticator code when signing in or changing your password. Turn it back on to use your existing authenticator.</small>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Authenticator code"
              aria-checked={authenticationCodeEnabled}
              className={`settings-switch ${authenticationCodeEnabled ? "active" : ""}`}
              disabled={authSettingsLoading || authSettingsSaving}
              onClick={handleAuthenticationCodeToggle}
            ><span /></button>
          </div>
          <form className="settings-idle-form" onSubmit={handleSaveIdleTimeout}>
            <label htmlFor="settings-idle-timeout">Sign out after inactivity</label>
            <div className="settings-idle-controls">
              <input
                id="settings-idle-timeout"
                type="number"
                min="5"
                max="1440"
                step="1"
                value={idleTimeoutMinutes}
                onChange={(event) => {
                  setIdleTimeoutMinutes(event.target.value);
                  setAuthSettingsNotice("");
                }}
                disabled={authSettingsLoading || authSettingsSaving}
                aria-describedby="settings-idle-help"
              />
              <span>minutes</span>
              <button type="submit" disabled={authSettingsLoading || authSettingsSaving || Number(idleTimeoutMinutes) === savedIdleTimeoutMinutes}>
                {authSettingsSaving ? "Saving..." : "Save"}
              </button>
            </div>
            <small id="settings-idle-help">Allowed range: 5–1440 minutes.</small>
            {authSettingsError && <div className="alert error" role="alert">{authSettingsError}</div>}
            {authSettingsNotice && <div className="success-box" role="status">{authSettingsNotice}</div>}
          </form>
        </div>

        <div className="settings-section">
          <div className="settings-label">Optional features</div>
          <div className="settings-feature-row">
            <div className="settings-feature-copy">
              <strong>Agent Duel</strong>
              <small>
                {agentDuelEnabled
                  ? "Enabled in the chat agent selector."
                  : canEnableAgentDuel
                    ? "Compare Cursor and Codex on the same prompt."
                    : "Configure both Cursor and Codex before enabling."}
              </small>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={agentDuelEnabled}
              aria-label="Enable Agent Duel"
              className={`settings-switch ${agentDuelEnabled ? "active" : ""}`}
              disabled={updatingDuel || (!agentDuelEnabled && !canEnableAgentDuel)}
              onClick={handleAgentDuelToggle}
            >
              <span />
            </button>
          </div>
          {duelError && <div className="alert error">{duelError}</div>}
        </div>

        <PushNotificationSettings />

        <div className="settings-section">
          <div className="settings-label">Default agent</div>
          <div className="settings-choice-row">
            <button
              type="button"
              className={`settings-choice ${defaultAgent === "cursor" ? "active" : ""}`}
              onClick={() => onDefaultAgentChange("cursor")}
            >
              Cursor
            </button>
            <button
              type="button"
              className={`settings-choice ${defaultAgent === "codex" ? "active" : ""}`}
              onClick={() => onDefaultAgentChange("codex")}
            >
              Codex
            </button>
            <button
              type="button"
              className={`settings-choice ${defaultAgent === "local" ? "active" : ""}`}
              onClick={() => onDefaultAgentChange("local")}
            >
              Local
            </button>
          </div>
        </div>

        <div className="settings-section settings-config-list">
          <div className="settings-label">{selectedAgentName}</div>
          <button
            type="button"
            className="settings-menu-item"
            onClick={() => onConfigureAgent(defaultAgent)}
          >
            <span>Configure {selectedAgentName}</span>
            <small>
              {statusText(selectedAgentStatus)}
              {defaultAgent === "codex" && codexModel ? ` - Model: ${codexModel}` : ""}
              {connectionSummary?.connectionMode
                ? ` - ${connectionSummary.connectionMode} → ${connectionSummary.protocol || "pending"} / ${connectionSummary.transport || "pending"}`
                : ""}
            </small>
          </button>

          {defaultAgent !== "local" && (
            <UsageDisclosure
              agentId={defaultAgent}
              usage={agentUsage?.[defaultAgent]}
              loading={agentUsageLoading?.[defaultAgent]}
              onRefresh={() => onRefreshUsage(defaultAgent)}
            />
          )}

          <button
            type="button"
            className="settings-menu-item settings-menu-item-danger"
            onClick={() => {
              if (!selectedAgentConfigured || deletingAgent) return;
              setDeleteError("");
              setConfirmDeleteOpen(true);
            }}
            disabled={deletingAgent || !selectedAgentConfigured}
          >
            <span>{deletingAgent ? "Deleting configuration..." : `Delete ${selectedAgentName} configuration`}</span>
            <small>Reset AgentBridge setup for this agent</small>
          </button>
          {deleteNotice && <div className="success-box">{deleteNotice}</div>}
          {deleteError && <div className="alert error">{deleteError}</div>}
        </div>
      </div>

      {confirmDeleteOpen && (
        <ConfirmDialog
          title={`Delete ${selectedAgentName} configuration`}
          message={
            `Remove the ${selectedAgentName} setup from AgentBridge? ` +
            "This will not uninstall the CLI or sign out of its account. You will need to run the configuration wizard again before using it."
          }
          confirmLabel="Delete configuration"
          cancelLabel="Cancel"
          danger
          busy={deletingAgent}
          onConfirm={handleDeleteAgentConfig}
          onCancel={() => {
            if (deletingAgent) return;
            setConfirmDeleteOpen(false);
          }}
        />
      )}
    </>
  );
}
