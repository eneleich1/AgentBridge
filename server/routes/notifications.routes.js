const notificationService = require("../services/notificationService");

async function notificationsRoutes(fastify) {
  fastify.get("/api/notifications/status", async () => notificationService.getStatus());
  fastify.get("/api/notifications/vapid-public-key", async () => ({ publicKey: notificationService.getPublicKey() }));

  fastify.post("/api/notifications/subscriptions", async (request, reply) => {
    try {
      return { subscription: notificationService.saveSubscription(request.body || {}) };
    } catch (error) {
      return reply.code(400).send({ error: error.message, code: error.code });
    }
  });

  fastify.delete("/api/notifications/subscriptions", async (request) => ({
    removed: notificationService.removeSubscription(request.body?.endpoint),
  }));

  fastify.post("/api/notifications/test", async () => {
    const result = await notificationService.notify({
      title: "AgentBridge notifications enabled",
      body: "You will be notified when an agent completes, fails, or requests permission.",
      tag: "agentbridge-test",
      data: { url: "/", event: "test" },
    });
    return result;
  });
}

module.exports = notificationsRoutes;
