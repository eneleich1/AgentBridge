const fs = require("fs");
const path = require("path");
const { runProcess } = require("./runProcess");
const { refreshProcessPath, resolveCodexCommand } = require("./cliPath");

function appendImageArgs(args, attachments) {
  for (const attachment of attachments || []) {
    if (attachment?.path) {
      args.push("--image", attachment.path);
    }
  }
  return args;
}

function readDeepValue(value, keys) {
  if (!value || typeof value !== "object") return null;
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key].trim()) {
      return value[key].trim();
    }
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = readDeepValue(child, keys);
      if (found) return found;
    }
  }

  return null;
}

function extractSessionId(event) {
  const explicit = readDeepValue(event, [
    "session_id",
    "sessionId",
    "conversation_id",
    "conversationId",
    "thread_id",
    "threadId",
  ]);
  if (explicit) return explicit;

  const type = String(event?.type || event?.event || "");
  if (type.includes("session") && typeof event.id === "string") {
    return event.id.trim();
  }

  return null;
}

function textFromContentBlocks(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((block) => {
      if (typeof block === "string") return block;
      if (!block || typeof block !== "object") return "";
      if (block.type && !String(block.type).includes("text")) return "";
      return block.text || block.content || "";
    })
    .filter(Boolean)
    .join("");
}

function looksLikeTechnicalFallbackLine(line) {
  const text = String(line || "").trim();
  if (!text) return true;

  if (/^(openai codex|workdir:|model:|provider:|approval:|sandbox:|reasoning effort:|reasoning summaries:|session id:|user|assistant|--------)$/i.test(text)) {
    return true;
  }

  if (/^(fatal:|error:|warning:|exit code:|wall time:|output:|mode\s+lastwritetime\s+length\s+name)$/i.test(text)) {
    return true;
  }

  if (/^(exec|codex)$/i.test(text)) return true;
  if (/^(npx|npm|node|git|rg|grep|find|ls|dir|cat|sed|awk|python|pwsh|powershell|get-|set-|new-|remove-|copy-|move-|start-|stop-)/i.test(text)) {
    return true;
  }

  if (/^[\w .-]+\\[\w .\\/-]+$/.test(text)) return true;
  if (/^[\w .-]+\/[\w ./-]+$/.test(text)) return true;
  if (/^<\??[\w:.-]+[\s>]/.test(text)) return true;
  if (/^(using|namespace|internal|public|private|static|return|var|const|let|function|class|if|for|foreach|while|try|catch|switch|case|break|using\s+var)\b/.test(text)) {
    return true;
  }
  if (/^[{}[\]();,]+$/.test(text)) return true;
  if (/^[-*]\s+`?[\w./\\-]+`?:/.test(text)) return true;

  return false;
}

function looksLikeProgressFallbackLine(line) {
  const text = String(line || "").trim();
  if (!text || looksLikeTechnicalFallbackLine(text)) return false;
  if (text.length > 280) return false;
  if (/^(voy|estoy|ahora|primero|luego|ya ubiqu|ya encontr|revisar|verificar|leer|comprobar|actualizar|implementar|validar)\b/i.test(text)) {
    return true;
  }
  if (/^(i'?m|i am|now|first|next|checking|reviewing|reading|updating|verifying|looking)\b/i.test(text)) {
    return true;
  }
  return false;
}

function extractVisibleText(event) {
  if (!event || typeof event !== "object") return "";

  const type = String(event.type || event.event || "");
  if (type === "item.completed" && event.item?.type === "agent_message") {
    return event.item.text || textFromContentBlocks(event.item.content);
  }
  if (type === "agent_message_delta" || type === "response.output_text.delta") {
    return event.delta || event.text || "";
  }
  if (type === "agent_message" || type === "response.output_text.done") {
    return event.message || event.text || event.content || "";
  }

  const item = event.item || event.payload || event.message;
  if (item && typeof item === "object") {
    if (item.payload && typeof item.payload === "object") {
      return extractVisibleText(item.payload);
    }

    const itemType = String(item.type || "");
    const role = String(item.role || "");
    if ((itemType === "message" || itemType === "assistant_message" || itemType === "agent_message") && role !== "user") {
      return textFromContentBlocks(item.content) || item.text || item.message || "";
    }
  }

  return "";
}

function isDeltaTextEvent(event) {
  const type = String(event?.type || event?.event || "");
  return type.includes("delta") && type !== "item.completed";
}

function isCompleteMessageEvent(event) {
  const type = String(event?.type || event?.event || "");
  if (type === "agent_message" || type.includes("done") || type.includes("completed")) {
    return true;
  }

  const item = event?.item || event?.payload || event?.message;
  if (!item || typeof item !== "object") return false;
  if (item.payload && typeof item.payload === "object") {
    return isCompleteMessageEvent(item.payload);
  }

  const itemType = String(item.type || "");
  return itemType === "message" || itemType === "assistant_message" || itemType === "agent_message";
}

function compactProgressText(text, max = 180) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
}

function describeCodexEvent(event) {
  const type = String(event?.type || event?.event || "");
  const item = event?.item || {};
  const itemType = String(item?.type || "");

  if (type === "thread.started") {
    return {
      label: "Preparando",
      text: "Estoy preparando la sesión de trabajo.",
    };
  }

  if (type === "turn.started") {
    return {
      label: "Trabajando",
      text: "Estoy procesando tu solicitud.",
    };
  }

  if (type === "item.started") {
    if (/command|exec|shell|terminal/i.test(itemType)) {
      return {
        label: "Verificando",
        text: "Estoy ejecutando una comprobación en el proyecto.",
      };
    }
    if (/file|read|search/i.test(itemType)) {
      return {
        label: "Revisando",
        text: "Estoy leyendo los archivos necesarios.",
      };
    }
    return {
      label: "Avanzando",
      text: "Estoy realizando el siguiente paso.",
    };
  }

  if (type === "item.completed" && itemType && itemType !== "agent_message") {
    if (/command|exec|shell|terminal/i.test(itemType)) {
      return {
        label: "Comprobado",
        text: "Terminé una comprobación y sigo con el análisis.",
      };
    }
    return null;
  }

  if (type === "turn.completed") {
    return {
      label: "Terminando",
      text: "Estoy cerrando la respuesta.",
    };
  }

  const progress = event?.message || event?.text || event?.delta;
  if (typeof progress === "string" && looksLikeProgressFallbackLine(progress)) {
    return {
      label: "Trabajando",
      text: compactProgressText(progress),
    };
  }

  return null;
}

function formatProgressMarker(step) {
  if (!step?.label || !step?.text) return "";
  return `[[agentbridge:progress]] ${step.label}|${step.text}\n`;
}

function createJsonlParser({ onEvent, onText, onRaw }) {
  let buffered = "";
  let emittedDeltaText = false;
  const emittedProgress = new Set();

  const consumeLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (onRaw) onRaw(`${line}\n`);

    try {
      const event = JSON.parse(trimmed);
      if (onEvent) onEvent(event);
      const progressStep = describeCodexEvent(event);
      const progressMarker = formatProgressMarker(progressStep);
      if (progressMarker && !emittedProgress.has(progressMarker)) {
        emittedProgress.add(progressMarker);
        if (onText) onText(progressMarker);
      }
      const text = extractVisibleText(event);
      if (text && onText) {
        if (isDeltaTextEvent(event)) {
          emittedDeltaText = true;
        }
        if (!emittedDeltaText || !isCompleteMessageEvent(event)) {
          onText(text);
        }
      }
    } catch {
      if (onText && looksLikeProgressFallbackLine(line)) {
        onText(`${line}\n`);
      }
    }
  };

  return {
    push(chunk) {
      buffered += chunk;
      const lines = buffered.split(/\n/);
      buffered = lines.pop() || "";
      lines.forEach(consumeLine);
    },
    end() {
      if (buffered) {
        consumeLine(buffered);
        buffered = "";
      }
    },
  };
}

/**
 * Codex CLI adapter.
 * Uses Codex CLI JSONL output so AgentBridge can capture the native Codex
 * session id and resume it on later turns instead of replaying chat history.
 */
function createCodexAgent(options = {}) {
  const model = options.model || "gpt-5.6-sol";
  const sandboxMode = options.sandboxMode || "workspace-write";

  return {
    id: "codex",
    name: "Codex CLI",
    supportsNativeResume: true,

    async run({
      projectPath,
      prompt,
      attachments = [],
      nativeSessionId = null,
      onStdout,
      onStderr,
      onNativeSession,
      signal,
    }) {
      const resolved = path.resolve(projectPath);
      if (!fs.existsSync(resolved)) {
        throw new Error(`Project path does not exist: ${resolved}`);
      }

      const codexArgs = nativeSessionId
        ? appendImageArgs([
            "exec",
            "resume",
            "--json",
            "--model",
            model,
            "--skip-git-repo-check",
          ], attachments).concat([nativeSessionId, "-"])
        : appendImageArgs([
            "exec",
            "--json",
            "--model",
            model,
            "--sandbox",
            sandboxMode,
            "--skip-git-repo-check",
          ], attachments).concat(["-"]);

      refreshProcessPath({ force: true });
      const codexCommand = resolveCodexCommand();
      const args = ["/d", "/c", codexCommand, ...codexArgs];
      let visibleStdout = "";
      let rawStdout = "";
      let capturedNativeSessionId = nativeSessionId || null;
      const parser = createJsonlParser({
        onRaw: (text) => {
          rawStdout += text;
        },
        onText: (text) => {
          visibleStdout += text;
          if (onStdout) onStdout(text);
        },
        onEvent: (event) => {
          const nextSessionId = extractSessionId(event);
          if (nextSessionId && nextSessionId !== capturedNativeSessionId) {
            capturedNativeSessionId = nextSessionId;
            if (onNativeSession) onNativeSession(nextSessionId);
          }
        },
      });

      const result = await runProcess("cmd.exe", args, {
        cwd: resolved,
        onStdout: (text) => parser.push(text),
        onStderr,
        signal,
        stdinData: prompt + "\n",
      });

      parser.end();

      return {
        ...result,
        stdout: visibleStdout,
        rawStdout: rawStdout || result.stdout,
        nativeSessionId: capturedNativeSessionId,
        resumed: Boolean(nativeSessionId),
      };
    },
  };
}

module.exports = {
  createCodexAgent,
};
