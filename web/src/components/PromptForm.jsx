import { useState } from "react";
import VoiceInput from "./VoiceInput";

export default function PromptForm({
  projects,
  agents,
  selectedProjectId,
  selectedAgent,
  prompt,
  running,
  onProjectChange,
  onAgentChange,
  onPromptChange,
  onSubmit,
  onAddProject,
}) {
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPath, setNewProjectPath] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  async function handleAddProject(e) {
    e.preventDefault();
    setAdding(true);
    setAddError("");
    try {
      await onAddProject({ name: newProjectName, path: newProjectPath });
      setShowAddProject(false);
      setNewProjectName("");
      setNewProjectPath("");
    } catch (error) {
      setAddError(error.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="panel prompt-form">
      <h2>Run Agent</h2>

      <label>
        Project
        <select
          value={selectedProjectId}
          onChange={(e) => onProjectChange(e.target.value)}
          disabled={running}
        >
          <option value="">Select project...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.path}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="btn btn-link"
        onClick={() => setShowAddProject(!showAddProject)}
      >
        {showAddProject ? "Cancel" : "+ Add project"}
      </button>

      {showAddProject && (
        <form className="add-project-form" onSubmit={handleAddProject}>
          <input
            type="text"
            placeholder="Project name"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
          />
          <input
            type="text"
            placeholder="C:\path\to\project"
            value={newProjectPath}
            onChange={(e) => setNewProjectPath(e.target.value)}
            required
          />
          {addError && <p className="error">{addError}</p>}
          <button type="submit" className="btn" disabled={adding}>
            {adding ? "Adding..." : "Add"}
          </button>
        </form>
      )}

      <label>
        Agent
        <select
          value={selectedAgent}
          onChange={(e) => onAgentChange(e.target.value)}
          disabled={running}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Prompt
        <textarea
          rows={5}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder="Describe what the agent should do..."
          disabled={running}
        />
      </label>

      <div className="form-actions">
        <VoiceInput
          disabled={running}
          onTranscript={(text) =>
            onPromptChange(prompt ? `${prompt} ${text}` : text)
          }
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSubmit}
          disabled={running || !selectedProjectId || !prompt.trim()}
        >
          {running ? "Running..." : "Run"}
        </button>
      </div>
    </div>
  );
}
