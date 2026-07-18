const STATUS_CLASS = {
  queued: "status-queued",
  running: "status-running",
  completed: "status-completed",
  failed: "status-failed",
  cancelled: "status-cancelled",
};

export default function TaskHistory({ tasks, activeTaskId, onSelect }) {
  if (!tasks.length) {
    return (
      <div className="panel task-history">
        <h2>Task History</h2>
        <p className="muted">No tasks yet.</p>
      </div>
    );
  }

  return (
    <div className="panel task-history">
      <h2>Task History</h2>
      <ul className="task-list">
        {tasks.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              className={`task-item ${task.id === activeTaskId ? "active" : ""}`}
              onClick={() => onSelect(task.id)}
            >
              <span className={`status-dot ${STATUS_CLASS[task.status] || ""}`} />
              <span className="task-agent">{task.agentType}</span>
              <span className="task-prompt">{task.prompt.slice(0, 60)}</span>
              <span className="task-time">
                {new Date(task.createdAt).toLocaleString()}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
