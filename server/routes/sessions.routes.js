const sessionManager = require("../sessions/sessionManager");

async function sessionsRoutes(fastify) {
  fastify.post("/api/sessions", async (request, reply) => {
    const { projectId, agentType, mode } = request.body || {};

    try {
      const session = await sessionManager.createSession({ projectId, agentType, mode });
      return reply.code(201).send({ session });
    } catch (error) {
      return reply.code(400).send({
        error: error.message,
        code: error.code,
        agent: error.agent,
        setup: error.setup,
      });
    }
  });

  fastify.get("/api/sessions", async (request) => {
    const limit = Number(request.query.limit) || 100;
    const projectId = request.query.projectId || null;
    return { sessions: sessionManager.listSessions(projectId, limit) };
  });

  fastify.get("/api/sessions/:sessionId", async (request, reply) => {
    const session = sessionManager.getSessionDetails(request.params.sessionId);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }
    return { session };
  });

  fastify.delete("/api/sessions/:sessionId", async (request, reply) => {
    const session = sessionManager.deleteSession(request.params.sessionId);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }
    return { ok: true, session };
  });

  fastify.post("/api/sessions/:sessionId/cancel", async (request, reply) => {
    const session = sessionManager.cancelSession(request.params.sessionId);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }
    return { session };
  });
}

module.exports = sessionsRoutes;
