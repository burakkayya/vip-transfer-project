import { defineRouting } from "next-intl/routing";
import { LOCALES } from "./locales";

// K-77: on iki dil. Ülkeye göre dil seçimi middleware'de (i18n/locales.ts), açık seçim NEXT_LOCALE çerezinde.
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: "en",
});

export type Locale = (typeof routing.locales)[number];
