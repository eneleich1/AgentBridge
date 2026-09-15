import { useEffect, useState } from "react";
import { api } from "../services/api";

export default function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!open) return;
    api.getAccount().then(setAccount).catch(() => setAccount(null));
  }, [open]);

  function resetForm() {
    setCurrentPassword("");
    setTotpToken("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    setStatus("");
  }

  async function handleChangePassword(event) {
    event.preventDefault();
    setError("");
    setStatus("");
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await api.changePassword(currentPassword, totpToken, newPassword);
      setStatus("Password updated.");
      setCurrentPassword("");
      setTotpToken("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err?.message || "Could not change password");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await api.logout();
    window.dispatchEvent(new Event("agentbridge:unauthorized"));
  }

  const initial = (account?.username || "?").slice(0, 1).toUpperCase();

  return (
    <>
      <button
        type="button"
        className="account-menu-trigger"
        onClick={() => setOpen(true)}
        aria-label="Account"
        title="Account"
      >
        {initial}
      </button>

      {open && (
        <div
          className="wizard-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Account"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setOpen(false);
              resetForm();
            }
          }}
        >
          <div className="agent-wizard">
            <div className="agent-wizard-header">
              <div>
                <h2>Account</h2>
                <p>{account?.username || "..."}{account?.email ? ` · ${account.email}` : ""}</p>
              </div>
              <button
                type="button"
                className="settings-close"
                onClick={() => {
                  setOpen(false);
                  resetForm();
                }}
                aria-label="Close"
              >
                x
              </button>
            </div>

            <form className="setup-form" onSubmit={handleChangePassword}>
              <div className="settings-label">Change password</div>
              <label>
                Current password
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
              <label>
                Authenticator code
                <input
                  value={totpToken}
                  onChange={(e) => setTotpToken(e.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6-digit code"
                  autoComplete="one-time-code"
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>

              {status && <div className="success-box">{status}</div>}
              {error && <div className="alert error">{error}</div>}

              <div className="agent-wizard-actions">
                <button type="button" className="btn" onClick={handleLogout}>
                  Log out
                </button>
                <button
                  type="submit"
                  className="btn primary"
                  disabled={loading || !currentPassword || !totpToken || !newPassword}
                >
                  {loading ? "Saving..." : "Update password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
