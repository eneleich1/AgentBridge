import { useEffect, useRef, useState } from "react";

function compactText(text, max = 160) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

const META_LINE_PATTERN = /^(openai codex|workdir:|model:|provider:|approval:|sandbox:|reasoning effort:|reasoning summaries:|session id:|--------)$/i;
const RESULT_LINE_PATTERN = /^(succeeded in |failed in )/i;
const INTERNAL_PROMPT_START_PATTERN = /^(you are continuing an agentbridge session\.|project:|agent:|previous conversation summary:|recent messages:|current user request:|rules:)$/i;
const TECHNICAL_LINE_PATTERN = /^(fatal:|error:|warning:|exit code:|wall time:|output:|mode\s+lastwritetime\s+length\s+name|using |namespace |internal |public |private |static |return |var |const |let |function |class |if |for |foreach |while |try|catch|switch|case|break|<\/?|<\?xml|# |```|---|\+\+\+)/i;
const PROGRESS_MARKER_PATTERN = /^\[\[agentbridge:progress\]\]\s*([^|]+)\|(.*)$/;

function looksLikeCommandLine(line) {
  return /^(npx|npm|node|git|rg|grep|find|ls|dir|cat|sed|awk|python|pwsh|powershell|Get-|Set-|New-|Remove-|Copy-|Move-|Start-|Stop-)/i.test(line);
}

function looksLikeFilePath(line) {
  const text = String(line || "").trim();
  return /^[\w .-]+[\\/][\w .\\/()-]+$/.test(text);
}

function looksLikeProgressLine(line) {
  const text = String(line || "").trim();
  if (!text || text.length > 280) return false;
  return /^(voy|estoy|ahora|primero|luego|ya ubiqu|ya encontr|ya tengo|revisar|verificar|leer|comprobar|actualizar|implementar|validar|i'?m|i am|now|first|next|checking|reviewing|reading|updating|verifying|looking)\b/i.test(text);
}

function shouldHideTechnicalLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return false;
  if (PROGRESS_MARKER_PATTERN.test(trimmed)) return true;
  if (/^\{".*"\}$/.test(trimmed)) return true;
  if (/^\{"type":"(thread|turn|item)\./.test(trimmed)) return true;
  if (META_LINE_PATTERN.test(trimmed) || RESULT_LINE_PATTERN.test(trimmed)) return true;
  if (TECHNICAL_LINE_PATTERN.test(trimmed)) return true;
  if (looksLikeCommandLine(trimmed) || looksLikeFilePath(trimmed)) return true;
  if (/^[{}[\]();,]+$/.test(trimmed)) return true;
  if (/^[-*]\s+`?[\w./\\-]+`?:/.test(trimmed)) return true;
  return false;
}

function extractAgentTextFromJsonLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.startsWith("{")) return "";

  try {
    const event = JSON.parse(trimmed);
    if (event?.type === "item.completed" && event.item?.type === "agent_message") {
      return String(event.item.text || "").replace(/\\n/g, "\n").trim();
    }
    if (event?.type === "agent_message") {
      return String(event.text || event.message || "").replace(/\\n/g, "\n").trim();
    }
  } catch {
    return "";
  }

  return "";
}

function describeCommand(command) {
  const text = String(command || "").trim();
  const lower = text.toLowerCase();

  if (/^(rg|grep|find|ls|dir|get-childitem)\b/.test(lower)) {
    return {
      label: "Reviewing project",
      text: "Looking through the project structure and finding the relevant files.",
    };
  }

  if (/^(cat|sed|awk|get-content)\b/.test(lower)) {
    return {
      label: "Reading code",
      text: "Checking the component and nearby code paths before changing behavior.",
    };
  }

  if (/\b(apply_patch|git apply|copy-item|move-item|new-item|set-content)\b/.test(lower)) {
    return {
      label: "Applying fix",
      text: "Updating the implementation in the affected files.",
    };
  }

  if (/\b(npm|pnpm|yarn|node|npx|vitest|jest|playwright|eslint|tsc)\b/.test(lower)) {
    return {
      label: "Verifying",
      text: "Running the project checks needed to validate the change.",
    };
  }

  if (/^git\s+(status|diff|show)\b/.test(lower)) {
    return {
      label: "Checking changes",
      text: "Reviewing the workspace changes and current state.",
    };
  }

  return {
    label: "Working",
    text: "Handling the next implementation step.",
  };
}

function uniqueSteps(steps) {
  return steps.filter((step, index, array) => {
    return index === array.findIndex((item) => item.label === step.label && item.text === step.text);
  });
}

function extractActivitySteps(rawText, responseText) {
  const cleanRaw = String(rawText || "").replace(/\r/g, "");
  if (!cleanRaw.trim()) return [];

  const response = String(responseText || "").trim();
  const lines = cleanRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const steps = [];
  let skippingInternalPrompt = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] || "";
    const progressMatch = line.match(PROGRESS_MARKER_PATTERN);

    if (progressMatch) {
      steps.push({
        label: progressMatch[1].trim(),
        text: compactText(progressMatch[2].trim()),
      });
      continue;
    }

    if (/^user$/i.test(line) && INTERNAL_PROMPT_START_PATTERN.test(next)) {
      skippingInternalPrompt = true;
      index += 1;
      continue;
    }

    if (skippingInternalPrompt) {
      if (looksLikeProgressLine(line)) {
        skippingInternalPrompt = false;
      } else {
        continue;
      }
    }

    if (META_LINE_PATTERN.test(line)) {
      continue;
    }

    if (/^exec$/i.test(line) && next) {
      steps.push(describeCommand(next.replace(/^"+|"+$/g, "")));
      continue;
    }

    if (/^codex$/i.test(line) && next && next !== response && !INTERNAL_PROMPT_START_PATTERN.test(next)) {
      steps.push({
        label: "Planning",
        text: compactText(next),
      });
      continue;
    }

    if (looksLikeProgressLine(line)) {
      steps.push({
        label: "Working",
        text: compactText(line),
      });
      continue;
    }

    if (/^\[stderr\]/i.test(line)) {
      steps.push({
        label: "Checking issue",
        text: compactText(line.replace(/^\[stderr\]\s*/i, "")),
      });
    }
  }

  return uniqueSteps(steps);
}

function buildFallbackSteps(isRunning) {
  if (!isRunning) return [];

  return [
    { label: "Recibido", text: "Ya recibí tu solicitud." },
    { label: "Trabajando", text: "Estoy esperando los primeros eventos del agente." },
    { label: "En curso", text: "La tarea sigue ejecutándose." },
  ];
}

export function extractDisplayContent(rawText, responseText) {
  const source = String(responseText || rawText || "").replace(/\r/g, "");
  const lines = source.split("\n");
  const visible = [];
  let skippingInternalPrompt = false;
  let skippedTechnicalBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const next = (lines[index + 1] || "").trim();

    if (!trimmed) {
      if (visible.length && visible[visible.length - 1] !== "") visible.push("");
      continue;
    }

    if (/^user$/i.test(trimmed) && INTERNAL_PROMPT_START_PATTERN.test(next)) {
      skippingInternalPrompt = true;
      index += 1;
      continue;
    }

    if (skippingInternalPrompt) {
      if (looksLikeProgressLine(trimmed)) {
        skippingInternalPrompt = false;
      } else {
        continue;
      }
    }

    const jsonAgentText = extractAgentTextFromJsonLine(trimmed);
    if (jsonAgentText) {
      visible.push(jsonAgentText);
      skippedTechnicalBlock = false;
      continue;
    }

    if (shouldHideTechnicalLine(trimmed)) {
      skippedTechnicalBlock = true;
      continue;
    }

    if (/^exec$/i.test(trimmed)) {
      if (next) index += 1;
      skippedTechnicalBlock = true;
      continue;
    }

    if (/^\[stderr\]/i.test(trimmed)) {
      skippedTechnicalBlock = true;
      continue;
    }
    if (/^codex$/i.test(trimmed)) {
      skippedTechnicalBlock = true;
      continue;
    }

    visible.push(line);
    skippedTechnicalBlock = false;
  }

  return visible.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function ThinkingPanel({ steps, openByDefault = false, isRunning = false }) {
  if (!steps.length) return null;

  const visibleSteps = isRunning ? steps.slice(-4) : steps.slice(-6);

  return (
    <details className={`thinking-panel ${openByDefault ? "open" : ""}`} open={openByDefault}>
      <summary>{isRunning ? "Trabajando" : "Actividad"}</summary>
      <div className="thinking-steps">
        {visibleSteps.map((step, index) => (
          <div className="thinking-step" key={`${step.label}-${index}`}>
            <span className="thinking-step-label">{step.label}</span>
            <span className="thinking-step-text">{step.text}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

export default function ChatMessage({ message, session, running = false, onReplayUserMessage }) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(message?.content || "");
  const editTextareaRef = useRef(null);

  useEffect(() => {
    if (!editing) {
      setDraftText(message?.content || "");
      return;
    }
    window.setTimeout(() => {
      editTextareaRef.current?.focus();
      editTextareaRef.current?.select();
    }, 0);
  }, [editing, message?.content]);

  if (message?.role === "user") {
    const canReplay = Boolean(onReplayUserMessage) && !running;
    const canSubmitEdit = draftText.trim() && draftText.trim() !== String(message?.content || "").trim();

    async function handleSubmitEdit() {
      if (!canSubmitEdit) return;
      await onReplayUserMessage(message, draftText.trim());
      setEditing(false);
    }

    return (
      <div className="chat-message user">
        <div className={`user-message-shell ${editing ? "editing" : ""}`}>
          {editing ? (
            <div className="user-edit-panel">
              <textarea
                ref={editTextareaRef}
                value={draftText}
                rows={3}
                onChange={(event) => setDraftText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    handleSubmitEdit();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setEditing(false);
                    setDraftText(message?.content || "");
                  }
                }}
              />
              <div className="user-edit-actions">
                <button
                  type="button"
                  className="user-edit-secondary"
                  onClick={() => {
                    setEditing(false);
                    setDraftText(message?.content || "");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="user-edit-primary"
                  disabled={!canSubmitEdit}
                  onClick={handleSubmitEdit}
                >
                  Send
                </button>
              </div>
            </div>
          ) : (
            <div className="msg-body user-bubble">
              {message?.attachments?.length > 0 && (
                <div className="message-attachments">
                  {message.attachments.map((attachment) => (
                    <img key={attachment.path || attachment.name} src={attachment.dataUrl} alt={attachment.name} />
                  ))}
                </div>
              )}
              {message?.content}
            </div>
          )}
          {!editing && (
            <button
              type="button"
              className="user-replay-btn"
              onClick={() => setEditing(true)}
              disabled={!canReplay}
              title={canReplay ? "Edit and resend from here" : "Wait until the current run finishes"}
              aria-label="Edit and resend from here"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="m13.5 6.5 4 4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }

  const isRunning = message?.status === "running" || message?.status === "queued";
  const responseText = message?.content || "";
  const rawText = message?.raw || "";
  const hasError = message?.status === "failed" || message?.error;
  const displayContent = extractDisplayContent(rawText, responseText);
  const showRawLogs = rawText && rawText.trim() !== displayContent.trim();
  const activitySteps = extractActivitySteps(rawText, responseText);
  const visibleSteps = activitySteps.length ? activitySteps : buildFallbackSteps(isRunning);

  return (
    <div className="chat-message agent">
      <div className="msg-label">
        <span className="agent-avatar">{session?.agentType === "codex" ? "Cx" : "Cu"}</span>
        {session?.agentType === "codex" ? "Codex" : "Cursor"} Agent
        {message?.status && <span className={`status-chip ${message.status}`}>{message.status}</span>}
      </div>

      {hasError && message?.error?.userMessage && (
        <div className="guidance-box error">
          <strong>{message.error.type?.replace(/_/g, " ") || "Task failed"}</strong>
          <p>{message.error.userMessage}</p>
          <small>Apply this fix on the desktop machine, not in the browser.</small>
        </div>
      )}

      {isRunning && !responseText && (
        <div className="working-indicator">
          <span className="spinner" />
          <span>
            {message?.status === "queued"
              ? "En cola. Comenzará automáticamente cuando haya capacidad."
              : "Trabajando..."}
          </span>
        </div>
      )}

      <ThinkingPanel steps={visibleSteps} openByDefault={isRunning} isRunning={isRunning} />

      {displayContent && <div className="msg-body agent-bubble">{displayContent}</div>}

      {showRawLogs && (
        <details className="log-details">
          <summary>Technical logs</summary>
          <div className="log-text">{rawText}</div>
        </details>
      )}
    </div>
  );
}
