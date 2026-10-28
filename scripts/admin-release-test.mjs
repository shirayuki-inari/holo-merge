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
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const base = process.env.BASE_URL || "http://127.0.0.1:4173";
try {
  const page = await browser.newPage({
      locale: "zh-CN",
      viewport: { width: 1280, height: 1000 },
    }),
    errors = [],
    requests = [];
  await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => requests.push(r.url()));
  const now = Date.now(),
    player = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Release Test",
      avatar: "shirakami-fubuki",
      best: 2147483647,
      best_at: now,
      created: now,
      rank: 1,
    };
  await page.route("**/api/admin/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    const data = path.endsWith("session")
      ? { csrf: "test-only", expires: now + 3600_000 }
      : path.endsWith("overview")
        ? {
            now,
            metricsSince: now,
            totals: {
              players: 45,
              ranked: 16,
              highest: 2147483647,
              averageBest: 20680,
              outstanding: 3,
            },
            period: {
              started: 12,
              accepted: 5,
              rejected: 1,
              averageScore: 1000,
            },
            days: Array.from({ length: 14 }, (_, i) => ({
              day: new Date(now - (13 - i) * 86_400_000)
                .toISOString()
                .slice(0, 10),
              players: i,
              started: i * 3,
              accepted: i,
              rejected: 0,
            })),
            distribution: [
              { bucket: "0", count: 29 },
              { bucket: "1–4,999", count: 5 },
              { bucket: "5,000–9,999", count: 5 },
              { bucket: "10,000–19,999", count: 5 },
              { bucket: "20,000+", count: 1 },
            ],
            top: [player],
          }
        : path.endsWith("players")
          ? { players: [player], total: 1, page: 1, pageSize: 25 }
          : { entries: [], total: 0, page: 1, pageSize: 25 };
    return r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  await page.goto(base + "/admin/", { waitUntil: "domcontentloaded" });
  await page.locator(".admin-chart").waitFor();
  // Behavior-only layout checks can pass with missing CSS. Assert the actual production styles.
  assert.equal(
    await page
      .locator(".admin-metrics")
      .evaluate((el) => getComputedStyle(el).display),
    "grid",
  );
  assert.equal(
    await page
      .locator(".admin-header")
      .evaluate((el) => getComputedStyle(el).display),
    "flex",
  );
  assert.ok(
    await page
      .locator(".admin-shell")
      .evaluate((el) => el.getBoundingClientRect().width <= 1120),
  );
  assert.ok(
    requests.some((url) => /\/assets\/Admin-.*\.css(?:\?|$)/.test(url)),
  );
  assert.ok(
    !requests.some((url) => /\/assets\/App-.*\.js(?:\?|$)/.test(url)),
    "Admin must not preload the game bundle",
  );
  assert.ok(!requests.some((url) => /\/audio\//.test(url)));
  await mkdir(".qa", { recursive: true });
  await page.screenshot({ path: ".qa/admin-release.png", fullPage: true });
  for (const [locale, label] of [
    ["en", "Overview"],
    ["ja", "稼働状況"],
    ["zh-CN", "运行概览"],
  ]) {
    await page.locator(".admin-header select").selectOption(locale);
    await page.getByRole("button", { name: label, exact: true }).click();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 950 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${locale}:${width}`,
      );
      assert.ok(
        await page.locator(".admin-metric").evaluateAll((cards) =>
          cards.every((card) => {
            const value = card.querySelector("strong");
            return value.scrollWidth <= value.clientWidth;
          }),
        ),
        `${locale}: long score fits`,
      );
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".qa/admin-release-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS production admin styles, separate game/admin chunks, maximum score layout, 3 languages and 320–1280px",
  );
} finally {
  await browser.close();
}
