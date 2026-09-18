const BACKEND_ORIGIN_KEY = "agentbridge_backend_origin";
const TOKEN_KEY = "agentbridge_token";
const SETUP_DONE_KEY = "agentbridge_setup_done";
const SIDEBAR_WIDTH_KEY = "agentbridge_sidebar_width";
const DEFAULT_AGENT_KEY = "agentbridge_default_agent";
const SYSTEM_METRICS_VISIBLE_KEY = "agentbridge_system_metrics_visible";
const THEME_KEY = "agentbridge_theme";

function getConfiguredApiOrigin() {
  const configured = String(import.meta.env.VITE_AGENTBRIDGE_API_ORIGIN || "").trim();
  return configured.replace(/\/$/, "");
}

function getApiBaseUrl() {
  const stored = localStorage.getItem(BACKEND_ORIGIN_KEY);
  if (stored) return stored.replace(/\/$/, "");
  return getConfiguredApiOrigin();
}

function getServerUrl() {
  return getApiBaseUrl() || window.location.origin.replace(/\/$/, "");
}

function getSuggestedBackendOrigin() {
  return getServerUrl();
}

function isLocalOrPrivateHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

function normalizeBackendOrigin(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const hasProtocol = /^https?:\/\//i.test(raw);
  const defaultProtocol =
    raw.startsWith("localhost") ||
    raw.startsWith("127.0.0.1") ||
    raw.startsWith("[::1]") ||
    /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(raw)
      ? "http"
      : "https";
  const withProtocol = hasProtocol ? raw : `${defaultProtocol}://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    if (!parsed.port && parsed.protocol === "http:" && isLocalOrPrivateHost(parsed.hostname)) {
      parsed.port = "3847";
    }
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return withProtocol.replace(/\/$/, "");
  }
}

function setBackendOrigin(url) {
  const normalized = normalizeBackendOrigin(url);
  if (normalized) {
    localStorage.setItem(BACKEND_ORIGIN_KEY, normalized);
  } else {
    localStorage.removeItem(BACKEND_ORIGIN_KEY);
  }
  return normalized;
}

function clearBackendOrigin() {
  localStorage.removeItem(BACKEND_ORIGIN_KEY);
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function isSetupDone() {
  return localStorage.getItem(SETUP_DONE_KEY) === "true";
}

function setSetupDone(done) {
  localStorage.setItem(SETUP_DONE_KEY, done ? "true" : "false");
}

function getSidebarWidth() {
  return Number(localStorage.getItem(SIDEBAR_WIDTH_KEY)) || 260;
}

function setSidebarWidth(width) {
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
}

function getDefaultAgent() {
  const agent = localStorage.getItem(DEFAULT_AGENT_KEY);
  return ["cursor", "codex", "local"].includes(agent) ? agent : "cursor";
}

function setDefaultAgent(agent) {
  localStorage.setItem(DEFAULT_AGENT_KEY, ["cursor", "codex", "local"].includes(agent) ? agent : "cursor");
}

function getSystemMetricsVisible() {
  return localStorage.getItem(SYSTEM_METRICS_VISIBLE_KEY) !== "false";
}

function setSystemMetricsVisible(visible) {
  localStorage.setItem(SYSTEM_METRICS_VISIBLE_KEY, visible ? "true" : "false");
}

function getTheme() {
  const theme = localStorage.getItem(THEME_KEY);
  return ["dark", "light", "system"].includes(theme) ? theme : "dark";
}

function setTheme(theme) {
  const normalized = ["dark", "light", "system"].includes(theme) ? theme : "dark";
  localStorage.setItem(THEME_KEY, normalized);
  return normalized;
}

function authHeaders() {
  const token = getToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function request(path, options = {}, baseUrl = null) {
  const method = (options.method || "GET").toUpperCase();
  const headers = {
    ...authHeaders(),
    ...options.headers,
  };

  let body = options.body;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  } else if (method !== "GET" && method !== "HEAD") {
    body = "{}";
    headers["Content-Type"] = "application/json";
  }

  let response;
  const resolvedBaseUrl = (baseUrl || getApiBaseUrl() || "").replace(/\/$/, "");
  try {
    response = await fetch(`${resolvedBaseUrl}${path}`, {
      ...options,
      method,
      headers,
      body,
    });
  } catch (error) {
    const err = new Error(`Failed to fetch ${getServerUrl()}${path}`);
    err.cause = error;
    throw err;
  }

  const data = await response.json().catch(() => ({}));

  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    setToken("");
    window.dispatchEvent(new Event("agentbridge:unauthorized"));
  }

  if (!response.ok) {
    const err = new Error(data.error || `Request failed (${response.status})`);
    err.code = data.code;
    err.setup = data.setup;
    err.agent = data.agent;
    err.data = data;
    throw err;
  }

  return data;
}

export const api = {
  getServerUrl,
  getSuggestedBackendOrigin,
  normalizeBackendOrigin,
  setBackendOrigin,
  clearBackendOrigin,
  getToken,
  setToken,
  isSetupDone,
  setSetupDone,
  getSidebarWidth,
  setSidebarWidth,
  getDefaultAgent,
  setDefaultAgent,
  getSystemMetricsVisible,
  setSystemMetricsVisible,
  getTheme,
  setTheme,

  testConnection(serverUrl = null) {
    return request("/api/connections/test", { method: "POST" }, serverUrl);
  },

  getHealth(serverUrl = null) {
    return request("/api/health", {}, serverUrl);
  },

  getAuthStatus() {
    return request("/api/auth/status");
  },

  checkSession() {
    return request("/api/auth/session");
  },

  async login(username, password, totpToken) {
    const data = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, totpToken }),
    });
    setToken(data.token);
    return data;
  },

  async logout() {
    try {
      await request("/api/auth/logout", { method: "POST" });
    } finally {
      setToken("");
    }
  },

  getAccount() {
    return request("/api/auth/me");
  },

  changePassword(currentPassword, totpToken, newPassword) {
    return request("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, totpToken, newPassword }),
    });
  },

  getSetupStatus(serverUrl = null) {
    return request("/api/setup/status", {}, serverUrl);
  },

  refreshSetupStatus(serverUrl = null) {
    return request("/api/setup/status?refresh=1", {}, serverUrl);
  },

  getNotificationStatus(serverUrl = null) {
    return request("/api/notifications/status", {}, serverUrl);
  },

  getPushPublicKey(serverUrl = null) {
    return request("/api/notifications/vapid-public-key", {}, serverUrl);
  },

  savePushSubscription(subscription, serverUrl = null) {
    return request("/api/notifications/subscriptions", {
      method: "POST",
      body: JSON.stringify(subscription),
    }, serverUrl);
  },

  removePushSubscription(endpoint, serverUrl = null) {
    return request("/api/notifications/subscriptions", {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
    }, serverUrl);
  },

  sendPushNotificationTest(serverUrl = null) {
    return request("/api/notifications/test", { method: "POST" }, serverUrl);
  },

  getSystemMetrics(serverUrl = null) {
    return request("/api/system-metrics", {}, serverUrl);
  },

  getAgents(serverUrl = null) {
    return request("/api/agents", {}, serverUrl);
  },

  getAgentDuelSettings(serverUrl = null) {
    return request("/api/agents/duel-settings", {}, serverUrl);
  },

  updateAgentDuelSettings(enabled, serverUrl = null) {
    return request("/api/agents/duel-settings", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }, serverUrl);
  },

  getAgentConfig(agentId, serverUrl = null) {
    return request(`/api/agents/${agentId}/config`, {}, serverUrl);
  },

  getAgentUsage(agentId, serverUrl = null) {
    return request(`/api/agents/${agentId}/usage`, {}, serverUrl);
  },

  updateAgentConfig(agentId, settings, serverUrl = null) {
    return request(`/api/agents/${agentId}/config`, {
      method: "PUT",
      body: JSON.stringify(settings || {}),
    }, serverUrl);
  },

  deleteAgentConfig(agentId, serverUrl = null) {
    return request(`/api/agents/${agentId}/config`, {
      method: "DELETE",
    }, serverUrl);
  },

  getProjects(serverUrl = null) {
    return request("/api/projects", {}, serverUrl);
  },

  validateProject(path, serverUrl = null) {
    return request("/api/projects/validate", {
      method: "POST",
      body: JSON.stringify({ path }),
    }, serverUrl);
  },

  addProject({ name, path }, serverUrl = null) {
    return request("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name, path }),
    }, serverUrl);
  },

  deleteProject(id, serverUrl = null) {
    return request(`/api/projects/${id}`, { method: "DELETE" }, serverUrl);
  },

  getTasks(limit = 100, projectId = null, serverUrl = null) {
    const query = projectId
      ? `?limit=${limit}&projectId=${encodeURIComponent(projectId)}`
      : `?limit=${limit}`;
    return request(`/api/tasks${query}`, {}, serverUrl);
  },

  getTask(id, serverUrl = null) {
    return request(`/api/tasks/${id}`, {}, serverUrl);
  },

  createTask({ projectId, agentType, prompt, attachments = [], conversationId = null }, serverUrl = null) {
    return request("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ projectId, agentType, prompt, attachments, conversationId }),
    }, serverUrl);
  },

  cancelTask(id, serverUrl = null) {
    return request(`/api/tasks/${id}/cancel`, { method: "POST" }, serverUrl);
  },

  deleteTask(id, serverUrl = null) {
    return request(`/api/tasks/${id}`, { method: "DELETE" }, serverUrl);
  },

  getSessions(limit = 100, projectId = null, serverUrl = null) {
    const query = projectId
      ? `?limit=${limit}&projectId=${encodeURIComponent(projectId)}`
      : `?limit=${limit}`;
    return request(`/api/sessions${query}`, {}, serverUrl);
  },

  getSession(id, serverUrl = null) {
    return request(`/api/sessions/${id}`, {}, serverUrl);
  },

  createSession({ projectId, agentType, mode }, serverUrl = null) {
    return request("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ projectId, agentType, mode }),
    }, serverUrl);
  },

  deleteSession(id, serverUrl = null) {
    return request(`/api/sessions/${id}`, { method: "DELETE" }, serverUrl);
  },

  cancelSession(id, serverUrl = null) {
    return request(`/api/sessions/${id}/cancel`, { method: "POST" }, serverUrl);
  },

  respondToSessionPermission(sessionId, requestId, { decision, optionId } = {}, serverUrl = null) {
    return request(`/api/sessions/${sessionId}/permissions/${requestId}`, {
      method: "POST",
      body: JSON.stringify({ decision, optionId }),
    }, serverUrl);
  },

  selectDuelWinner(id, messageId, winner, serverUrl = null) {
    return request(`/api/sessions/${id}/duel-winner`, {
      method: "POST",
      body: JSON.stringify({ messageId, winner }),
    }, serverUrl);
  },

  updateSessionMode(id, mode, serverUrl = null) {
    return request(`/api/sessions/${id}/mode`, {
      method: "PATCH",
      body: JSON.stringify({ mode }),
    }, serverUrl);
  },

  updateSessionAgent(id, agentType, serverUrl = null) {
    return request(`/api/sessions/${id}/agent`, {
      method: "PATCH",
      body: JSON.stringify({ agentType }),
    }, serverUrl);
  },

  getSessionMessages(id, serverUrl = null) {
    return request(`/api/sessions/${id}/messages`, {}, serverUrl);
  },

  createSessionMessage(id, { content, attachments = [] }, serverUrl = null) {
    return request(`/api/sessions/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, attachments }),
    }, serverUrl);
  },

  replaySessionMessage(sessionId, messageId, { content }, serverUrl = null) {
    return request(`/api/sessions/${sessionId}/messages/${messageId}/replay`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }, serverUrl);
  },

  transcribeAudio({ audio, language }, serverUrl = null) {
    return request("/api/audio/transcriptions", {
      method: "POST",
      body: JSON.stringify({ audio, language }),
    }, serverUrl);
  },
};

export function getWebSocketUrl() {
  const base = getApiBaseUrl() || window.location.origin;
  const url = new URL(base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const token = getToken();
  url.pathname = "/ws";
  if (token) url.searchParams.set("token", token);
  return url.toString();
}
