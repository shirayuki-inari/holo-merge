import {
  DANGER_LIMIT_MS,
  DROP_COOLDOWN_MS,
  Simulation,
  STEP_MS,
  type SimulationOptions,
} from "./simulation";
export type { GameState } from "./simulation";
import { COLORS, DANGER_Y, HEIGHT, RADII, WIDTH, type Talent } from "./model";
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
interface Options extends SimulationOptions {
  lineup: Talent[];
  labels?: { limit: string; danger: string };
}
/** Visual-only grow-in for merged members; physics always uses the full radius. */
const SPAWN_MS = 170;
/** Held arrow keys steer the aim: start slow for precision, then speed up (px/ms). */
const STEER_MIN_SPEED = 0.18;
const STEER_MAX_SPEED = 0.62;
const STEER_ACCEL_MS = 450;
const FALLBACK_FONT = '"Poppins", "Noto Sans SC", "Noto Sans JP", sans-serif';
function currentDpr() {
  return Math.min(window.devicePixelRatio || 1, 2);
}
function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}
function easeOutBack(t: number) {
  const c1 = 1.70158,
    c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
/** Halve large portraits step by step so small members stay smooth on every browser. */
function downscale(img: HTMLImageElement, size: number): CanvasImageSource {
  let source: CanvasImageSource = img,
    width = img.naturalWidth || size;
  while (width / 2 >= size * 1.5) {
    width = Math.ceil(width / 2);
    const step = document.createElement("canvas");
    step.width = step.height = width;
    const c = step.getContext("2d")!;
    c.imageSmoothingQuality = "high";
    c.drawImage(source, 0, 0, width, width);
    source = step;
  }
  return source;
}
export class HoloEngine extends Simulation {
  private ctx: CanvasRenderingContext2D;
  private background = document.createElement("canvas");
  private sprites: HTMLCanvasElement[] = [];
  private images: (HTMLImageElement | undefined)[] = [];
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  /** Merged member body id → simulation time it appeared. */
  private spawns = new Map<number, number>();
  /** Positions before the latest physics step, for render interpolation. */
  private previous = new Map<number, { x: number; y: number }>();
  private alpha = 1;
  private frame = 0;
  private last = 0;
  private accumulator = 0;
  private paused = false;
  private hidden = document.hidden;
  private disposed = false;
  private dirty = true;
  private animating = true;
  private aimCancelled = false;
  private steer = 0;
  private steerStart = 0;
  private reducedMotion =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  private font = FALLBACK_FONT;
  private dpr = currentDpr();
  private dprQuery: MediaQueryList | null = null;
  constructor(
    private canvas: HTMLCanvasElement,
    private visualOptions: Options,
  ) {
    super(visualOptions);
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.readFont();
    this.setupCanvas();
    this.loadImages();
    this.watchDpr();
    // Browser zoom also fires resize; the matchMedia query covers display moves.
    window.addEventListener("resize", this.dprChanged);
    document.addEventListener("visibilitychange", this.visibility);
    document.fonts?.ready.then(() => {
      if (this.disposed) return;
      this.readFont();
      this.requestDraw();
    });
    this.emit();
    this.frame = requestAnimationFrame(this.tick);
  }
  setLabels(labels: NonNullable<Options["labels"]>) {
    this.visualOptions.labels = labels;
    this.readFont();
    this.requestDraw();
  }
  /** Touch drag far enough to cancel: show the aim as inactive. */
  setAimCancelled(value: boolean) {
    if (this.aimCancelled === value) return;
    this.aimCancelled = value;
    this.requestDraw();
  }
  override setAim(x: number) {
    super.setAim(x);
    this.requestDraw();
  }
  /** -1 / 1 while an arrow key is held, 0 when released. */
  setSteer(direction: number) {
    const d = Math.sign(direction);
    if (d === this.steer) return;
    this.steer = d;
    this.steerStart = performance.now();
  }
  private readFont() {
    const family = getComputedStyle(this.canvas).fontFamily;
    this.font = family || FALLBACK_FONT;
  }
  /** Draw now when no animation frame is pending, otherwise on the next frame. */
  private requestDraw() {
    this.dirty = true;
    if (!this.frame && !this.hidden && !this.disposed) this.draw();
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
    else this.requestDraw();
  };
  // The bitmap size only depends on the device pixel ratio, never on CSS layout,
  // so only zoom or moving to another display needs new bitmaps.
  private watchDpr() {
    this.dprQuery?.removeEventListener("change", this.dprChanged);
    if (typeof matchMedia !== "function") return;
    this.dprQuery = matchMedia(
      `(resolution: ${window.devicePixelRatio || 1}dppx)`,
    );
    this.dprQuery.addEventListener("change", this.dprChanged);
  }
  private dprChanged = () => {
    if (this.disposed) return;
    // Re-arm the query for the new raw ratio, even when the capped value is unchanged.
    if (this.dprQuery && !this.dprQuery.matches) this.watchDpr();
    const dpr = currentDpr();
    if (dpr === this.dpr) return;
    this.dpr = dpr;
    this.setupCanvas();
  };
  private setupCanvas() {
    // Resizing clears the bitmap; repaint immediately so paused boards never go blank.
    this.canvas.width = this.background.width = WIDTH * this.dpr;
    this.canvas.height = this.background.height = HEIGHT * this.dpr;
    const c = this.background.getContext("2d")!;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
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
    this.visualOptions.lineup.forEach((_, level) => this.paintSprite(level));
    this.requestDraw();
  }
  private paintSprite(level: number) {
    const size = Math.ceil(RADII[level] * 2 * this.dpr);
    const sprite = (this.sprites[level] ??= document.createElement("canvas"));
    sprite.width = sprite.height = size;
    const c = sprite.getContext("2d")!;
    const img = this.images[level];
    c.save();
    c.beginPath();
    c.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = COLORS[level];
    c.fillRect(0, 0, size, size);
    if (img) {
      c.imageSmoothingQuality = "high";
      c.drawImage(downscale(img, size), 0, 0, size, size);
    } else {
      c.fillStyle = "#fff";
      c.font = `bold ${size * 0.32}px ${this.font}`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(
        this.visualOptions.lineup[level].name.slice(0, 2),
        size / 2,
        size / 2,
      );
    }
    c.restore();
    c.beginPath();
    c.arc(size / 2, size / 2, size / 2 - this.dpr * 1.5, 0, Math.PI * 2);
    c.strokeStyle = COLORS[level];
    c.lineWidth = this.dpr * 3;
    c.stroke();
  }
  private loadImages() {
    this.visualOptions.lineup.forEach((talent, level) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        if (this.disposed) return;
        this.images[level] = img;
        this.paintSprite(level);
        this.requestDraw();
      };
      img.src = talent.image;
    });
  }
  setPaused(value: boolean) {
    this.paused = value;
    this.last = 0;
    this.accumulator = 0;
    if (value) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      // Settle interpolation on the exact simulated positions.
      this.snapshot();
      this.alpha = 1;
      this.requestDraw();
    } else if (!this.hidden && !this.state.over && !this.frame)
      this.frame = requestAnimationFrame(this.tick);
  }
  override drop() {
    if (this.paused || this.hidden) return false;
    const dropped = super.drop();
    if (dropped) this.dirty = true;
    return dropped;
  }
  override finish() {
    super.finish();
    this.alpha = 1;
    this.requestDraw();
  }
  protected override onMergeVisual(
    level: number,
    x: number,
    y: number,
    points: number,
    id: number,
  ) {
    this.spawns.set(id, this.time);
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
  }
  private snapshot() {
    for (const [id, { body }] of this.orbs) {
      const p = this.previous.get(id);
      if (p) {
        p.x = body.position.x;
        p.y = body.position.y;
      } else this.previous.set(id, { x: body.position.x, y: body.position.y });
    }
    if (this.previous.size > this.orbs.size)
      for (const id of this.previous.keys())
        if (!this.orbs.has(id)) this.previous.delete(id);
  }
  protected override step(dt: number) {
    this.snapshot();
    super.step(dt);
  }
  private updateEffects(f: number) {
    let n = 0;
    for (const p of this.particles) {
      p.x += p.vx * f;
      p.y += p.vy * f;
      p.vy += 0.08 * f;
      p.life -= 0.035 * f;
      if (p.life > 0) this.particles[n++] = p;
    }
    this.particles.length = n;
    n = 0;
    for (const ring of this.rings) {
      ring.life -= 0.025 * f;
      if (ring.life > 0) this.rings[n++] = ring;
    }
    this.rings.length = n;
    for (const [id, born] of this.spawns)
      if (this.time - born >= SPAWN_MS || !this.orbs.has(id))
        this.spawns.delete(id);
  }
  /** Anything that changes between frames without new input. */
  private isAnimating() {
    if (
      this.particles.length ||
      this.rings.length ||
      this.spawns.size ||
      this.dangerProgress > 0 ||
      this.time - this.lastDrop < DROP_COOLDOWN_MS + STEP_MS
    )
      return true;
    for (const { body } of this.orbs.values()) if (!body.isSleeping) return true;
    return false;
  }
  private tick = (now: number) => {
    if (this.disposed) {
      this.frame = 0;
      return;
    }
    const elapsed = this.last ? Math.min(now - this.last, 50) : 0;
    this.last = now;
    const running = !this.paused && !this.hidden && !this.state.over;
    // Steer before clearing `frame`, so setAim only marks the frame dirty.
    if (running && this.steer) {
      const held = Math.min(1, (now - this.steerStart) / STEER_ACCEL_MS);
      const speed =
        STEER_MIN_SPEED + (STEER_MAX_SPEED - STEER_MIN_SPEED) * held;
      this.moveAim(this.steer * speed * elapsed);
    }
    this.frame = 0;
    if (running) {
      this.accumulator += elapsed;
      while (this.accumulator >= STEP_MS) {
        this.step(STEP_MS);
        this.accumulator -= STEP_MS;
        if (this.state.over) break;
      }
      this.alpha = this.state.over ? 1 : this.accumulator / STEP_MS;
      this.updateEffects(elapsed / 16.667);
    }
    // Skip identical frames once every member sleeps; draw one more to settle.
    const animating = this.isAnimating();
    if (!this.hidden && (this.dirty || animating || this.animating))
      this.draw();
    this.animating = animating;
    if (!this.hidden && !this.paused && !this.state.over)
      this.frame = requestAnimationFrame(this.tick);
  };
  private draw() {
    this.dirty = false;
    const c = this.ctx;
    const danger = this.dangerProgress;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.drawImage(this.background, 0, 0, WIDTH, HEIGHT);
    c.save();
    c.setLineDash([6, 6]);
    c.beginPath();
    c.moveTo(14, DANGER_Y);
    c.lineTo(WIDTH - 14, DANGER_Y);
    c.strokeStyle = this.state.danger ? "#ee7183" : "#b9d3cf";
    c.lineWidth = 1.5;
    c.stroke();
    c.restore();
    if (danger > 0 && !this.state.over) {
      // Countdown bar: shrinks from both ends toward the centre as time runs out.
      const half = ((WIDTH - 28) / 2) * (1 - danger);
      c.strokeStyle = "#e5566f";
      c.lineWidth = 3.5;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(WIDTH / 2 - half, DANGER_Y);
      c.lineTo(WIDTH / 2 + half, DANGER_Y);
      c.stroke();
      c.lineCap = "butt";
    }
    c.fillStyle = this.state.danger ? "#c43d59" : "#5b7b76";
    c.font = `${this.state.danger ? 600 : 500} 11px ${this.font}`;
    c.textAlign = "right";
    c.textBaseline = "alphabetic";
    const remaining = Math.max(0, (DANGER_LIMIT_MS * (1 - danger)) / 1000);
    c.fillText(
      this.state.danger
        ? `${this.visualOptions.labels?.danger ?? "!"} ${remaining.toFixed(1)}s`
        : (this.visualOptions.labels?.limit ?? "—"),
      WIDTH - 17,
      DANGER_Y - 9,
    );
    if (!this.state.over) {
      const r = RADII[this.state.current];
      // The next member eases into the hand over the drop cooldown.
      const t = Math.min(1, (this.time - this.lastDrop) / DROP_COOLDOWN_MS);
      const ready = easeOutCubic(t);
      const held = this.reducedMotion ? r : r * (0.55 + 0.45 * easeOutBack(t));
      c.save();
      c.setLineDash([3, 6]);
      c.strokeStyle = this.aimCancelled ? "#d5dcdc" : "#a9d6d6";
      c.beginPath();
      c.moveTo(this.x, 44 + r);
      c.lineTo(this.x, HEIGHT - 12);
      c.stroke();
      c.restore();
      c.globalAlpha = this.aimCancelled ? 0.3 : 0.9 * (0.3 + 0.7 * ready);
      c.drawImage(
        this.sprites[this.state.current],
        this.x - held,
        44 - held,
        held * 2,
        held * 2,
      );
      c.globalAlpha = 1;
      c.fillStyle = this.aimCancelled ? "#b8c5c7" : "#27bad4";
      c.beginPath();
      c.moveTo(this.x - 4, 10);
      c.lineTo(this.x + 4, 10);
      c.lineTo(this.x, 15);
      c.fill();
    }
    const a = this.alpha;
    // Pulse members that are holding the board above the limit line.
    const pulse = 0.55 + 0.45 * Math.sin(this.time / 85);
    for (const [id, orb] of this.orbs) {
      const { body, level } = orb;
      const p = this.previous.get(id);
      const x = p ? p.x + (body.position.x - p.x) * a : body.position.x;
      const y = p ? p.y + (body.position.y - p.y) * a : body.position.y;
      let r = RADII[level];
      const born = this.spawns.get(id);
      if (born !== undefined) {
        const t = Math.min(1, (this.time - born) / SPAWN_MS);
        r *= 0.72 + 0.28 * easeOutBack(t);
      }
      // Members never rotate (infinite inertia), so a plain blit is enough.
      c.drawImage(this.sprites[level], x - r, y - r, r * 2, r * 2);
      if (danger > 0 && this.isAboveLimit(orb)) {
        c.globalAlpha = pulse;
        c.strokeStyle = "#e5566f";
        c.lineWidth = 3;
        c.beginPath();
        c.arc(x, y, r + 2, 0, Math.PI * 2);
        c.stroke();
        c.globalAlpha = 1;
      }
    }
    c.textAlign = "center";
    c.font = `bold 19px ${this.font}`;
    for (const ring of this.rings) {
      c.globalAlpha = ring.life;
      c.strokeStyle = ring.color;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(ring.x, ring.y, ring.radius + (1 - ring.life) * 30, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = "#147f9e";
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
    this.dprQuery?.removeEventListener("change", this.dprChanged);
    window.removeEventListener("resize", this.dprChanged);
    document.removeEventListener("visibilitychange", this.visibility);
    super.destroy();
  }
}
