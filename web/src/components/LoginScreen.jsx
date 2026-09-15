import { useState } from "react";
import { api } from "../services/api";

export default function LoginScreen({ onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.login(username.trim(), password, totpToken.trim());
      onLoggedIn();
    } catch (err) {
      setError(err?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wizard-backdrop" role="dialog" aria-modal="true" aria-label="Log in">
      <div className="agent-wizard">
        <div className="agent-wizard-header">
          <div>
            <h2>AgentBridge</h2>
            <p>Sign in to continue.</p>
          </div>
        </div>

        <form className="setup-form" onSubmit={handleSubmit}>
          <label>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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

          {error && <div className="alert error">{error}</div>}

          <div className="agent-wizard-actions">
            <button
              type="submit"
              className="btn primary"
              disabled={loading || !username || !password || !totpToken}
            >
              {loading ? "Signing in..." : "Log in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
