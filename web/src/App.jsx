import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./services/api";
import { connectWebSocket } from "./services/websocket";
import { DEFAULT_CODEX_MODEL } from "./constants/codexModels";
import Sidebar from "./components/Sidebar";
import ChatMessage, { extractDisplayContent } from "./components/ChatMessage";
import AgentDuelMessage from "./components/AgentDuelMessage";
import ChatComposer from "./components/ChatComposer";
import SettingsMenu from "./components/SettingsMenu";
import AgentSetupWizard from "./components/AgentSetupWizard";
import ProjectSetupWizard from "./components/ProjectSetupWizard";
import BackendSetupWizard from "./components/BackendSetupWizard";
import SystemMetricsPanel from "./components/SystemMetricsPanel";

function formatRefreshError(err) {
  const message = String(err?.message || err);
  if (message.startsWith("Failed to fetch ")) {
    return "Backend not connected. Use the connection status in the sidebar to choose an AgentBridge backend.";
  }
  return message;
}

function buildSessionPreview(session, messages = []) {
  const firstUser = messages.find((message) => message.role === "user")?.content || "";
  return {
    ...session,
    preview: firstUser || session.summary || "",
  };
}

function mergeMessageList(current, nextMessage) {
  const index = current.findIndex((message) => message.id === nextMessage.id);
  if (index >= 0) {
    const copy = [...current];
    copy[index] = { ...copy[index], ...nextMessage };
    return copy;
  }
  return [...current, nextMessage];
}

function isSessionBusy(status) {
  return status === "queued" || status === "running";
}

function getAgentLabel(agentId, detailed = false) {
  if (agentId === "cursor") return detailed ? "Cursor Agent" : "Cursor";
  if (agentId === "codex") return detailed ? "Codex CLI" : "Codex";
  return "Agent Duel";
}

function getAgentNotReadyMessage(agentType, setupStatus) {
  if (!setupStatus) {
    return "Backend is not connected. Configure an AgentBridge backend before running tasks.";
  }

  if (agentType === "duel") {
    if (setupStatus.duel?.enabled !== true) {
      return "Enable Agent Duel in Settings before starting a duel.";
    }
    if (setupStatus.duel?.configured !== true) {
      return "Configure both Codex CLI and Cursor Agent in AgentBridge settings before starting Agent Duel.";
    }
    if (setupStatus.duel?.status !== "ready") {
      return setupStatus.duel?.message || "Agent Duel is not ready on the desktop.";
    }
    return null;
  }

  const agentInfo = setupStatus?.[agentType];
  if (!agentInfo) {
    return `${getAgentLabel(agentType, true)} is not available.`;
  }
  if (agentInfo.configured !== true) {
    return `Configure ${getAgentLabel(agentType, true)} in AgentBridge settings before running tasks.`;
  }
  if (agentInfo.status !== "ready") {
    return agentInfo.message || `${getAgentLabel(agentType, true)} is not ready on the desktop.`;
  }
  return null;
}

const DEFAULT_AGENT_CONFIGS = {
  cursor: { id: "cursor", settings: { configured: false } },
  codex: { id: "codex", settings: { configured: false, model: DEFAULT_CODEX_MODEL } },
};

function updateSetupAgentConfigured(current, agentId, configured) {
  if (!current?.[agentId]) return current;
  const next = {
    ...current,
    [agentId]: {
      ...current[agentId],
      configured,
    },
  };
  const hasProject = current.checks?.hasProject ?? Boolean(current.projects?.length);
  const hasReadyAgent = ["cursor", "codex"].some(
    (id) => next[id]?.configured === true && next[id]?.status === "ready"
  );
  return {
    ...next,
    setupComplete: hasProject && hasReadyAgent,
    checks: {
      ...(current.checks || {}),
      hasProject,
      hasReadyAgent,
    },
  };
}

export default function App() {
  const [backendUrl, setBackendUrl] = useState(api.getServerUrl());
  const [sidebarWidth, setSidebarWidth] = useState(api.getSidebarWidth());
  const [projects, setProjects] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [setupStatus, setSetupStatus] = useState(null);
  const [health, setHealth] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isDraft, setIsDraft] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [agent, setAgent] = useState(api.getDefaultAgent());
  const [defaultAgent, setDefaultAgentState] = useState(api.getDefaultAgent());
  const [agentConfigs, setAgentConfigs] = useState(DEFAULT_AGENT_CONFIGS);
  const [agentUsage, setAgentUsage] = useState({ cursor: null, codex: null });
  const [agentUsageLoading, setAgentUsageLoading] = useState({ cursor: false, codex: false });
  const [mode, setMode] = useState("ask");
  const [agentChanging, setAgentChanging] = useState(false);
  const [modeChanging, setModeChanging] = useState(false);
  const [running, setRunning] = useState(false);
  const [liveReply, setLiveReply] = useState(null);
  const [wsStatus, setWsStatus] = useState("connecting");
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsAnchor, setSettingsAnchor] = useState(null);
  const [agentWizard, setAgentWizard] = useState(null);
  const [projectWizardOpen, setProjectWizardOpen] = useState(false);
  const [backendWizardOpen, setBackendWizardOpen] = useState(false);
  const [systemMetrics, setSystemMetrics] = useState(null);
  const [systemMetricsVisible, setSystemMetricsVisible] = useState(api.getSystemMetricsVisible());
  const [theme, setThemeState] = useState(api.getTheme());
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const selectedSessionIdRef = useRef(null);
  const sessionRequestIdRef = useRef(0);
  const sessionSelectionRequestRef = useRef(0);
  const sessionDraftsRef = useRef(new Map());
  const pendingOutputRef = useRef(new Map());
  const outputFlushTimerRef = useRef(null);
  const chatEndRef = useRef(null);

  function handleOpenSettings(anchorRect) {
    setSettingsAnchor(isMobile ? null : anchorRect);
    setSettingsOpen((open) => !open);
  }

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth <= 768);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    function applyTheme() {
      const resolved = theme === "system"
        ? window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"
        : theme;
      root.dataset.theme = resolved;
      root.dataset.themePreference = theme;
    }

    applyTheme();
    if (theme !== "system") return undefined;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  const refresh = useCallback(async () => {
    try {
      const [healthRes, setupRes, projectsRes, sessionsRes, cursorConfigRes, codexConfigRes] = await Promise.all([
        api.getHealth(),
        api.getSetupStatus(),
        api.getProjects(),
        api.getSessions(),
        api.getAgentConfig("cursor"),
        api.getAgentConfig("codex"),
      ]);
      setHealth(healthRes);
      setSetupStatus(setupRes);
      setProjects(projectsRes.projects || []);
      setSessions((sessionsRes.sessions || []).map((session) => buildSessionPreview(session)));
      setAgentConfigs({
        cursor: cursorConfigRes.agent || DEFAULT_AGENT_CONFIGS.cursor,
        codex: codexConfigRes.agent || DEFAULT_AGENT_CONFIGS.codex,
      });

      if (projectsRes.projects?.length) {
        const hasSelectedProject =
          selectedProjectId && projectsRes.projects.some((project) => project.id === selectedProjectId);
        if (!hasSelectedProject) {
          setSelectedProjectId(projectsRes.projects[0].id);
        }
      } else if (selectedProjectId) {
        setSelectedProjectId("");
      }
    } catch (err) {
      setWsStatus("disconnected");
      setHealth(null);
      setSetupStatus(null);
      setProjects([]);
      setSessions([]);
      setError(formatRefreshError(err));
    }
  }, [selectedProjectId, backendUrl]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const refreshAgentUsage = useCallback(async (agentId = null) => {
    const targets = agentId ? [agentId] : ["cursor", "codex"];

    setAgentUsageLoading((current) => {
      const next = { ...current };
      targets.forEach((target) => {
        next[target] = true;
      });
      return next;
    });

    await Promise.all(
      targets.map(async (target) => {
        try {
          const { usage } = await api.getAgentUsage(target);
          setAgentUsage((current) => ({ ...current, [target]: usage || null }));
        } catch {
          setAgentUsage((current) => ({ ...current, [target]: null }));
        } finally {
          setAgentUsageLoading((current) => ({ ...current, [target]: false }));
        }
      })
    );
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    refreshAgentUsage();
  }, [settingsOpen, refreshAgentUsage]);

  useEffect(() => {
    if (!systemMetricsVisible || wsStatus !== "connected") return undefined;

    let cancelled = false;

    async function loadMetrics() {
      try {
        const nextMetrics = await api.getSystemMetrics();
        if (!cancelled) {
          setSystemMetrics(nextMetrics);
        }
      } catch {
        if (!cancelled) {
          setSystemMetrics(null);
        }
      }
    }

    loadMetrics();
    const timer = window.setInterval(loadMetrics, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [systemMetricsVisible, wsStatus, backendUrl]);

  function resetDraft(projectId) {
    const currentSessionId = selectedSessionIdRef.current;
    if (currentSessionId) {
      if (prompt.trim() || attachments.length > 0) {
        sessionDraftsRef.current.set(currentSessionId, { prompt, attachments });
      } else {
        sessionDraftsRef.current.delete(currentSessionId);
      }
    }
    flushPendingAgentOutput();
    sessionRequestIdRef.current += 1;
    sessionSelectionRequestRef.current += 1;
    const pid = projectId || selectedProjectId;
    if (pid) setSelectedProjectId(pid);
    selectedSessionIdRef.current = null;
    setSelectedSessionId(null);
    setActiveSession(null);
    setMessages([]);
    setPrompt("");
    setAttachments([]);
    setError("");
    setIsDraft(true);
    setRunning(false);
    setLiveReply(null);
    setAgent(api.getDefaultAgent());
    setMode("ask");
    setMobileMenuOpen(false);
  }

  function applyAgentOutputBatch(current, outputByMessageId) {
    if (outputByMessageId.size === 0) return current;

    return current.map((message) => {
      const output = outputByMessageId.get(message.id);
      if (!output) return message;

      return {
        ...message,
        content: `${message.content || ""}${output.content || ""}`,
        raw: `${message.raw || ""}${output.raw || ""}`,
      };
    });
  }

  function flushPendingAgentOutput() {
    if (outputFlushTimerRef.current) {
      window.clearTimeout(outputFlushTimerRef.current);
      outputFlushTimerRef.current = null;
    }

    const pending = pendingOutputRef.current;
    if (pending.size === 0) return;

    pendingOutputRef.current = new Map();
    setMessages((prev) => applyAgentOutputBatch(prev, pending));
  }

  function queueAgentOutput(payload) {
    const pending = pendingOutputRef.current;
    const current = pending.get(payload.messageId) || { content: "", raw: "" };

    if (payload.stream === "stderr") {
      current.raw += payload.text || "";
    } else {
      current.content += payload.text || "";
      current.raw += payload.text || "";
    }

    pending.set(payload.messageId, current);
    if (!outputFlushTimerRef.current) {
      outputFlushTimerRef.current = window.setTimeout(flushPendingAgentOutput, 50);
    }
  }

  function queueDuelOutput(payload) {
    const pending = pendingOutputRef.current;
    const current = pending.get(payload.messageId) || { content: "", raw: "" };
    current.raw += `[[agentbridge:duel-output]]${JSON.stringify({
      agentId: payload.agentId,
      stream: payload.stream,
      text: payload.text || "",
    })}\n`;
    pending.set(payload.messageId, current);
    if (!outputFlushTimerRef.current) {
      outputFlushTimerRef.current = window.setTimeout(flushPendingAgentOutput, 50);
    }
  }

  useEffect(() => {
    const ws = connectWebSocket((msg) => {
      if (msg.type === "connected") {
        setWsStatus("connected");
        return;
      }

      if (msg.session) {
        setSessions((prev) => {
          const existing = prev.find((session) => session.id === msg.session.id);
          const next = buildSessionPreview(existing ? { ...existing, ...msg.session } : msg.session);
          if (existing) {
            return prev.map((session) => (session.id === next.id ? next : session));
          }
          return [next, ...prev];
        });
        if (msg.session.id === selectedSessionIdRef.current) {
          setActiveSession(msg.session);
          setRunning(isSessionBusy(msg.session.status));
        }
      }

      if (msg.type === "message_added" && msg.payload?.message) {
        if (msg.sessionId === selectedSessionIdRef.current) {
          setMessages((prev) => mergeMessageList(prev, msg.payload.message));
        }
        if (msg.payload.message.role === "user") {
          setSessions((prev) =>
            prev.map((session) =>
              session.id === msg.sessionId
                ? buildSessionPreview({ ...session, updatedAt: new Date().toISOString() }, [msg.payload.message])
                : session
            )
          );
        }
      }

      if (msg.type === "message_updated" && msg.payload?.message) {
        if (msg.sessionId === selectedSessionIdRef.current) {
          setMessages((prev) => mergeMessageList(prev, msg.payload.message));
        }
      }

      if (msg.type === "agent_output" && msg.payload?.messageId && msg.sessionId === selectedSessionIdRef.current) {
        queueAgentOutput(msg.payload);
      }

      if (msg.type === "duel_output" && msg.payload?.messageId && msg.sessionId === selectedSessionIdRef.current) {
        queueDuelOutput(msg.payload);
      }

      if ((msg.type === "agent_error" || msg.type === "session_completed") && msg.payload?.message) {
        if (msg.sessionId === selectedSessionIdRef.current) {
          flushPendingAgentOutput();
          setMessages((prev) => mergeMessageList(prev, msg.payload.message));
          if (msg.payload.message.status !== "cancelled" && msg.session?.agentType !== "duel") {
            const finalText =
              extractDisplayContent(msg.payload.message.raw, msg.payload.message.content) ||
              msg.payload.message.error?.userMessage ||
              msg.payload.message.content ||
              "";
            if (finalText.trim()) {
              setLiveReply({
                id: `${msg.payload.message.id}:${msg.payload.message.status}`,
                text: finalText,
              });
            }
          }
        }
      }

      if (msg.type === "session_rewound" && msg.payload?.messages) {
        if (msg.sessionId === selectedSessionIdRef.current) {
          pendingOutputRef.current = new Map();
          if (outputFlushTimerRef.current) {
            window.clearTimeout(outputFlushTimerRef.current);
            outputFlushTimerRef.current = null;
          }
          setMessages(msg.payload.messages);
        }
      }

      if (msg.type === "session_failed" && msg.payload?.reason === "deleted") {
        setSessions((prev) => prev.filter((session) => session.id !== msg.sessionId));
        if (msg.sessionId === selectedSessionIdRef.current) {
          resetDraft(selectedProjectId);
        }
      }
    });

    ws.onopen = () => setWsStatus("connected");
    ws.onclose = () => setWsStatus("disconnected");
    return () => {
      if (outputFlushTimerRef.current) {
        window.clearTimeout(outputFlushTimerRef.current);
        outputFlushTimerRef.current = null;
      }
      pendingOutputRef.current = new Map();
      ws.close();
    };
  }, [backendUrl, selectedProjectId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, isDraft]);

  function handleResizeStart(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    function onMove(ev) {
      setSidebarWidth(Math.min(420, Math.max(200, startWidth + ev.clientX - startX)));
    }

    function onUp(ev) {
      const next = Math.min(420, Math.max(200, startWidth + ev.clientX - startX));
      api.setSidebarWidth(next);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function openBackendWizard() {
    setSettingsOpen(false);
    setBackendWizardOpen(true);
    setMobileMenuOpen(false);
  }

  function handleToggleSystemMetrics() {
    setSystemMetricsVisible((current) => {
      const next = !current;
      api.setSystemMetricsVisible(next);
      return next;
    });
  }

  function handleThemeChange(nextTheme) {
    const normalized = api.setTheme(nextTheme);
    setThemeState(normalized);
  }

  async function handleBackendConnected(_serverUrl, nextAction = null) {
    setBackendUrl(api.getServerUrl());
    await refresh();
    if (!nextAction) return;

    setBackendWizardOpen(false);
    if (nextAction === "project") {
      setProjectWizardOpen(true);
      return;
    }
    if (nextAction === "cursor" || nextAction === "codex") {
      setAgentWizard(nextAction);
    }
  }

  function openAgentWizard(nextAgent) {
    setSettingsOpen(false);
    setBackendWizardOpen(false);
    setMobileMenuOpen(false);
    setAgentWizard(nextAgent);
  }

  function handleSelectProject(projectId) {
    setSelectedProjectId(projectId);
    resetDraft(projectId);
  }

  async function handleSelectSession(sessionId) {
    const currentSessionId = selectedSessionIdRef.current;
    if (currentSessionId) {
      if (prompt.trim() || attachments.length > 0) {
        sessionDraftsRef.current.set(currentSessionId, { prompt, attachments });
      } else {
        sessionDraftsRef.current.delete(currentSessionId);
      }
    }
    flushPendingAgentOutput();
    sessionRequestIdRef.current += 1;
    const selectionRequestId = sessionSelectionRequestRef.current + 1;
    sessionSelectionRequestRef.current = selectionRequestId;
    selectedSessionIdRef.current = sessionId;
    setSelectedSessionId(sessionId);
    setIsDraft(false);
    setError("");
    setLiveReply(null);
    setMessages([]);

    const savedDraft = sessionDraftsRef.current.get(sessionId);
    setPrompt(savedDraft?.prompt || "");
    setAttachments(savedDraft?.attachments || []);

    const preview = sessions.find((session) => session.id === sessionId);
    if (preview) {
      setActiveSession(preview);
      setRunning(isSessionBusy(preview.status));
      setSelectedProjectId(preview.projectId || selectedProjectId);
      setAgent(preview.agentType || agent);
      setMode(preview.mode || "ask");
    }

    try {
      const { session } = await api.getSession(sessionId);
      if (
        selectionRequestId !== sessionSelectionRequestRef.current ||
        selectedSessionIdRef.current !== sessionId
      ) {
        return;
      }
      setActiveSession(session);
      setMessages(session.messages || []);
      setSelectedProjectId(session.projectId || selectedProjectId);
      setRunning(isSessionBusy(session.status));
      setAgent(session.agentType || agent);
      setMode(session.mode || "ask");
      setMobileMenuOpen(false);
    } catch (err) {
      if (
        selectionRequestId === sessionSelectionRequestRef.current &&
        selectedSessionIdRef.current === sessionId
      ) {
        setError(err.message);
      }
    }
  }

  async function handleDeleteSession(sessionId) {
    try {
      await api.deleteSession(sessionId);
      setSessions((prev) => prev.filter((session) => session.id !== sessionId));
      if (selectedSessionId === sessionId || activeSession?.id === sessionId) {
        resetDraft(selectedProjectId);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteProject(projectId) {
    try {
      await api.deleteProject(projectId);
      setProjects((prev) => {
        const remaining = prev.filter((project) => project.id !== projectId);
        if (selectedProjectId === projectId) {
          if (remaining.length) {
            setTimeout(() => handleSelectProject(remaining[0].id), 0);
          } else {
            setSelectedProjectId("");
            resetDraft("");
          }
        }
        return remaining;
      });
      setSessions((prev) => prev.filter((session) => session.projectId !== projectId));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSend() {
    if (!selectedProjectId) {
      setError("Select a project first.");
      return;
    }

    const runAgent = activeSession?.agentType || agent;
    const notReadyMessage = getAgentNotReadyMessage(runAgent, setupStatus);
    if (notReadyMessage) {
      setError(notReadyMessage);
      return;
    }

    const originalPrompt = prompt;
    const text = prompt.trim();
    const outgoingAttachments = attachments;
    const hadSession = Boolean(activeSession);
    const requestId = sessionRequestIdRef.current + 1;
    sessionRequestIdRef.current = requestId;

    setError("");
    setPrompt("");
    setAttachments([]);
    setRunning(true);
    setIsDraft(false);

    try {
      let session = activeSession;
      if (!session) {
        const created = await api.createSession({
          projectId: selectedProjectId,
          agentType: agent,
          mode,
        });
        session = created.session;
        setSessions((prev) => [buildSessionPreview(session), ...prev.filter((item) => item.id !== session.id)]);
        if (
          sessionRequestIdRef.current === requestId &&
          selectedSessionIdRef.current === null
        ) {
          selectedSessionIdRef.current = session.id;
          setSelectedSessionId(session.id);
          setActiveSession(session);
        }
      }

      await api.createSessionMessage(session.id, {
        content: text,
        attachments: outgoingAttachments,
      });
      sessionDraftsRef.current.delete(session.id);
    } catch (err) {
      if (sessionRequestIdRef.current === requestId) {
        setRunning(false);
        setPrompt(originalPrompt);
        setAttachments(outgoingAttachments);
        setError(err.message);
        if (!hadSession && !selectedSessionIdRef.current) {
          setIsDraft(true);
        }
      }
    }
  }

  async function handleLiveInterrupt() {
    if (!activeSession?.id) return;
    try {
      const { session } = await api.cancelSession(activeSession.id);
      setActiveSession(session);
      setRunning(false);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }

  async function handleLiveSubmit(liveText) {
    const trimmedText = String(liveText || "").trim();
    if (!trimmedText) return;
    if (!selectedProjectId) {
      const message = "Select a project first.";
      setError(message);
      throw new Error(message);
    }

    const runAgent = activeSession?.agentType || agent;
    const notReadyMessage = getAgentNotReadyMessage(runAgent, setupStatus);
    if (notReadyMessage) {
      setError(notReadyMessage);
      throw new Error(notReadyMessage);
    }

    if (running && activeSession?.id) {
      await handleLiveInterrupt();
    }

    const text = trimmedText;
    const hadSession = Boolean(activeSession);
    const requestId = sessionRequestIdRef.current + 1;
    sessionRequestIdRef.current = requestId;

    setError("");
    setPrompt("");
    setAttachments([]);
    setRunning(true);
    setIsDraft(false);
    setLiveReply(null);

    try {
      let session = activeSession;
      if (!session) {
        const created = await api.createSession({
          projectId: selectedProjectId,
          agentType: agent,
          mode,
        });
        session = created.session;
        selectedSessionIdRef.current = session.id;
        setSelectedSessionId(session.id);
        setActiveSession(session);
        setSessions((prev) => [buildSessionPreview(session), ...prev.filter((item) => item.id !== session.id)]);
      }

      await api.createSessionMessage(session.id, {
        content: text,
        attachments: [],
      });
    } catch (err) {
      if (sessionRequestIdRef.current === requestId) {
        setRunning(false);
        if (!hadSession && !selectedSessionIdRef.current) {
          setIsDraft(true);
        }
      }
      setError(err.message);
      throw err;
    }
  }

  async function handleReplayUserMessage(message, nextContent) {
    if (!activeSession?.id || running) return;

    const notReadyMessage = getAgentNotReadyMessage(activeSession.agentType || agent, setupStatus);
    if (notReadyMessage) {
      setError(notReadyMessage);
      return;
    }

    const requestId = sessionRequestIdRef.current + 1;
    sessionRequestIdRef.current = requestId;
    setError("");
    setPrompt("");
    setAttachments([]);
    setRunning(true);

    try {
      pendingOutputRef.current = new Map();
      const result = await api.replaySessionMessage(activeSession.id, message.id, {
        content: nextContent,
      });
      if (result.session) {
        setActiveSession(result.session);
      }
      if (result.messages) {
        setMessages(result.messages);
      }
    } catch (err) {
      if (sessionRequestIdRef.current === requestId) {
        setRunning(false);
      }
      setError(err.message);
    }
  }

  async function handleCancel() {
    if (!activeSession?.id) return;
    try {
      const { session } = await api.cancelSession(activeSession.id);
      setActiveSession(session);
      setRunning(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSelectDuelWinner(messageId, winner) {
    if (!activeSession?.id) return;
    try {
      const { session, message } = await api.selectDuelWinner(activeSession.id, messageId, winner);
      setActiveSession(session);
      setMessages((prev) => mergeMessageList(prev, message));
      setSessions((prev) => prev.map((item) =>
        item.id === session.id ? buildSessionPreview({ ...item, ...session }) : item
      ));
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleModeChange(nextMode) {
    setError("");
    setMode(nextMode);
    if (!activeSession) return;

    const previousMode = activeSession.mode || "ask";
    const optimisticSession = { ...activeSession, mode: nextMode };
    setActiveSession(optimisticSession);
    setSessions((prev) => prev.map((item) =>
      item.id === activeSession.id ? buildSessionPreview({ ...item, mode: nextMode }) : item
    ));
    setModeChanging(true);

    try {
      const { session } = await api.updateSessionMode(activeSession.id, nextMode);
      setActiveSession(session);
      setSessions((prev) => prev.map((item) =>
        item.id === session.id ? buildSessionPreview({ ...item, ...session }) : item
      ));
    } catch (err) {
      setMode(previousMode);
      setActiveSession((current) => current?.id === activeSession.id
        ? { ...current, mode: previousMode }
        : current);
      setSessions((prev) => prev.map((item) =>
        item.id === activeSession.id ? buildSessionPreview({ ...item, mode: previousMode }) : item
      ));
      setError(err.message);
    } finally {
      setModeChanging(false);
    }
  }

  async function handleAgentChange(nextAgent) {
    setError("");
    if (!activeSession) {
      setAgent(nextAgent);
      if (nextAgent === "duel") setMode("plan");
      return;
    }

    const previousAgent = activeSession.agentType || agent;
    if (nextAgent === previousAgent) return;

    setAgent(nextAgent);
    setAgentChanging(true);
    const optimisticSession = {
      ...activeSession,
      agentType: nextAgent,
      nativeSessionId: null,
      sessionMode: nextAgent === "codex" ? "native-resume" : "context-replay",
    };
    setActiveSession(optimisticSession);
    setSessions((prev) => prev.map((item) =>
      item.id === activeSession.id
        ? buildSessionPreview({ ...item, ...optimisticSession })
        : item
    ));

    try {
      const { session } = await api.updateSessionAgent(activeSession.id, nextAgent);
      setAgent(session.agentType);
      setActiveSession(session);
      setSessions((prev) => prev.map((item) =>
        item.id === session.id ? buildSessionPreview({ ...item, ...session }) : item
      ));
    } catch (err) {
      setAgent(previousAgent);
      setActiveSession((current) => current?.id === activeSession.id
        ? { ...current, agentType: previousAgent }
        : current);
      setSessions((prev) => prev.map((item) =>
        item.id === activeSession.id
          ? buildSessionPreview({ ...item, agentType: previousAgent })
          : item
      ));
      setError(err.message);
    } finally {
      setAgentChanging(false);
    }
  }

  async function handleAgentDuelEnabledChange(enabled) {
    await api.updateAgentDuelSettings(enabled);
    const nextSetupStatus = await api.refreshSetupStatus();
    setSetupStatus(nextSetupStatus);
    if (!enabled && isDraft && agent === "duel") {
      setAgent(defaultAgent);
      setMode("ask");
    }
  }

  async function handleSaveAgentConfig(agentId, settings) {
    const { agent: updatedAgent } = await api.updateAgentConfig(agentId, settings);
    setAgentConfigs((current) => ({ ...current, [agentId]: updatedAgent }));
    setSetupStatus((current) => updateSetupAgentConfigured(
      current,
      agentId,
      updatedAgent.settings?.configured === true
    ));
    await refresh();
    return updatedAgent;
  }

  async function handleDeleteAgentConfig(agentId) {
    const { agent: resetAgent } = await api.deleteAgentConfig(agentId);
    setAgentConfigs((current) => ({ ...current, [agentId]: resetAgent }));
    setSetupStatus((current) => updateSetupAgentConfigured(current, agentId, false));
    await refresh();
    if (isDraft && agent === "duel") {
      setAgent(defaultAgent);
      setMode("ask");
    }
    return resetAgent;
  }

  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const currentSession = activeSession || null;

  const mobileHeaderTitle = selectedProject?.name || "AgentBridge";
  const currentAgentType = currentSession?.agentType || agent;
  const mobileHeaderSubtitle = `${getAgentLabel(currentAgentType)} / ${health?.hostname || "desktop"} / ${currentSession?.mode || mode}`;
  const connectionLabel = wsStatus === "connected"
    ? "Connected"
    : setupStatus?.setupComplete
      ? "Disconnected"
      : "Needs Setup";

  return (
    <div className="shell">
      <Sidebar
        width={sidebarWidth}
        onResizeStart={handleResizeStart}
        projects={projects}
        sessions={sessions}
        selectedProjectId={selectedProjectId}
        selectedSessionId={selectedSessionId}
        isDraft={isDraft}
        onSelectProject={handleSelectProject}
        onSelectSession={handleSelectSession}
        onNewSession={resetDraft}
        onDeleteProject={handleDeleteProject}
        onDeleteSession={handleDeleteSession}
        onRefresh={refresh}
        onOpenSettings={handleOpenSettings}
        onAddProject={() => {
          if (wsStatus !== "connected") {
            setBackendWizardOpen(true);
            return;
          }
          setProjectWizardOpen(true);
        }}
        onOpenBackendSetup={openBackendWizard}
        connectionStatus={wsStatus}
        setupStatus={setupStatus}
        serverUrl={backendUrl}
        health={health}
        isMobile={isMobile}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        systemMetrics={systemMetrics}
        systemMetricsVisible={systemMetricsVisible}
        onToggleSystemMetrics={handleToggleSystemMetrics}
      />

      <main className="main-panel">
        {!isMobile && (
          <div className="system-metrics-dock">
            <SystemMetricsPanel
              metrics={systemMetrics}
              visible={systemMetricsVisible}
              onToggle={handleToggleSystemMetrics}
            />
          </div>
        )}
        <div className="main-centered">
          <header className={`chat-header ${isMobile ? "mobile" : ""}`}>
            {isMobile && (
              <button
                type="button"
                className="mobile-menu-btn"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open navigation drawer"
              >
                <span />
                <span />
                <span />
              </button>
            )}

            <div className="chat-header-left">
              <h2>{isMobile ? mobileHeaderTitle : selectedProject?.name || "Select a project"}</h2>
              <p>
                {isMobile
                  ? mobileHeaderSubtitle
                  : `${getAgentLabel(currentAgentType, true)} / ${health?.hostname || "desktop"} / ${currentSession?.sessionMode === "live-process" ? "Live" : currentSession?.sessionMode === "native-resume" ? "Native Resume" : currentSession?.sessionMode === "context-replay" ? "Context Replay" : "Task"} / ${currentSession?.status || "draft"}`}
              </p>
            </div>

            <div className="chat-header-actions">
              {isMobile && (
                <button
                  type="button"
                  className={`mobile-connection-indicator ${wsStatus}`}
                  onClick={openBackendWizard}
                  title={connectionLabel}
                >
                  <span className="mobile-status-dot" />
                  <span>{connectionLabel}</span>
                </button>
              )}
            </div>
          </header>

          {error && <div className="alert error banner">{error}</div>}

          <div className={`chat-feed ${isMobile ? "mobile" : ""}`}>
            {isDraft && (
              <div className="empty-chat">
                <div className="empty-icon">*</div>
                <h3>New chat</h3>
                <p>
                  Send a prompt to run {getAgentLabel(agent)} on{" "}
                  <strong>{selectedProject?.name || "your project"}</strong> at{" "}
                  {health?.hostname || "the desktop"}.
                </p>
              </div>
            )}

            {!isDraft && (
              <div className="chat-thread">
                {messages.map((message) => (
                  <div className="chat-turn" key={message.id}>
                    {currentSession?.agentType === "duel" && message.role === "agent" ? (
                      <AgentDuelMessage
                        message={message}
                        session={currentSession}
                        onSelectWinner={handleSelectDuelWinner}
                      />
                    ) : (
                      <ChatMessage
                        message={message}
                        session={currentSession}
                        running={running}
                        onReplayUserMessage={handleReplayUserMessage}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          <div className={isMobile ? "mobile-composer-shell" : ""}>
            <ChatComposer
              prompt={prompt}
              attachments={attachments}
              agent={currentSession?.agentType || agent}
              mode={currentSession?.mode || mode}
              running={running}
              agentChanging={agentChanging}
              modeChanging={modeChanging}
              duelEnabled={setupStatus?.duel?.enabled === true}
              onPromptChange={setPrompt}
              onAttachmentsChange={setAttachments}
              onAgentChange={handleAgentChange}
              onModeChange={handleModeChange}
              onSend={handleSend}
              onCancel={handleCancel}
              onLiveSubmit={handleLiveSubmit}
              onLiveInterrupt={handleLiveInterrupt}
              liveReply={liveReply}
            />
          </div>
        </div>
      </main>

      {settingsOpen && (
        <SettingsMenu
          anchorRect={settingsAnchor}
          setupStatus={setupStatus}
          defaultAgent={defaultAgent}
          codexModel={agentConfigs.codex?.settings?.model || DEFAULT_CODEX_MODEL}
          agentUsage={agentUsage}
          agentUsageLoading={agentUsageLoading}
          agentDuelEnabled={setupStatus?.duel?.enabled === true}
          canEnableAgentDuel={setupStatus?.duel?.canEnable === true}
          theme={theme}
          onRefreshUsage={refreshAgentUsage}
          onConfigureBackend={openBackendWizard}
          onThemeChange={handleThemeChange}
          onDefaultAgentChange={(nextAgent) => {
            api.setDefaultAgent(nextAgent);
            setDefaultAgentState(nextAgent);
            if (isDraft) setAgent(nextAgent);
          }}
          onConfigureAgent={(nextAgent) => {
            setSettingsOpen(false);
            openAgentWizard(nextAgent);
          }}
          onDeleteAgentConfig={handleDeleteAgentConfig}
          onAgentDuelEnabledChange={handleAgentDuelEnabledChange}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {backendWizardOpen && (
        <BackendSetupWizard
          initialUrl={backendUrl}
          onConnected={handleBackendConnected}
          onClose={() => setBackendWizardOpen(false)}
        />
      )}

      {projectWizardOpen && (
        <ProjectSetupWizard
          agent={agent}
          setupStatus={setupStatus}
          onRefresh={refresh}
          onComplete={(project) => {
            setProjectWizardOpen(false);
            setSelectedProjectId(project.id);
            refresh();
          }}
          onClose={() => setProjectWizardOpen(false)}
        />
      )}

      {agentWizard && (
        <AgentSetupWizard
          agent={agentWizard}
          setupStatus={setupStatus}
          agentConfig={agentConfigs[agentWizard] || DEFAULT_AGENT_CONFIGS[agentWizard]}
          onRefresh={refresh}
          onSaveAgentConfig={handleSaveAgentConfig}
          onClose={() => setAgentWizard(null)}
        />
      )}
    </div>
  );
}
