import { getWebSocketUrl } from "./api.js";

export function connectWebSocket(onMessage) {
  const ws = new WebSocket(getWebSocketUrl());

  ws.onmessage = (event) => {
    try {
      onMessage(JSON.parse(event.data));
    } catch {
      // ignore malformed messages
    }
  };

  ws.onerror = () => {
    onMessage({ type: "error", message: "WebSocket connection error" });
  };

  return ws;
}
