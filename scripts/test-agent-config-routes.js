const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Fastify = require("fastify");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentbridge-agent-routes-"));
process.env.AGENTBRIDGE_DATA_DIR = temporaryRoot;

const agentsRoutes = require("../server/routes/agents.routes");

async function main() {
  const app = Fastify();

  try {
    await app.register(agentsRoutes);
    await app.ready();

    let response = await app.inject({
      method: "GET",
      url: "/api/agents/codex/config",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().agent.settings.configured, false);
    assert.equal(response.json().agent.settings.model, "gpt-5.6-sol");

    response = await app.inject({
      method: "PUT",
      url: "/api/agents/codex/config",
      payload: { configured: true, model: "gpt-5.5" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().agent.settings.configured, true);
    assert.equal(response.json().agent.settings.model, "gpt-5.5");

    response = await app.inject({
      method: "DELETE",
      url: "/api/agents/codex/config",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().agent.settings.configured, false);
    assert.equal(response.json().agent.settings.model, "gpt-5.6-sol");

    response = await app.inject({
      method: "GET",
      url: "/api/agents/codex/config",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().agent.settings.configured, false);

    response = await app.inject({
      method: "GET",
      url: "/api/agents/cursor/config",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().agent.settings.configured, false);

    response = await app.inject({
      method: "PUT",
      url: "/api/agents/cursor/config",
      payload: { configured: true },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().agent.settings.configured, true);

    response = await app.inject({
      method: "DELETE",
      url: "/api/agents/cursor/config",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().agent.settings.configured, false);

    response = await app.inject({
      method: "GET",
      url: "/api/agents/cursor/config",
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().agent.settings.configured, false);

    response = await app.inject({
      method: "PUT",
      url: "/api/agents/cursor/config",
      payload: { configured: true },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().agent.settings.configured, true);

    console.log("agent config route tests passed");
  } finally {
    await app.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
