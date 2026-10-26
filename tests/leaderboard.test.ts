import test from "node:test";
import assert from "node:assert/strict";
import { createApi, hash, replayScore, validateReplay } from "../server/api.ts";
import { sqliteStore } from "../server/sqlite.ts";
import { Simulation } from "../src/game/simulation.ts";
import { MAX_TICKS } from "../src/game/replay.ts";
import { groups } from "../src/game/model.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const avatar = groups[0].members[0].id;
function recorded(seed: number, count = 12) {
  const game = new Simulation({
    seed,
    onChange() {},
    onMerge() {},
    onWin() {},
    onEnd() {},
  });
  for (let i = 0; i < count; i++) {
    game.setAim(220);
    assert.equal(game.drop(), true);
    for (let t = 0; t < 110; t++) game.advance();
  }
  const result = { replay: game.replay(), score: game.state.score };
  game.destroy();
  return result;
}
function fixture() {
  const store = sqliteStore(":memory:");
  let now = 1_800_000_000_000;
  const api = createApi(store, "https://game.test", () => now);
  async function call(
    path: string,
    method = "GET",
    body?: unknown,
    token = "a".repeat(64),
    ip = "ip-1",
    origin = "https://game.test",
  ) {
    const response = await api(
      new Request(`https://api.test/api${path}`, {
        method,
        headers: {
          Origin: origin,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
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
  async function register(token = "a".repeat(64), name = "测试玩家") {
    assert.equal(
      (await call("/players", "POST", { name, avatar, token }, token)).status,
      200,
    );
  }
  async function run(token = "a".repeat(64)) {
    const response = await call("/runs", "POST", {}, token);
    assert.equal(response.status, 200);
    return response.body;
  }
  return {
    store,
    call,
    register,
    run,
    advance(ms: number) {
      now += ms;
    },
  };
}
test("seeded physics records replay independently of unrelated Matter worlds", () => {
  for (const seed of [0, 1, 42, 0xffffffff]) {
    const result = recorded(seed);
    assert.ok(result.score > 0);
    assert.equal(replayScore(seed, result.replay), result.score);
    assert.equal(replayScore(seed, result.replay), result.score);
  }
});
test("replay validation rejects huge, accelerated, malformed or too-fast records before simulation", () => {
  const valid = {
    version: 1,
    ticks: 120,
    drops: [
      [0, 220],
      [46, 220],
    ],
  };
  assert.doesNotThrow(() => validateReplay(valid, 1000));
  for (const replay of [
    null,
    { ...valid, version: 2 },
    { ...valid, ticks: MAX_TICKS + 1 },
    { ...valid, ticks: -1 },
    { ...valid, ticks: 1.5 },
    { ...valid, drops: [] },
    {
      ...valid,
      drops: [
        [0, 220],
        [45, 220],
      ],
    },
    { ...valid, drops: [[0, NaN]] },
    { ...valid, drops: [[0, 441]] },
    { ...valid, drops: [[121, 220]] },
    { ...valid, drops: [[0, 220, 0]] },
  ])
    assert.throws(() => validateReplay(replay, 1e8));
  assert.throws(() => validateReplay({ ...valid, ticks: 1000 }, 0));
});
test("API derives scores, binds runs to identities, keeps best, and prevents repeat submission", async () => {
  const f = fixture();
  try {
    await f.register();
    await f.register("b".repeat(64), "第二名");
    const run = await f.run();
    const result = recorded(run.seed);
    assert.equal(
      (await f.call("/scores", "POST", { run: run.id, replay: result.replay }))
        .status,
      400,
      "cannot fast-forward wall time",
    );
    f.advance(20_000);
    assert.equal(
      (
        await f.call(
          "/scores",
          "POST",
          { run: run.id, replay: result.replay },
          "b".repeat(64),
        )
      ).status,
      404,
    );
    assert.equal(
      (await f.call("/scores", "POST", { run: run.id, score: 99999999 }))
        .status,
      400,
      "bare scores never accepted",
    );
    const submitted = await f.call("/scores", "POST", {
      run: run.id,
      replay: result.replay,
      score: 99999999,
    });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.acceptedScore, result.score);
    assert.equal(submitted.body.me.score, result.score);
    assert.equal(submitted.body.me.rank, 1);
    assert.equal(submitted.body.improved, true);
    assert.equal(
      (await f.call("/scores", "POST", { run: run.id, replay: result.replay }))
        .status,
      409,
    );
    const smaller = await f.run();
    const zero = { version: 1, ticks: 0, drops: [[0, 220]] };
    const lower = await f.call("/scores", "POST", {
      run: smaller.id,
      replay: zero,
    });
    assert.equal(lower.body.improved, false);
    assert.equal(lower.body.me.score, result.score);
    const other = await f.run("b".repeat(64));
    f.store.query("UPDATE runs SET seed = ? WHERE id = ?", run.seed, other.id);
    f.advance(20_000);
    await f.call(
      "/scores",
      "POST",
      { run: other.id, replay: result.replay },
      "b".repeat(64),
    );
    const renamed = await f.call("/player", "PATCH", {
      name: "新名称",
      avatar: groups[10].members[0].id,
    });
    assert.equal(renamed.body.me.score, result.score);
    assert.equal(renamed.body.me.name, "新名称");
    assert.deepEqual(
      renamed.body.entries.map((e: { rank: number }) => e.rank),
      [1, 2],
    );
    assert.equal(
      renamed.body.entries[0].name,
      "新名称",
      "earliest best wins ties",
    );
    assert.equal(JSON.stringify(renamed.body).includes("token"), false);
    assert.equal(
      f.store.query(
        "SELECT token_hash FROM players WHERE name = ?",
        "新名称",
      )[0].token_hash,
      await hash("a".repeat(64)),
    );
  } finally {
    f.store.close();
  }
});
test("profile allowlist, origin, body limit, auth, expiry and durable rate limits", async () => {
  const f = fixture();
  try {
    assert.equal((await f.call("/runs", "POST", {})).status, 401);
    for (const name of ["", " ", "12345678901234567", "<script>", "a\u200bb"])
      assert.equal(
        (
          await f.call("/players", "POST", {
            name,
            avatar,
            token: "a".repeat(64),
          })
        ).status,
        400,
      );
    assert.equal(
      (
        await f.call("/players", "POST", {
          name: "测试",
          avatar: "https://bad.test/x.png",
          token: "a".repeat(64),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.call(
          "/leaderboard",
          "GET",
          undefined,
          undefined,
          undefined,
          "https://evil.test",
        )
      ).status,
      403,
    );
    assert.equal(
      (await f.call("/players", "POST", { name: "x".repeat(160001) })).status,
      413,
    );
    await f.register();
    const run = await f.run();
    f.advance(6 * 3600_000 + 1);
    assert.equal(
      (
        await f.call("/scores", "POST", {
          run: run.id,
          replay: { version: 1, ticks: 0, drops: [[0, 220]] },
        })
      ).status,
      404,
    );
    for (let i = 0; i < 20; i++)
      await f.call("/scores", "POST", { run: "invalid" });
    assert.equal(
      (await f.call("/scores", "POST", { run: "invalid" })).status,
      429,
      "failed submissions consume limit too",
    );
    f.advance(60_001);
    assert.equal(
      (await f.call("/scores", "POST", { run: "invalid" })).status,
      404,
    );
  } finally {
    f.store.close();
  }
});
test("SQLite identities and highest score survive reconnect", async () => {
  const directory = mkdtempSync(join(tmpdir(), "holo-ranking-"));
  const filename = join(directory, "test.sqlite");
  const token = "c".repeat(64);
  try {
    let store = sqliteStore(filename);
    let api = createApi(store);
    const registration = await api(
      new Request("http://test/api/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "持久玩家", avatar, token }),
      }),
      "ip",
    );
    assert.equal(registration.status, 200);
    store.query("UPDATE players SET best = 123, best_at = 10");
    store.close();
    store = sqliteStore(filename);
    api = createApi(store);
    const response = await api(
      new Request("http://test/api/leaderboard", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      "ip",
    );
    const board = (await response.json()) as {
      me: { score: number; name: string };
    };
    assert.equal(board.me.score, 123);
    assert.equal(board.me.name, "持久玩家");
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("top 50 ranking keeps an out-of-list player's rank and concurrent submissions settle once", async () => {
  const f = fixture();
  try {
    await f.register();
    const player = f.store.query("SELECT id FROM players")[0];
    f.store.query("UPDATE players SET best = 4, best_at = 1");
    for (let i = 0; i < 55; i++)
      f.store.query(
        "INSERT INTO players(id, token_hash, name, avatar, best, best_at, created) VALUES (?, ?, ?, ?, ?, ?, 0)",
        `fixture-${i}`,
        `hash-${i}`,
        `玩家${i}`,
        avatar,
        8 + i * 4,
        i + 1,
      );
    const board = await f.call("/leaderboard");
    assert.equal(board.body.entries.length, 50);
    assert.equal(board.body.entries[0].score, 224);
    assert.equal(board.body.me.id, player.id);
    assert.equal(board.body.me.rank, 56);
    const run = await f.run();
    const replay = { version: 1, ticks: 0, drops: [[0, 220]] };
    const results = await Promise.all([
      f.call("/scores", "POST", { run: run.id, replay }),
      f.call("/scores", "POST", { run: run.id, replay }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  } finally {
    f.store.close();
  }
});
