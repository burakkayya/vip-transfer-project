/**
 * K-77: müşteri uygulaması on iki dil. Her sözlük Türkçe kaynakla aynı anahtarları ve aynı yer tutucuları taşır;
 * dil telefonun dilinden, desteklenmiyorsa ülkeden (cihaz bölgesi), o da yoksa İngilizce seçilir.
 */
import { COUNTRY_LOCALE, pickLocale } from "@/lib/i18n";
import ar from "@/lib/locales/ar";
import es from "@/lib/locales/es";
import fr from "@/lib/locales/fr";
import it from "@/lib/locales/it";
import ja from "@/lib/locales/ja";
import ko from "@/lib/locales/ko";
import pt from "@/lib/locales/pt";
import zh from "@/lib/locales/zh";

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "en", regionCode: "GB" }] }));

declare function require(id: string): unknown;
const fs = require("fs") as { readFileSync(p: string, enc: "utf8"): string };
const path = require("path") as { resolve(...p: string[]): string };
declare const __dirname: string;

// Türkçe kaynak sözlüğü dosyadan okunur (modül yalnızca etkin dili dışa verir).
const source = fs.readFileSync(path.resolve(__dirname, "../lib/i18n.ts"), "utf8");
const trBlock = source.slice(source.indexOf("const tr = {"), source.indexOf("export type Key"));
const trKeys = [...trBlock.matchAll(/^\s+(?:"([^"]+)"|(\w+)):/gm)].map((m) => m[1] ?? m[2]).sort();
const placeholders = (v: string) => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const trValues: Record<string, string> = Object.fromEntries(
  [...trBlock.matchAll(/^\s+(?:"([^"]+)"|(\w+)): "((?:[^"\\]|\\.)*)",?$/gm)].map((m) => [m[1] ?? m[2], m[3]]),
);

const DICTS = { ar, es, fr, it, ja, ko, pt, zh };

test("Türkçe kaynak okunur", () => {
  expect(trKeys.length).toBeGreaterThan(200);
  expect(Object.keys(trValues).length).toBeGreaterThan(200);
});

test.each(Object.entries(DICTS))("%s sözlüğü Türkçeyle aynı anahtarları taşır", (_, dict) => {
  expect(Object.keys(dict).sort()).toEqual(trKeys);
});

test.each(Object.entries(DICTS))("%s sözlüğünde yer tutucular kaynakla aynı", (lang, dict) => {
  const bad = Object.entries(dict).filter(([k, v]) => trValues[k] !== undefined && placeholders(v) !== placeholders(trValues[k]));
  expect([lang, bad.map(([k]) => k)]).toEqual([lang, []]);
});

test.each(Object.entries(DICTS))("%s sözlüğünde boş metin yok", (_, dict) => {
  expect(Object.values(dict).filter((v) => !v.trim())).toEqual([]);
});

test("telefonun dili destekleniyorsa o dil açılır", () => {
  expect(pickLocale("ar", "TR")).toBe("ar");
  expect(pickLocale("ko", "US")).toBe("ko");
  expect(pickLocale("DE", null)).toBe("de");
});

test("dil desteklenmiyorsa ülkenin dili, o da yoksa İngilizce", () => {
  expect(pickLocale("nl", "BE")).toBe("fr");
  expect(pickLocale("ca", "ES")).toBe("es");
  expect(pickLocale("uk", "BR")).toBe("pt");
  expect(pickLocale("nl", "NL")).toBe("en");
  expect(pickLocale("nl", "TR")).toBe("en");
  expect(pickLocale(null, "TR")).toBe("tr");
  expect(pickLocale(null, null)).toBe("en");
});

test("ülke eşlemesi web ile aynı ana ülkeleri kapsar", () => {
  expect(COUNTRY_LOCALE).toMatchObject({ TR: "tr", DE: "de", SA: "ar", CN: "zh", JP: "ja", KR: "ko", IT: "it", PT: "pt", MX: "es", FR: "fr", RU: "ru" });
});
