import { groups, WIDTH } from "../src/game/model.ts";
import {
  MAX_DROPS,
  MAX_TICKS,
  RULES_VERSION,
  type Replay,
} from "../src/game/replay.ts";
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
const avatars = new Set(groups.flatMap((g) => g.members.map((m) => m.id)));
const MAX_BODY = 160_000;
const RUN_LIFETIME = 6 * 60 * 60 * 1000;
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(status: number, message: string): never {
  throw new ApiError(status, message);
}
export async function hash(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
function profile(body: Record<string, unknown>) {
  if (typeof body.name !== "string" || typeof body.avatar !== "string")
    fail(400, "请输入名称并选择头像。");
  const name = body.name.normalize("NFKC").trim();
  if ([...name].length < 1 || [...name].length > 16 || /[\p{C}<>]/u.test(name))
    fail(400, "名称须为 1–16 个字，不能包含控制符或尖括号。");
  if (!avatars.has(body.avatar)) fail(400, "请选择已有角色头像。");
  return { name, avatar: body.avatar };
}
// Validates the entire command stream BEFORE doing any physics work.
export function validateReplay(value: unknown, elapsed: number): Replay {
  const replay = value as Replay;
  if (
    !replay ||
    replay.version !== RULES_VERSION ||
    !Number.isSafeInteger(replay.ticks) ||
    replay.ticks < 0 ||
    replay.ticks > MAX_TICKS ||
    !Array.isArray(replay.drops) ||
    !replay.drops.length ||
    replay.drops.length > MAX_DROPS
  )
    fail(400, "对局记录不符合当前规则或超出计分时长。");
  if (replay.ticks * STEP_MS > elapsed + 1500) fail(400, "对局计时异常。");
  let previous = -46;
  for (const command of replay.drops) {
    if (!Array.isArray(command) || command.length !== 2)
      fail(400, "投放记录无效。");
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
      fail(400, "投放位置或频率异常。");
    previous = tick;
  }
  return replay;
}
export function replayScore(seed: number, replay: Replay) {
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
        if (simulation.state.over) fail(400, "游戏结束后的记录无效。");
        simulation.advance();
        tick++;
      }
      simulation.setAim(x);
      if (!simulation.drop()) fail(400, "投放记录无法回放。");
      if (simulation.orbs.size > 180) fail(400, "棋盘数量异常。");
    }
    while (tick < replay.ticks) {
      if (simulation.state.over) fail(400, "游戏结束后的记录无效。");
      simulation.advance();
      tick++;
    }
    return simulation.state.score;
  } finally {
    simulation.destroy();
  }
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    fail(415, "请使用 JSON 请求。");
  if (Number(request.headers.get("content-length")) > MAX_BODY)
    fail(413, "请求过大。");
  const reader = request.body?.getReader();
  if (!reader) fail(400, "缺少请求内容。");
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY) {
      await reader.cancel();
      fail(413, "请求过大。");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail(400, "请求内容无效。");
    return value;
  } catch {
    return fail(400, "请求内容无效。");
  }
}
export function createApi(store: Store, origin?: string, clock = Date.now) {
  for (const sql of SCHEMA) store.query(sql);
  function limit(key: string, max: number, duration: number, now: number) {
    const row = store.query(
      "SELECT count, reset FROM rate_limits WHERE key = ?",
      key,
    )[0];
    if (row && Number(row.reset) > now && Number(row.count) >= max)
      fail(429, "操作过于频繁，请稍后再试。");
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
        fail(403, "不允许来自此站点的请求。");
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
      if (player)
        store.transaction(() => {
          if (route === "/api/runs")
            limit(`runs:${player.id}`, 60, 3_600_000, now);
          if (route === "/api/scores")
            limit(`submit:${player.id}`, 20, 60_000, now);
        });
      const data = store.transaction(() => {
        if (route === "/api/leaderboard" && request.method === "GET")
          return listing(player);
        if (route === "/api/players" && request.method === "POST") {
          const { name, avatar } = profile(body);
          const id = crypto.randomUUID();
          const token = body.token;
          // Client-generated random capability; never accept a caller-selected player ID.
          if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
            fail(400, "玩家凭证无效。");
          if (
            store.query(
              "SELECT id FROM players WHERE token_hash = ?",
              registrationHash,
            )[0]
          )
            fail(409, "玩家凭证已存在。请使用原有凭证。");
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
        if (!player) fail(401, "玩家凭证已失效，请重新创建玩家。");
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
          return {
            id,
            seed,
            version: RULES_VERSION,
            maxTicks: MAX_TICKS,
            expires: now + RUN_LIFETIME,
          };
        }
        if (route === "/api/scores" && request.method === "POST") {
          if (typeof body.run !== "string") fail(400, "缺少对局凭证。");
          const run = store.query(
            "SELECT * FROM runs WHERE id = ? AND player_id = ?",
            body.run,
            player.id,
          )[0];
          if (!run) fail(404, "对局不存在或已过期。");
          if (run.used) fail(409, "本局成绩已提交。");
          const replay = validateReplay(body.replay, now - Number(run.created));
          const score = replayScore(Number(run.seed), replay);
          store.query("UPDATE runs SET used = 1 WHERE id = ?", run.id);
          if (score > Number(player.best))
            store.query(
              "UPDATE players SET best = ?, best_at = ? WHERE id = ?",
              score,
              now,
              player.id,
            );
          return {
            ...listing(player),
            acceptedScore: score,
            improved: score > Number(player.best),
          };
        }
        return fail(404, "接口不存在。");
      });
      return new Response(JSON.stringify(data), { headers });
    } catch (error) {
      if (!(error instanceof ApiError))
        console.error(
          "Leaderboard request failed",
          error instanceof Error ? error.message : "unknown",
        );
      const status = error instanceof ApiError ? error.status : 500;
      return new Response(
        JSON.stringify({
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
