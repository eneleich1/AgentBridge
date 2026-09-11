import { useEffect, useState } from "react";
import { api } from "../services/api";
import {
  disablePushNotifications,
  enablePushNotifications,
  hasPushSubscription,
  pushNotificationsSupported,
} from "../services/pushNotifications";

export default function PushNotificationSettings() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const supported = pushNotificationsSupported();

  useEffect(() => {
    if (!supported) return;
    hasPushSubscription().then(setEnabled).catch(() => setEnabled(false));
  }, [supported]);

  async function toggle() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (enabled) {
        await disablePushNotifications();
        setEnabled(false);
        setNotice("Push notifications disabled for this device.");
      } else {
        await enablePushNotifications();
        setEnabled(true);
        setNotice("Push notifications enabled for this device.");
      }
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.sendPushNotificationTest();
      setNotice("Test notification sent.");
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-label">Remote notifications</div>
      <div className="settings-feature-row">
        <div className="settings-feature-copy">
          <strong>Push notifications</strong>
          <small>
            {supported
              ? "Get alerted when an agent completes, fails, or needs permission — even with AgentBridge closed."
              : "This browser does not support web push notifications."}
          </small>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Enable push notifications"
          className={`settings-switch ${enabled ? "active" : ""}`}
          disabled={!supported || busy}
          onClick={toggle}
        >
          <span />
        </button>
      </div>
      {enabled && (
        <button type="button" className="settings-inline-action" onClick={sendTest} disabled={busy}>
          {busy ? "Working..." : "Send test notification"}
        </button>
      )}
      {notice && <div className="success-box">{notice}</div>}
      {error && <div className="alert error">{error}</div>}
    </div>
  );
}
