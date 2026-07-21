import { extractDisplayContent } from "./ChatMessage";

const DUEL_OUTPUT_PREFIX = "[[agentbridge:duel-output]]";
const DUEL_RESULT_PREFIX = "[[agentbridge:duel-result]]";
const CONTESTANTS = [
  { id: "cursor", name: "Cursor", initials: "Cu" },
  { id: "codex", name: "Codex", initials: "Cx" },
];

function emptyContestant(agentId, status = "queued") {
  return { agentId, status, content: "", error: "" };
}

function parseFinalResults(content) {
  const text = String(content || "");
  const markerIndex = text.indexOf(DUEL_RESULT_PREFIX);
  if (markerIndex < 0) return null;
  try {
    return JSON.parse(text.slice(markerIndex + DUEL_RESULT_PREFIX.length));
  } catch {
    return null;
  }
}

function parseStreamingResults(raw, messageStatus) {
  const initialStatus = messageStatus === "running" ? "running" : "queued";
  const results = {
    cursor: emptyContestant("cursor", initialStatus),
    codex: emptyContestant("codex", initialStatus),
  };
  for (const line of String(raw || "").split("\n")) {
    if (!line.startsWith(DUEL_OUTPUT_PREFIX)) continue;
    try {
      const output = JSON.parse(line.slice(DUEL_OUTPUT_PREFIX.length));
      const contestant = results[output.agentId];
      if (!contestant) continue;
      contestant.status = messageStatus === "queued" ? "queued" : "running";
      if (output.stream === "stderr") contestant.error += output.text || "";
      else contestant.content += output.text || "";
    } catch {
      // An incomplete marker will be completed by a later streaming update.
    }
  }
  return results;
}

function getDuelResults(message) {
  return parseFinalResults(message?.content) || parseStreamingResults(message?.raw, message?.status);
}

function ContestantCard({ contestant, definition, winner, busy, onSelectWinner }) {
  const displayContent = extractDisplayContent("", contestant.content || "");
  const isWinner = winner === definition.id;
  const canSelect = !busy && contestant.status === "completed";

  return (
    <section className={`duel-card ${isWinner ? "winner" : ""}`}>
      <header className="duel-card-header">
        <div className="duel-agent-name">
          <span className="agent-avatar">{definition.initials}</span>
          <strong>{definition.name}</strong>
        </div>
        <span className={`status-chip ${contestant.status}`}>{contestant.status}</span>
      </header>
      <div className="duel-card-body">
        {!displayContent && !contestant.error && ["queued", "running"].includes(contestant.status) && (
          <div className="working-indicator">
            <span className="spinner" />
            <span>{contestant.status === "queued" ? "Waiting to start..." : "Building proposal..."}</span>
          </div>
        )}
        {displayContent && <div className="duel-answer">{displayContent}</div>}
        {contestant.error && <div className="duel-error">{contestant.error}</div>}
      </div>
      <footer className="duel-card-footer">
        {isWinner ? (
          <span className="duel-winner-badge">Winner selected</span>
        ) : (
          <button
            type="button"
            className="duel-select-btn"
            disabled={!canSelect}
            onClick={() => onSelectWinner(definition.id)}
          >
            Choose {definition.name}
          </button>
        )}
      </footer>
    </section>
  );
}

export default function AgentDuelMessage({ message, session, onSelectWinner }) {
  const results = getDuelResults(message);
  const busy = message?.status !== "completed" ||
    ["queued", "running"].includes(session?.status);

  return (
    <div className="chat-message agent duel-message">
      <div className="msg-label duel-label">
        <span className="duel-vs-avatar">VS</span>
        Agent Duel
        {message?.status && <span className={`status-chip ${message.status}`}>{message.status}</span>}
        <span className="duel-safety-label">Proposal only</span>
      </div>
      <div className="duel-grid">
        {CONTESTANTS.map((definition) => (
          <ContestantCard
            key={definition.id}
            contestant={results[definition.id] || emptyContestant(definition.id)}
            definition={definition}
            winner={message?.duelWinner}
            busy={busy}
            onSelectWinner={(winner) => onSelectWinner(message.id, winner)}
          />
        ))}
      </div>
    </div>
  );
}
