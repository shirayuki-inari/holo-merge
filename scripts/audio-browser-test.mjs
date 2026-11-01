import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { baseUrl, launch, zh } from "./browser-helpers.mjs";
const browser = await launch(["--autoplay-policy=document-user-activation-required", "--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies"]);
const base = baseUrl("http://localhost:5173");
await mkdir(".qa", { recursive: true });
try {
  const page = await browser.newPage({
    locale: "zh-CN",
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
  );
  await page.goto(base, { waitUntil: "networkidle" });
  const audio = page.locator("audio");
  assert.equal(await audio.count(), 1);
  const source = await audio.getAttribute("src");
  assert.match(source, /^\/audio\/bgm\/bgm_park_area_.*\.mp3$/);
  assert.equal(await audio.evaluate((el) => el.loop), true);
  assert.equal(
    await audio.evaluate((el) => el.paused),
    true,
    "strict autoplay policy waits for a gesture",
  );
  // Open the panel programmatically to retain the blocked autoplay state.
  await page
    .getByRole("button", { name: zh("settings.title"), exact: true })
    .evaluate((el) => el.click());
  // Turning off must not count as the gesture that starts music.
  await page.getByRole("switch", { name: zh("settings.bgm"), exact: true }).click();
  assert.equal(await audio.evaluate((el) => el.paused), true);
  assert.equal(await audio.evaluate((el) => el.currentTime), 0);
  await page.keyboard.press("Escape");
  const canvas = page.locator("canvas");
  await canvas.click();
  assert.equal(await audio.evaluate((el) => el.paused), true);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: zh("settings.title"), exact: true }).click();
  assert.equal(
    await page
      .getByRole("switch", { name: zh("settings.bgm"), exact: true })
      .getAttribute("aria-checked"),
    "false",
  );
  assert.equal(await audio.evaluate((el) => el.paused), true);
  console.log(
    "PASS blocked autoplay, off gesture, off during gameplay, preference survives reload",
  );
  await page.getByRole("switch", { name: zh("settings.bgm"), exact: true }).click();
  await page.waitForFunction(() => {
    const a = document.querySelector("audio");
    return !a.paused && a.currentTime > 0.15 && a.readyState >= 2;
  });
  const playingSource = await audio.getAttribute("src");
  assert.equal(await audio.evaluate((el) => el.volume), 0.35);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: zh("game.pause"), exact: true }).click();
  assert.equal(await audio.evaluate((el) => el.paused), true);
  const frozen = await audio.evaluate((el) => el.currentTime);
  await page.waitForTimeout(150);
  assert.equal(await audio.evaluate((el) => el.currentTime), frozen);
  await page
    .getByRole("button", { name: zh("game.resume"), exact: true })
    .last()
    .click();
  await page.waitForFunction(() => !document.querySelector("audio").paused);
  assert.equal(await audio.getAttribute("src"), playingSource);
  await canvas.click();
  await page.getByRole("button", { name: zh("game.restart"), exact: true }).click();
  await page
    .locator("dialog")
    .getByRole("button", { name: zh("game.restart"), exact: true })
    .click();
  assert.equal(
    await audio.getAttribute("src"),
    playingSource,
    "restart does not interrupt the track",
  );
  assert.equal(await audio.evaluate((el) => el.paused), false);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  assert.equal(await audio.evaluate((el) => el.paused), true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(() => !document.querySelector("audio").paused);
  await page.getByRole("button", { name: zh("settings.title"), exact: true }).click();
  await page.getByRole("switch", { name: zh("settings.bgm"), exact: true }).click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    delete document.hidden;
  });
  assert.equal(await audio.evaluate((el) => el.paused), true);
  console.log(
    "PASS actual playback, looping configuration, pause/resume, restart and visibility lifecycle",
  );
  // File validity and durations: tests/media.test.ts. Playing each numbered
  // track through the settings UI: settings-browser-test.mjs.
  for (const width of [320, 390, 580, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".qa/bgm-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("PASS BGM control layout at 320–1280px and no runtime errors");
} finally {
  await browser.close();
}
