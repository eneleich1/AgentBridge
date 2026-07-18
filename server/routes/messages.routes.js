const sessionManager = require("../sessions/sessionManager");

async function messagesRoutes(fastify) {
  fastify.get("/api/sessions/:sessionId/messages", async (request, reply) => {
    const session = sessionManager.getSessionById(request.params.sessionId);
    if (!session) {
      return reply.code(404).send({ error: "Session not found" });
    }
    return { messages: sessionManager.listMessages(session.id) };
  });

  fastify.post("/api/sessions/:sessionId/messages", async (request, reply) => {
    const { content, attachments } = request.body || {};

    try {
      const message = await sessionManager.enqueueMessage(request.params.sessionId, {
        content,
        attachments,
      });
      return reply.code(202).send(message);
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });

  fastify.post("/api/sessions/:sessionId/messages/:messageId/replay", async (request, reply) => {
    const { content } = request.body || {};

    try {
      const result = await sessionManager.reviseAndReplayMessage(
        request.params.sessionId,
        request.params.messageId,
        { content }
      );
      return reply.code(202).send(result);
    } catch (error) {
      return reply.code(400).send({ error: error.message });
    }
  });
}

module.exports = messagesRoutes;
