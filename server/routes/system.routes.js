const systemMetricsService = require("../services/systemMetricsService");

async function systemRoutes(fastify) {
  fastify.get("/api/system-metrics", async () => {
    return systemMetricsService.getSystemMetrics();
  });
}

module.exports = systemRoutes;
