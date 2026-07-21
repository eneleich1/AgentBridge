const {
  getAgentConfig,
  listAgents,
  resetAgentConfig,
  updateAgentConfig,
} = require("../agents/agentFactory");
const { getCodexUsage, getCursorUsage } = require("../agents/diagnostics");
const { invalidateSetupStatusCache } = require("../services/setupService");

async function agentsRoutes(fastify) {
  fastify.get("/api/agents", async () => {
    return { agents: listAgents() };
  });

  fastify.get("/api/agents/:id/config", async (request, reply) => {
    try {
      return { agent: getAgentConfig(request.params.id) };
    } catch (error) {
      return reply.code(404).send({ error: error.message });
    }
  });

  fastify.put("/api/agents/:id/config", async (request, reply) => {
    try {
      const agent = updateAgentConfig(request.params.id, request.body || {});
      invalidateSetupStatusCache();
      return { agent };
    } catch (error) {
      const statusCode = error.message.includes("Unknown agent type") ? 404 : 400;
      return reply.code(statusCode).send({ error: error.message });
    }
  });

  fastify.delete("/api/agents/:id/config", async (request, reply) => {
    try {
      const agent = resetAgentConfig(request.params.id);
      invalidateSetupStatusCache();
      return { agent };
    } catch (error) {
      const statusCode = error.message.includes("Unknown agent type") ? 404 : 400;
      return reply.code(statusCode).send({ error: error.message });
    }
  });

  fastify.get("/api/agents/:id/usage", async (request, reply) => {
    try {
      if (request.params.id === "codex") {
        return { usage: await getCodexUsage() };
      }
      if (request.params.id === "cursor") {
        return { usage: await getCursorUsage() };
      }
      return reply.code(404).send({ error: `Unknown agent type: ${request.params.id}` });
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });
}

module.exports = agentsRoutes;
