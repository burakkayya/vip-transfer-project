"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { routing } from "@/i18n/routing";
import { usePathname, useRouter } from "@/i18n/navigation";

const NAMES: Record<string, string> = { tr: "Türkçe", en: "English", de: "Deutsch", ru: "Русский" };

export default function LocaleSwitcher() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  return (
    <select
      aria-label={t("language")}
      value={locale}
      onChange={(e) => {
        const q = search.toString();
        router.replace(q ? `${pathname}?${q}` : pathname, { locale: e.target.value });
      }}
    >
      {routing.locales.map((l) => (
        <option key={l} value={l}>
          {NAMES[l]}
        </option>
      ))}
    </select>
  );
}
