const path = require("path");
const fs = require("fs");
const crypto = require("node:crypto");
const Fastify = require("fastify");
const cors = require("@fastify/cors");
const websocket = require("@fastify/websocket");
const fastifyStatic = require("@fastify/static");
const { getAccessToken } = require("./agents/agentFactory");
const { refreshProcessPath } = require("./agents/cliPath");
const setupService = require("./services/setupService");
const taskService = require("./services/taskService");
const notificationService = require("./services/notificationService");
const sessionManager = require("./sessions/sessionManager");
const { registerClient } = require("./realtime/websocket");
const authService = require("./auth/authService");

const setupRoutes = require("./routes/setup.routes");
const agentsRoutes = require("./routes/agents.routes");
const projectsRoutes = require("./routes/projects.routes");
const tasksRoutes = require("./routes/tasks.routes");
const sessionsRoutes = require("./routes/sessions.routes");
const messagesRoutes = require("./routes/messages.routes");
const systemRoutes = require("./routes/system.routes");
const notificationsRoutes = require("./routes/notifications.routes");
const authRoutes = require("./routes/auth.routes");

const PORT = Number(process.env.PORT) || 3847;
const HOST = process.env.HOST || "127.0.0.1";
const WEB_DIST = path.join(__dirname, "../web/dist");
const DEVELOPMENT_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function getAllowedOrigins() {
  const configured = String(process.env.AGENTBRIDGE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return new Set([...DEVELOPMENT_ORIGINS, ...configured]);
}

function isAllowedOrigin(origin, callback) {
  if (!origin || getAllowedOrigins().has(origin.replace(/\/$/, ""))) {
    callback(null, true);
    return;
  }
  callback(null, false);
}

function buildApp() {
  const app = Fastify({ logger: {
    redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
    serializers: { req: request => ({ method: request.method, url: request.url?.split("?")[0], remoteAddress: request.ip }) },
  }, bodyLimit: 25 * 1024 * 1024 });

  app.register(cors, { origin: isAllowedOrigin });
  app.register(websocket);

  app.addHook("onRequest", async (request, reply) => {
    const pathname = request.url.split("?")[0];
    const isWebSocketRequest = pathname === "/ws";
    const isGuardedRequest = pathname.startsWith("/api") || isWebSocketRequest;
    if (!isGuardedRequest) return; // let the static SPA shell load without a token

    const publicPaths = ["/health", "/api/health", "/api/auth/login", "/api/auth/status"];
    if (publicPaths.includes(pathname)) return;

    const header = request.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    const queryToken = request.query?.token;
    const presentedToken = isWebSocketRequest ? bearer || queryToken : bearer;

    if (await authService.isAccountConfigured()) {
      if (presentedToken && authService.validateSession(presentedToken)) return;
      return reply.code(401).send({ error: "Unauthorized" });
    }

    // No account configured yet: fall back to the legacy static access token
    // (or no auth at all, if that isn't set either) so a fresh clone stays
    // frictionless until `npm run setup:auth` is run.
    const legacyToken = getAccessToken();
    if (!legacyToken) {
      if (["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.ip) && ["127.0.0.1", "::1", "localhost"].includes(HOST)) return;
      return reply.code(503).send({ error: "Configure an account or access token before enabling remote access." });
    }
    const actual = crypto.createHash("sha256").update(String(presentedToken || "")).digest();
    const expected = crypto.createHash("sha256").update(legacyToken).digest();
    if (crypto.timingSafeEqual(actual, expected)) return;

    return reply.code(401).send({ error: "Unauthorized" });
  });

  app.get("/health", async () => setupService.getHealth());

  app.register(authRoutes);
  app.register(setupRoutes);
  app.register(agentsRoutes);
  app.register(projectsRoutes);
  app.register(tasksRoutes);
  app.register(sessionsRoutes);
  app.register(messagesRoutes);
  app.register(systemRoutes);
  app.register(notificationsRoutes);

  app.register(async (scoped) => {
    scoped.get("/ws", { websocket: true }, (socket) => {
      registerClient(socket);
      socket.send(JSON.stringify({ type: "connected" }));
      socket.send(JSON.stringify({ type: "permissions_snapshot", payload: { permissions: sessionManager.listPendingPermissions() } }));
    });
  });

  if (fs.existsSync(WEB_DIST)) {
    app.register(fastifyStatic, {
      root: WEB_DIST,
      prefix: "/",
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api") || request.url.startsWith("/ws")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}

async function start() {
  refreshProcessPath({ force: true });
  taskService.initDb();
  sessionManager.init();
  notificationService.init();
  const app = buildApp();

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`AgentBridge listening on http://${HOST}:${PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
