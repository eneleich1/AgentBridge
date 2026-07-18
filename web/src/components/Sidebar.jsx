import { useRef, useState } from "react";
import ContextMenu from "./ContextMenu";
import SystemMetricsPanel from "./SystemMetricsPanel";

function statusLabel(status, setupStatus) {
  if (!setupStatus) return "Needs Setup";
  if (setupStatus.setupComplete) return "Connected";
  if (
    setupStatus.cursor?.status === "needs_login" ||
    setupStatus.codex?.status === "needs_login"
  ) {
    return "Needs Setup";
  }
  return status === "connected" ? "Connected" : "Disconnected";
}

function getSessionTitle(session) {
  const text = session.preview || session.summary || "";
  if (text.trim()) return text.slice(0, 48);
  return `Chat: ${new Date(session.createdAt).toLocaleString()}`;
}

export default function Sidebar({
  width,
  onResizeStart,
  projects,
  sessions,
  selectedProjectId,
  selectedSessionId,
  isDraft,
  onSelectProject,
  onSelectSession,
  onNewSession,
  onDeleteProject,
  onDeleteSession,
  onRefresh,
  onOpenSettings,
  onAddProject,
  onOpenBackendSetup,
  connectionStatus,
  setupStatus,
  serverUrl,
  health,
  isMobile = false,
  mobileOpen = false,
  onCloseMobile,
  systemMetrics,
  systemMetricsVisible = false,
  onToggleSystemMetrics,
}) {
  const [menu, setMenu] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const projectsRef = useRef(null);

  const sessionsByProject = projects.reduce((acc, project) => {
    acc[project.id] = sessions
      .filter((session) => session.projectId === project.id)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return acc;
  }, {});

  function closeDrawer() {
    onCloseMobile?.();
  }

  function openProjectMenu(e, project) {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "New chat",
          onClick: () => {
            onNewSession(project.id);
            closeDrawer();
          },
        },
        {
          label: "Remove project",
          danger: true,
          onClick: () => {
            if (window.confirm(`Remove project "${project.name}" and all its chats?`)) {
              onDeleteProject(project.id);
            }
          },
        },
      ],
    });
  }

  function openSessionMenu(e, session) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "Remove chat",
          danger: true,
          onClick: () => onDeleteSession(session.id),
        },
      ],
    });
  }

  const sidebarClassName = [
    "sidebar",
    isMobile ? "mobile-drawer" : "",
    isMobile && mobileOpen ? "open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {isMobile && mobileOpen && (
        <button
          type="button"
          className="mobile-drawer-backdrop"
          onClick={closeDrawer}
          aria-label="Close navigation drawer"
        />
      )}

      <aside className={sidebarClassName} style={!isMobile ? { width } : undefined}>
        <div className="sidebar-brand">
          <img
            className="app-logo"
            src="/agentbridge-logo.png"
            alt="AgentBridge logo"
          />
          <div>
            <strong>AgentBridge</strong>
            <small>Remote agent control</small>
          </div>
          {isMobile && (
            <button
              type="button"
              className="mobile-drawer-close"
              onClick={closeDrawer}
              aria-label="Close menu"
            >
              x
            </button>
          )}
        </div>

        <div className="sidebar-scroll">
          {isMobile && (
            <>
              <div className="mobile-connection-card">
                <div className={`mobile-connection-pill ${connectionStatus}`}>
                  <span className="mobile-status-dot" />
                  {statusLabel(connectionStatus, setupStatus)}
                </div>
                <div className="mobile-host-name">
                  {health?.hostname || serverUrl.replace(/^https?:\/\//, "")}
                </div>
              </div>
              <div className="mobile-metrics-section">
                <SystemMetricsPanel
                  metrics={systemMetrics}
                  visible={systemMetricsVisible}
                  onToggle={onToggleSystemMetrics}
                />
              </div>
            </>
          )}

          <nav className="sidebar-nav">
            <button
              type="button"
              className="nav-item"
              onClick={() => {
                onOpenBackendSetup();
                closeDrawer();
              }}
            >
              Connections
            </button>
            <button
              type="button"
              className="nav-item"
              onClick={(event) => {
                onOpenSettings(event.currentTarget.getBoundingClientRect());
                closeDrawer();
              }}
            >
              Settings
            </button>
            <button
              type="button"
              className="nav-item muted"
              disabled
            >
              History (Coming soon)
            </button>
            {!isMobile && (
              <button type="button" className="nav-item" onClick={onRefresh}>
                Refresh
              </button>
            )}
          </nav>

          <div className="sidebar-section" ref={projectsRef}>
            <div className="section-header">
              <div className="section-title">Projects</div>
              <div className="section-actions">
                <button
                  type="button"
                  className="section-icon-btn"
                  title={collapsed ? "Expand all" : "Collapse all"}
                  aria-label={collapsed ? "Expand all projects" : "Collapse all projects"}
                  onClick={() => setCollapsed((value) => !value)}
                >
                  {collapsed ? ">" : "v"}
                </button>
                <button
                  type="button"
                  className="section-icon-btn"
                  title="Add project"
                  aria-label="Add project"
                  onClick={() => {
                    onAddProject();
                    closeDrawer();
                  }}
                >
                  <span className="folder-add-icon" aria-hidden="true">
                    <span className="folder-add-shape" />
                    <span className="folder-add-plus">+</span>
                  </span>
                </button>
              </div>
            </div>

            {projects.length === 0 && (
              <p className="sidebar-empty">
                No projects yet. {connectionStatus === "connected" ? "Open Connections to add one." : "Connect a backend first."}
              </p>
            )}

            {projects.map((project) => (
              <div key={project.id} className="project-group">
                <div
                  className={`project-row-wrap ${
                    selectedProjectId === project.id && isDraft ? "draft-active" : ""
                  }`}
                >
                  <button
                    type="button"
                    className={`project-row ${selectedProjectId === project.id ? "active" : ""}`}
                    onClick={() => {
                      onSelectProject(project.id);
                      closeDrawer();
                    }}
                    onContextMenu={(e) => openProjectMenu(e, project)}
                  >
                    <span className="folder-icon" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M3 7.5C3 6.39543 3.89543 5.5 5 5.5H9.2C9.8033 5.5 10.3732 5.77234 10.7524 6.24032L11.4476 7.09968C11.8268 7.56766 12.3967 7.84 13 7.84H19C20.1046 7.84 21 8.73543 21 9.84V17.5C21 18.6046 20.1046 19.5 19 19.5H5C3.89543 19.5 3 18.6046 3 17.5V7.5Z"
                          fill="#F7C948"
                          stroke="#E0A91A"
                          strokeWidth="1.2"
                        />
                      </svg>
                    </span>
                    <span className="project-name">{project.name}</span>
                  </button>
                  <button
                    type="button"
                    className="project-new-btn"
                    title="New chat in this project"
                    aria-label={`New chat in ${project.name}`}
                    onClick={() => {
                      onNewSession(project.id);
                      closeDrawer();
                    }}
                  >
                    +
                  </button>
                </div>

                {!collapsed && (
                  <ul className="session-list">
                    {(sessionsByProject[project.id] || []).map((session) => (
                      <li key={session.id}>
                        <button
                          type="button"
                          className={`session-row ${
                            selectedSessionId === session.id && !isDraft ? "active" : ""
                          }`}
                          onClick={() => {
                            onSelectSession(session.id);
                            closeDrawer();
                          }}
                          onContextMenu={(e) => openSessionMenu(e, session)}
                        >
                          <span className={`dot ${session.status}`} />
                          <span className="session-title">{getSessionTitle(session)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>

        {!isMobile && (
          <div className="sidebar-footer">
            <button
              type="button"
              className={`conn-pill ${connectionStatus}`}
              onClick={onOpenBackendSetup}
              title="Configure backend connection"
            >
              {statusLabel(connectionStatus, setupStatus)}
            </button>
            <small className="host-label" title={serverUrl}>
              {health?.hostname || serverUrl.replace(/^https?:\/\//, "")}
            </small>
          </div>
        )}

        {!isMobile && <div className="resize-handle" onMouseDown={onResizeStart} />}

        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.items}
            onClose={() => setMenu(null)}
          />
        )}
      </aside>
    </>
  );
}
