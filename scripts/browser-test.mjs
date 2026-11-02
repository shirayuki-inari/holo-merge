import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { baseUrl, launch, zh } from "./browser-helpers.mjs";
const browser = await launch();
const base = baseUrl("http://localhost:5173");
await mkdir(".qa", { recursive: true });
const errors = [];
try {
  const page = await browser.newPage({
    locale: "zh-CN",
    viewport: { width: 1440, height: 1100 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
  );
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator("canvas").waitFor();
  await page.screenshot({ path: ".qa/desktop.png", fullPage: true });
  assert.equal(await page.title(), zh("app.title"));
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
  await page.getByRole("button", { name: zh("game.pause"), exact: true }).click();
  await page
    .getByRole("button", { name: zh("game.resume"), exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: zh("settings.title"), exact: true }).click();
  await page.getByRole("switch", { name: zh("settings.bgm"), exact: true }).click();
  assert.equal(
    await page
      .getByRole("switch", { name: zh("settings.bgm"), exact: true })
      .getAttribute("aria-checked"),
    "false",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: zh("help.open") }).click();
  assert.equal(await page.locator("dialog[open]").count(), 1);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await page.getByRole("button", { name: zh("game.restart"), exact: true }).click();
  assert.ok(
    (await page.locator("dialog").innerText()).includes(zh("restart.title")),
  );
  await page.getByRole("button", { name: zh("restart.continue"), exact: true }).click();
  await page.getByRole("button", { name: zh("game.restart"), exact: true }).click();
  await page
    .locator("dialog")
    .getByRole("button", { name: zh("game.restart"), exact: true })
    .click();
  assert.equal(await page.locator(".score-card strong").innerText(), "0");
  console.log(
    "PASS desktop images, keyboard drop, pause/resume, BGM toggle, modal and confirmed restart",
  );
  await canvas.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const setHidden = (value) => {
      Object.defineProperty(document, "hidden", { configurable: true, value });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    setHidden(true);
    setHidden(false);
    delete document.hidden;
  });
  await page
    .locator(".board-overlay")
    .getByRole("button", { name: zh("game.resume"), exact: true })
    .click();
  console.log("PASS leaving the tab mid-round pauses it");
  // Game rules (merging, limit line, drops, determinism) are tested in Node by
  // tests/simulation.test.ts. These cases need a real canvas and animation frames.
  const engineReport = await page.evaluate(
    async (labels) => {
      const { HoloEngine } = await import("/src/game/engine.ts");
      const { createLineup, RADII } = await import("/src/game/model.ts");
      const report = [];
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      function fixture() {
        const c = document.createElement("canvas");
        document.body.append(c);
        const game = new HoloEngine(c, {
          lineup: createLineup(() => 0),
          labels,
          onChange: () => {},
          onMerge: () => {},
          onEnd: () => {},
          onWin: () => {},
        });
        game.setPaused(true);
        // Count this canvas's draws and labels only.
        const ctx = c.getContext("2d");
        const spy = { draws: 0, text: [] };
        const drawImage = ctx.drawImage.bind(ctx);
        ctx.drawImage = (...a) => (spy.draws++, drawImage(...a));
        const fillText = ctx.fillText.bind(ctx);
        ctx.fillText = (v, ...a) => (spy.text.push(String(v)), fillText(v, ...a));
        return {
          game,
          c,
          ctx,
          spy,
          dispose() {
            game.destroy();
            c.remove();
          },
        };
      }
      const step = (g, n) => {
        for (let i = 0; i < n; i++) g.step(1000 / 120);
      };
      function check(v, msg) {
        if (!v) throw new Error(msg);
        report.push(msg);
      }
      {
        const f = fixture();
        f.game.state.current = 0;
        f.game.setPaused(false);
        check(f.game.drop(), "unpaused board accepts a drop");
        const orb = [...f.game.orbs.values()][0];
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
        await wait(80);
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
        const t = f.game.time;
        await wait(100);
        check(
          f.game.time === t && f.game.frame === 0,
          "background visibility stops time and animation frames",
        );
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: false,
        });
        document.dispatchEvent(new Event("visibilitychange"));
        await wait(80);
        check(f.game.time > t, "foreground resumes without a time jump");
        delete document.hidden;
        f.dispose();
      }
      {
        const f = fixture();
        f.game.setPaused(false);
        await wait(300);
        const before = f.spy.draws;
        await wait(500);
        check(
          f.spy.draws === before && f.game.frame !== 0,
          "a still board keeps stepping physics but skips identical frames",
        );
        f.game.setAim(100);
        await wait(60);
        check(f.spy.draws > before, "moving the aim redraws");
        f.dispose();
      }
      {
        const f = fixture();
        f.game.setPaused(false);
        const start = f.game.x;
        f.game.setSteer(1);
        await wait(300);
        f.game.setSteer(0);
        const moved = f.game.x - start;
        await wait(60);
        check(
          moved > 30 && f.game.x === start + moved,
          `a held arrow glides the aim (${moved.toFixed(0)} px in 300 ms) and stops on release`,
        );
        f.dispose();
      }
      {
        // A paused board stays painted when the device pixel ratio changes
        // (zoom fires resize; rebuilding the bitmap clears it).
        const f = fixture();
        f.game.addOrb(3, 220, 400);
        f.game.setPaused(true);
        const width = f.c.width;
        Object.defineProperty(window, "devicePixelRatio", {
          configurable: true,
          value: width === 440 ? 2 : 1,
        });
        dispatchEvent(new Event("resize"));
        const resized = f.c.width;
        const [r, g, b] = f.ctx.getImageData(
          resized / 2,
          resized * 0.3,
          1,
          1,
        ).data;
        delete window.devicePixelRatio;
        dispatchEvent(new Event("resize"));
        check(
          resized !== width && r + g + b > 600,
          `paused board repaints after a DPR change (${width} → ${resized} px)`,
        );
        f.dispose();
      }
      {
        const f = fixture();
        const held = f.game.addOrb(0, 220, 80);
        held.isStatic = true;
        step(f.game, 300);
        f.spy.text.length = 0;
        f.game.draw();
        check(
          f.spy.text.some((t) =>
            new RegExp(`^${labels.danger} \\d\\.\\ds$`).test(t),
          ),
          "the limit line shows the remaining seconds: " +
            f.spy.text.find((t) => t.startsWith(labels.danger)),
        );
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
          ms < 16.67 && RADII.length === 11,
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
    },
    { limit: zh("game.limit"), danger: zh("game.danger") },
  );
  engineReport.forEach((m) => console.log("PASS " + m));
  const record = await browser.newPage({
    locale: "zh-CN",
    viewport: { width: 1100, height: 900 },
  });
  record.on("pageerror", (e) => errors.push(e.message));
  await record.addInitScript(() => {
    Math.random = () => 0.1;
  });
  await record.route("**/api/**", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
  );
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
  // Scores count up; wait for the shown best to reach the stored value.
  await record.waitForFunction(
    () =>
      document
        .querySelector(".best-card strong")
        .textContent.replaceAll(",", "") ===
      localStorage.getItem("holo-merge-best-v1"),
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
    locale: "zh-CN",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  mobile.on("pageerror", (e) => errors.push(e.message));
  await mobile.route("**/api/**", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
  );
  await mobile.goto(base, { waitUntil: "networkidle" });
  await mobile.screenshot({ path: ".qa/mobile.png", fullPage: true });
  const bounds = await mobile.locator("canvas").boundingBox();
  await mobile.touchscreen.tap(
    bounds.x + bounds.width * 0.3,
    bounds.y + bounds.height * 0.45,
  );
  await mobile.waitForTimeout(500);
  await mobile.getByRole("button", { name: zh("game.restart"), exact: true }).click();
  assert.ok(
    (await mobile.locator("dialog").innerText()).includes(zh("restart.title")),
  );
  await mobile
    .locator("dialog")
    .getByRole("button", { name: zh("restart.continue") })
    .click();
  await mobile.locator("canvas").scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: ".qa/mobile-playing.png", fullPage: true });
  console.log("PASS mobile touch drop and modal");
  // A drag that moves far vertically cancels the drop and says so while armed.
  await mobile.getByRole("button", { name: zh("game.restart"), exact: true }).click();
  await mobile
    .locator("dialog")
    .getByRole("button", { name: zh("game.restart"), exact: true })
    .click();
  const welcome = mobile.locator(".empty-welcome");
  await welcome.waitFor();
  const touch = await mobile.context().newCDPSession(mobile);
  const pad = await mobile.locator("canvas").boundingBox();
  const finger = (type, y) =>
    touch.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchEnd" ? [] : [{ x: pad.x + pad.width / 2, y: pad.y + y }],
    });
  await finger("touchStart", pad.height * 0.7);
  await finger("touchMove", pad.height * 0.3);
  await mobile
    .getByRole("status")
    .filter({ hasText: zh("game.dropCancel") })
    .waitFor();
  await finger("touchEnd");
  await mobile.waitForTimeout(200);
  assert.equal(await mobile.locator(".drop-cancel").count(), 0);
  assert.ok(await welcome.isVisible(), "cancelled drag must not drop");
  console.log("PASS touch drag cancel hint and cancelled drop");
  // Ranked rounds: registered players start with one request, and the next
  // seed is fetched while the restart dialog is open so "restart" is instant.
  const ranked = await browser.newPage({
    locale: "zh-CN",
    viewport: { width: 1280, height: 900 },
  });
  ranked.on("pageerror", (e) => errors.push(e.message));
  const calls = [];
  let runs = 0;
  await ranked.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push(`${request.method()} ${path}`);
    const json = (body) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/leaderboard")
      return json({
        entries: [],
        me: { id: "fixture", name: "Fixture", avatar: "azki", score: 0, rank: null },
      });
    if (path === "/api/runs")
      return json({
        id: `run-${++runs}`,
        seed: runs,
        version: 1,
        expires: Date.now() + 6 * 3_600_000,
      });
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  const rankReady = ranked.getByText(zh("rank.ready"), { exact: true });
  await ranked.goto(base, { waitUntil: "networkidle" });
  await rankReady.waitFor();
  assert.deepEqual(calls, ["GET /api/leaderboard", "POST /api/runs"]);
  calls.length = 0;
  await ranked.reload({ waitUntil: "networkidle" });
  await rankReady.waitFor();
  assert.deepEqual(calls, ["POST /api/runs"], "registered: no leaderboard fetch");
  calls.length = 0;
  await ranked.locator("canvas").click();
  await ranked.getByRole("button", { name: zh("game.restart"), exact: true }).click();
  await ranked.waitForTimeout(300);
  assert.deepEqual(calls, ["POST /api/runs"], "next seed prefetched");
  calls.length = 0;
  await ranked
    .locator("dialog")
    .getByRole("button", { name: zh("game.restart"), exact: true })
    .click();
  await ranked.locator(".empty-welcome").waitFor({ timeout: 1000 });
  await rankReady.waitFor({ timeout: 1000 });
  assert.deepEqual(calls, [], "restart uses the prefetched seed");
  await ranked.close();
  console.log("PASS ranked start uses one request; restart reuses the prefetched seed");
  assert.deepEqual(errors, []);
  console.log("PASS zero browser runtime errors");
} finally {
  await browser.close();
}
