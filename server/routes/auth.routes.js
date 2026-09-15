const authService = require("../auth/authService");

async function authRoutes(fastify) {
  fastify.get("/api/auth/status", async () => {
    return { configured: await authService.isAccountConfigured() };
  });

  fastify.post("/api/auth/login", async (request, reply) => {
    const { username, password, totpToken } = request.body || {};
    if (!username || !password || !totpToken) {
      return reply.code(400).send({ error: "username, password, and totpToken are required" });
    }

    const result = await authService.login({ username, password, totpToken });
    if (!result.ok) {
      return reply.code(401).send({ error: result.error });
    }
    return { token: result.token };
  });

  fastify.get("/api/auth/session", async () => {
    return { ok: true };
  });

  fastify.post("/api/auth/logout", async (request) => {
    const header = request.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (bearer) authService.revokeSession(bearer);
    return { ok: true };
  });

  fastify.get("/api/auth/me", async () => {
    return (await authService.getAccountInfo()) || {};
  });

  fastify.post("/api/auth/change-password", async (request, reply) => {
    const { currentPassword, totpToken, newPassword } = request.body || {};
    if (!currentPassword || !totpToken || !newPassword) {
      return reply.code(400).send({ error: "currentPassword, totpToken, and newPassword are required" });
    }
    const result = await authService.changePassword({ currentPassword, totpToken, newPassword });
    if (!result.ok) {
      return reply.code(400).send({ error: result.error });
    }
    return { ok: true };
  });
}

module.exports = authRoutes;
