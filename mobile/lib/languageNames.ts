// K-77: sürücünün konuştuğu dillerin adı, müşterinin arayüz dilinde ("Speaks: Turkish, English").
// Hermes Intl.DisplayNames desteklemediği için tablo. Sıra: tr en de es ru fr ar zh ja it pt ko.
const CODES = ["tr", "en", "de", "es", "ru", "fr", "ar", "zh", "ja", "it", "pt", "ko"] as const;
const ROWS: Record<string, string> = {
  tr: "Türkçe|İngilizce|Almanca|İspanyolca|Rusça|Fransızca|Arapça|Çince|Japonca|İtalyanca|Portekizce|Korece",
  en: "Turkish|English|German|Spanish|Russian|French|Arabic|Chinese|Japanese|Italian|Portuguese|Korean",
  de: "Türkisch|Englisch|Deutsch|Spanisch|Russisch|Französisch|Arabisch|Chinesisch|Japanisch|Italienisch|Portugiesisch|Koreanisch",
  es: "turco|inglés|alemán|español|ruso|francés|árabe|chino|japonés|italiano|portugués|coreano",
  ru: "турецкий|английский|немецкий|испанский|русский|французский|арабский|китайский|японский|итальянский|португальский|корейский",
  fr: "turc|anglais|allemand|espagnol|russe|français|arabe|chinois|japonais|italien|portugais|coréen",
  ar: "التركية|الإنجليزية|الألمانية|الإسبانية|الروسية|الفرنسية|العربية|الصينية|اليابانية|الإيطالية|البرتغالية|الكورية",
  zh: "土耳其语|英语|德语|西班牙语|俄语|法语|阿拉伯语|中文|日语|意大利语|葡萄牙语|韩语",
  ja: "トルコ語|英語|ドイツ語|スペイン語|ロシア語|フランス語|アラビア語|中国語|日本語|イタリア語|ポルトガル語|韓国語",
  it: "turco|inglese|tedesco|spagnolo|russo|francese|arabo|cinese|giapponese|italiano|portoghese|coreano",
  pt: "turco|inglês|alemão|espanhol|russo|francês|árabe|chinês|japonês|italiano|português|coreano",
  ko: "튀르키예어|영어|독일어|스페인어|러시아어|프랑스어|아랍어|중국어|일본어|이탈리아어|포르투갈어|한국어",
};

export function languageName(code: string, uiLocale: string): string {
  const i = CODES.indexOf(code as (typeof CODES)[number]);
  const row = (ROWS[uiLocale] ?? ROWS.en).split("|");
  return i >= 0 ? row[i] : code;
}
