import { Simulation, type SimulationOptions } from "./simulation";
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
export class HoloEngine extends Simulation {
  private ctx: CanvasRenderingContext2D;
  private background = document.createElement("canvas");
  private sprites: HTMLCanvasElement[] = [];
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private frame = 0;
  private last = 0;
  private accumulator = 0;
  private paused = false;
  private hidden = document.hidden;
  private disposed = false;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private observer: ResizeObserver;
  constructor(
    private canvas: HTMLCanvasElement,
    private visualOptions: Options,
  ) {
    super(visualOptions);
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    this.loadSprites();
    document.addEventListener("visibilitychange", this.visibility);
    this.emit();
    this.frame = requestAnimationFrame(this.tick);
  }
  setLabels(labels: NonNullable<Options["labels"]>) {
    this.visualOptions.labels = labels;
    this.draw();
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
    this.visualOptions.lineup.forEach((talent, level) => {
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
  override drop() {
    if (this.paused || this.hidden) return false;
    return super.drop();
  }
  protected override onMergeVisual(
    level: number,
    x: number,
    y: number,
    points: number,
  ) {
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
      this.state.danger
        ? (this.visualOptions.labels?.danger ?? "!")
        : (this.visualOptions.labels?.limit ?? "—"),
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
    super.destroy();
  }
}
