import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const manifest = JSON.parse(
  await readFile("release/deployment-manifest.json", "utf8"),
);
const voices = JSON.parse(
  await readFile("src/audio/character-voices.json", "utf8"),
);
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
const base = process.env.BASE_URL || "http://127.0.0.1:4173";
try {
  const page = await browser.newPage({
    locale: "zh-CN",
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Check the bytes actually served by the extracted deployment package.
  const pending = [...manifest.files];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (pending.length) {
        const file = pending.shift();
        const response = await page.request.get(
          new URL(file.path, base + "/").href,
        );
        assert.equal(response.status(), 200, file.path);
        const body = await response.body();
        assert.equal(body.length, file.bytes, file.path);
        assert.equal(
          createHash("sha256").update(body).digest("hex"),
          file.sha256,
          file.path,
        );
        const mime = response.headers()["content-type"] || "";
        if (file.path.endsWith(".mp3")) assert.match(mime, /audio\/mpeg/);
        if (file.path.endsWith(".js")) assert.match(mime, /javascript/);
        if (file.path.endsWith(".css")) assert.match(mime, /text\/css/);
      }
    }),
  );
  assert.equal(
    (await page.request.get(base + "/audio/missing.mp3")).status(),
    404,
  );
  console.log(
    `PASS all ${manifest.fileCount} deployed files match the size/hash manifest; media MIME and missing-file 404 are correct`,
  );
  await page.addInitScript(() => {
    Math.random = () => 0.95;
    window.__voiceStarts = [];
    const NativeAudioContext = window.AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      createBufferSource() {
        const node = super.createBufferSource();
        const start = node.start.bind(node);
        node.start = (...args) => {
          window.__voiceStarts.push(node.buffer?.duration);
          return start(...args);
        };
        return node;
      }
    };
  });
  await page.goto(base, { waitUntil: "networkidle" });
  assert.match(
    await page.locator(".evolution-item").nth(2).getAttribute("aria-label"),
    /轟はじめ/,
  );
  assert.equal(
    await page
      .locator("img")
      .evaluateAll((images) =>
        images.every((image) => image.complete && image.naturalWidth > 0),
      ),
    true,
  );
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("switch", { name: "背景音乐", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.locator("canvas").click();
  await page.waitForTimeout(500);
  assert.deepEqual(await page.evaluate(() => window.__voiceStarts), []);
  for (const path of [
    "/audio/characters/todoroki-hajime/drop.mp3",
    "/audio/characters/todoroki-hajime/win.mp3",
    "/audio/characters/tokino-sora/drop.mp3",
  ])
    assert.equal((await page.request.get(base + path)).status(), 404, path);
  // Two ReGLOSS drops merge into this lineup's holoX member.
  await page.locator("canvas").click();
  const expected = voices["kazama-iroha"].merge.durationSeconds;
  await page.waitForFunction(
    (duration) =>
      window.__voiceStarts.some((value) => Math.abs(value - duration) < 0.1),
    expected,
  );
  console.log(
    "PASS ReGLOSS drop is silent, removed clips return 404, and the resulting holoX merge plays its recording",
  );
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS production layout at 320/390/768/1280px, local portraits, no runtime errors",
  );
} finally {
  await browser.close();
}
