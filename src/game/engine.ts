import Matter from "matter-js";
import {
  clampDrop,
  COLORS,
  DANGER_Y,
  HEIGHT,
  mergeLevel,
  mergePoints,
  RADII,
  randomDrop,
  WIDTH,
  type Talent,
} from "./model";
const { Engine, Bodies, Body, Composite, Events } = Matter;
type Orb = { body: Matter.Body; level: number; born: number };
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
};
type Ring = {
  x: number;
  y: number;
  radius: number;
  life: number;
  color: string;
  points: number;
};
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
interface Options {
  lineup: Talent[];
  onChange: (state: GameState) => void;
  onMerge: (level: number) => void;
  onEnd: () => void;
  onWin: () => void;
}
export class HoloEngine {
  readonly physics = Engine.create({
    enableSleeping: true,
    positionIterations: 6,
    velocityIterations: 4,
  });
  readonly orbs = new Map<number, Orb>();
  state: GameState = {
    score: 0,
    current: randomDrop(),
    next: randomDrop(),
    highest: 0,
    count: 0,
    drops: 0,
    danger: false,
    over: false,
    won: false,
    combo: 0,
  };
  private ctx: CanvasRenderingContext2D;
  private background = document.createElement("canvas");
  private sprites: HTMLCanvasElement[] = [];
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private pending: [number, number][] = [];
  private frame = 0;
  private last = 0;
  private accumulator = 0;
  private time = 0;
  private lastDrop = -1000;
  private lastMerge = -3000;
  private dangerTime = 0;
  private x = WIDTH / 2;
  private paused = false;
  private hidden = document.hidden;
  private disposed = false;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private observer: ResizeObserver;
  constructor(
    private canvas: HTMLCanvasElement,
    private options: Options,
  ) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.physics.gravity.y = 1.7;
    Composite.add(this.physics.world, [
      Bodies.rectangle(-20, HEIGHT / 2, 52, HEIGHT * 4, {
        isStatic: true,
        friction: 0.4,
      }),
      Bodies.rectangle(WIDTH + 20, HEIGHT / 2, 52, HEIGHT * 4, {
        isStatic: true,
        friction: 0.4,
      }),
      Bodies.rectangle(WIDTH / 2, HEIGHT + 15, WIDTH + 80, 50, {
        isStatic: true,
        friction: 0.6,
      }),
    ]);
    Events.on(this.physics, "collisionStart", (event) => {
      for (const pair of event.pairs)
        if (this.orbs.has(pair.bodyA.id) && this.orbs.has(pair.bodyB.id))
          this.pending.push([pair.bodyA.id, pair.bodyB.id]);
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    this.loadSprites();
    document.addEventListener("visibilitychange", this.visibility);
    this.emit();
    this.frame = requestAnimationFrame(this.tick);
  }
  private visibility = () => {
    this.hidden = document.hidden;
    this.last = 0;
    this.accumulator = 0;
    if (this.hidden) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    } else if (!this.paused && !this.state.over && !this.frame)
      this.frame = requestAnimationFrame(this.tick);
  };
  private resize() {
    this.canvas.width = this.background.width = WIDTH * this.dpr;
    this.canvas.height = this.background.height = HEIGHT * this.dpr;
    const c = this.background.getContext("2d")!;
    c.scale(this.dpr, this.dpr);
    c.fillStyle = "#fffefb";
    c.fillRect(0, 0, WIDTH, HEIGHT);
    c.fillStyle = "#e7eeea";
    for (let y = 19; y < HEIGHT; y += 26)
      for (let x = 17; x < WIDTH; x += 26) {
        c.beginPath();
        c.arc(x, y, 0.7, 0, Math.PI * 2);
        c.fill();
      }
    // A quiet mint-coloured cushion at the bottom of the play space.
    c.fillStyle = "#f0f7f1";
    c.beginPath();
    c.moveTo(0, HEIGHT - 16);
    c.bezierCurveTo(110, HEIGHT - 33, 260, HEIGHT - 9, WIDTH, HEIGHT - 21);
    c.lineTo(WIDTH, HEIGHT);
    c.lineTo(0, HEIGHT);
    c.closePath();
    c.fill();
  }
  private loadSprites() {
    this.options.lineup.forEach((talent, level) => {
      const size = Math.ceil(RADII[level] * 2 * this.dpr);
      const sprite = document.createElement("canvas");
      sprite.width = sprite.height = size;
      const c = sprite.getContext("2d")!;
      const paint = (img?: HTMLImageElement) => {
        c.clearRect(0, 0, size, size);
        c.save();
        c.beginPath();
        c.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
        c.clip();
        c.fillStyle = COLORS[level];
        c.fillRect(0, 0, size, size);
        if (img) c.drawImage(img, 0, 0, size, size);
        else {
          c.fillStyle = "#fff";
          c.font = `bold ${size * 0.32}px sans-serif`;
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillText(talent.name.slice(0, 2), size / 2, size / 2);
        }
        c.restore();
        c.beginPath();
        c.arc(size / 2, size / 2, size / 2 - this.dpr * 1.5, 0, Math.PI * 2);
        c.strokeStyle = COLORS[level];
        c.lineWidth = this.dpr * 3;
        c.stroke();
      };
      paint();
      this.sprites[level] = sprite;
      const img = new Image();
      img.onload = () => {
        if (!this.disposed) paint(img);
      };
      img.src = talent.image;
    });
  }
  setAim(x: number) {
    this.x = clampDrop(x, this.state.current);
  }
  moveAim(dx: number) {
    this.setAim(this.x + dx);
  }
  setPaused(value: boolean) {
    this.paused = value;
    this.last = 0;
    this.accumulator = 0;
    if (value) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    } else if (!this.hidden && !this.state.over && !this.frame)
      this.frame = requestAnimationFrame(this.tick);
  }
  drop() {
    if (
      this.paused ||
      this.hidden ||
      this.state.over ||
      this.time - this.lastDrop < 380
    )
      return false;
    this.addOrb(this.state.current, clampDrop(this.x, this.state.current), 44);
    this.state.drops++;
    this.lastDrop = this.time;
    this.state.current = this.state.next;
    this.state.next = randomDrop();
    this.setAim(this.x);
    this.emit();
    return true;
  }
  private addOrb(level: number, x: number, y: number) {
    const body = Bodies.circle(x, y, RADII[level], {
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
  private flushMerges() {
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
      this.rings.push({
        x,
        y,
        radius: RADII[level],
        life: 1,
        color: COLORS[level],
        points,
      });
      for (let i = 0; i < 12; i++) {
        const angle = (Math.PI * 2 * i) / 12;
        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * (2 + Math.random() * 2),
          vy: Math.sin(angle) * 3 - 1,
          life: 1,
          color: COLORS[level],
        });
      }
      this.options.onMerge(level);
      if (level === RADII.length - 1 && !this.state.won) {
        this.state.won = true;
        this.options.onWin();
      }
      this.emit();
    }
    this.pending.length = 0;
  }
  private emit() {
    this.state.count = this.orbs.size;
    this.options.onChange({ ...this.state });
  }
  private step(dt: number) {
    if (this.state.over) return;
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
  private tick = (now: number) => {
    this.frame = 0;
    if (this.disposed) return;
    const elapsed = this.last ? Math.min(now - this.last, 50) : 0;
    this.last = now;
    if (!this.paused && !this.hidden && !this.state.over) {
      this.accumulator += elapsed;
      while (this.accumulator >= 1000 / 120) {
        this.step(1000 / 120);
        this.accumulator -= 1000 / 120;
        if (this.state.over) break;
      }
      const f = elapsed / 16.667;
      for (const p of this.particles) {
        p.x += p.vx * f;
        p.y += p.vy * f;
        p.vy += 0.08 * f;
        p.life -= 0.035 * f;
      }
      for (const ring of this.rings) ring.life -= 0.025 * f;
      this.particles = this.particles.filter((p) => p.life > 0);
      this.rings = this.rings.filter((p) => p.life > 0);
    }
    if (!this.hidden) this.draw();
    if (!this.hidden && !this.paused && !this.state.over)
      this.frame = requestAnimationFrame(this.tick);
  };
  private draw() {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.drawImage(this.background, 0, 0, WIDTH, HEIGHT);
    c.save();
    c.setLineDash([6, 6]);
    c.beginPath();
    c.moveTo(14, DANGER_Y);
    c.lineTo(WIDTH - 14, DANGER_Y);
    c.strokeStyle = this.state.danger ? "#ee7183" : "#cbdedb";
    c.lineWidth = 1.5;
    c.stroke();
    c.restore();
    c.fillStyle = this.state.danger ? "#d9526c" : "#a7bcb6";
    c.font = "10px sans-serif";
    c.textAlign = "right";
    c.fillText(
      this.state.danger ? "已超过警戒线，请及时合成" : "警戒线",
      WIDTH - 17,
      DANGER_Y - 9,
    );
    if (!this.state.over) {
      const r = RADII[this.state.current];
      c.save();
      c.setLineDash([3, 6]);
      c.strokeStyle = "#c7e3e2";
      c.beginPath();
      c.moveTo(this.x, 44 + r);
      c.lineTo(this.x, HEIGHT - 12);
      c.stroke();
      c.restore();
      c.globalAlpha = this.time - this.lastDrop < 380 ? 0.45 : 0.9;
      c.drawImage(
        this.sprites[this.state.current],
        this.x - r,
        44 - r,
        r * 2,
        r * 2,
      );
      c.globalAlpha = 1;
      c.fillStyle = "#27bad4";
      c.beginPath();
      c.moveTo(this.x - 4, 10);
      c.lineTo(this.x + 4, 10);
      c.lineTo(this.x, 15);
      c.fill();
    }
    for (const { body, level } of this.orbs.values()) {
      const r = RADII[level];
      c.save();
      c.translate(body.position.x, body.position.y);
      c.rotate(body.angle);
      c.drawImage(this.sprites[level], -r, -r, r * 2, r * 2);
      c.restore();
    }
    for (const ring of this.rings) {
      c.globalAlpha = ring.life;
      c.strokeStyle = ring.color;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(ring.x, ring.y, ring.radius + (1 - ring.life) * 30, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = "#147f9e";
      c.font = "bold 19px sans-serif";
      c.textAlign = "center";
      c.fillText("+" + ring.points, ring.x, ring.y - 15 - (1 - ring.life) * 40);
    }
    for (const p of this.particles) {
      c.globalAlpha = p.life;
      c.fillStyle = p.color;
      c.fillRect(p.x, p.y, 4, 4);
    }
    c.globalAlpha = 1;
    c.fillStyle = "#d9eae2";
    c.fillRect(6, HEIGHT - 10, WIDTH - 12, 10);
  }
  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    document.removeEventListener("visibilitychange", this.visibility);
    Events.off(this.physics, "collisionStart");
    Composite.clear(this.physics.world, false);
    Engine.clear(this.physics);
    this.orbs.clear();
  }
}
