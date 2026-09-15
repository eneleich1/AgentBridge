const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.AGENTBRIDGE_PG_HOST || "127.0.0.1",
  port: Number(process.env.AGENTBRIDGE_PG_PORT) || 5433,
  user: process.env.AGENTBRIDGE_PG_USER || "agentbridge",
  password: process.env.AGENTBRIDGE_PG_PASSWORD || "",
  database: process.env.AGENTBRIDGE_PG_DATABASE || "agentbridge",
  max: 5,
});

let schemaReady = null;

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS auth_account (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        username TEXT NOT NULL,
        email TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        totp_secret_encrypted TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }
  return schemaReady;
}

async function query(text, params) {
  await ensureSchema();
  return pool.query(text, params);
}

module.exports = { query, ensureSchema, pool };
