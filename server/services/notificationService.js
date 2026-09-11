const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const webPush = require("web-push");
const { DATA_DIR, readJsonConfig, writeJsonConfig } = require("../utils/runtimeConfig");

const VAPID_CONFIG_FILE = "push-notifications.json";
let db = null;
let configured = false;

function loadVapidConfig() {
  const saved = readJsonConfig(VAPID_CONFIG_FILE, {});
  const configuredKeys = {
    subject: process.env.AGENTBRIDGE_VAPID_SUBJECT || saved.subject || "mailto:admin@agentbridge.local",
    publicKey: process.env.AGENTBRIDGE_VAPID_PUBLIC_KEY || saved.publicKey,
    privateKey: process.env.AGENTBRIDGE_VAPID_PRIVATE_KEY || saved.privateKey,
  };
  if (!configuredKeys.publicKey || !configuredKeys.privateKey) {
    const generated = webPush.generateVAPIDKeys();
    configuredKeys.publicKey = generated.publicKey;
    configuredKeys.privateKey = generated.privateKey;
    writeJsonConfig(VAPID_CONFIG_FILE, configuredKeys);
  }
  return configuredKeys;
}

function init() {
  if (configured) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(path.join(DATA_DIR, "agentbridge.sqlite"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      subscription_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error TEXT
    );
  `);
  const vapid = loadVapidConfig();
  webPush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  configured = true;
}

function close() {
  if (db) db.close();
  db = null;
  configured = false;
}

function now() {
  return new Date().toISOString();
}

function assertSubscription(subscription) {
  if (!subscription || typeof subscription.endpoint !== "string" || !subscription.endpoint.startsWith("https://")) {
    const error = new Error("A valid HTTPS push subscription is required.");
    error.code = "invalid_push_subscription";
    throw error;
  }
  if (!subscription.keys?.p256dh || !subscription.keys?.auth) {
    const error = new Error("The push subscription is missing encryption keys.");
    error.code = "invalid_push_subscription";
    throw error;
  }
}

function getPublicKey() {
  init();
  return loadVapidConfig().publicKey;
}

function saveSubscription(subscription) {
  init();
  assertSubscription(subscription);
  const timestamp = now();
  db.prepare(`
    INSERT INTO push_subscriptions (endpoint, subscription_json, created_at, updated_at, last_error)
    VALUES (?, ?, ?, ?, NULL)
    ON CONFLICT(endpoint) DO UPDATE SET
      subscription_json = excluded.subscription_json,
      updated_at = excluded.updated_at,
      last_error = NULL
  `).run(subscription.endpoint, JSON.stringify(subscription), timestamp, timestamp);
  return { endpoint: subscription.endpoint, createdAt: timestamp };
}

function removeSubscription(endpoint) {
  init();
  if (!endpoint) return false;
  return db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint).changes > 0;
}

function getStatus() {
  init();
  const count = db.prepare("SELECT COUNT(*) AS count FROM push_subscriptions").get().count;
  return { enabled: count > 0, subscriptionCount: count, publicKey: getPublicKey() };
}

async function notify({ title, body, data = {}, tag = "agentbridge" }) {
  init();
  const payload = JSON.stringify({ title, body, data: { ...data, url: data.url || "/" }, tag });
  const subscriptions = db.prepare("SELECT endpoint, subscription_json FROM push_subscriptions").all();
  const results = await Promise.allSettled(subscriptions.map(async (row) => {
    const subscription = JSON.parse(row.subscription_json);
    try {
      await webPush.sendNotification(subscription, payload, { TTL: 60 * 60 });
      db.prepare("UPDATE push_subscriptions SET last_error = NULL, updated_at = ? WHERE endpoint = ?")
        .run(now(), row.endpoint);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        removeSubscription(row.endpoint);
        return;
      }
      db.prepare("UPDATE push_subscriptions SET last_error = ?, updated_at = ? WHERE endpoint = ?")
        .run(String(error.message || error).slice(0, 500), now(), row.endpoint);
      throw error;
    }
  }));
  return {
    sent: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
  };
}

function notifySessionEvent(type, session, payload = {}) {
  if (!session) return;
  const project = session.projectName || "your project";
  const agent = session.agentType || "Agent";
  if (type === "permission_requested") {
    void notify({
      title: "AgentBridge needs your approval",
      body: `${agent} is waiting for permission in ${project}.`,
      tag: `permission:${session.id}`,
      data: { url: `/?session=${encodeURIComponent(session.id)}`, sessionId: session.id, event: type },
    }).catch(() => {});
  } else if (type === "session_completed") {
    void notify({
      title: "AgentBridge task completed",
      body: `${agent} finished work in ${project}.`,
      tag: `completed:${session.id}`,
      data: { url: `/?session=${encodeURIComponent(session.id)}`, sessionId: session.id, event: type },
    }).catch(() => {});
  } else if (type === "agent_error") {
    void notify({
      title: "AgentBridge task failed",
      body: `${agent} needs attention in ${project}.`,
      tag: `failed:${session.id}`,
      data: { url: `/?session=${encodeURIComponent(session.id)}`, sessionId: session.id, event: type },
    }).catch(() => {});
  }
}

function notifyTaskEvent(type, task) {
  if (type !== "task:finished" || !task || task.status === "cancelled") return;
  const failed = task.status === "failed";
  void notify({
    title: failed ? "AgentBridge task failed" : "AgentBridge task completed",
    body: `${task.agentType || "Agent"} ${failed ? "needs attention" : "finished"} in ${task.projectName || "your project"}.`,
    tag: `${failed ? "failed" : "completed"}:task:${task.id}`,
    data: { url: "/", taskId: task.id, event: type },
  }).catch(() => {});
}

module.exports = {
  init,
  close,
  getPublicKey,
  getStatus,
  saveSubscription,
  removeSubscription,
  notify,
  notifySessionEvent,
  notifyTaskEvent,
};
