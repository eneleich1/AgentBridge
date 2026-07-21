export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  return (
    <div className="wizard-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="confirm-dialog">
        <div className="confirm-dialog-header">
          <h2>{title}</h2>
          <button type="button" className="settings-close" onClick={onCancel} aria-label="Close" disabled={busy}>
            x
          </button>
        </div>
        <p className="confirm-dialog-message">{message}</p>
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
