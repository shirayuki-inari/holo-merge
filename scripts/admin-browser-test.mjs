import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { adminEn, adminJa, adminZh, baseUrl, launch, literal } from "./browser-helpers.mjs";
const browser = await launch();
const base = baseUrl("http://127.0.0.1:5175"),
  password =
    process.env.ADMIN_TEST_PASSWORD || "test-only-administrator-password";
await mkdir(".qa", { recursive: true });
try {
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1280, height: 1000 },
  });
  await context.route("https://fonts.googleapis.com/**", (r) => r.abort());
  const page = await context.newPage(),
    errors = [],
    media = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/\/audio\//.test(r.url())) media.push(r.url());
  });
  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const register = await page.request.post(base + "/api/players", {
    headers: { Origin: base },
    data: { token, name: "Panel Browser", avatar: "shirakami-fubuki" },
  });
  assert.equal(register.status(), 200);
  const id = (await register.json()).id;
  await page.goto(base + "/admin/", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: adminZh("login") }).waitFor();
  assert.equal(
    (await page.request.get(base + "/api/admin/overview")).status(),
    401,
  );
  await page.getByLabel(adminZh("password"), { exact: true }).fill("incorrect");
  await page.getByRole("button", { name: adminZh("signIn"), exact: true }).click();
  await page.getByRole("alert").filter({ hasText: adminZh("invalidPassword") }).waitFor();
  await page.getByLabel(adminZh("password"), { exact: true }).fill(password);
  await page.getByRole("button", { name: adminZh("signIn"), exact: true }).click();
  await page.getByRole("heading", { name: adminZh("activity") }).waitFor();
  assert.match(await page.title(), new RegExp(literal(adminZh("title"))));
  assert.equal(await page.locator("canvas,audio").count(), 0);
  assert.equal(media.length, 0);
  assert.ok(
    (await context.cookies()).some(
      (c) => c.name === "holo-admin" && c.httpOnly && c.sameSite === "Strict",
    ),
  );
  await page.screenshot({ path: ".qa/admin-overview.png", fullPage: true });
  await page.getByRole("button", { name: adminZh("rankings"), exact: true }).click();
  await page.getByLabel(adminZh("filter"), { exact: true }).selectOption("all");
  await page.getByRole("searchbox").fill(id);
  await page.getByRole("button", { name: adminZh("searchButton"), exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Panel Browser" })
    .getByRole("button", { name: adminZh("edit"), exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(adminZh("name"), { exact: true }).fill("管理测试玩家");
  await dialog.getByLabel(adminZh("score"), { exact: true }).fill("23456");
  await dialog
    .getByLabel(adminZh("avatar"), { exact: true })
    .selectOption("nakiri-ayame");
  assert.equal(
    await dialog
      .getByRole("button", { name: adminZh("save"), exact: true })
      .isEnabled(),
    false,
  );
  await dialog.getByLabel(adminZh("reason"), { exact: true }).fill("浏览器验证修改");
  await dialog.getByRole("button", { name: adminZh("save"), exact: true }).click();
  await page.getByRole("status").filter({ hasText: adminZh("saved") }).waitFor();
  await page.getByRole("row").filter({ hasText: "管理测试玩家" }).waitFor();
  const board = await (
    await page.request.get(base + "/api/leaderboard")
  ).json();
  assert.ok(
    board.entries.some(
      (p) =>
        p.id === id &&
        p.name === "管理测试玩家" &&
        p.score === 23456 &&
        p.avatar === "nakiri-ayame",
    ),
  );
  await page.screenshot({ path: ".qa/admin-rankings.png", fullPage: true });
  // Force a concurrent profile change through the original game API.
  await page.getByRole("button", { name: adminZh("edit"), exact: true }).click();
  await dialog.getByLabel(adminZh("score"), { exact: true }).fill("22000");
  await dialog.getByLabel(adminZh("reason"), { exact: true }).fill("并发测试");
  assert.equal(
    (
      await page.request.patch(base + "/api/player", {
        headers: { Origin: base, Authorization: `Bearer ${token}` },
        data: { name: "实时玩家", avatar: "nakiri-ayame" },
      })
    ).status(),
    200,
  );
  await dialog.getByRole("button", { name: adminZh("save"), exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: adminZh("conflict") }).waitFor();
  await dialog
    .getByRole("button", { name: adminZh("cancel"), exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: adminZh("refresh"), exact: true }).click();
  await page.getByRole("row").filter({ hasText: "实时玩家" }).waitFor();
  await page.getByRole("button", { name: adminZh("reset"), exact: true }).click();
  await dialog.getByLabel(adminZh("reason"), { exact: true }).fill("浏览器验证清除");
  await dialog.getByRole("button", { name: adminZh("confirmReset"), exact: true }).click();
  await page.getByRole("status").waitFor();
  await page.getByRole("button", { name: adminZh("audit"), exact: true }).click();
  await page
    .getByRole("cell", { name: "浏览器验证修改", exact: true })
    .waitFor();
  await page
    .getByRole("cell", { name: "浏览器验证清除", exact: true })
    .waitFor();
  await page.screenshot({ path: ".qa/admin-audit.png", fullPage: true });
  for (const [locale, overview] of [
    ["en", adminEn("overview")],
    ["ja", adminJa("overview")],
    ["zh-CN", adminZh("overview")],
  ]) {
    await page.locator(".admin-header select").selectOption(locale);
    await page.getByRole("button", { name: overview, exact: true }).click();
    await page.locator(".admin-chart").waitFor();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 950 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${locale} width ${width}`,
      );
    }
    if (locale === "en")
      await page.screenshot({
        path: ".qa/admin-overview-en.png",
        fullPage: true,
      });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".qa/admin-mobile.png", fullPage: true });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: adminZh("activity") }).waitFor();
  await page.getByRole("button", { name: adminZh("logout"), exact: true }).click();
  await page.getByRole("heading", { name: adminZh("login") }).waitFor();
  assert.equal(
    (await page.request.get(base + "/api/admin/audit")).status(),
    401,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(media, []);
  console.log(
    JSON.stringify({
      passed: true,
      login: true,
      edit: true,
      reset: true,
      audit: true,
      conflict: true,
      locales: 3,
      responsive: [320, 390, 768, 1280],
      noGameAudioLoaded: true,
      errors,
    }),
  );
  await context.close();
} finally {
  await browser.close();
}
