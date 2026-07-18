function getThreadColor(index) {
  const hue = (index * 29) % 360;
  return `hsl(${hue} 78% 58%)`;
}

function formatMetricBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 GB";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

function shortenHost(hostname) {
  const value = String(hostname || "").trim();
  if (!value) return "Waiting";
  return value.length > 12 ? `${value.slice(0, 12)}...` : value;
}

export default function SystemMetricsPanel({ metrics, visible, onToggle }) {
  const usedBytes = metrics?.memory?.usedBytes || 0;
  const totalBytes = metrics?.memory?.totalBytes || 0;
  const freeBytes = Math.max(0, totalBytes - usedBytes);

  return (
    <div className={`system-metrics-shell ${visible ? "open" : "closed"}`}>
      <div className="system-metrics-topbar">
        <span className="system-metrics-topbar-label">System Metrics</span>
        <button
          type="button"
          className="system-metrics-toggle"
          onClick={onToggle}
          aria-expanded={visible}
          aria-label={visible ? "Hide system metrics" : "Show system metrics"}
          title={visible ? "Hide system metrics" : "Show system metrics"}
        >
          {visible ? "-" : "+"}
        </button>
      </div>

      {visible && (
        <section className="system-metrics-card" aria-label="Backend system metrics">
          <>
          <div className="system-metrics-header">
            <div>
              <strong>Backend</strong>
              <small>{shortenHost(metrics?.hostname)}</small>
            </div>
            <span className="system-metrics-chip">
              CPU {typeof metrics?.cpu?.averageUsage === "number" ? metrics.cpu.averageUsage.toFixed(0) : "0"}%
            </span>
          </div>

          <div className="system-metrics-memory-summary" aria-label="Memory summary">
            <div className="memory-summary-track">
              <div className="memory-summary-item">
              <span className="memory-summary-label">Used</span>
              <strong>{formatMetricBytes(usedBytes)}</strong>
              </div>
              <div className="memory-summary-item memory-summary-item-center">
              <span className="memory-summary-label">Free</span>
              <strong>{formatMetricBytes(freeBytes)}</strong>
              </div>
              <div className="memory-summary-item memory-summary-item-right">
              <span className="memory-summary-label">Total</span>
              <strong>{formatMetricBytes(totalBytes)}</strong>
              </div>
            </div>
          </div>

          <div className="thread-grid">
            <div className="metrics-row" aria-label="Memory usage">
              <div className="metric-bar">
                <span
                  style={{
                    width: `${metrics?.memory?.usage || 0}%`,
                    background: "linear-gradient(90deg, #60a5fa, #22c55e)",
                  }}
                />
              </div>
              <div className="metric-meta">
                <span className="metric-name">RAM</span>
                <span className="metric-percent">
                  {typeof metrics?.memory?.usage === "number" ? metrics.memory.usage.toFixed(0) : "0"}%
                </span>
              </div>
            </div>
            {(metrics?.cpu?.threads || []).map((thread) => (
              <div className="metrics-row" key={thread.index}>
                <div className="metric-bar">
                  <span
                    style={{
                      width: `${thread.usage}%`,
                      background: `linear-gradient(90deg, ${getThreadColor(thread.index)}, rgba(255,255,255,0.24))`,
                    }}
                  />
                </div>
                <div className="metric-meta">
                  <span className="metric-name">Core {thread.index + 1}</span>
                  <span className="metric-percent">{thread.usage.toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>
          </>
        </section>
      )}
    </div>
  );
}
