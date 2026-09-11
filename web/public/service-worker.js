self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(payload.title || "AgentBridge", {
    body: payload.body || "AgentBridge has an update.",
    icon: "/favicon.png",
    badge: "/favicon.png",
    tag: payload.tag || "agentbridge",
    data: payload.data || { url: "/" },
    renotify: true,
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) return existing.focus();
    return clients.openWindow(url);
  }));
});
