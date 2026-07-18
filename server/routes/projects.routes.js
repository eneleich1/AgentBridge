const projectService = require("../services/projectService");
const taskService = require("../services/taskService");
const sessionManager = require("../sessions/sessionManager");
const setupService = require("../services/setupService");

async function projectsRoutes(fastify) {
  fastify.get("/api/projects", async () => {
    return { projects: projectService.listProjects() };
  });

  fastify.post("/api/projects/validate", async (request, reply) => {
    const { path: projectPath } = request.body || {};
    const validation = projectService.validateProjectPath(projectPath);
    if (!validation.valid) {
      return reply.code(400).send({ validation });
    }
    return { validation };
  });

  fastify.post("/api/projects", async (request, reply) => {
    const { name, path: projectPath } = request.body || {};

    if (!projectPath) {
      return reply.code(400).send({ error: "path is required" });
    }

    try {
      const project = projectService.addProject({ name, path: projectPath });
      setupService.invalidateSetupStatusCache();
      return reply.code(201).send({ project });
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.delete("/api/projects/:id", async (request, reply) => {
    const project = projectService.getProjectById(request.params.id);
    if (!project) {
      return reply.code(404).send({ error: "Project not found" });
    }

    try {
      const deletedTasks = taskService.deleteTasksForProject(project.id);
      const deletedSessions = sessionManager.deleteSessionsForProject(project.id);
      projectService.deleteProject(project.id);
      setupService.invalidateSetupStatusCache();
      return { ok: true, deletedTasks, deletedSessions };
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });
}

module.exports = projectsRoutes;
