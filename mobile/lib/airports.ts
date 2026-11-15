// K-77: havalimanı adları ziyaretçinin dilinde. Veritabanındaki ad Türkçedir ("Antalya Havalimanı"); İngilizce
// arayüzde "Antalya Airport" görünür. web/lib/airports.ts ile aynı tablo.

type Names = { tr: string; latin: string; ru: string; ar: string; zh: string; ja: string; ko: string } & Partial<
  Record<"de" | "es" | "fr" | "it" | "pt", string>
>;

const NAMES: Record<string, Names> = {
  AYT: { tr: "Antalya", latin: "Antalya", ru: "Анталья", ar: "أنطاليا", zh: "安塔利亚", ja: "アンタルヤ", ko: "안탈리아" },
  GZP: { tr: "Gazipaşa-Alanya", latin: "Gazipaşa-Alanya", ru: "Газипаша-Аланья", ar: "غازي باشا-ألانيا", zh: "加济帕夏-阿拉尼亚", ja: "ガズィパシャ・アランヤ", ko: "가지파샤-알라니아" },
  DLM: { tr: "Dalaman", latin: "Dalaman", ru: "Даламан", ar: "دالامان", zh: "达拉曼", ja: "ダラマン", ko: "달라만" },
  BJV: { tr: "Milas-Bodrum", latin: "Milas-Bodrum", ru: "Милас-Бодрум", ar: "ميلاس-بودروم", zh: "米拉斯-博德鲁姆", ja: "ミラス・ボドルム", ko: "밀라스-보드룸" },
  IST: { tr: "İstanbul", latin: "Istanbul", ru: "Стамбул", ar: "إسطنبول", zh: "伊斯坦布尔", ja: "イスタンブール", ko: "이스탄불" },
  SAW: { tr: "Sabiha Gökçen", latin: "Sabiha Gökçen", ru: "Сабиха Гёкчен", ar: "صبيحة كوكجن", zh: "萨比哈·格克琴", ja: "サビハ・ギョクチェン", ko: "사비하 괵첸" },
  ESB: { tr: "Ankara Esenboğa", latin: "Ankara Esenboğa", ru: "Анкара Эсенбога", ar: "أنقرة إيسنبوغا", zh: "安卡拉埃森博阿", ja: "アンカラ・エセンボア", ko: "앙카라 에센보아" },
  ADB: { tr: "İzmir Adnan Menderes", latin: "Izmir Adnan Menderes", ru: "Измир Аднан Мендерес", ar: "إزمير عدنان مندريس", zh: "伊兹密尔阿德南·曼德列斯", ja: "イズミル・アドナン・メンデレス", ko: "이즈미르 아드난 멘데레스" },
  NAV: { tr: "Nevşehir Kapadokya", latin: "Cappadocia", de: "Kappadokien", es: "Capadocia", fr: "Cappadoce", pt: "Capadócia", ru: "Каппадокия", ar: "كابادوكيا", zh: "卡帕多奇亚", ja: "カッパドキア", ko: "카파도키아" },
  ASR: { tr: "Kayseri Erkilet", latin: "Kayseri Erkilet", ru: "Кайсери Эркилет", ar: "قيصري إركيليت", zh: "开塞利埃尔基莱特", ja: "カイセリ・エルキレト", ko: "카이세리 에르킬레트" },
};

const PATTERN: Record<string, (n: string) => string> = {
  tr: (n) => `${n} Havalimanı`,
  en: (n) => `${n} Airport`,
  de: (n) => `Flughafen ${n}`,
  es: (n) => `Aeropuerto de ${n}`,
  ru: (n) => `Аэропорт ${n}`,
  fr: (n) => `Aéroport de ${n}`,
  ar: (n) => `مطار ${n}`,
  zh: (n) => `${n}机场`,
  ja: (n) => `${n}空港`,
  it: (n) => `Aeroporto di ${n}`,
  pt: (n) => `Aeroporto de ${n}`,
  ko: (n) => `${n} 공항`,
};

/** Havalimanının bu dildeki adı; tanınmayan kodda null (çağıran veritabanındaki adı kullanır). */
export function airportName(iata: string | null | undefined, locale: string): string | null {
  const n = iata ? NAMES[iata.toUpperCase()] : undefined;
  if (!n) return null;
  const lang = PATTERN[locale] ? locale : "en";
  if (lang === "tr") return null; // Türkçede veritabanındaki ad (admin'in yazdığı) kullanılır.
  const base = (n as Record<string, string | undefined>)[lang] ?? n.latin;
  return PATTERN[lang](base);
}

/** Bölgenin uygulama dilindeki adı (havalimanları çevrilir, ilçe adları özel addır). */
export function regionName(r: { name: string; iata_code?: string | null }, locale: string): string {
  return airportName(r.iata_code, locale) ?? r.name;
}
