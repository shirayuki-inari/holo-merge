// Shared setup for the Chromium tests in scripts/*-test.mjs.
// Run them with tsx (see package.json) so UI text comes from the TypeScript
// dictionaries: copy edits then never break a selector, while every test still
// proves the page renders the translated text.
import { createTranslator } from "../src/i18n/core.ts";
import { adminDictionaries } from "../src/admin/messages.ts";

export const zh = createTranslator("zh-CN");
export const ja = createTranslator("ja");
export const en = createTranslator("en");
const adminText = (locale) => (key) => {
  const text = adminDictionaries[locale][key];
  if (!text) throw new Error(`Missing admin text ${locale}:${key}`);
  return text;
};
export const adminZh = adminText("zh-CN");
export const adminJa = adminText("ja");
export const adminEn = adminText("en");

/** Literal text inside a RegExp, e.g. to match a translated prefix. */
export const literal = (text) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const baseUrl = (fallback) => process.env.BASE_URL || fallback;

const TERMUX_CHROMIUM = "/data/data/com.termux/files/usr/bin/chromium-browser";
/** Launch headless Chromium: BROWSER_PATH, Termux's system build, or Playwright's. */
export async function launch(extraArgs = []) {
  const android = process.platform === "android";
  // playwright-core refuses to load on "android"; Termux runs a normal Linux Chromium.
  if (android) Object.defineProperty(process, "platform", { value: "linux" });
  const { chromium } = await import("playwright-core");
  return chromium.launch({
    executablePath:
      process.env.BROWSER_PATH ||
      (android ? TERMUX_CHROMIUM : chromium.executablePath()),
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      ...extraArgs,
    ],
  });
}

/** Answer every API call with 404 so the game runs offline and nothing is recorded. */
export const offlineApi = (target) =>
  target.route("**/api/**", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
  );
