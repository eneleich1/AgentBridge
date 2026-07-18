const taskService = require("../services/taskService");
const logService = require("../services/logService");

async function tasksRoutes(fastify) {
  fastify.post("/api/tasks", async (request, reply) => {
    const { projectId, projectPath, agentType, prompt, attachments, conversationId } = request.body || {};

    try {
      const task = await taskService.createTask({
        projectId,
        projectPath,
        agentType,
        prompt,
        attachments,
        conversationId,
      });
      return reply.code(201).send({ task });
    } catch (error) {
      return reply.code(400).send({
        error: error.message,
        code: error.code,
        agent: error.agent,
        setup: error.setup,
      });
    }
  });

  fastify.get("/api/tasks", async (request) => {
    const limit = Number(request.query.limit) || 50;
    const projectId = request.query.projectId || null;
    return { tasks: taskService.listTasks(limit, projectId) };
  });

  fastify.get("/api/tasks/:id", async (request, reply) => {
    const task = taskService.getTaskById(request.params.id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }

    const log = logService.readLog(task.id);
    return { task, log };
  });

  fastify.post("/api/tasks/:id/cancel", async (request, reply) => {
    const task = taskService.cancelTask(request.params.id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }
    return { task };
  });

  fastify.delete("/api/tasks/:id", async (request, reply) => {
    const task = taskService.deleteTask(request.params.id);
    if (!task) {
      return reply.code(404).send({ error: "Task not found" });
    }
    return { ok: true, task };
  });

  fastify.delete("/api/conversations/:id", async (request, reply) => {
    const tasks = taskService.deleteConversation(request.params.id);
    if (!tasks.length) {
      return reply.code(404).send({ error: "Conversation not found" });
    }
    return { ok: true, tasks };
  });
}

module.exports = tasksRoutes;
