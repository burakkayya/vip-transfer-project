import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";
import { fictionalPhone, fictionalUkMobile, requireDevSms } from "./session";

// SMS doğrulama (B-W3): `OtpLogin` ve onu saran `RequireLogin` (/account, /bookings, /data-request).
// Telefon başına saatlik kod sınırı ve yanlış kod sayacı olduğu için her test yeni bir numara kullanır.
// Numaralar kurgusaldır (ABD 555-01XX, `session.ts`): ülke ABD seçilip ulusal kısım yazılır.

/** Ülkeyi ABD yapar; kod gönderen testlerde kurgusal numara bu seçimle yazılır. */
async function selectUs(page: Page) {
  await page.selectOption("#otp-country", "US");
}

/** /account oturumsuz açılır; telefon alanı oturum denetimi bittikten (hidrasyon sonrası) görünür. */
async function openLogin(page: Page, locale = "tr") {
  await page.goto(`/${locale}/account`);
  await expect(page.locator("#otp-phone")).toBeVisible({ timeout: 30_000 });
}

/** ABD'yi seçer, kurgusal numarayı (veya verilen yazımı) yazar ve kodu ister; kod adımına geçildiğini bekler. */
async function requestCode(page: Page, national = fictionalPhone().national) {
  requireDevSms();
  await selectUs(page);
  await page.fill("#otp-phone", national);
  await page.locator("form:has(#otp-phone) button[type=submit]").click();
  await expect(page.locator("#otp-code")).toBeVisible({ timeout: 15_000 });
  return national;
}

test("otp step has no axe violations", async ({ page }) => {
  // Üç axe taraması + geliştirme sunucusunda ilk derleme: varsayılan 30 sn sınırda kalıyor.
  test.setTimeout(90_000);
  await openLogin(page);
  await expectNoAxeViolations(page);
  await requestCode(page);
  await expectNoAxeViolations(page);
  // Yanlış kod sonrası hata durumu da denetlenir.
  await page.fill("#otp-code", "000000");
  await page.locator("form:has(#otp-code) button[type=submit]").click();
  await expect(page.locator(".otp").getByRole("alert")).toBeVisible();
  await expectNoAxeViolations(page);
});

test("wrong code shows error and keeps phone", async ({ page }) => {
  await openLogin(page);
  const national = await requestCode(page);
  // Geliştirme kodu tesadüfen 000000 ise başka bir yanlış kod denenir.
  const dev = ((await page.locator(".dev-hint").textContent()) ?? "").replace(/\D/g, "");
  const wrong = dev === "000000" ? "000001" : "000000";
  await page.fill("#otp-code", wrong);
  await page.locator("form:has(#otp-code) button[type=submit]").click();

  const alert = page.locator(".otp").getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Kod hatalı");
  // Hata alana bağlıdır ve odak düzeltme için alana döner.
  const code = page.locator("#otp-code");
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await expect(code).toBeFocused();
  const describedBy = (await code.getAttribute("aria-describedby")) ?? "";
  expect(describedBy.split(" ")).toContain("otp-error");
  // Kodun gönderildiği numara değişmez.
  await expect(page.locator(".otp-sent")).toContainText(`+1 ${national}`);
  // Numarayı değiştir: yazılan numara korunur ve odak telefon alanına gider.
  await page.getByRole("button", { name: "Numarayı değiştir" }).click();
  const phone = page.locator("#otp-phone");
  await expect(phone).toHaveValue(national);
  await expect(phone).toBeFocused();
});

test("resend is rate-limited visually", async ({ page }) => {
  await page.clock.install();
  await openLogin(page);
  await requestCode(page);
  // İlk gönderimden sonra tekrar gönderme bekleme süresini metinle söyler.
  const resend = page.locator("button.otp-resend");
  await expect(resend).toBeDisabled();
  await expect(resend).toHaveAccessibleName(/\d+ sn/);
  await page.clock.runFor(46_000);
  await expect(resend).toBeEnabled();
  await expect(resend).toHaveAccessibleName("Kodu tekrar gönder");
  await resend.click();
  // Yeni kod gönderildiği duyurulur ve bekleme yeniden başlar.
  const live = page.locator(".otp").getByRole("status");
  await expect(live).toHaveText(/Yeni kodu \+1 \d+ numarasına gönderdik/);
  await expect(resend).toBeDisabled();
  await expect(resend).toHaveAccessibleName(/\d+ sn/);
  // İkinci tekrar gönderim de duyurulur: metin aynı olsa da bölge boşaltılıp yeniden yazılır.
  await live.evaluate((el) => {
    const w = window as unknown as { __liveTexts: string[] };
    w.__liveTexts = [];
    new MutationObserver(() => w.__liveTexts.push(el.textContent ?? "")).observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  await page.clock.runFor(46_000);
  await expect(resend).toBeEnabled();
  await resend.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __liveTexts: string[] }).__liveTexts))
    .toEqual(expect.arrayContaining(["", expect.stringMatching(/Yeni kodu/)]));
  await expect(live).toHaveText(/Yeni kodu/);
});

test("countdown resumes from timestamp after the tab was hidden", async ({ page }) => {
  await page.clock.install();
  await openLogin(page);
  await requestCode(page);
  const resend = page.locator("button.otp-resend");
  await expect(resend).toHaveAccessibleName(/4\d sn/);
  // Sayaç adım saymaz: saat 30 sn atlatılınca (kısılmış arka plan sekmesi gibi) kalan süre doğrudan 15 sn civarına iner.
  const pageNow = await page.evaluate(() => Date.now());
  await page.clock.setFixedTime(pageNow + 30_000);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(resend).toHaveAccessibleName(/^1\d sn/);
});

test("phone input announces dial code", async ({ page }) => {
  await openLogin(page);
  const phone = page.locator("#otp-phone");
  await expect(phone).toHaveAccessibleName(/Telefon numarası.*\+90/);
  await expect(phone).toHaveAccessibleDescription(/6 haneli/);
  await page.selectOption("#otp-country", "DE");
  await expect(phone).toHaveAccessibleName(/\+49/);
  // Ön ek alanın yanında görünür.
  await expect(page.locator(".phone-dial")).toHaveText("+49");
});

test("number typed with country code is not prefixed twice", async ({ page }) => {
  await openLogin(page);
  const { national } = fictionalPhone();
  await requestCode(page, `+1 ${national}`);
  await expect(page.locator(".otp-sent")).toContainText(`+1 ${national}`);
  await expect(page.locator(".otp-sent")).not.toContainText("+1 1");
});

test("international number with another country's code switches the country", async ({ page }) => {
  await openLogin(page);
  requireDevSms();
  // Kurgusal Birleşik Krallık numarası, Türkiye seçiliyken uluslararası yazılır.
  const uk = fictionalUkMobile();
  await page.fill("#otp-phone", `(+44) 7700 ${uk.national.slice(4)}`);
  await page.locator("form:has(#otp-phone) button[type=submit]").click();
  await expect(page.locator("#otp-code")).toBeVisible({ timeout: 15_000 });
  // Müşteri ülkesi numarayla tutarlı: seçim Birleşik Krallık'a döner (para birimi TRY değil GBP/EUR olur).
  await expect(page.locator(".otp-sent")).toContainText(`+44 ${uk.national}`);
  await page.getByRole("button", { name: "Numarayı değiştir" }).click();
  await expect(page.locator("#otp-country")).toHaveValue("GB");
  await expect(page.locator(".phone-dial")).toHaveText("+44");
});

test("country code outside the list shows field error", async ({ page }) => {
  await openLogin(page);
  await page.fill("#otp-phone", "+81 90 1234 5678");
  await page.locator("form:has(#otp-phone) button[type=submit]").click();
  const phone = page.locator("#otp-phone");
  await expect(phone).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#otp-phone-error")).toContainText("Bu ülke kodu listede yok");
  await expect(page.locator("#otp-country")).toHaveValue("TR");
});

const TOO_MANY = {
  status: 429,
  contentType: "application/json",
  body: JSON.stringify({ error: { code: "too_many_requests", message: "çok fazla kod istendi" } }),
};

test("rate limit (429) on send shows API message and keeps phone", async ({ page }) => {
  await openLogin(page);
  await page.route("**/bff/auth/otp/request", (r) => r.fulfill(TOO_MANY));
  const { national } = fictionalPhone();
  await selectUs(page);
  await page.fill("#otp-phone", national);
  await page.locator("form:has(#otp-phone) button[type=submit]").click();
  await expect(page.locator(".otp").getByRole("alert")).toHaveText("Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.");
  await expect(page.locator("#otp-phone")).toHaveValue(national);
  await expect(page.locator("#otp-code")).toHaveCount(0);
});

test("rate limit (429) on resend shows API message and keeps phone", async ({ page }) => {
  await page.clock.install();
  await openLogin(page);
  const national = await requestCode(page);
  await page.clock.runFor(46_000);
  await page.route("**/bff/auth/otp/request", (r) => r.fulfill(TOO_MANY));
  const resend = page.locator("button.otp-resend");
  await expect(resend).toBeEnabled();
  await resend.click();
  await expect(page.locator(".otp").getByRole("alert")).toHaveText("Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.");
  await expect(page.locator(".otp-sent")).toContainText(`+1 ${national}`);
  await expect(page.locator("#otp-code")).toBeVisible();
  // Başarısız istek beklemeyi yeniden başlatmaz.
  await expect(resend).toBeEnabled();
});

test("too short phone number shows field error instead of a silent disabled button", async ({ page }) => {
  await openLogin(page);
  const send = page.locator("form:has(#otp-phone) button[type=submit]");
  await expect(send).toBeEnabled();
  await page.fill("#otp-phone", "532");
  await send.click();
  const phone = page.locator("#otp-phone");
  await expect(phone).toHaveAttribute("aria-invalid", "true");
  await expect(phone).toBeFocused();
  await expect(page.locator("#otp-phone-error")).toHaveText("Telefon numarasını kontrol edin.");
});

test("send code network failure shows alert and retry works", async ({ page }) => {
  await openLogin(page);
  await page.route("**/bff/auth/otp/request", (r) => r.abort());
  requireDevSms();
  await selectUs(page);
  await page.fill("#otp-phone", fictionalPhone().national);
  const send = page.locator("form:has(#otp-phone) button[type=submit]");
  await send.click();
  await expect(page.locator(".otp").getByRole("alert")).toContainText("Sunucuya ulaşılamadı");
  await page.unroute("**/bff/auth/otp/request");
  await send.click();
  await expect(page.locator("#otp-code")).toBeVisible({ timeout: 15_000 });
});

for (const width of [360, 390, 768, 1024, 1440]) {
  test(`de otp at ${width}px has no horizontal overflow`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "genişlik testte ayarlanır; tek projede yeter");
    await page.setViewportSize({ width, height: 900 });
    const check = async () => {
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
      const clipped = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".otp .btn, .otp label, .otp .dev-hint, .otp .phone-input"))
          .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible")
          .map((el) => el.textContent?.trim().slice(0, 40)),
      );
      expect(clipped).toEqual([]);
    };
    await openLogin(page, "de");
    await check();
    requireDevSms();
    await selectUs(page);
    await page.fill("#otp-phone", fictionalPhone().national);
    await page.locator("form:has(#otp-phone) button[type=submit]").click();
    await expect(page.locator("#otp-code")).toBeVisible({ timeout: 15_000 });
    await check();
  });
}
