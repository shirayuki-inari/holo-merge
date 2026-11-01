import assert from "node:assert/strict";
import { baseUrl, launch, literal, zh } from "./browser-helpers.mjs";
// "第 {rank} 名 · {score} 分" without the rank, e.g. " · 36 分".
const scoreSuffix = (score) =>
  zh("board.rank", { rank: "\0", score }).split("\0")[1];
const browser = await launch();
const base = baseUrl("http://127.0.0.1:5173");
try {
  const page = await browser.newPage({
    locale: "zh-CN",
    viewport: { width: 390, height: 844 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByText(zh("rank.ready"), { exact: true }).waitFor();
  await page.getByRole("button", { name: zh("board.title"), exact: true }).click();
  await page.getByRole("button", { name: zh("board.edit"), exact: true }).click();
  await page.getByLabel(zh("board.name")).fill("星街玩家");
  const avatars = page.getByRole("button", {
    name: new RegExp("^" + literal(zh("board.chooseAvatar", { name: "" }))),
  });
  assert.equal(await avatars.count(), 43);
  await page
    .getByRole("button", {
      name: zh("board.chooseAvatar", { name: "星街すいせい" }),
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: zh("board.save"), exact: true }).click();
  await page.getByText(zh("board.saved"), { exact: true }).waitFor();
  assert.equal(
    await page.locator(".player-summary strong").innerText(),
    "星街玩家",
  );
  await page.keyboard.press("Escape");
  // Capture the real App engine without altering any physics, seed or score.
  await page.evaluate(async () => {
    const { HoloEngine } = await import("/src/game/engine.ts");
    const original = HoloEngine.prototype.drop;
    HoloEngine.prototype.drop = function () {
      window.__rankedEngine = this;
      return original.call(this);
    };
  });
  const canvas = page.locator("canvas");
  for (let i = 0; i < 12; i++) {
    await canvas.click();
    await page.waitForTimeout(700);
  }
  await page.getByRole("button", { name: zh("board.title"), exact: true }).click();
  const score = await page.evaluate(() => window.__rankedEngine.state.score);
  assert.ok(score > 0);
  const snapshot = await page.evaluate(() => window.__rankedEngine.replay());
  await page
    .getByRole("button", { name: zh("board.submit"), exact: true })
    .click();
  await page.getByText(new RegExp(
        [zh("score.improved", { score }), zh("score.kept", { score })]
          .map(literal)
          .join("|"),
      ),).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: zh("board.submit"), exact: true })
      .count(),
    0,
  );
  await page.waitForFunction(
    (suffix) =>
      document
        .querySelector(".player-summary small")
        ?.textContent.includes(suffix),
    scoreSuffix(score),
  );
  assert.match(
    await page.locator(".player-summary small").innerText(),
    new RegExp(literal(scoreSuffix(score))),
  );
  assert.equal(
    await page.locator(".rank-list .is-me .rank-name").innerText(),
    "星街玩家" + zh("board.me"),
  );
  await page.screenshot({ path: ".qa/leaderboard-mobile.png", fullPage: true });
  // Verify the browser and Node replays agree, including a longer recorded game.
  for (const seed of [0, 42, 0xffffffff]) {
    const result = await page.evaluate(async (seed) => {
      const { Simulation } = await import("/src/game/simulation.ts");
      const game = new Simulation({
        seed,
        onChange() {},
        onMerge() {},
        onWin() {},
        onEnd() {},
      });
      for (let i = 0; i < 80 && !game.state.over; i++) {
        game.setAim(30 + ((i * 73) % 380));
        game.drop();
        for (let j = 0; j < 95 && !game.state.over; j++) game.advance();
      }
      const result = { replay: game.replay(), score: game.state.score };
      game.destroy();
      return result;
    }, seed);
    // Import TS via tsx separately in the HTTP smoke; here compare with Node's bundled backend replay using a test session.
    const { execFileSync } = await import("node:child_process");
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import { replayScore } from './server/api.ts'; console.log(await replayScore(${seed}, ${JSON.stringify(result.replay)}));`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(
      Number(output.trim()),
      result.score,
      `cross-runtime physics seed ${seed}`,
    );
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: zh("board.title"), exact: true }).click();
  await page.getByText("星街玩家", { exact: true }).first().waitFor();
  assert.match(
    await page.locator(".player-summary small").innerText(),
    new RegExp(literal(scoreSuffix(score))),
  );
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.ok(
      await page
        .locator("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    `PASS leaderboard profile, 43 avatars, real-game score ${score}, ${snapshot.drops.length} drops, server replay, browser reload, 320–1280px layouts`,
  );
} finally {
  await browser.close();
}
