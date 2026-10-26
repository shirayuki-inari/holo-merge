import assert from "node:assert/strict";
import { Simulation } from "../src/game/simulation.ts";
import { groups } from "../src/game/model.ts";
const base = process.env.API_URL || "http://127.0.0.1:8787";
const token = crypto
  .getRandomValues(new Uint8Array(32))
  .reduce((s, n) => s + n.toString(16).padStart(2, "0"), "");
async function call(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    data: (await response.json()) as Record<string, any>,
  };
}
assert.equal(
  (
    await call("/players", "POST", {
      name: "后端验证",
      avatar: groups[0].members[0].id,
      token,
    })
  ).status,
  200,
);
const run = await call("/runs", "POST", {});
assert.equal(run.status, 200);
const simulation = new Simulation({
  seed: run.data.seed,
  onChange() {},
  onMerge() {},
  onWin() {},
  onEnd() {},
});
for (let i = 0; i < 8; i++) {
  simulation.drop();
  for (let t = 0; t < 90; t++) simulation.advance();
}
const replay = simulation.replay();
assert.ok(simulation.state.score > 0);
await new Promise((r) => setTimeout(r, 6200)); // Session wall clock must cover actual simulation time.
const result = await call("/scores", "POST", {
  run: run.data.id,
  replay,
  score: 99999999,
});
assert.equal(result.status, 200, JSON.stringify(result.data));
assert.equal(result.data.acceptedScore, simulation.state.score);
assert.equal(result.data.me.score, simulation.state.score);
assert.equal(
  (await call("/scores", "POST", { run: run.data.id, replay })).status,
  409,
);
const updated = await call("/player", "PATCH", {
  name: "资料已修改",
  avatar: groups[10].members[0].id,
});
assert.equal(updated.status, 200);
assert.equal(updated.data.me.score, simulation.state.score);
assert.equal(updated.data.me.name, "资料已修改");
assert.equal(
  (await call("/player", "PATCH", { name: "x", avatar: "bogus" })).status,
  400,
);
simulation.destroy();
console.log(
  `PASS ${base}: persistent identity, replayed score, forged score ignored, replay blocked, profile update`,
);
