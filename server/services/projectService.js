const fs = require("fs");
const path = require("path");
const { readJsonConfig, writeJsonConfig } = require("../utils/runtimeConfig");

const DEFAULT_CONFIG = {
  projects: [],
};

function loadProjectsConfig() {
  return readJsonConfig("projects.json", DEFAULT_CONFIG);
}

function saveProjectsConfig(config) {
  writeJsonConfig("projects.json", config);
}

function normalizePath(projectPath) {
  const resolved = path.resolve(projectPath);
  const canonical = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function listProjects() {
  const config = loadProjectsConfig();
  return config.projects.filter((p) => {
    try {
      return fs.existsSync(p.path);
    } catch {
      return false;
    }
  });
}

function getProjectById(id) {
  const config = loadProjectsConfig();
  return config.projects.find((p) => p.id === id) || null;
}

function isAllowedProjectPath(projectPath) {
  const resolved = normalizePath(projectPath);
  const config = loadProjectsConfig();
  return config.projects.some((p) => normalizePath(p.path) === resolved);
}

function resolveProjectPath(projectIdOrPath) {
  const byId = getProjectById(projectIdOrPath);
  if (byId) {
    return normalizePath(byId.path);
  }

  const resolved = normalizePath(projectIdOrPath);
  if (isAllowedProjectPath(resolved)) {
    return resolved;
  }

  return null;
}

function addProject({ name, path: projectPath }) {
  const validation = validateProjectPath(projectPath);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const resolved = validation.path;
  const config = loadProjectsConfig();
  const duplicate = config.projects.find((p) => normalizePath(p.path) === resolved);
  if (duplicate) {
    return duplicate;
  }

  const project = {
    id: `proj-${Date.now()}`,
    name: name || path.basename(resolved),
    path: resolved,
    addedAt: new Date().toISOString(),
  };

  config.projects.push(project);
  saveProjectsConfig(config);
  return project;
}

function validateProjectPath(projectPath) {
  if (!projectPath || !String(projectPath).trim()) {
    return { valid: false, message: "Project path is required." };
  }

  const resolved = normalizePath(projectPath);

  if (!fs.existsSync(resolved)) {
    return {
      valid: false,
      path: resolved,
      message: `Path does not exist on the desktop: ${resolved}`,
    };
  }

  if (!fs.statSync(resolved).isDirectory()) {
    return { valid: false, path: resolved, message: "Project path must be a directory." };
  }

  let readable = false;
  let writable = false;
  try {
    fs.accessSync(resolved, fs.constants.R_OK);
    readable = true;
  } catch {
    readable = false;
  }

  try {
    fs.accessSync(resolved, fs.constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }

  if (!readable) {
    return {
      valid: false,
      path: resolved,
      readable,
      writable,
      message: `Path is not readable: ${resolved}`,
    };
  }

  const gitDir = path.join(resolved, ".git");
  const isGitRepo = fs.existsSync(gitDir);

  return {
    valid: true,
    path: resolved,
    readable,
    writable,
    isGitRepo,
    message: writable
      ? "Project path is accessible."
      : "Project path is readable but not writable. Some agent tasks may fail.",
  };
}

function deleteProject(id) {
  const config = loadProjectsConfig();
  const index = config.projects.findIndex((p) => p.id === id);
  if (index === -1) {
    throw new Error("Project not found");
  }
  const [removed] = config.projects.splice(index, 1);
  saveProjectsConfig(config);
  return removed;
}

module.exports = {
  listProjects,
  getProjectById,
  isAllowedProjectPath,
  resolveProjectPath,
  addProject,
  validateProjectPath,
  deleteProject,
};
