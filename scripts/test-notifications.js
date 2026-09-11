const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentbridge-push-"));
process.env.AGENTBRIDGE_DATA_DIR = temporaryRoot;

const notifications = require("../server/services/notificationService");

try {
  const publicKey = notifications.getPublicKey();
  assert.ok(publicKey.length > 20);

  const subscription = {
    endpoint: "https://push.example.test/subscription-1",
    keys: { p256dh: "test-public-key", auth: "test-auth-key" },
  };
  notifications.saveSubscription(subscription);
  assert.equal(notifications.getStatus().subscriptionCount, 1);
  assert.equal(notifications.removeSubscription(subscription.endpoint), true);
  assert.equal(notifications.getStatus().subscriptionCount, 0);
  console.log("notification tests passed");
} finally {
  notifications.close();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
