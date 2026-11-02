import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations } from "./a11y";

// SMS doğrulama (B-W3): `OtpLogin` ve onu saran `RequireLogin` (/account, /bookings, /data-request).
// Telefon başına saatlik kod sınırı ve yanlış kod sayacı olduğu için her test yeni bir numara kullanır.

let seq = 0;
/** Türkiye için 10 haneli, test başına benzersiz ulusal numara. */
function freshNational() {
  seq += 1;
  return `558${String(Date.now()).slice(-5)}${String(seq % 100).padStart(2, "0")}`;
}

/** /account oturumsuz açılır; telefon alanı oturum denetimi bittikten (hidrasyon sonrası) görünür. */
async function openLogin(page: Page, locale = "tr") {
  await page.goto(`/${locale}/account`);
  await expect(page.locator("#otp-phone")).toBeVisible({ timeout: 30_000 });
}

/** Telefonu yazar ve kodu ister; kod adımına geçildiğini bekler. */
async function requestCode(page: Page, national = freshNational()) {
  await page.fill("#otp-phone", national);
  await page.locator("form:has(#otp-phone) button[type=submit]").click();
  await expect(page.locator("#otp-code")).toBeVisible({ timeout: 15_000 });
  return national;
}

test("otp step has no axe violations", async ({ page }) => {
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
  await expect(page.locator(".otp-sent")).toContainText(`+90 ${national}`);
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
  await expect(page.locator(".otp").getByRole("status").filter({ hasText: "Yeni kodu" })).toBeVisible();
  await expect(resend).toBeDisabled();
  await expect(resend).toHaveAccessibleName(/\d+ sn/);
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
  const national = freshNational();
  await requestCode(page, `+90 ${national}`);
  await expect(page.locator(".otp-sent")).toContainText(`+90 ${national}`);
  await expect(page.locator(".otp-sent")).not.toContainText("+90 90");
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
  await page.fill("#otp-phone", freshNational());
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
    await page.fill("#otp-phone", freshNational());
    await page.locator("form:has(#otp-phone) button[type=submit]").click();
    await expect(page.locator("#otp-code")).toBeVisible({ timeout: 15_000 });
    await check();
  });
}
