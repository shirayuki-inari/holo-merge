import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const android = process.platform === "android";
if (android) Object.defineProperty(process, "platform", { value: "linux" });
const { chromium } = await import("playwright-core");
const browser = await chromium.launch({
  executablePath:
    process.env.BROWSER_PATH ||
    (android
      ? "/data/data/com.termux/files/usr/bin/chromium-browser"
      : chromium.executablePath()),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const base = process.env.BASE_URL || "http://localhost:5173";
await mkdir(".qa", { recursive: true });
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", route => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator("canvas").waitFor();
  await page.screenshot({ path: ".qa/desktop.png", fullPage: true });
  assert.equal(await page.title(), "holo merge! — hololive 合成游戏");
  assert.equal(await page.locator(".evolution-item").count(), 11);
  assert.deepEqual(
    await page.evaluate(() =>
      [...document.images]
        .filter((i) => !i.complete || !i.naturalWidth)
        .map((i) => i.src),
    ),
    [],
  );
  const canvas = page.locator(".canvas-wrap canvas");
  await canvas.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Space");
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "暂停游戏", exact: true }).click();
  await page
    .getByRole("button", { name: "继续游戏", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "关闭背景音乐", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "开启背景音乐", exact: true })
      .getAttribute("aria-pressed"),
    "false",
  );
  await page.getByRole("button", { name: "查看玩法说明" }).click();
  assert.equal(await page.locator("dialog[open]").count(), 1);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await page.getByRole("button", { name: "重新开始", exact: true }).click();
  assert.match(await page.locator("dialog").innerText(), /重新开始会清空棋盘/);
  await page.getByRole("button", { name: "继续本局", exact: true }).click();
  await page.getByRole("button", { name: "重新开始", exact: true }).click();
  await page
    .locator("dialog")
    .getByRole("button", { name: "重新开始", exact: true })
    .click();
  assert.equal(await page.locator(".score-card strong").innerText(), "0");
  console.log(
    "PASS desktop images, keyboard drop, pause/resume, BGM toggle, modal and confirmed restart",
  );
  // Fixture tests use the real production physics class and a fixed clock for deterministic collision coverage.
  const physics = await page.evaluate(async () => {
    const { HoloEngine } = await import("/src/game/engine.ts");
    const { createLineup, RADII, mergePoints } =
      await import("/src/game/model.ts");
    const matterURL = performance
      .getEntriesByType("resource")
      .find((e) => e.name.includes("/matter-js.js")).name;
    const { default: Matter } = await import(matterURL);
    const report = [];
    function fixture() {
      const c = document.createElement("canvas");
      document.body.append(c);
      let ended = 0,
        won = 0;
      const game = new HoloEngine(c, {
        lineup: createLineup(() => 0),
        onChange: () => {},
        onMerge: () => {},
        onEnd: () => ended++,
        onWin: () => won++,
      });
      game.setPaused(true);
      return {
        game,
        c,
        end: () => ended,
        win: () => won,
        dispose() {
          game.destroy();
          c.remove();
        },
      };
    }
    function step(g, n) {
      for (let i = 0; i < n; i++) g.step(1000 / 120);
    }
    function check(v, msg) {
      if (!v) throw new Error(msg);
      report.push(msg);
    }
    for (let level = 0; level < 10; level++) {
      const f = fixture(),
        r = RADII[level];
      f.game.addOrb(level, 220 - r * 0.9, 560 - r);
      f.game.addOrb(level, 220 + r * 0.9, 560 - r);
      step(f.game, 30);
      check(
        f.game.orbs.size === 1 &&
          f.game.state.highest === level + 1 &&
          f.game.state.score === mergePoints(level + 1),
        "merge tier " + level + " → " + (level + 1),
      );
      if (level === 9)
        check(f.win() === 1, "maximum tier triggers win exactly once");
      f.dispose();
    }
    {
      const f = fixture();
      f.game.addOrb(10, 115, 450);
      f.game.addOrb(10, 315, 450);
      step(f.game, 60);
      check(
        f.game.orbs.size === 2 && f.game.state.score === 0,
        "maximum tier cannot overflow the lineup",
      );
      f.dispose();
    }
    {
      const f = fixture();
      f.game.addOrb(0, 200, 530);
      f.game.addOrb(1, 230, 530);
      step(f.game, 120);
      check(
        f.game.orbs.size === 2 && f.game.state.score === 0,
        "different members never merge",
      );
      f.dispose();
    }
    {
      const f = fixture();
      for (const x of [190, 220, 250]) f.game.addOrb(0, x, 530);
      step(f.game, 60);
      check(
        f.game.orbs.size === 2 && f.game.state.score === 4,
        "simultaneous three-way contact consumes each orb once",
      );
      f.dispose();
    }
    {
      const f = fixture();
      for (const x of [202, 214, 226, 238]) f.game.addOrb(0, x, 530);
      step(f.game, 240);
      check(
        f.game.orbs.size === 1 &&
          f.game.state.highest === 2 &&
          f.game.state.score === 16,
        "four-orb collision chains through two generations",
      );
      f.dispose();
    }
    {
      const f = fixture();
      const b = f.game.addOrb(0, 220, 80);
      Matter.Sleeping.set(b, true);
      step(f.game, 180);
      check(
        !f.game.state.danger && !f.game.state.over,
        "new drops have a 1.6 second danger grace period",
      );
      step(f.game, 50);
      check(
        f.game.state.danger && !f.game.state.over,
        "danger warns before game over",
      );
      Matter.Body.setPosition(b, { x: 220, y: 400 });
      step(f.game, 5);
      check(
        !f.game.state.danger && !f.game.state.over,
        "clearing the limit line resets danger",
      );
      Matter.Body.setPosition(b, { x: 220, y: 80 });
      Matter.Sleeping.set(b, true);
      step(f.game, 280);
      check(
        f.game.state.over && f.end() === 1,
        "sustained overflow ends the game",
      );
      check(!f.game.drop(), "game over blocks further drops");
      f.dispose();
    }
    {
      const f = fixture();
      f.game.state.current = 0;
      f.game.setPaused(false);
      f.game.setAim(-1000);
      check(f.game.drop(), "first drop accepted");
      check(!f.game.drop(), "rapid duplicate drop is throttled");
      const orb = [...f.game.orbs.values()][0];
      check(orb.body.position.x - RADII[0] > 6, "drop clamped inside walls");
      f.game.setPaused(true);
      const before = orb.body.position.y;
      f.game.tick(performance.now() + 1000);
      check(
        orb.body.position.y === before && !f.game.drop(),
        "pause stops both time and input",
      );
      f.dispose();
    }
    {
      const f = fixture();
      f.game.addOrb(0, 220, 100);
      f.game.setPaused(false);
      await new Promise((r) => setTimeout(r, 80));
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      const t = f.game.time;
      await new Promise((r) => setTimeout(r, 100));
      check(
        f.game.time === t && f.game.frame === 0,
        "background visibility stops time and animation frames",
      );
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((r) => setTimeout(r, 80));
      check(f.game.time > t, "foreground resumes without a time jump");
      delete document.hidden;
      f.dispose();
    }
    {
      const f = fixture();
      for (let row = 0; row < 9; row++)
        for (let col = 0; col < 8; col++)
          f.game.addOrb((row + col) % 3, 30 + col * 54, 180 + row * 40);
      const before = f.game.orbs.size;
      const start = performance.now();
      for (let i = 0; i < 240; i++) {
        step(f.game, 2);
        f.game.draw();
      }
      const ms = (performance.now() - start) / 240;
      check(
        ms < 16.67,
        "dense board throughput: " +
          before +
          " initial orbs, " +
          f.game.orbs.size +
          " final, " +
          ms.toFixed(2) +
          " ms per physics + render frame (60 FPS budget: 16.67 ms)",
      );
      f.dispose();
    }
    return report;
  });
  physics.forEach((m) => console.log("PASS " + m));
  const record = await browser.newPage({
    viewport: { width: 1100, height: 900 },
  });
  record.on("pageerror", (e) => errors.push(e.message));
  await record.addInitScript(() => {
    Math.random = () => 0.1;
  });
  await record.route("**/api/**", route => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await record.goto(base, { waitUntil: "networkidle" });
  const recordCanvas = record.locator("canvas");
  const board = await recordCanvas.boundingBox();
  await recordCanvas.click({
    position: { x: board.width / 2, y: board.height * 0.7 },
  });
  await record.waitForTimeout(900);
  await recordCanvas.click({
    position: { x: board.width / 2, y: board.height * 0.7 },
  });
  await record.waitForFunction(
    () =>
      Number(
        document
          .querySelector(".score-card strong")
          .textContent.replaceAll(",", ""),
      ) > 0,
  );
  const savedBest = await record.locator(".best-card strong").innerText();
  await record.screenshot({ path: ".qa/desktop-playing.png", fullPage: true });
  await record.reload({ waitUntil: "networkidle" });
  assert.equal(
    await record.locator(".best-card strong").innerText(),
    savedBest,
  );
  await record.close();
  console.log(
    "PASS natural drop collision scores points and highest score survives reload",
  );
  for (const width of [320, 390, 580, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const size = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      view: innerWidth,
    }));
    assert.equal(size.page, size.view, "horizontal overflow at " + width);
  }
  console.log(
    "PASS no horizontal overflow at 320, 390, 580, 768, 1024, 1440 px",
  );
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  mobile.on("pageerror", (e) => errors.push(e.message));
  await mobile.route("**/api/**", route => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await mobile.goto(base, { waitUntil: "networkidle" });
  await mobile.screenshot({ path: ".qa/mobile.png", fullPage: true });
  const bounds = await mobile.locator("canvas").boundingBox();
  await mobile.touchscreen.tap(
    bounds.x + bounds.width * 0.3,
    bounds.y + bounds.height * 0.45,
  );
  await mobile.waitForTimeout(500);
  await mobile.getByRole("button", { name: "重新开始", exact: true }).click();
  assert.match(
    await mobile.locator("dialog").innerText(),
    /重新开始会清空棋盘/,
  );
  await mobile
    .locator("dialog")
    .getByRole("button", { name: "继续本局" })
    .click();
  await mobile.locator("canvas").scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: ".qa/mobile-playing.png", fullPage: true });
  console.log("PASS mobile touch drop and modal");
  assert.deepEqual(errors, []);
  console.log("PASS zero browser runtime errors");
} finally {
  await browser.close();
}
