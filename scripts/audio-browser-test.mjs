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
    "--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies",
  ],
});
const base = process.env.BASE_URL || "http://localhost:5173";
await mkdir(".qa", { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", route => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
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
  // Turning off must not count as the gesture that starts music.
  await page.getByRole("button", { name: "关闭背景音乐" }).click();
  assert.equal(await audio.evaluate((el) => el.paused), true);
  assert.equal(await audio.evaluate((el) => el.currentTime), 0);
  const canvas = page.locator("canvas");
  await canvas.click();
  assert.equal(await audio.evaluate((el) => el.paused), true);
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(
    await page
      .getByRole("button", { name: "开启背景音乐" })
      .getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(await audio.evaluate((el) => el.paused), true);
  console.log(
    "PASS blocked autoplay, off gesture, off during gameplay, preference survives reload",
  );
  await page.getByRole("button", { name: "开启背景音乐" }).click();
  await page.waitForFunction(() => {
    const a = document.querySelector("audio");
    return !a.paused && a.currentTime > 0.15 && a.readyState >= 2;
  });
  const playingSource = await audio.getAttribute("src");
  assert.equal(await audio.evaluate((el) => el.volume), 0.35);
  await page.getByRole("button", { name: "暂停游戏", exact: true }).click();
  assert.equal(await audio.evaluate((el) => el.paused), true);
  const frozen = await audio.evaluate((el) => el.currentTime);
  await page.waitForTimeout(150);
  assert.equal(await audio.evaluate((el) => el.currentTime), frozen);
  await page
    .getByRole("button", { name: "继续游戏", exact: true })
    .last()
    .click();
  await page.waitForFunction(() => !document.querySelector("audio").paused);
  assert.equal(await audio.getAttribute("src"), playingSource);
  await canvas.click();
  await page.getByRole("button", { name: "重新开始", exact: true }).click();
  await page
    .locator("dialog")
    .getByRole("button", { name: "重新开始", exact: true })
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
  await page.getByRole("button", { name: "关闭背景音乐" }).click();
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    delete document.hidden;
  });
  assert.equal(await audio.evaluate((el) => el.paused), true);
  console.log(
    "PASS actual playback, looping configuration, pause/resume, restart and visibility lifecycle",
  );
  const media = await page.evaluate(async () => {
    const { BGM_TRACKS } = await import("/src/audio/bgm.ts");
    const decoded = [];
    for (const source of BGM_TRACKS) {
      const sample = new Audio(source);
      sample.preload = "auto";
      await new Promise((resolve, reject) => {
        sample.addEventListener("canplay", resolve, { once: true });
        sample.addEventListener(
          "error",
          () => reject(new Error("Cannot decode " + source)),
          { once: true },
        );
      });
      await sample.play();
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (sample.paused || sample.currentTime === 0 || sample.error)
        throw new Error("Playback failed: " + source);
      decoded.push({ source, duration: sample.duration });
      sample.pause();
      sample.removeAttribute("src");
      sample.load();
    }
    return decoded;
  });
  assert.equal(media.length, 3);
  media.forEach((item) => assert.ok(item.duration > 60));
  console.log(
    "PASS all three MP3 files decoded and played:",
    JSON.stringify(media),
  );
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
