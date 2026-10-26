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
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--autoplay-policy=document-user-activation-required",
  ],
});
const base = process.env.BASE_URL || "http://localhost:5173";
await mkdir(".qa", { recursive: true });
try {
  const page = await browser.newPage({
    locale: "zh-CN",
    viewport: { width: 1280, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Math.random = () => 0.1;
    window.__canvasText = [];
    const text = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (value, ...args) {
      window.__canvasText.push(value);
      if (window.__canvasText.length > 200) window.__canvasText.shift();
      return text.call(this, value, ...args);
    };
  });
  // No live leaderboard records are created, including when testing the production domain.
  const me = {
    id: "settings-fixture",
    name: "Settings Test",
    avatar: "shirakami-fubuki",
    score: 0,
    rank: null,
  };
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === "/api/leaderboard"
        ? {
            me,
            entries: [
              {
                id: "demo",
                name: "Demo Player",
                avatar: "shirakami-fubuki",
                score: 20680,
                rank: 1,
              },
            ],
          }
        : {
            code: "invalidName",
            error: "名称须为 1–16 个字，不能包含控制符或尖括号。",
          };
    return route.fulfill({
      status: path === "/api/leaderboard" ? 200 : 400,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await page
    .getByText("本局为离线游戏，排行榜暂不可用", { exact: true })
    .waitFor();
  assert.equal(await page.locator(".header-actions button").count(), 3);
  for (let i = 0; i < 12; i++) {
    await page.locator("canvas").click();
    await page.waitForTimeout(500);
  }
  assert.ok(
    Number(
      (await page.locator(".score-card strong").innerText()).replaceAll(
        ",",
        "",
      ),
    ) > 0,
  );
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.evaluate(() => {
    window.__originalCanvas = document.querySelector("canvas");
    window.__score = document.querySelector(".score-card strong").textContent;
    window.__lineup = [...document.querySelectorAll(".evolution-item img")].map(
      (img) => img.src,
    );
  });
  const audio = page.locator("audio");
  for (const track of ["01", "02", "03"]) {
    await page
      .getByRole("button", { name: `曲目 ${track}`, exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: `曲目 ${track}`, exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.waitForFunction(
      () =>
        !document.querySelector("audio").paused &&
        document.querySelector("audio").currentTime > 0.05,
    );
  }
  const source3 = await audio.getAttribute("src");
  assert.equal(await page.locator("audio").count(), 1);
  assert.doesNotMatch(
    await page.locator("dialog").innerText(),
    /bgm_park|\.mp3/,
  );
  await page.getByRole("switch", { name: "背景音乐", exact: true }).click();
  await page.getByRole("button", { name: "曲目 02", exact: true }).click();
  assert.equal(
    await audio.evaluate((el) => el.paused),
    true,
    "switching tracks cannot unmute BGM",
  );
  const source2 = await audio.getAttribute("src");
  assert.notEqual(source2, source3);
  await page.getByRole("switch", { name: "角色语音", exact: true }).click();
  assert.equal(
    await page
      .getByRole("switch", { name: "角色语音", exact: true })
      .getAttribute("aria-checked"),
    "false",
  );
  for (const [lang, title, limit] of [
    ["en", "Settings", "Limit"],
    ["ja", "設定", "警戒線"],
    ["zh-CN", "设置", "警戒线"],
  ]) {
    await page.locator("#game-language").selectOption(lang);
    assert.equal(await page.locator("html").getAttribute("lang"), lang);
    assert.equal(await page.locator("dialog h2").innerText(), title);
    assert.equal(
      await page.evaluate(
        () => window.__originalCanvas === document.querySelector("canvas"),
      ),
      true,
    );
    assert.equal(
      await page.locator(".score-card strong").innerText(),
      await page.evaluate(() => window.__score),
    );
    assert.deepEqual(
      await page
        .locator(".evolution-item img")
        .evaluateAll((imgs) => imgs.map((img) => img.src)),
      await page.evaluate(() => window.__lineup),
    );
    assert.ok(
      await page.evaluate(
        (value) => window.__canvasText.includes(value),
        limit,
      ),
      "canvas labels update while the game is paused",
    );
    for (const width of [320, 390, 580, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        width,
        `${lang}, ${width}px`,
      );
      assert.equal(
        await page
          .locator("dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
        `settings overflow: ${lang}, ${width}`,
      );
    }
  }
  await page.locator("#game-language").selectOption("en");
  await page.screenshot({ path: ".qa/settings-en.png", fullPage: true });
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "View instructions", exact: true })
    .click();
  assert.match(await page.locator("dialog").innerText(), /Generation 0/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Merge guide", exact: true }).click();
  assert.match(await page.locator("dialog").innerText(), /Generation 0/);
  assert.doesNotMatch(
    await page.locator("dialog").innerText(),
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Leaderboard", exact: true }).click();
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await page.getByLabel("Player name", { exact: true }).fill("Invalid Profile");
  await page
    .getByRole("button", {
      name: "Choose avatar: Shirakami Fubuki",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /Names must be/);
  assert.doesNotMatch(
    await page.locator("dialog").innerText(),
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
  );
  await page.screenshot({ path: ".qa/leaderboard-en.png", fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("#game-language").selectOption("ja");
  await page.screenshot({ path: ".qa/settings-ja.png", fullPage: true });
  const voiceRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/audio/characters/"))
      voiceRequests.push(request.url());
  });
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("html").getAttribute("lang"), "ja");
  await page.getByRole("button", { name: "設定", exact: true }).click();
  assert.equal(await audio.getAttribute("src"), source2);
  assert.equal(await audio.evaluate((el) => el.paused), true);
  assert.equal(
    await page
      .getByRole("switch", { name: "キャラクターボイス", exact: true })
      .getAttribute("aria-checked"),
    "false",
  );
  assert.deepEqual(voiceRequests, [], "muted voices are not fetched on reload");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "ランキング", exact: true }).click();
  await page
    .getByRole("button", { name: "プロフィールを編集", exact: true })
    .click();
  assert.equal(
    await page.getByRole("button", { name: /^アバターを選択：/ }).count(),
    43,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "遊び方を見る", exact: true }).click();
  assert.match(await page.locator("dialog").innerText(), /0期生/);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.screenshot({ path: ".qa/settings-mobile.png", fullPage: true });
  const auto = await browser.newPage({ locale: "en-US" });
  await auto.route("**/api/**", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
  );
  await auto.addInitScript(() => {
    if (!localStorage.getItem("holo-merge-language-v1"))
      localStorage.setItem("holo-merge-language-v1", "invalid-locale");
  });
  await auto.goto(base, { waitUntil: "networkidle" });
  assert.equal(await auto.locator("html").getAttribute("lang"), "en");
  await auto.getByRole("button", { name: "Settings", exact: true }).click();
  await auto.locator("#game-language").selectOption("ja");
  await auto.reload({ waitUntil: "networkidle" });
  assert.equal(
    await auto.locator("html").getAttribute("lang"),
    "ja",
    "manual language overrides browser language",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS all three numbered BGM tracks play; mute, selection and voice preference persist; muted voices make no requests",
  );
  console.log(
    "PASS Chinese/Japanese/English UI, canvas, help, members, profiles, localized API errors, browser language and manual override",
  );
  console.log(
    "PASS language changes preserve the board, score and lineup; three header controls; all languages fit 320–1280px; no runtime errors",
  );
} finally {
  await browser.close();
}
