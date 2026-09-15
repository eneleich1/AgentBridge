import { useEffect, useState } from "react";
import { api } from "../services/api";
import LoginScreen from "./LoginScreen";
import App from "../App";

export default function AuthGate() {
  const [status, setStatus] = useState("checking"); // checking | login | app

  async function checkAuth() {
    try {
      const { configured } = await api.getAuthStatus();
      if (!configured) {
        setStatus("app");
        return;
      }
      if (api.getToken()) {
        try {
          await api.checkSession();
          setStatus("app");
          return;
        } catch {
          // stored token is invalid/expired, fall through to login
        }
      }
      setStatus("login");
    } catch {
      // Backend unreachable: let App render its own connection error UI.
      setStatus("app");
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
  if (status === "login") return <LoginScreen onLoggedIn={() => setStatus("app")} />;
  return <App />;
}
