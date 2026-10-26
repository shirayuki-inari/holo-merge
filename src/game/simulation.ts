import Matter from "matter-js";
import {
  clampDrop,
  DANGER_Y,
  HEIGHT,
  mergeLevel,
  mergePoints,
  RADII,
  randomDrop,
  WIDTH,
} from "./model";
import { seededRandom, type Replay } from "./replay";
const { Engine, Bodies, Body, Composite, Events } = Matter;
type Orb = { body: Matter.Body; level: number; born: number };
export interface GameState {
  score: number;
  current: number;
  next: number;
  highest: number;
  count: number;
  drops: number;
  danger: boolean;
  over: boolean;
  won: boolean;
  combo: number;
}
export interface SimulationOptions {
  seed?: number;
  onChange: (state: GameState) => void;
  onMerge: (level: number) => void;
  onEnd: () => void;
  onWin: () => void;
}
export const STEP_MS = 1000 / 120;
export class Simulation {
  readonly physics = Engine.create({
    enableSleeping: true,
    positionIterations: 6,
    velocityIterations: 4,
  });
  readonly orbs = new Map<number, Orb>();
  state: GameState;
  protected pending: [number, number][] = [];
  protected time = 0;
  protected lastDrop = -1000;
  protected lastMerge = -3000;
  protected dangerTime = 0;
  protected x = WIDTH / 2;
  protected ticks = 0;
  private nextId = 1;
  private random: () => number;
  private commands: [number, number][] = [];
  constructor(protected options: SimulationOptions) {
    this.random =
      options.seed === undefined ? Math.random : seededRandom(options.seed);
    this.state = {
      score: 0,
      current: randomDrop(this.random),
      next: randomDrop(this.random),
      highest: 0,
      count: 0,
      drops: 0,
      danger: false,
      over: false,
      won: false,
      combo: 0,
    };
    this.physics.gravity.y = 1.7;
    Composite.add(this.physics.world, [
      Bodies.rectangle(-20, HEIGHT / 2, 52, HEIGHT * 4, {
        id: this.nextId++,
        isStatic: true,
        friction: 0.4,
      }),
      Bodies.rectangle(WIDTH + 20, HEIGHT / 2, 52, HEIGHT * 4, {
        id: this.nextId++,
        isStatic: true,
        friction: 0.4,
      }),
      Bodies.rectangle(WIDTH / 2, HEIGHT + 15, WIDTH + 80, 50, {
        id: this.nextId++,
        isStatic: true,
        friction: 0.6,
      }),
    ]);
    Events.on(this.physics, "collisionStart", (event) => {
      for (const pair of event.pairs)
        if (this.orbs.has(pair.bodyA.id) && this.orbs.has(pair.bodyB.id))
          this.pending.push([pair.bodyA.id, pair.bodyB.id]);
    });
  }
  setAim(x: number) {
    this.x = clampDrop(x, this.state.current);
  }
  moveAim(dx: number) {
    this.setAim(this.x + dx);
  }
  drop() {
    if (this.state.over || this.time - this.lastDrop < 380) return false;
    this.commands.push([this.ticks, this.x]);
    this.addOrb(this.state.current, this.x, 44);
    this.state.drops++;
    this.lastDrop = this.time;
    this.state.current = this.state.next;
    this.state.next = randomDrop(this.random);
    this.setAim(this.x);
    this.emit();
    return true;
  }
  replay(): Replay {
    return {
      version: 1,
      ticks: this.ticks,
      drops: this.commands.map((c) => [...c]),
    };
  }
  advance() {
    this.step(STEP_MS);
  }
  finish() {
    this.state.over = true;
    this.emit();
    this.options.onEnd();
  }
  protected onMergeVisual(
    _level: number,
    _x: number,
    _y: number,
    _points: number,
  ) {}
  protected addOrb(level: number, x: number, y: number) {
    const body = Bodies.circle(x, y, RADII[level], {
      id: this.nextId++,
      // Circle rotation does not affect gameplay. Keep portraits upright and avoid
      // runtime-dependent trig rounding accumulating into different replay scores.
      inertia: Infinity,
      restitution: 0.16,
      friction: 0.45,
      frictionStatic: 0.65,
      frictionAir: 0.006,
      density: 0.002,
      sleepThreshold: 55,
    });
    this.orbs.set(body.id, { body, level, born: this.time });
    Composite.add(this.physics.world, body);
    return body;
  }
  protected flushMerges() {
    for (const [aId, bId] of this.pending) {
      const a = this.orbs.get(aId),
        b = this.orbs.get(bId);
      if (!a || !b) continue;
      const level = mergeLevel(a.level, b.level);
      if (level === null) continue;
      const x = clampDrop((a.body.position.x + b.body.position.x) / 2, level);
      const y = Math.min(
        HEIGHT - 10 - RADII[level],
        (a.body.position.y + b.body.position.y) / 2,
      );
      const velocity = {
        x: (a.body.velocity.x + b.body.velocity.x) * 0.2,
        y: Math.min(0, (a.body.velocity.y + b.body.velocity.y) * 0.2),
      };
      Composite.remove(this.physics.world, [a.body, b.body]);
      this.orbs.delete(aId);
      this.orbs.delete(bId);
      const body = this.addOrb(level, x, y);
      Body.setVelocity(body, velocity);
      const points = mergePoints(level);
      this.state.score += points;
      this.state.highest = Math.max(this.state.highest, level);
      this.state.combo =
        this.time - this.lastMerge < 1300 ? this.state.combo + 1 : 1;
      this.lastMerge = this.time;
      this.onMergeVisual(level, x, y, points);
      this.options.onMerge(level);
      if (level === RADII.length - 1 && !this.state.won) {
        this.state.won = true;
        this.options.onWin();
      }
      this.emit();
    }
    this.pending.length = 0;
  }
  protected emit() {
    this.state.count = this.orbs.size;
    this.options.onChange({ ...this.state });
  }
  protected step(dt: number) {
    if (this.state.over) return;
    this.ticks++;
    this.time += dt;
    Engine.update(this.physics, dt);
    this.flushMerges();
    let danger = false;
    for (const orb of this.orbs.values())
      if (
        this.time - orb.born > 1600 &&
        orb.body.position.y - RADII[orb.level] < DANGER_Y
      ) {
        danger = true;
        break;
      }
    this.dangerTime = danger ? this.dangerTime + dt : 0;
    if (this.state.danger !== danger) {
      this.state.danger = danger;
      this.emit();
    }
    if (this.dangerTime > 2200) {
      this.state.over = true;
      this.emit();
      this.options.onEnd();
    }
  }
  destroy() {
    Events.off(this.physics, "collisionStart");
    Composite.clear(this.physics.world, false);
    Engine.clear(this.physics);
    this.orbs.clear();
  }
}
