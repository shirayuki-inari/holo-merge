import { ApiError, fail, hash, profile, readBody } from "./http.ts";
export { hash } from "./http.ts";
import { ADMIN_SCHEMA, createAdmin } from "./admin.ts";
import { initializeMetrics, recordMetric } from "./metrics.ts";
import { WIDTH } from "../src/game/model.ts";
import { MAX_DROPS, RULES_VERSION, type Replay } from "../src/game/replay.ts";
import { Simulation, STEP_MS } from "../src/game/simulation.ts";

export type Row = Record<string, string | number | null>;
export interface Store {
  query(sql: string, ...args: (string | number | null)[]): Row[];
  transaction<T>(callback: () => T): T;
}
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, avatar TEXT NOT NULL, best INTEGER NOT NULL DEFAULT 0, best_at INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS ranking ON players(best DESC, best_at ASC, id ASC)`,
  `CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, seed INTEGER NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS run_expiry ON runs(expires)`,
  `CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL)`,
];
const RUN_LIFETIME = 6 * 60 * 60 * 1000;
// Validates the entire command stream BEFORE doing any physics work.
export function validateReplay(value: unknown, elapsed: number): Replay {
  const replay = value as Replay;
  if (
    !replay ||
    replay.version !== RULES_VERSION ||
    !Number.isSafeInteger(replay.ticks) ||
    replay.ticks < 0 ||
    !Array.isArray(replay.drops) ||
    !replay.drops.length ||
    replay.drops.length > MAX_DROPS
  )
    fail(400, "invalidReplay");
  if (replay.ticks * STEP_MS > elapsed + 1500) fail(400, "invalidTiming");
  let previous = -46;
  for (const command of replay.drops) {
    if (!Array.isArray(command) || command.length !== 2)
      fail(400, "invalidDrop");
    const [tick, x] = command;
    if (
      !Number.isSafeInteger(tick) ||
      tick < 0 ||
      tick > replay.ticks ||
      tick - previous < 46 ||
      !Number.isFinite(x) ||
      x < 0 ||
      x > WIDTH
    )
      fail(400, "invalidDropRate");
    previous = tick;
  }
  return replay;
}
export async function replayScore(seed: number, replay: Replay) {
  const simulation = new Simulation({
    seed,
    onChange() {},
    onMerge() {},
    onEnd() {},
    onWin() {},
  });
  let tick = 0;
  try {
    for (const [at, x] of replay.drops) {
      while (tick < at) {
        if (simulation.state.over) fail(400, "afterGameOver");
        simulation.advance();
        tick++;
        // Yield between bounded batches; never hold a SQLite transaction here.
        if (tick % 2048 === 0)
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      simulation.setAim(x);
      if (!simulation.drop()) fail(400, "replayFailed");
      if (simulation.orbs.size > 180) fail(400, "invalidBoard");
    }
    while (tick < replay.ticks) {
      if (simulation.state.over) fail(400, "afterGameOver");
      simulation.advance();
      tick++;
      if (tick % 2048 === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return simulation.state.score;
  } finally {
    simulation.destroy();
  }
}
export function createApi(
  store: Store,
  origin?: string,
  clock = Date.now,
  adminPassword?: string,
) {
  for (const sql of [...SCHEMA, ...ADMIN_SCHEMA]) store.query(sql);
  initializeMetrics(store, clock());
  const admin = createAdmin(store, origin, clock, adminPassword);
  const verifying = new Set<string>();
  function limit(key: string, max: number, duration: number, now: number) {
    const row = store.query(
      "SELECT count, reset FROM rate_limits WHERE key = ?",
      key,
    )[0];
    if (row && Number(row.reset) > now && Number(row.count) >= max)
      fail(429, "rateLimited");
    store.query(
      "INSERT INTO rate_limits(key, count, reset) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN reset <= ? THEN 1 ELSE count + 1 END, reset = CASE WHEN reset <= ? THEN excluded.reset ELSE reset END",
      key,
      now + duration,
      now,
      now,
    );
  }
  function listing(player?: Row) {
    const rows = store.query(
      "SELECT id, name, avatar, best AS score FROM players WHERE best > 0 ORDER BY best DESC, best_at ASC, id ASC LIMIT 50",
    );
    const entries = rows.map((p, i) => ({ ...p, rank: i + 1 }));
    let me = null;
    if (player) {
      const row = store.query(
        "SELECT * FROM players WHERE id = ?",
        player.id,
      )[0];
      const rank =
        Number(row.best) > 0
          ? Number(
              store.query(
                "SELECT COUNT(*) AS n FROM players WHERE best > ? OR (best = ? AND (best_at < ? OR (best_at = ? AND id < ?)))",
                row.best,
                row.best,
                row.best_at,
                row.best_at,
                row.id,
              )[0].n,
            ) + 1
          : null;
      me = {
        id: row.id,
        name: row.name,
        avatar: row.avatar,
        score: row.best,
        rank,
      };
    }
    return { entries, me };
  }
  return async (request: Request, ip: string): Promise<Response> => {
    if (new URL(request.url).pathname.startsWith("/api/admin"))
      return admin(request, ip);
    let submissionPlayer = false;
    const allowedOrigin = origin || new URL(request.url).origin;
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    };
    if (request.headers.get("Origin") === allowedOrigin)
      headers["Access-Control-Allow-Origin"] = allowedOrigin;
    try {
      if (
        request.headers.has("Origin") &&
        request.headers.get("Origin") !== allowedOrigin
      )
        fail(403, "originDenied");
      if (request.method === "OPTIONS")
        return new Response(null, {
          status: 204,
          headers: {
            ...headers,
            "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Max-Age": "600",
          },
        });
      const route = new URL(request.url).pathname;
      const bearer = request.headers
        .get("Authorization")
        ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      const tokenHash = bearer ? await hash(bearer) : null;
      const ipHash = await hash(ip);
      const now = clock();
      store.transaction(() => {
        store.query("DELETE FROM rate_limits WHERE reset <= ?", now);
        store.query("DELETE FROM runs WHERE expires <= ?", now);
        limit(`ip:${ipHash}`, 240, 60_000, now);
        if (request.method !== "GET")
          limit(`write:${ipHash}`, 120, 60_000, now);
        if (route === "/api/players" && request.method === "POST")
          limit(`signup:${ipHash}`, 30, 3_600_000, now);
      });
      const body = ["POST", "PATCH"].includes(request.method)
        ? await readBody(request)
        : {};
      const registrationHash =
        route === "/api/players" &&
        request.method === "POST" &&
        typeof body.token === "string"
          ? await hash(body.token)
          : null;
      const player = tokenHash
        ? store.query(
            "SELECT * FROM players WHERE token_hash = ?",
            tokenHash,
          )[0]
        : undefined;
      submissionPlayer =
        !!player && route === "/api/scores" && request.method === "POST";
      if (player)
        store.transaction(() => {
          if (route === "/api/runs")
            limit(`runs:${player.id}`, 60, 3_600_000, now);
          if (route === "/api/scores")
            limit(`submit:${player.id}`, 20, 60_000, now);
        });
      let verifiedScore: number | undefined;
      if (route === "/api/scores" && request.method === "POST") {
        if (!player) fail(401, "identityExpired");
        if (typeof body.run !== "string") fail(400, "runRequired");
        const run = store.query(
          "SELECT * FROM runs WHERE id = ? AND player_id = ?",
          body.run,
          player.id,
        )[0];
        if (!run) fail(404, "runExpired");
        if (run.used) fail(409, "alreadySubmitted");
        const replay = validateReplay(body.replay, now - Number(run.created));
        if (verifying.has(String(player.id))) fail(429, "verificationBusy");
        verifying.add(String(player.id));
        try {
          verifiedScore = await replayScore(Number(run.seed), replay);
        } finally {
          verifying.delete(String(player.id));
        }
      }
      const data = store.transaction(() => {
        if (route === "/api/leaderboard" && request.method === "GET")
          return listing(player);
        if (route === "/api/players" && request.method === "POST") {
          const { name, avatar } = profile(body);
          const id = crypto.randomUUID();
          const token = body.token;
          // Client-generated random capability; never accept a caller-selected player ID.
          if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
            fail(400, "invalidToken");
          if (
            store.query(
              "SELECT id FROM players WHERE token_hash = ?",
              registrationHash,
            )[0]
          )
            fail(409, "identityExists");
          store.query(
            "INSERT INTO players(id, token_hash, name, avatar, created) VALUES (?, ?, ?, ?, ?)",
            id,
            registrationHash,
            name,
            avatar,
            now,
          );
          return { id };
        }
        if (!player) fail(401, "identityExpired");
        if (route === "/api/player" && request.method === "PATCH") {
          const { name, avatar } = profile(body);
          store.query(
            "UPDATE players SET name = ?, avatar = ? WHERE id = ?",
            name,
            avatar,
            player.id,
          );
          return listing(player);
        }
        if (route === "/api/runs" && request.method === "POST") {
          // Only three recent outstanding sessions per identity (e.g. multiple tabs).
          const active = store.query(
            "SELECT id FROM runs WHERE player_id = ? AND used = 0 ORDER BY created DESC",
            player.id,
          );
          for (const row of active.slice(2))
            store.query("DELETE FROM runs WHERE id = ?", row.id);
          const id = crypto.randomUUID(),
            seed = crypto.getRandomValues(new Uint32Array(1))[0];
          store.query(
            "INSERT INTO runs(id, player_id, seed, created, expires) VALUES (?, ?, ?, ?, ?)",
            id,
            player.id,
            seed,
            now,
            now + RUN_LIFETIME,
          );
          recordMetric(store, now, "started");
          return {
            id,
            seed,
            version: RULES_VERSION,
            expires: now + RUN_LIFETIME,
          };
        }
        if (route === "/api/scores" && request.method === "POST") {
          if (typeof body.run !== "string") fail(400, "runRequired");
          const run = store.query(
            "SELECT * FROM runs WHERE id = ? AND player_id = ?",
            body.run,
            player.id,
          )[0];
          if (!run || Number(run.expires) <= clock()) fail(404, "runExpired");
          if (run.used) fail(409, "alreadySubmitted");
          const score = verifiedScore!;
          const previousBest = Number(
            store.query("SELECT best FROM players WHERE id = ?", player.id)[0]
              .best,
          );
          store.query("UPDATE runs SET used = 1 WHERE id = ?", run.id);
          if (score > previousBest)
            store.query(
              "UPDATE players SET best = ?, best_at = ? WHERE id = ?",
              score,
              now,
              player.id,
            );
          recordMetric(store, clock(), "accepted", score);
          return {
            ...listing(player),
            acceptedScore: score,
            improved: score > previousBest,
          };
        }
        return fail(404, "notFound");
      });
      return new Response(JSON.stringify(data), { headers });
    } catch (error) {
      if (submissionPlayer) {
        try {
          store.transaction(() => recordMetric(store, clock(), "rejected"));
        } catch {
          console.error("Unable to record submission metric");
        }
      }
      if (!(error instanceof ApiError))
        console.error(
          "Leaderboard request failed",
          error instanceof Error ? error.message : "unknown",
        );
      const status = error instanceof ApiError ? error.status : 500;
      return new Response(
        JSON.stringify({
          code: error instanceof ApiError ? error.code : "unavailable",
          error:
            error instanceof ApiError
              ? error.message
              : "排行榜暂时不可用，请稍后重试。",
        }),
        {
          status,
          headers: {
            ...headers,
            ...(status === 429 ? { "Retry-After": "60" } : {}),
          },
        },
      );
    }
  };
}
