import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";

export default function AccountMenu({ onOpenSettings }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
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
    api.getAccount().then(setAccount).catch(() => setAccount(null));
  }, [open]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menuOpen]);

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
      <div className="sidebar-account" ref={menuRef}>
      <button
        type="button"
        className="account-menu-trigger"
        onClick={() => setMenuOpen(value => !value)}
        aria-expanded={menuOpen}
        aria-label="Account"
        title="Account"
      >
        <span className="account-avatar">{account?.username ? initial : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg>}</span>
        <span className="account-name">{account?.username || "Account"}<small>Personal workspace</small></span>
        <span aria-hidden="true">⌃</span>
      </button>
      {menuOpen && <div className="account-popover" aria-label="Account options">
        <button type="button" onClick={() => { setMenuOpen(false); onOpenSettings?.(); }}><span aria-hidden="true">⚙</span> Settings</button>
        <button type="button" onClick={() => { setMenuOpen(false); setOpen(true); }}><span aria-hidden="true">♙</span> Account &amp; password</button>
        <button type="button" onClick={() => { setMenuOpen(false); handleLogout().catch(err => { setError(err.message); setOpen(true); }); }}><span aria-hidden="true">↪</span> Log out</button>
      </div>}
      </div>

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
              {account?.authenticationCodeEnabled && <label>
                Authenticator code
                <input
                  value={totpToken}
                  onChange={(e) => setTotpToken(e.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6-digit code"
                  autoComplete="one-time-code"
                />
              </label>}
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
                  disabled={loading || !account || !currentPassword || (account.authenticationCodeEnabled && !totpToken) || !newPassword}
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
