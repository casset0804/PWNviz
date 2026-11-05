import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import zhCommon from "./locales/zh-CN/common.json";
import zhToolbar from "./locales/zh-CN/toolbar.json";
import zhPanels from "./locales/zh-CN/panels.json";
import zhDebugger from "./locales/zh-CN/debugger.json";
import zhErrors from "./locales/zh-CN/errors.json";
import zhSettings from "./locales/zh-CN/settings.json";
import zhExplanation from "./locales/zh-CN/explanation.json";

import enCommon from "./locales/en-US/common.json";
import enToolbar from "./locales/en-US/toolbar.json";
import enPanels from "./locales/en-US/panels.json";
import enDebugger from "./locales/en-US/debugger.json";
import enErrors from "./locales/en-US/errors.json";
import enSettings from "./locales/en-US/settings.json";
import enExplanation from "./locales/en-US/explanation.json";

/** Namespaces mirror docs/I18N.md and the locales/ directory layout. */
export const NAMESPACES = [
  "common",
  "toolbar",
  "panels",
  "debugger",
  "errors",
  "settings",
  "explanation",
] as const;

export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Contract fixed by V1.1: zh-CN is the default and the storage key is stable. */
export const DEFAULT_LOCALE: Locale = "zh-CN";
export const LOCALE_STORAGE_KEY = "pwnviz.locale";

export const resources = {
  "zh-CN": {
    common: zhCommon,
    toolbar: zhToolbar,
    panels: zhPanels,
    debugger: zhDebugger,
    errors: zhErrors,
    settings: zhSettings,
    explanation: zhExplanation,
  },
  "en-US": {
    common: enCommon,
    toolbar: enToolbar,
    panels: enPanels,
    debugger: enDebugger,
    errors: enErrors,
    settings: enSettings,
    explanation: enExplanation,
  },
} as const;

export function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

/** Read the persisted locale. Storage can be unavailable in embedded contexts. */
export function readStoredLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isSupportedLocale(stored)) return stored;
  } catch {
    // Ignore storage failures: the default is always Simplified Chinese.
  }
  return DEFAULT_LOCALE;
}

export function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // The switch still works for this page even if it cannot be persisted.
  }
}

function applyDocumentLanguage(locale: Locale): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }
}

const initialLocale = readStoredLocale();

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLocale,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: SUPPORTED_LOCALES as unknown as string[],
  ns: NAMESPACES as unknown as string[],
  defaultNS: "common",
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
});

applyDocumentLanguage(initialLocale);

/**
 * Switch the whole workbench language without a page reload.
 * Persisted synchronously so a reload keeps the choice.
 */
export async function setLocale(locale: Locale): Promise<void> {
  persistLocale(locale);
  applyDocumentLanguage(locale);
  await i18n.changeLanguage(locale);
}

export function currentLocale(): Locale {
  return isSupportedLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
}

/** Translate outside React (store/log/error helpers). */
export function translate(
  key: string,
  params?: Record<string, unknown>,
  namespace = "common",
): string {
  return String(i18n.t(key, { ns: namespace, ...(params ?? {}) }));
}

export default i18n;
