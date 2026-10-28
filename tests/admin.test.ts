import test from "node:test";
import assert from "node:assert/strict";
import { createApi, hash } from "../server/api.ts";
import { sqliteStore } from "../server/sqlite.ts";
import { adminDictionaries } from "../src/admin/messages.ts";
const origin = "https://game.test",
  password = "test-only-administrator-password";
function fixture(config: string | undefined = password) {
  const store = sqliteStore(":memory:");
  let now = 1_800_000_000_000;
  let api = createApi(store, origin, () => now, config);
  let cookie = "",
    csrf = "";
  async function call(
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
    ip = "admin-test",
  ) {
    const response = await api(
      new Request(origin + path, {
        method,
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: cookie,
          "X-Admin-CSRF": csrf,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      ip,
    );
    return {
      status: response.status,
      body: await response.json(),
      headers: response.headers,
    };
  }
  async function login() {
    const r = await call("/api/admin/login", "POST", { password });
    assert.equal(r.status, 200);
    cookie = r.headers.get("Set-Cookie")!.split(";")[0];
    csrf = r.body.csrf;
    return r;
  }
  const player = {
    id: crypto.randomUUID(),
    name: "原名",
    avatar: "shirakami-fubuki",
    best: 20680,
    best_at: now - 1000,
    created: now - 86_400_000,
  };
  async function seed() {
    store.query(
      "INSERT INTO players(id,token_hash,name,avatar,best,best_at,created) VALUES (?,?,?,?,?,?,?)",
      player.id,
      await hash("a".repeat(64)),
      player.name,
      player.avatar,
      player.best,
      player.best_at,
      player.created,
    );
  }
  return {
    store,
    call,
    login,
    player,
    seed,
    advance: (ms: number) => (now += ms),
    restart: (next = config) => {
      api = createApi(store, origin, () => now, next);
    },
    setCookie: (s: string) => (cookie = s),
  };
}
test("admin authentication is separate, secure, revocable and disabled without configuration", async () => {
  const f = fixture();
  try {
    await f.seed();
    for (const path of ["overview", "players", "audit"])
      assert.equal(
        (
          await f.call(`/api/admin/${path}`, "GET", undefined, {
            Authorization: `Bearer ${"a".repeat(64)}`,
          })
        ).status,
        401,
      );
    assert.equal(
      (await f.call("/api/admin/login", "POST", { password: "wrong" })).body
        .code,
      "invalidPassword",
    );
    const login = await f.login();
    assert.match(
      login.headers.get("set-cookie")!,
      /__Host-holo-admin=.*HttpOnly; SameSite=Strict; Max-Age=43200; Secure/,
    );
    assert.equal((await f.call("/api/admin/session")).status, 200);
    assert.equal(
      (await f.call("/api/admin/logout", "POST", {}, { "X-Admin-CSRF": "" }))
        .body.code,
      "csrf",
    );
    assert.equal(
      (
        await f.call(
          "/api/admin/logout",
          "POST",
          {},
          { Origin: "https://evil.test" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await f.call("/api/admin/logout", "POST", {}, { Origin: "null" }))
        .status,
      403,
    );
    assert.equal((await f.call("/api/admin/logout", "POST", {})).status, 200);
    assert.equal((await f.call("/api/admin/session")).status, 401);
    await f.login();
    f.restart(password + "-rotated");
    assert.equal((await f.call("/api/admin/session")).status, 401);
    f.restart();
    await f.login();
    f.advance(12 * 3600_000);
    assert.equal((await f.call("/api/admin/session")).status, 401);
    f.restart("");
    assert.equal((await f.call("/api/admin/overview")).status, 503);
  } finally {
    f.store.close();
  }
});
test("admin login rate limits persist across restarts and do not block game requests", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 10; i++)
      assert.equal(
        (await f.call("/api/admin/login", "POST", { password: "wrong" }))
          .status,
        401,
      );
    f.restart();
    assert.equal(
      (await f.call("/api/admin/login", "POST", { password })).status,
      429,
    );
    assert.equal((await f.call("/api/leaderboard")).status, 200);
    f.advance(15 * 60_000);
    await f.login();
  } finally {
    f.store.close();
  }
});
test("admin edits and resets are validated, atomic, audited and visible on the public leaderboard", async () => {
  const f = fixture();
  try {
    await f.seed();
    await f.login();
    const list = await f.call("/api/admin/players");
    const before = list.body.players[0];
    assert.equal(before.rank, 1);
    assert.equal(list.body.total, 1);
    assert.equal("token_hash" in before, false);
    const body = {
      action: "edit",
      name: "新版名称",
      avatar: "nakiri-ayame",
      best: 23000,
      reason: "纠正成绩",
      expected: before,
    };
    const url = `/api/admin/players/${before.id}`;
    assert.equal(
      (await f.call(url, "PATCH", { ...body, reason: "" })).body.code,
      "invalidReason",
    );
    assert.equal(
      (await f.call(url, "PATCH", { ...body, best: -1 })).body.code,
      "invalidScore",
    );
    assert.equal(
      (
        await f.call(url, "PATCH", {
          ...body,
          avatar: "https://evil.test/a.png",
        })
      ).body.code,
      "invalidAvatar",
    );
    assert.equal(
      (await f.call(url, "PATCH", { ...body, name: "<script>" })).body.code,
      "invalidName",
    );
    assert.equal(
      (await f.call(url, "PATCH", { ...body, best: 0.5 })).body.code,
      "invalidScore",
    );
    assert.equal((await f.call(url, "PATCH", body)).status, 200);
    const publicBoard = await f.call("/api/leaderboard");
    assert.deepEqual(publicBoard.body.entries[0], {
      id: before.id,
      name: body.name,
      avatar: body.avatar,
      score: 23000,
      rank: 1,
    });
    assert.equal((await f.call(url, "PATCH", body)).body.code, "conflict");
    let audit = await f.call("/api/admin/audit");
    assert.equal(audit.body.total, 1);
    assert.equal(JSON.parse(audit.body.entries[0].before_json).best, 20680);
    assert.equal(JSON.parse(audit.body.entries[0].after_json).best, 23000);
    assert.equal(audit.body.entries[0].reason, "纠正成绩");
    assert.doesNotMatch(
      JSON.stringify(audit.body),
      /token_hash|credential|csrf/,
    );
    const expected = (await f.call("/api/admin/players")).body.players[0];
    f.store.query("UPDATE players SET best=25000 WHERE id=?", expected.id);
    assert.equal(
      (await f.call(url, "PATCH", { ...body, expected })).status,
      409,
    );
    const current = (await f.call("/api/admin/players")).body.players[0];
    const reset = {
      action: "reset",
      name: current.name,
      avatar: current.avatar,
      best: 0,
      reason: "移除记录",
      expected: current,
    };
    f.store.query(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON admin_audit BEGIN SELECT RAISE(ABORT,'test rollback'); END",
    );
    assert.equal((await f.call(url, "PATCH", reset)).status, 500);
    assert.equal(
      f.store.query("SELECT best FROM players WHERE id=?", current.id)[0].best,
      25000,
    );
    f.store.query("DROP TRIGGER fail_audit");
    assert.equal((await f.call(url, "PATCH", reset)).status, 200);
    assert.equal((await f.call("/api/leaderboard")).body.entries.length, 0);
    assert.equal(
      (await f.call("/api/admin/players?filter=unranked")).body.players[0].rank,
      null,
    );
    assert.equal(
      (
        await f.call(
          "/api/runs",
          "POST",
          {},
          { Authorization: `Bearer ${"a".repeat(64)}` },
        )
      ).status,
      200,
    );
    audit = await f.call("/api/admin/audit");
    assert.equal(audit.body.total, 2);
  } finally {
    f.store.close();
  }
});
test("overview uses current database records and only measures server-observed activity after installation", async () => {
  const f = fixture();
  try {
    await f.seed();
    await f.login();
    let overview = (await f.call("/api/admin/overview")).body;
    assert.equal(overview.totals.players, 1);
    assert.equal(overview.totals.ranked, 1);
    assert.equal(overview.totals.highest, 20680);
    assert.equal(overview.days.length, 14);
    assert.equal(overview.days[0].started, null);
    assert.equal(overview.days.at(-1).started, 0);
    assert.equal(overview.days.at(-2).players, 1);
    assert.equal(overview.period.started, 0);
    const since = overview.metricsSince;
    const headers = { Authorization: `Bearer ${"a".repeat(64)}` };
    const run = await f.call("/api/runs", "POST", {}, headers);
    assert.equal(run.status, 200);
    assert.deepEqual(Object.keys(run.body).sort(), [
      "expires",
      "id",
      "seed",
      "version",
    ]);
    assert.equal(
      (
        await f.call(
          "/api/scores",
          "POST",
          {
            run: run.body.id,
            replay: { version: 1, ticks: 0, drops: [[0, 220]] },
            score: 999999,
          },
          headers,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.call(
          "/api/scores",
          "POST",
          { run: run.body.id, replay: {} },
          headers,
        )
      ).status,
      409,
    );
    overview = (await f.call("/api/admin/overview")).body;
    assert.equal(overview.period.started, 1);
    assert.equal(overview.period.accepted, 1);
    assert.equal(overview.period.rejected, 1);
    assert.equal(overview.period.averageScore, 0);
    assert.equal(overview.totals.highest, 20680);
    assert.equal(overview.distribution.at(-1).count, 1);
    f.advance(2 * 86_400_000);
    f.restart();
    await f.login();
    overview = (await f.call("/api/admin/overview")).body;
    assert.equal(overview.metricsSince, since);
    assert.equal(overview.period.started, 1);
    assert.equal(overview.days.at(-1).started, 0);
    assert.equal(overview.totals.outstanding, 0);
  } finally {
    f.store.close();
  }
});
test("admin pagination, literal search, ranking and dictionaries are complete", async () => {
  const f = fixture();
  try {
    await f.seed();
    for (let i = 0; i < 30; i++)
      f.store.query(
        "INSERT INTO players(id,token_hash,name,avatar,best,best_at,created) VALUES (?,?,?,?,?,?,?)",
        crypto.randomUUID(),
        `hash-${i}`,
        `Player ${i}`,
        "shirakami-fubuki",
        i * 100,
        100 + i,
        100,
      );
    await f.login();
    const second = (await f.call("/api/admin/players?page=2")).body;
    assert.equal(second.total, 30);
    assert.equal(second.players.length, 5);
    assert.equal(second.players[0].rank, 26);
    assert.equal(
      (await f.call("/api/admin/players?filter=all&search=%25")).body.total,
      0,
    );
    assert.equal(
      (await f.call("/api/admin/players?search=" + f.player.id)).body.players[0]
        .rank,
      1,
    );
    assert.equal((await f.call("/api/admin/players?page=-1")).status, 400);
    assert.equal((await f.call("/api/admin/players?filter=bad")).status, 400);
    for (const dictionary of Object.values(adminDictionaries)) {
      assert.deepEqual(
        Object.keys(dictionary).sort(),
        Object.keys(adminDictionaries["zh-CN"]).sort(),
      );
      for (const value of Object.values(dictionary)) assert.ok(value.trim());
    }
  } finally {
    f.store.close();
  }
});
