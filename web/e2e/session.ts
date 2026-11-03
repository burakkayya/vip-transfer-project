import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";

// Ortak e2e oturum yardımcıları: kurgusal test numaraları, BFF ile SMS girişi ve ödeme bekleyen rezervasyon.
// Testler geliştirme veritabanında müşteri, rezervasyon ve ödeme kaydı bırakır (temizlik yok; acik_konular.md).

const rand = (n: number) => Math.floor(Math.random() * n);

/**
 * Kurgusal ABD numarası (E.164 ve ulusal kısım). Kuzey Amerika numara planında 555-0100…0199 her alan kodunda
 * kurgu için ayrılmıştır (NANPA): gerçek bir aboneye SMS gitmez. Alan kodu ve son iki hane rastgeledir; paralel
 * işçiler ve ardışık koşular aynı numarayı pratikte paylaşmaz (telefon başına saatte 5 kod sınırı).
 */
export function fictionalPhone() {
  let npa = "";
  // Alan kodu: ilk hane 2–9, ikinci 0–8, N11 değil.
  do npa = `${2 + rand(8)}${rand(9)}${rand(10)}`;
  while (npa.slice(1) === "11");
  const national = `${npa}55501${String(rand(100)).padStart(2, "0")}`;
  return { e164: `+1${national}`, national, dial: "+1" };
}

/** Kurgusal Birleşik Krallık cep numarası: Ofcom 07700 900000–900999 aralığını dizi ve filmler için ayırmıştır. */
export function fictionalUkMobile() {
  const tail = String(rand(1000)).padStart(3, "0");
  return { e164: `+447700900${tail}`, national: `7700900${tail}`, dial: "+44" };
}

/**
 * SMS gönderen her adımdan önce çağrılır: hedef yerel geliştirme sunucusu değilse test atlanır
 * (konsol dışı bir SMS sağlayıcısı numaraya gerçekten mesaj atabilir).
 */
export function requireDevSms() {
  const base = test.info().project.use.baseURL ?? "http://localhost:3000";
  const host = new URL(base).hostname;
  test.skip(!["localhost", "127.0.0.1", "[::1]"].includes(host), `SMS gönderen test yalnızca yerel sunucuda çalışır (${host})`);
}

/** Hafif bir sayfa açar ve BFF ile SMS girişini yapar (oturum çerezi tarayıcı bağlamına yazılır). Numarayı döner. */
export async function login(page: Page, locale = "tr", phone = fictionalPhone().e164): Promise<string> {
  requireDevSms();
  await page.goto(`/${locale}/legal/cookies`);
  await page.evaluate(
    async ({ phone, locale }) => {
      const post = async (path: string, body: unknown) => {
        const r = await fetch(`/bff/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
        return r.json().catch(() => null);
      };
      const req = await post("auth/otp/request", { phone, purpose: "customer", locale });
      if (!req?.dev_code) throw new Error("geliştirme kodu dönmedi: SMS sağlayıcısı konsol değil");
      await post("auth/otp/verify", { phone, code: req.dev_code, purpose: "customer", country_code: "TR", locale });
    },
    { phone, locale },
  );
  return phone;
}

/** Ekrandaki SMS girişini geliştirme koduyla tamamlar (`#otp-phone` görünürken çağrılır). */
export async function loginOnScreen(page: Page, phone: string) {
  requireDevSms();
  await page.fill("#otp-phone", phone);
  await page.locator("form:has(#otp-phone) button[type=submit]").click();
  await page.locator(".dev-hint").click();
  await page.locator("form:has(#otp-code) button[type=submit]").click();
}

/** Bugünden 5 gün sonra 10:00, Türkiye saatiyle ISO-8601. */
function pickupAt() {
  const d = new Date(Date.now() + 5 * 864e5 + 3 * 3600_000);
  return `${d.toISOString().slice(0, 10)}T10:00:00+03:00`;
}

/**
 * Giriş yapar ve Antalya Havalimanı → Kemer için ödeme bekleyen bir rezervasyon oluşturur (TRY).
 * Kodu ve giriş numarasını döner.
 */
export async function bookingWithPhone(page: Page, locale = "tr"): Promise<{ code: string; phone: string }> {
  const phone = await login(page, locale);
  const code = await page.evaluate(
    async ({ locale, at }) => {
      const call = async (path: string, body?: unknown) => {
        const r = await fetch(`/bff/${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: body === undefined ? undefined : { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
        return r.json();
      };
      const regions: { id: number; code: string }[] = await call("regions");
      const id = (code: string) => regions.find((r) => r.code === code)!.id;
      const req = {
        pickup: { region_id: id("ayt"), address: null },
        dropoff: { region_id: id("kemer"), address: null },
        vehicle_type_code: "minivan",
        pickup_at: at,
        return_pickup_at: null,
        passenger_count: 2,
        luggage_count: 2,
        country_code: "TR",
        with_guarantee: false,
      };
      const quote = await call("quotes", req);
      const booking = await call("me/bookings", {
        ...req,
        booking_type: "planli",
        expected_total: quote.total,
        passenger_name: "Test Yolcu",
        note: null,
        flights: [],
        locale,
        accept_disclosure: true,
        accept_distance_sales: true,
      });
      return booking.booking_code as string;
    },
    { locale, at: pickupAt() },
  );
  expect(code).toMatch(/^GA[A-Z0-9]{6}$/);
  return { code, phone };
}

/** Giriş yapar ve ödeme bekleyen bir rezervasyon oluşturur; kodu döner. */
export async function bookingAwaitingPayment(page: Page, locale = "tr"): Promise<string> {
  return (await bookingWithPhone(page, locale)).code;
}

/**
 * Geliştirme sunucusu rotayı ilk istekte derler (soğuk derleme 60 sn'yi aşabilir). Dosyanın `beforeAll`'ında
 * her rota bir kez, cömert süreyle açılır; böylece ilk test derleme beklemesiyle zaman aşımına düşmez.
 */
export async function warmUp(browser: Browser, info: TestInfo, paths: string[]) {
  info.setTimeout(240_000);
  const baseURL = info.project.use.baseURL ?? "http://localhost:3000";
  const page = await browser.newPage({ baseURL });
  try {
    for (const path of paths) await page.goto(path, { waitUntil: "domcontentloaded", timeout: 180_000 });
  } finally {
    await page.close();
  }
}
