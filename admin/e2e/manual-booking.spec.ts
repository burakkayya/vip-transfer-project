import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";
import { hasCredentials, SKIP_MESSAGE } from "./session";

/** Türkiye saatiyle `datetime-local` değeri (gün sonra, saat 10:00). */
function localDate(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(d);
  return `${day}T10:00`;
}

// K-54: WhatsApp'tan gelen müşteri için admin girişiyle rezervasyon, ödeme bağlantısı ve elle tahsilat.
test("admin manuel rezervasyon: müşteri ekle, fiyat, oluştur, elle tahsilat", async ({ page }) => {
  test.skip(!hasCredentials(), SKIP_MESSAGE);
  test.setTimeout(90_000);
  const phone = `+49151${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

  await page.goto("/bookings/new");
  await expect(page.getByRole("heading", { level: 1, name: "Yeni rezervasyon (admin girişi)" })).toBeVisible();
  await expectNoAxeViolations(page);

  // 1. Müşteri yok → ekle ve seç
  await page.getByLabel("Telefon (tam numara)").fill(phone);
  await page.getByRole("button", { name: "Müşteriyi bul" }).click();
  await expect(page.getByText("Bu numarayla müşteri yok")).toBeVisible();
  await page.getByLabel("Ad soyad").fill("Hans Müller");
  await page.getByLabel("Ülke", { exact: false }).first().selectOption("DE");
  await page.getByRole("button", { name: "Müşteriyi ekle ve seç" }).click();
  await expect(page.getByText("Henüz SMS koduyla giriş yapmadı")).toBeVisible();

  // 2. Yolculuk: ilçe/havalimanı seçimi
  await page.getByLabel("Alış zamanı (Türkiye saati)").fill(localDate(3));
  for (const [name, index] of [["Alış noktası", 1], ["Varış noktası", 4]] as const) {
    const group = page.getByRole("group", { name });
    await group.getByLabel("İlçe / havalimanı seç").check();
    await group.getByLabel("İlçe veya havalimanı").selectOption({ index });
  }

  // 3. Fiyat
  await page.getByRole("button", { name: "Fiyatları hesapla" }).click();
  const vehicles = page.getByRole("radiogroup", { name: "Araç tipi" });
  await expect(vehicles.getByRole("radio").first()).toBeVisible();
  await vehicles.getByRole("radio", { disabled: false }).first().check();

  // 6. Onay ve oluştur (ödeme bağlantısı, SMS)
  await page.getByLabel(/KVKK aydınlatma metni/).check();
  await page.getByRole("button", { name: "Rezervasyonu oluştur", exact: true }).click();

  const heading = page.getByRole("heading", { level: 1, name: /Rezervasyon oluşturuldu: GA/ });
  await expect(heading).toBeVisible();
  const code = (await heading.innerText()).split(": ")[1].trim();
  await expect(page.getByLabel(/Ödeme bağlantısı/)).toHaveValue(new RegExp(`/bookings/${code}/pay$`));
  await expect(page.getByLabel("WhatsApp'a yapıştırılacak metin")).toHaveValue(new RegExp(code));
  await expectNoAxeViolations(page);

  // Detay: kaynak, paylaşım metni, elle tahsilat
  await page.getByRole("link", { name: "Detaya git" }).click();
  // Geliştirme sunucusunda sayfa ilk açılışta derlenir.
  await expect(page.getByRole("heading", { level: 1, name: `Rezervasyon ${code}` })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Admin girişi · WhatsApp")).toBeVisible();
  await page.getByLabel("Dekont / makbuz no").fill("DEKONT-E2E");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Tahsilatı kaydet" }).click();
  await expect(page.getByText("Tahsilat kaydedildi, rezervasyon onaylandı.")).toBeVisible();
  await expect(page.locator(".page-head .badge")).toHaveText("Onaylandı");
  await expect(page.getByText("Elle tahsilat · Havale / EFT")).toBeVisible();

  // Liste: kaynak filtresi
  await page.goto("/bookings");
  await page.getByLabel("Kaynak").selectOption("admin");
  await expect(page.getByRole("link", { name: code })).toBeVisible();
});

test("müşteriler sayfasından müşteri ekleme", async ({ page }) => {
  test.skip(!hasCredentials(), SKIP_MESSAGE);
  await page.goto("/customers");
  await page.getByRole("button", { name: "Müşteri ekle" }).click();
  await expect(page.getByRole("heading", { name: "Yeni müşteri" })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByLabel("Telefon", { exact: false }).nth(0).fill(`+90532${Math.floor(1_000_000 + Math.random() * 8_999_999)}`);
  await page.getByLabel("Ad soyad").fill("Ayşe Yılmaz");
  await page.getByRole("button", { name: "Müşteri ekle" }).last().click();
  await expect(page.getByText("Ayşe Yılmaz eklendi.")).toBeVisible();
});
