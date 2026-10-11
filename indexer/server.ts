/**
 * Trisara Indexer Server — serves chain state over HTTP.
 *
 * Wraps poller.ts: polls every 60s in the background, serves the latest
 * snapshot at GET /state. Deploy as a Render Web Service.
 *
 * Endpoints:
 *   GET /state   full snapshot (schemaVersion, ts, chains)
 *   GET /health  service status
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const PORT = parseInt(process.env.PORT || "10000", 10);

// Import poller logic by running it as a child process is overkill;
// instead we poll inline using the same module.
async function startPolling() {
  const { spawn } = await import("node:child_process");
  const poller = spawn("npx", ["tsx", "poller.ts"], { stdio: "inherit" });
  poller.on("exit", (code) => {
    console.error(`poller exited with code ${code}, restarting in 10s`);
    setTimeout(startPolling, 10_000);
  });
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, service: "trisara-indexer" }));
    return;
  }

  if (req.url === "/state" || req.url === "/") {
    try {
      const body = await readFile("state/latest.json", "utf8");
      res.writeHead(200);
      res.end(body);
    } catch {
      res.writeHead(503);
      res.end(JSON.stringify({ error: "no snapshot yet, poller warming up" }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`indexer server on :${PORT}`);
  startPolling();
});
