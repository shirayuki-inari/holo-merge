import zh from "./locales/zh-CN";
import ja from "./locales/ja";
import en from "./locales/en";
import type { Group, Talent } from "../game/model";
import type { Translate, Messages } from "./types";
export const LANGUAGES = [
  { id: "zh-CN", name: "简体中文" },
  { id: "ja", name: "日本語" },
  { id: "en", name: "English" },
] as const;
export type Locale = (typeof LANGUAGES)[number]["id"];
export const LANGUAGE_KEY = "holo-merge-language-v1";
export const dictionaries: Record<Locale, Messages> = { "zh-CN": zh, ja, en };
export function isLocale(value: unknown): value is Locale {
  return LANGUAGES.some(({ id }) => id === value);
}
export function detectLocale(languages: readonly string[]): Locale {
  for (const value of languages) {
    const lang = value.toLowerCase().split("-")[0];
    if (lang === "zh") return "zh-CN";
    if (lang === "ja" || lang === "en") return lang;
  }
  return "zh-CN";
}
export function createTranslator(locale: Locale): Translate {
  return ((key: keyof Messages, params?: Record<string, string | number>) => {
    const message = dictionaries[locale][key] || zh[key];
    return message.replace(/\{(\w+)\}/g, (slot, name: string) =>
      params?.[name] === undefined ? slot : String(params[name]),
    );
  }) as Translate;
}
export const talentName = (talent: Talent, locale: Locale) =>
  locale === "en" ? talent.en : talent.name;
export function groupName(group: Group, locale: Locale) {
  const key = `group.${group.id}` as keyof Messages;
  return dictionaries[locale][key] || group.name;
}
