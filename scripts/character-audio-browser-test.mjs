import assert from "node:assert/strict";
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
try {
  const page = await browser.newPage({
    locale: "zh-CN",
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Math.random = () => 0.1;
    window.__voiceEvents = [];
  });
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
  );
  await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const effectsUrl = performance
      .getEntriesByType("resource")
      .find((entry) =>
        entry.name.includes("/src/audio/character-effects.ts"),
      ).name;
    const { CharacterEffectsPlayer } = await import(effectsUrl);
    const original = CharacterEffectsPlayer.prototype.play;
    CharacterEffectsPlayer.prototype.play = async function (event, id) {
      const record = { event, id, played: null };
      window.__voiceEvents.push(record);
      record.played = await original.call(this, event, id);
      return record.played;
    };
    const { HoloEngine } = await import("/src/game/engine.ts");
    const drop = HoloEngine.prototype.drop;
    HoloEngine.prototype.drop = function () {
      window.__gameFixture = this;
      return drop.call(this);
    };
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("switch", { name: "背景音乐", exact: true }).click();
  await page.keyboard.press("Escape");
  const canvas = page.locator("canvas");
  for (let i = 0; i < 32; i++) {
    await canvas.click();
    await page.waitForTimeout(500);
    if (
      await page.evaluate(() =>
        window.__voiceEvents.some(
          (event) =>
            event.event === "merge" &&
            event.id === "la-darknesss" &&
            event.played === true,
        ),
      )
    )
      break;
  }
  await page.waitForFunction(() =>
    window.__voiceEvents.some(
      (event) =>
        event.event === "merge" &&
        event.id === "la-darknesss" &&
        event.played === true,
    ),
  );
  const dropped = await page.evaluate(() =>
    window.__voiceEvents.filter((event) => event.event === "drop"),
  );
  assert.ok(dropped.length >= 8);
  assert.ok(
    dropped.every(
      (event) => event.id === "achichi-mela" && event.played === false,
    ),
  );
  console.log(
    "PASS natural drop chain plays the correct holoX member's merge voice; missing debut members stay silent",
  );
  // Exercise the real App callbacks through a deterministic highest-tier physics collision.
  await page.evaluate(async () => {
    const { default: Matter } = await import(
      performance
        .getEntriesByType("resource")
        .find((entry) => entry.name.includes("/matter-js.js")).name
    );
    const engine = window.__gameFixture;
    engine.setPaused(true);
    Matter.Composite.remove(
      engine.physics.world,
      [...engine.orbs.values()].map((orb) => orb.body),
    );
    engine.orbs.clear();
    engine.pending.length = 0;
    engine.addOrb(9, 137.2, 468);
    engine.addOrb(9, 302.8, 468);
    engine.setPaused(false);
  });
  await page.getByRole("dialog", { name: "已合成最高等级" }).waitFor();
  await page.waitForFunction(() =>
    window.__voiceEvents.some(
      (event) =>
        event.event === "win" &&
        event.id === "tokino-sora" &&
        event.played === true,
    ),
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.__voiceEvents.find(
          (event) => event.event === "merge" && event.id === "tokino-sora",
        ).played,
    ),
    false,
  );
  console.log(
    "PASS highest-tier App callback plays Tokino Sora's win clip and replaces the simultaneous merge clip",
  );
  const results = await page.evaluate(async () => {
    const { CharacterEffectsPlayer, CHARACTER_VOICES } = await import(
      "/src/audio/character-effects.ts"
    );
    const player = new CharacterEffectsPlayer();
    player.prepare(Object.keys(CHARACTER_VOICES));
    player.unlock();
    const report = [];
    try {
      for (const [id, role] of Object.entries(CHARACTER_VOICES))
        for (const event of ["drop", "merge", "win"]) {
          if (!role[event]) {
            if (await player.play(event, id))
              throw new Error(`Unconfigured voice started: ${id}/${event}`);
            continue;
          }
          if (!(await player.play(event, id)))
            throw new Error(`Voice did not start: ${id}/${event}`);
          const buffer = player.current.node.buffer;
          if (Math.abs(buffer.duration - role[event].durationSeconds) > 0.1)
            throw new Error(`Voice truncated: ${id}/${event}`);
          const samples = buffer.getChannelData(0);
          let energy = 0;
          for (const value of samples) energy += value * value;
          if (energy / samples.length < 1e-7)
            throw new Error(`Silent voice: ${id}/${event}`);
          report.push({ id, event, duration: buffer.duration });
          player.stop();
        }
    } finally {
      player.destroy();
    }
    return report;
  });
  assert.equal(results.length, 39);
  assert.equal(results.filter((record) => record.event === "merge").length, 34);
  assert.equal(results.filter((record) => record.event === "win").length, 5);
  assert.equal(new Set(results.map((record) => record.id)).size, 34);
  console.log(
    "PASS all 39 shipped MP3 recordings decoded and started as real Web Audio sources, with non-silent full-duration waveforms",
  );
  await page.reload({ waitUntil: "networkidle" });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS cleanup/reload, responsive layout, no browser runtime errors",
  );
} finally {
  await browser.close();
}
