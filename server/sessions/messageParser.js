function stripAnsi(text) {
  return String(text || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function normalizeChunk(text) {
  return stripAnsi(text).replace(/\r\n/g, "\n");
}

function classifyAgentError(agentType, stdout, stderr) {
  const combined = `${stdout || ""}\n${stderr || ""}`.toLowerCase();

  if (
    combined.includes("authentication required") ||
    combined.includes("please run 'agent login'") ||
    combined.includes("cursor_api_key")
  ) {
    return {
      type: "auth_required",
      agentType,
      userMessage:
        "Cursor Agent is not authenticated on the desktop. Run `agent login` on the desktop, or set CURSOR_API_KEY there.",
      technicalMessage: combined.trim(),
      fixSteps: [
        "Run `agent login` on the desktop machine.",
        "Or set the CURSOR_API_KEY environment variable and restart AgentBridge.",
      ],
    };
  }

  if (combined.includes("you've hit your usage limit")) {
    return {
      type: "usage_limit",
      agentType,
      userMessage:
        "Codex usage limit reached. Try again later or switch to Cursor Agent.",
      technicalMessage: combined.trim(),
      fixSteps: [
        "Wait for the Codex quota window to reset.",
        "Switch the session to Cursor Agent if work must continue now.",
      ],
    };
  }

  if (
    combined.includes("workspace trust required") ||
    combined.includes("do you trust the contents of this directory")
  ) {
    return {
      type: "workspace_trust",
      agentType,
      userMessage:
        "Cursor Agent blocked this folder because workspace trust was not granted for a non-interactive run.",
      technicalMessage: combined.trim(),
      fixSteps: [
        "Restart AgentBridge so it picks up the latest Cursor adapter (uses --trust, plus --force for Execute).",
        "Or verify Ask on the desktop PC: agent --print --trust --mode ask --workspace \"<project-path>\" \"ok\"",
        "Apply the fix on the desktop machine, not in the browser.",
      ],
    };
  }

  if (
    combined.includes("read-only") ||
    combined.includes("sandbox") ||
    combined.includes("permission denied")
  ) {
    return {
      type: "permission_error",
      agentType,
      userMessage: "The agent does not have permission to complete that action.",
      technicalMessage: combined.trim(),
      fixSteps: [
        "Verify the selected project path is writable on the desktop.",
        "Retry in Ask or Plan mode if write access is not required.",
      ],
    };
  }

  if (
    combined.includes("project path does not exist") ||
    combined.includes("path does not exist")
  ) {
    return {
      type: "project_error",
      agentType,
      userMessage: "The selected project path is no longer available on the desktop.",
      technicalMessage: combined.trim(),
      fixSteps: [
        "Revalidate the project path in AgentBridge.",
        "Select another configured project if the folder moved.",
      ],
    };
  }

  if (
    combined.includes("'agent' is not recognized") ||
    combined.includes("'codex' is not recognized") ||
    combined.includes("not found")
  ) {
    return {
      type: "tool_missing",
      agentType,
      userMessage:
        agentType === "cursor"
          ? "Cursor Agent CLI is not installed or not on PATH."
          : "Codex CLI is not installed or not on PATH.",
      technicalMessage: combined.trim(),
      fixSteps: [
        "Install the CLI on the desktop machine.",
        "Ensure the executable is available on PATH before restarting AgentBridge.",
      ],
    };
  }

  return {
    type: "unknown",
    agentType,
    userMessage: "The agent failed unexpectedly. Open raw logs for technical details.",
    technicalMessage: combined.trim(),
    fixSteps: [],
  };
}

function buildSessionReplayPrompt(session, messages, nextUserContent) {
  const summary = session.summary || "No summary yet.";
  const recentMessages = messages.slice(-8).map((message) => {
    const role = message.role === "agent" ? "Agent" : "User";
    return `${role}: ${formatMessageContent(message.content)}`;
  });

  return [
    "You are continuing an AgentBridge session.",
    "",
    "Project:",
    `${session.projectName || session.projectId} (${session.projectPath})`,
    "",
    "Agent:",
    session.agentType,
    "",
    "Previous conversation summary (background only):",
    summary,
    "",
    "Recent messages (background only):",
    recentMessages.length > 0 ? recentMessages.join("\n") : "No prior messages.",
    "",
    "Current user request:",
    nextUserContent,
    "",
    "Rules:",
    "- Respect the project context.",
    "- Treat the current user request as authoritative and act only on that request.",
    "- Do not resume or execute unfinished work from the summary or recent messages unless the current user request explicitly asks you to continue it.",
    "- A greeting, acknowledgement, or mode change is not authorization to resume previous work.",
    "- If the current user request refers to previous instructions, use the recent messages only as supporting context.",
    "- Do not pretend to remember things not present in the provided context.",
  ].join("\n");
}

function formatMessageContent(content) {
  const text = String(content || "").trim();
  const prefix = "[[agentbridge:duel-result]]";
  if (!text.startsWith(prefix)) return text;

  try {
    const results = JSON.parse(text.slice(prefix.length));
    return ["cursor", "codex"]
      .map((agentId) => {
        const result = results?.[agentId] || {};
        const answer = String(result.content || result.error || "No response.").trim();
        return `${agentId === "codex" ? "Codex" : "Cursor"} (${result.status || "unknown"}): ${answer}`;
      })
      .join("\n");
  } catch {
    return "Agent Duel result could not be parsed.";
  }
}

function updateSessionSummary(previousSummary, recentAgentMessages) {
  const recentAgent = recentAgentMessages
    .filter((message) => message.content)
    .slice(-2)
    .map((message) => formatMessageContent(message.content).replace(/\s+/g, " "))
    .join(" ");

  if (!recentAgent) return previousSummary || "";
  const compact = recentAgent.slice(0, 400);
  if (!previousSummary) return compact;
  if (previousSummary.includes(compact)) return previousSummary;
  return `${previousSummary}\n${compact}`.slice(-1000);
}

module.exports = {
  normalizeChunk,
  classifyAgentError,
  buildSessionReplayPrompt,
  updateSessionSummary,
};
