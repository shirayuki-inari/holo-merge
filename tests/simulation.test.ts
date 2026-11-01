// Game rules run on the same Simulation class the server uses for replay checks,
// so they are tested in Node; only rendering/animation-frame behaviour needs a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import Matter from "matter-js";
import {
  DANGER_GRACE_MS,
  DANGER_LIMIT_MS,
  DROP_COOLDOWN_MS,
  Simulation,
  STEP_MS,
} from "../src/game/simulation.ts";
import { HEIGHT, RADII, WIDTH, mergePoints } from "../src/game/model.ts";

class TestSimulation extends Simulation {
  add(level: number, x: number, y: number) {
    return this.addOrb(level, x, y);
  }
  run(steps: number) {
    for (let i = 0; i < steps; i++) this.step(STEP_MS);
  }
  /** Advance simulated time without dropping, e.g. past the drop cooldown. */
  wait(ms: number) {
    this.run(Math.ceil(ms / STEP_MS));
  }
}
function fixture(seed = 1) {
  const events = { ended: 0, won: 0, merges: [] as number[] };
  const game = new TestSimulation({
    seed,
    onChange() {},
    onMerge: (level) => events.merges.push(level),
    onEnd: () => events.ended++,
    onWin: () => events.won++,
  });
  return { game, events };
}
const steps = (ms: number) => Math.ceil(ms / STEP_MS);

test("every tier merges into the next and scores its points; the top tier wins once", () => {
  for (let level = 0; level < RADII.length - 1; level++) {
    const { game, events } = fixture();
    const r = RADII[level];
    game.add(level, WIDTH / 2 - r * 0.9, HEIGHT - 20 - r);
    game.add(level, WIDTH / 2 + r * 0.9, HEIGHT - 20 - r);
    game.run(30);
    assert.equal(game.orbs.size, 1, `tier ${level}`);
    assert.equal(game.state.highest, level + 1);
    assert.equal(game.state.score, mergePoints(level + 1));
    assert.deepEqual(events.merges, [level + 1]);
    assert.equal(events.won, level === RADII.length - 2 ? 1 : 0);
    assert.equal(game.state.won, level === RADII.length - 2);
    game.destroy();
  }
});

test("the top tier never merges and different members never merge", () => {
  const top = RADII.length - 1;
  const { game } = fixture();
  game.add(top, 115, 450);
  game.add(top, 315, 450);
  game.add(0, 200, 300);
  game.add(1, 230, 300);
  game.run(steps(1000));
  assert.equal(game.orbs.size, 4);
  assert.equal(game.state.score, 0);
  game.destroy();
});

test("a three-way contact consumes each member once; four members chain two tiers", () => {
  {
    const { game } = fixture();
    for (const x of [190, 220, 250]) game.add(0, x, 530);
    game.run(60);
    assert.equal(game.orbs.size, 2);
    assert.equal(game.state.score, mergePoints(1));
    game.destroy();
  }
  {
    const { game } = fixture();
    for (const x of [202, 214, 226, 238]) game.add(0, x, 530);
    game.run(240);
    assert.equal(game.orbs.size, 1);
    assert.equal(game.state.highest, 2);
    assert.equal(game.state.score, 2 * mergePoints(1) + mergePoints(2));
    game.destroy();
  }
});

test("merges within 1.3 seconds count as a combo", () => {
  const { game } = fixture();
  game.add(0, 100, 530);
  game.add(0, 120, 530);
  game.run(30);
  assert.equal(game.state.combo, 1);
  game.add(0, 320, 530);
  game.add(0, 340, 530);
  game.run(30);
  assert.equal(game.state.combo, 2);
  game.wait(1400);
  game.add(1, 200, 300);
  game.add(1, 225, 300);
  game.run(60);
  assert.equal(game.state.combo, 1, "combo resets after a pause");
  game.destroy();
});

test("the limit line has a grace period, warns, clears, and ends the round", () => {
  const { game, events } = fixture();
  const held = game.add(0, 220, 80);
  Matter.Sleeping.set(held, true);
  game.run(steps(DANGER_GRACE_MS) - 2);
  assert.equal(game.state.danger, false, "new members get a grace period");
  assert.equal(game.dangerProgress, 0);
  game.run(steps(400));
  assert.equal(game.state.danger, true);
  assert.equal(game.state.over, false);
  const progress = game.dangerProgress;
  assert.ok(progress > 0 && progress < 1, `progress ${progress}`);
  Matter.Body.setPosition(held, { x: 220, y: 400 });
  game.run(5);
  assert.equal(game.state.danger, false, "dropping below the line clears it");
  assert.equal(game.dangerProgress, 0);
  Matter.Body.setPosition(held, { x: 220, y: 80 });
  Matter.Sleeping.set(held, true);
  game.run(steps(DANGER_LIMIT_MS) - 4);
  assert.equal(game.state.over, false, "the full limit is allowed");
  game.run(8);
  assert.equal(game.state.over, true);
  assert.equal(events.ended, 1);
  assert.equal(game.dangerProgress, 1);
  assert.equal(game.drop(), false, "game over blocks drops");
  game.destroy();
});

test("drops are clamped inside the walls and throttled by the cooldown", () => {
  const { game } = fixture();
  game.state.current = 0;
  game.setAim(-1000);
  assert.equal(game.drop(), true);
  assert.equal(game.drop(), false, "rapid duplicate drop is throttled");
  const [orb] = game.orbs.values();
  assert.ok(orb.body.position.x - RADII[0] > 6);
  game.wait(DROP_COOLDOWN_MS);
  game.setAim(10_000);
  assert.equal(game.drop(), true);
  const right = [...game.orbs.values()].at(-1)!;
  assert.ok(right.body.position.x + RADII[right.level] < WIDTH - 6);
  assert.equal(game.replay().drops.length, 2);
  game.destroy();
});

test("the same seed and commands give the same drops and score", () => {
  const play = () => {
    const { game } = fixture(42);
    const levels: number[] = [];
    for (let i = 0; i < 25; i++) {
      levels.push(game.state.current);
      game.setAim(60 + ((i * 53) % 320));
      game.drop();
      game.wait(DROP_COOLDOWN_MS + 200);
    }
    const result = { levels, score: game.state.score, count: game.orbs.size };
    game.destroy();
    return result;
  };
  const first = play();
  assert.ok(first.score > 0);
  assert.deepEqual(play(), first);
});
