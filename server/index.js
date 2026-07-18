const path = require("path");
const fs = require("fs");
const Fastify = require("fastify");
const cors = require("@fastify/cors");
const websocket = require("@fastify/websocket");
const fastifyStatic = require("@fastify/static");
const { getAccessToken } = require("./agents/agentFactory");
const setupService = require("./services/setupService");
const taskService = require("./services/taskService");
const sessionManager = require("./sessions/sessionManager");
const { registerClient } = require("./realtime/websocket");

const setupRoutes = require("./routes/setup.routes");
const agentsRoutes = require("./routes/agents.routes");
const projectsRoutes = require("./routes/projects.routes");
const tasksRoutes = require("./routes/tasks.routes");
const sessionsRoutes = require("./routes/sessions.routes");
const messagesRoutes = require("./routes/messages.routes");
const systemRoutes = require("./routes/system.routes");

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
  const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });

  app.register(cors, { origin: isAllowedOrigin });
  app.register(websocket);

  app.addHook("onRequest", async (request, reply) => {
    const token = getAccessToken();
    if (!token) return;

    const publicPaths = ["/health", "/api/health"];
    if (publicPaths.includes(request.url.split("?")[0])) return;

    const header = request.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    const queryToken = request.query?.token;
    const isWebSocketRequest = request.url.split("?")[0] === "/ws";

    if (bearer === token || (isWebSocketRequest && queryToken === token)) return;

    return reply.code(401).send({ error: "Unauthorized" });
  });

  app.get("/health", async () => setupService.getHealth());

  app.register(setupRoutes);
  app.register(agentsRoutes);
  app.register(projectsRoutes);
  app.register(tasksRoutes);
  app.register(sessionsRoutes);
  app.register(messagesRoutes);
  app.register(systemRoutes);

  app.register(async (scoped) => {
    scoped.get("/ws", { websocket: true }, (socket) => {
      registerClient(socket);
      socket.send(JSON.stringify({ type: "connected" }));
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
  taskService.initDb();
  sessionManager.init();
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
