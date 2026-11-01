// Request sequencing of the ranked-round client, with fake fetch and storage.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

type Handler = (method: string, path: string) => [number, unknown];
let calls: string[] = [];
let handler: Handler;
let runs = 0;
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
  },
});
globalThis.fetch = (async (input: string, init?: RequestInit) => {
  const method = init?.method || "GET";
  const path = new URL(input, "http://test").pathname;
  calls.push(`${method} ${path}`);
  const [status, body] = handler(method, path);
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

const board = { entries: [], me: { id: "p", name: "P", avatar: "azki", score: 0, rank: null } };
const session = (lifetime = 6 * 3_600_000) => ({
  id: `run-${++runs}`,
  seed: runs,
  version: 1,
  expires: Date.now() + lifetime,
});
/** A backend where this browser's identity is already registered. */
const registered: Handler = (method, path) =>
  path === "/api/leaderboard"
    ? [200, board]
    : path === "/api/runs"
      ? [200, session()]
      : [404, {}];
let instance = 0;
/** Module state (prefetch, registration cache) starts fresh in every test. */
const freshClient = () =>
  import(`../src/leaderboard-client.ts?instance=${++instance}`) as Promise<
    typeof import("../src/leaderboard-client.ts")
  >;
beforeEach(() => {
  calls = [];
  store.clear();
  handler = registered;
});

test("a new identity registers once; later rounds need a single request", async () => {
  let known = false;
  handler = (method, path) => {
    if (path === "/api/players" && method === "POST") {
      known = true;
      return [200, { id: "p" }];
    }
    if (path === "/api/leaderboard")
      return [200, known ? board : { ...board, me: null }];
    return registered(method, path);
  };
  const client = await freshClient();
  await client.beginRankedRun();
  assert.deepEqual(calls, [
    "GET /api/leaderboard",
    "POST /api/players",
    "GET /api/leaderboard",
    "POST /api/runs",
  ]);
  calls = [];
  await client.beginRankedRun();
  assert.deepEqual(calls, ["POST /api/runs"]);
  // The cached flag survives a reload (new module instance, same storage).
  calls = [];
  await (await freshClient()).beginRankedRun();
  assert.deepEqual(calls, ["POST /api/runs"]);
});

test("an identity the server forgot is registered again once", async () => {
  const client = await freshClient();
  await client.beginRankedRun();
  let forgotten = true;
  handler = (method, path) => {
    if (path === "/api/runs" && forgotten)
      return [401, { code: "identityExpired", error: "expired" }];
    if (path === "/api/leaderboard") {
      forgotten = false;
      return [200, board];
    }
    return registered(method, path);
  };
  calls = [];
  const run = await client.beginRankedRun();
  assert.ok(run.id);
  assert.deepEqual(calls, [
    "POST /api/runs",
    "GET /api/leaderboard",
    "POST /api/runs",
  ]);
});

test("other errors are reported without retrying", async () => {
  const client = await freshClient();
  await client.beginRankedRun();
  handler = () => [429, { code: "rateLimited", error: "slow down" }];
  calls = [];
  await assert.rejects(client.beginRankedRun(), { status: 429 });
  assert.deepEqual(calls, ["POST /api/runs"]);
});

test("a prefetched seed is used once, without another request", async () => {
  const client = await freshClient();
  await client.beginRankedRun();
  calls = [];
  client.prefetchRankedRun();
  client.prefetchRankedRun(); // repeated renders do not prefetch twice
  const prefetched = await client.takeRankedRun();
  assert.deepEqual(calls, ["POST /api/runs"]);
  const next = await client.takeRankedRun();
  assert.notEqual(next.id, prefetched.id, "a seed is never reused");
  assert.deepEqual(calls, ["POST /api/runs", "POST /api/runs"]);
});

test("a prefetched seed close to expiry or a failed prefetch falls back to a new request", async () => {
  const client = await freshClient();
  await client.beginRankedRun();
  handler = (method, path) =>
    path === "/api/runs" ? [200, session(60_000)] : registered(method, path);
  calls = [];
  client.prefetchRankedRun(); // the request starts immediately
  handler = registered;
  const fresh = await client.takeRankedRun();
  assert.ok(fresh.expires - Date.now() > 3_600_000);
  assert.deepEqual(calls, ["POST /api/runs", "POST /api/runs"]);

  handler = () => [503, {}];
  client.prefetchRankedRun();
  await new Promise((resolve) => setTimeout(resolve, 0));
  handler = registered;
  calls = [];
  const retried = await client.takeRankedRun();
  assert.ok(retried.id);
});
