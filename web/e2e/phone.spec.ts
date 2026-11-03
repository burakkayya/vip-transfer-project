import { expect, test } from "@playwright/test";
import { displayPhone, toE164 } from "../lib/phone";
import { countries } from "../lib/site";

// `toE164` birim testleri (B-W3 düzeltme turu 1): tarayıcı ve ağ kullanmaz, yalnızca bir projede koşar.

const TR = { code: "TR", dial: "+90" };
const DE = { code: "DE", dial: "+49" };
const KZ = { code: "KZ", dial: "+7" };

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "saf işlev; tek projede yeter");
});

const ok = (full: string, country: string) => ({ ok: true, full, country });

const cases: [string, { code: string; dial: string }, ReturnType<typeof ok> | { ok: false; reason: string }][] = [
  ["532 123 45 67", TR, ok("+905321234567", "TR")],
  ["0532 123 45 67", TR, ok("+905321234567", "TR")],
  ["+90 532 123 45 67", TR, ok("+905321234567", "TR")],
  ["0090 532 123 45 67", TR, ok("+905321234567", "TR")],
  ["(+90) 532-123-45-67", TR, ok("+905321234567", "TR")],
  ["(0532) 123 45 67", TR, ok("+905321234567", "TR")],
  ["90 532 123 45 67", TR, ok("+905321234567", "TR")],
  // DE ulusal önek 0 atılır.
  ["0151 1234567", DE, ok("+491511234567", "DE")],
  ["030 / 1234 5678", DE, ok("+493012345678", "DE")],
  // Uluslararası yazımın ülkesi seçimden farklıysa listedeki ülke kullanılır.
  ["+49 151 1234567", TR, ok("+491511234567", "DE")],
  ["0044 7911 123456", TR, ok("+447911123456", "GB")],
  // Aynı kodu paylaşan ülkelerde seçili ülke korunur.
  ["+7 701 123 4567", KZ, ok("+77011234567", "KZ")],
  ["+7 916 123 4567", TR, ok("+79161234567", "RU")],
  // Ülke kodu tekrarı yalnızca kalan kısım tam numara uzunluğundaysa: kısa ulusal numara olduğu gibi kalır.
  ["7172 12345", KZ, ok("+7717212345", "KZ")],
  // Listede olmayan kod ve çok kısa numara.
  ["+81 90 1234 5678", TR, { ok: false, reason: "unknown_country" }],
  ["532", TR, { ok: false, reason: "short" }],
  ["+90 532", TR, { ok: false, reason: "short" }],
];

for (const [input, selected, expected] of cases) {
  test(`toE164 ${JSON.stringify(input)} under ${selected.code}`, () => {
    expect(toE164(input, selected, countries)).toMatchObject(expected);
  });
}

test("displayPhone separates dial code", () => {
  expect(displayPhone("+905321234567", "+90")).toBe("+90 5321234567");
  expect(displayPhone("+491511234567", "+90")).toBe("+491511234567");
});
