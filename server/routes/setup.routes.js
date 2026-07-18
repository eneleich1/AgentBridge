const setupService = require("../services/setupService");

async function setupRoutes(fastify) {
  fastify.get("/api/health", async () => setupService.getHealth());

  fastify.get("/api/setup/status", async () => {
    return setupService.getSetupStatus();
  });

  fastify.post("/api/connections/test", async () => {
    const health = setupService.getHealth();
    return {
      connected: true,
      ...health,
    };
  });
}

module.exports = setupRoutes;
