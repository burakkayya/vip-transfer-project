import { defineRouting } from "next-intl/routing";

// MVP dört dil (mvp_plani.md). Diğer altı dil messages/ altına eklenip buraya yazılır.
export const routing = defineRouting({
  locales: ["tr", "en", "de", "ru"],
  defaultLocale: "en",
});

export type Locale = (typeof routing.locales)[number];
