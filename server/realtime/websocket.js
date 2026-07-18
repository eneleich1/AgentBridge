const clients = new Set();

function registerClient(socket) {
  clients.add(socket);
  socket.on("close", () => {
    clients.delete(socket);
  });
}

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    try {
      client.send(payload);
    } catch {
      clients.delete(client);
    }
  }
}

module.exports = {
  registerClient,
  broadcast,
};
