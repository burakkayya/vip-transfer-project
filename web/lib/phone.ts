// Telefon numarası çözümleme (SMS girişi). Saf işlev: tarayıcı, sunucu ve testlerde aynı çalışır.
// Yorum backend `normalize_phone` ile uyumludur ("00" → "+"); ülke yalnızca `countries` listesinden seçilir.

export type Country = { code: string; dial: string };

export type PhoneResult =
  | { ok: true; full: string; country: string; dial: string }
  | { ok: false; reason: "short" | "unknown_country" };

/** Ulusal kısımda en az bu kadar hane beklenir (en kısa yaygın abone numaraları). */
const MIN_NATIONAL = 6;
/** Seçili ülke kodu baştan tekrar yazılmış sayılması için kalan ulusal kısmın en az uzunluğu (TR, DE, GB, RU, US mobil: 10). */
const REPEATED_DIAL_NATIONAL = 10;
/** E.164 en fazla 15 hane. */
const MAX_E164 = 15;

const dialDigits = (c: Country) => c.dial.replace(/\D/g, "");

/** Uluslararası hanelerden ülkeyi bulur: en uzun eşleşen kod; aynı kodu paylaşanlarda (+7 RU/KZ) seçili ülke önceliklidir. */
function matchCountry(digits: string, selected: Country, list: Country[]): Country | null {
  let best: Country | null = null;
  for (const c of list) {
    const d = dialDigits(c);
    if (!d || !digits.startsWith(d)) continue;
    const better =
      !best ||
      d.length > dialDigits(best).length ||
      (d.length === dialDigits(best).length && c.code === selected.code);
    if (better) best = c;
  }
  return best;
}

function international(digits: string, selected: Country, list: Country[]): PhoneResult {
  const country = matchCountry(digits, selected, list);
  if (!country) return { ok: false, reason: "unknown_country" };
  const national = digits.length - dialDigits(country).length;
  if (national < MIN_NATIONAL || digits.length > MAX_E164) return { ok: false, reason: "short" };
  return { ok: true, full: `+${digits}`, country: country.code, dial: country.dial };
}

/**
 * Yazılan numarayı E.164'e çevirir ve ülkeyi belirler.
 * - Biçim karakterleri (boşluk, parantez, tire, nokta, eğik çizgi) önce atılır.
 * - "+" veya "00" ile başlıyorsa uluslararası yazımdır: ülke listedeki koddan bulunur, yoksa `unknown_country`.
 * - Başta ulusal önek 0 varsa atılır, seçili ülke kodu eklenir.
 * - Seçili ülke kodu başa tekrar yazılmışsa ("90 532 …") ve kalan kısım tam bir ulusal numara uzunluğundaysa ikinci kez eklenmez.
 */
export function toE164(raw: string, selected: Country, list: Country[]): PhoneResult {
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return international(cleaned.replace(/\D/g, ""), selected, list);
  if (cleaned.startsWith("00")) return international(cleaned.slice(2).replace(/\D/g, ""), selected, list);
  const digits = cleaned.replace(/\D/g, "");
  const dial = dialDigits(selected);
  if (
    !digits.startsWith("0") &&
    digits.startsWith(dial) &&
    digits.length - dial.length >= REPEATED_DIAL_NATIONAL &&
    digits.length <= MAX_E164
  ) {
    return { ok: true, full: `+${digits}`, country: selected.code, dial: selected.dial };
  }
  const national = digits.replace(/^0+/, "");
  if (national.length < MIN_NATIONAL) return { ok: false, reason: "short" };
  return { ok: true, full: `${selected.dial}${national}`, country: selected.code, dial: selected.dial };
}

/** Ekranda okunur biçim: ülke kodu ile numara arasında boşluk. */
export function displayPhone(full: string, dial: string) {
  return full.startsWith(dial) ? `${dial} ${full.slice(dial.length)}` : full;
}
