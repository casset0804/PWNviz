import { useTranslation } from "react-i18next";

import { SUPPORTED_LOCALES, setLocale, type Locale } from "../../i18n";

/**
 * Language switch. The option labels are always written in their own language so
 * a user who cannot read the current UI can still find their language.
 */
export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation("common");
  const current = i18n.language as Locale;
  const label = (locale: Locale) =>
    locale === "zh-CN" ? t("language.zh") : t("language.en");

  return (
    <label
      className={`flex h-11 items-center gap-2 rounded-md border border-[#2b3d51] bg-[#0c1520] text-[12px] uppercase tracking-[0.06em] text-[#7f93a8] ${
        compact ? "px-2" : "px-3"
      }`}
      title={t("language.current", { language: label(current) })}
      data-testid="language-switch-wrapper"
    >
      <span className={compact ? "sr-only" : "hidden lg:inline"}>
        {t("language.label")}
      </span>
      <select
        value={current}
        onChange={(event) => void setLocale(event.target.value as Locale)}
        className="h-8 cursor-pointer bg-transparent font-mono text-[13px] normal-case tracking-normal text-[#d7e4f0] outline-none"
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
