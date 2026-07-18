export default function OutputPanel({ task, liveOutput }) {
  const output = liveOutput || task?.stdout || "";
  const errors = task?.stderr || "";
  const status = task?.status || "idle";

  return (
    <div className="panel output-panel">
      <div className="panel-header">
        <h2>Output</h2>
        {task && (
          <span className={`badge badge-${status}`}>{status}</span>
        )}
      </div>

      {!task && !liveOutput && (
        <p className="muted">Run a task to see output here.</p>
      )}

      {(output || errors) && (
        <pre className="output-log">
          {output}
          {errors && (
            <>
              {output ? "\n" : ""}
              <span className="stderr">{errors}</span>
            </>
          )}
        </pre>
      )}

      {task?.exitCode !== null && task?.exitCode !== undefined && (
        <p className="exit-code">Exit code: {task.exitCode}</p>
      )}
    </div>
  );
}
