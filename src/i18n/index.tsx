import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createTranslator,
  detectLocale,
  groupName,
  isLocale,
  LANGUAGE_KEY,
  talentName,
  type Locale,
} from "./core";
import type { Group, Talent } from "../game/model";
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* Language selection also works without storage. */
  }
  return detectLocale(navigator.languages || [navigator.language]);
}
function useLanguage() {
  const [locale, setLocale] = useState(initialLocale);
  const t = useMemo(() => createTranslator(locale), [locale]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("app.title");
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", t("app.description"));
  }, [locale, t]);
  return {
    locale,
    t,
    number: (value: number) => value.toLocaleString(locale),
    name: (talent: Talent) => talentName(talent, locale),
    group: (value: Group) => groupName(value, locale),
    setLocale: (value: Locale) => {
      if (!isLocale(value)) return;
      setLocale(value);
      try {
        localStorage.setItem(LANGUAGE_KEY, value);
      } catch {
        /* Storage is optional. */
      }
    },
  };
}
const I18nContext = createContext<ReturnType<typeof useLanguage> | null>(null);
export function I18nProvider({ children }: { children: ReactNode }) {
  return (
    <I18nContext.Provider value={useLanguage()}>
      {children}
    </I18nContext.Provider>
  );
}
export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("I18nProvider is required");
  return value;
}
