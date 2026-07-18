import { useMemo, useState } from "react";

function statusText(info) {
  if (!info) return "Not checked";
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
          <span className="settings-usage-kicker">{agentId === "codex" ? "Codex CLI" : "Cursor Agent"}</span>
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
  agentUsage,
  agentUsageLoading,
  onRefreshUsage,
  onConfigureBackend,
  onDefaultAgentChange,
  onThemeChange,
  onConfigureAgent,
  onClose,
}) {
  const popoverStyle = useMemo(() => {
    if (!anchorRect || typeof window === "undefined") return undefined;
    const panelWidth = 360;
    const panelMaxHeight = Math.min(560, window.innerHeight - 24);
    const gap = 8;
    const left = Math.min(anchorRect.right + gap, window.innerWidth - panelWidth - 12);
    const top = Math.min(
      Math.max(anchorRect.top - 8, 12),
      window.innerHeight - panelMaxHeight - 12
    );

    return {
      left: `${Math.max(left, 12)}px`,
      top: `${Math.max(top, 12)}px`,
      bottom: "auto",
    };
  }, [anchorRect]);

  return (
    <div className="settings-popover" role="dialog" aria-label="Settings" style={popoverStyle}>
      <div className="settings-popover-header">
        <div>
          <strong>AgentBridge settings</strong>
          <small>Agents and defaults</small>
        </div>
        <button type="button" className="settings-close" onClick={onClose} aria-label="Close">
          x
        </button>
      </div>

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
        </div>
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
        <button type="button" className="settings-menu-item" onClick={onConfigureBackend}>
          <span>Configure Backend</span>
          <small>{setupStatus?.setupComplete ? "Connected" : "Needs setup"}</small>
        </button>

        <button type="button" className="settings-menu-item" onClick={() => onConfigureAgent("cursor")}>
          <span>Configure Cursor Agent</span>
          <small>{statusText(setupStatus?.cursor)}</small>
        </button>
        <UsageDisclosure
          agentId="cursor"
          usage={agentUsage?.cursor}
          loading={agentUsageLoading?.cursor}
          onRefresh={() => onRefreshUsage("cursor")}
        />

        <button type="button" className="settings-menu-item" onClick={() => onConfigureAgent("codex")}>
          <span>Configure Codex CLI</span>
          <small>
            {statusText(setupStatus?.codex)}
            {codexModel ? ` - Model: ${codexModel}` : ""}
          </small>
        </button>
        <UsageDisclosure
          agentId="codex"
          usage={agentUsage?.codex}
          loading={agentUsageLoading?.codex}
          onRefresh={() => onRefreshUsage("codex")}
        />
      </div>
    </div>
  );
}
