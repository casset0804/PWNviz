import { useTranslation } from "react-i18next";

import { SUPPORTED_LOCALES, setLocale, type Locale } from "../../i18n";

/**
 * Language switch. The option labels are always written in their own language so
 * a user who cannot read the current UI can still find their language.
 */
export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const { i18n, t } = useTranslation("common");
  const current = i18n.language as Locale;
  const label = (locale: Locale) =>
    locale === "zh-CN" ? t("language.zh") : t("language.en");

  return (
    <label
      className={`flex h-6 items-center gap-1 border border-[#253346] bg-[#0b1017] font-mono text-[9px] uppercase tracking-[0.08em] text-[#6b7c90] ${
        compact ? "px-1" : "px-1.5"
      }`}
      title={t("language.current", { language: label(current) })}
      data-testid="language-switch-wrapper"
    >
      <span className={compact ? "sr-only" : "hidden xl:inline"}>
        {t("language.label")}
      </span>
      <select
        value={current}
        onChange={(event) => setLocale(event.target.value as Locale)}
        className="h-5 cursor-pointer bg-transparent font-mono text-[10px] normal-case tracking-normal text-[#d0dbe7] outline-none"
        aria-label={t("language.label")}
        data-testid="language-switch"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale} className="bg-[#0d141d] text-[#d0dbe7]">
            {label(locale)}
          </option>
        ))}
      </select>
    </label>
  );
}
