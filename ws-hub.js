const WebSocket = require("ws");

const PORT = 8765;
const wss = new WebSocket.Server({ port: PORT });

console.log(`WS hub running on ws://127.0.0.1:${PORT}`);

wss.on("connection", (ws, req) => {
  console.log("Client connected:", req.socket.remoteAddress);

  ws.send(JSON.stringify({
    type: "hub",
    ok: true,
    ts: Date.now()
  }));

  ws.on("message", (data) => {
    const text = data.toString();
    console.log("Message in:", text.slice(0, 200));

    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(text);
      }
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});
