import { useEffect, useState } from "react";
import { api } from "../services/api";
import LoginScreen from "./LoginScreen";
import App from "../App";
import { resolveAuthStatus } from "../services/authStatus";

export default function AuthGate() {
  const [status, setStatus] = useState("checking"); // checking | login | app | error

  async function checkAuth() {
    setStatus("checking");
    try {
      setStatus(await resolveAuthStatus(api));
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => {
    checkAuth();
    function handleUnauthorized() {
      setStatus("login");
    }
    window.addEventListener("agentbridge:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("agentbridge:unauthorized", handleUnauthorized);
  }, []);

  if (status === "checking") return null;
  if (status === "error") return (
    <div className="wizard-backdrop" role="alert">
      <div className="agent-wizard">
        <h2>Could not verify your session</h2>
        <p>Unable to connect to the server. Your sign-in has been kept. Please retry.</p>
        <button className="btn primary" onClick={checkAuth}>Retry</button>
      </div>
    </div>
  );
  if (status === "login") return <LoginScreen onLoggedIn={() => setStatus("app")} />;
  return <App />;
}
