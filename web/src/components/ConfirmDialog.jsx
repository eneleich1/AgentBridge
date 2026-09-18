export default function ConfirmDialog({
  title,
  message,
  className = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  return (
    <div className="wizard-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`confirm-dialog ${className}`.trim()}>
        <div className="confirm-dialog-header">
          <h2>{title}</h2>
          <button type="button" className="settings-close" onClick={onCancel} aria-label="Close" disabled={busy}>
            x
          </button>
        </div>
        <div className="confirm-dialog-message">{message}</div>
        <div className="agent-wizard-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn primary ${danger ? "danger" : ""}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
