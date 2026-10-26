import { createServer } from "node:http";
import { Readable } from "node:stream";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createApi } from "./api.ts";
import { sqliteStore } from "./sqlite.ts";
const filename = process.env.DATABASE_PATH || "data/leaderboard.sqlite";
mkdirSync(dirname(filename), { recursive: true });
const store = sqliteStore(filename);
const handler = createApi(
  store,
  process.env.PUBLIC_ORIGIN || "http://localhost:5173",
);
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
const server = createServer(
  { requestTimeout: 15_000, headersTimeout: 10_000, maxHeaderSize: 8192 },
  async (req, res) => {
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (value)
          headers.set(key, Array.isArray(value) ? value.join(",") : value);
      const init: RequestInit & { duplex?: string } = {
        method: req.method,
        headers,
      };
      if (req.method !== "GET" && req.method !== "HEAD") {
        init.body = Readable.toWeb(req) as ReadableStream;
        init.duplex = "half";
      }
      // URL origin is configured, never inferred from an attacker-controlled Host header.
      const request = new Request(
        `${process.env.PUBLIC_ORIGIN || `http://localhost:${port}`}${req.url}`,
        init,
      );
      // Enable only behind a trusted proxy that OVERWRITES this header; do not trust X-Forwarded-For.
      const ip =
        process.env.TRUST_PROXY === "1" &&
        typeof req.headers["x-real-ip"] === "string"
          ? req.headers["x-real-ip"]
          : req.socket.remoteAddress || "unknown";
      const response = await handler(request, ip);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end('{"error":"请求无效。"}');
    }
  },
);
server.listen(port, host, () =>
  console.log(`Leaderboard listening on http://${host}:${port}`),
);
function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
