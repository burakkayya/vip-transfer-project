# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: otp.spec.ts >> rate limit (429) on send shows API message and keeps phone
- Location: e2e\otp.spec.ts:170:5

# Error details

```
Error: locator.click: Target crashed 
Call log:
  - waiting for locator('form:has(#otp-phone) button[type=submit]')
    - locator resolved to <button type="submit" class="btn primary">Kod gönder</button>
  - attempting click action
    - waiting for element to be visible, enabled and stable
    - element is visible, enabled and stable
    - scrolling into view if needed
    - done scrolling

```

# Test source

```ts
  76  |   const resend = page.locator("button.otp-resend");
  77  |   await expect(resend).toBeDisabled();
  78  |   await expect(resend).toHaveAccessibleName(/\d+ sn/);
  79  |   await page.clock.runFor(46_000);
  80  |   await expect(resend).toBeEnabled();
  81  |   await expect(resend).toHaveAccessibleName("Kodu tekrar gönder");
  82  |   await resend.click();
  83  |   // Yeni kod gönderildiği duyurulur ve bekleme yeniden başlar.
  84  |   const live = page.locator(".otp").getByRole("status");
  85  |   await expect(live).toHaveText(/Yeni kodu \+1 \d+ numarasına gönderdik/);
  86  |   await expect(resend).toBeDisabled();
  87  |   await expect(resend).toHaveAccessibleName(/\d+ sn/);
  88  |   // İkinci tekrar gönderim de duyurulur: metin aynı olsa da bölge boşaltılıp yeniden yazılır.
  89  |   await live.evaluate((el) => {
  90  |     const w = window as unknown as { __liveTexts: string[] };
  91  |     w.__liveTexts = [];
  92  |     new MutationObserver(() => w.__liveTexts.push(el.textContent ?? "")).observe(el, {
  93  |       childList: true,
  94  |       characterData: true,
  95  |       subtree: true,
  96  |     });
  97  |   });
  98  |   await page.clock.runFor(46_000);
  99  |   await expect(resend).toBeEnabled();
  100 |   await resend.click();
  101 |   await expect
  102 |     .poll(() => page.evaluate(() => (window as unknown as { __liveTexts: string[] }).__liveTexts))
  103 |     .toEqual(expect.arrayContaining(["", expect.stringMatching(/Yeni kodu/)]));
  104 |   await expect(live).toHaveText(/Yeni kodu/);
  105 | });
  106 | 
  107 | test("countdown resumes from timestamp after the tab was hidden", async ({ page }) => {
  108 |   await page.clock.install();
  109 |   await openLogin(page);
  110 |   await requestCode(page);
  111 |   const resend = page.locator("button.otp-resend");
  112 |   await expect(resend).toHaveAccessibleName(/4\d sn/);
  113 |   // Sayaç adım saymaz: saat 30 sn atlatılınca (kısılmış arka plan sekmesi gibi) kalan süre doğrudan 15 sn civarına iner.
  114 |   const pageNow = await page.evaluate(() => Date.now());
  115 |   await page.clock.setFixedTime(pageNow + 30_000);
  116 |   await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  117 |   await expect(resend).toHaveAccessibleName(/^1\d sn/);
  118 | });
  119 | 
  120 | test("phone input announces dial code", async ({ page }) => {
  121 |   await openLogin(page);
  122 |   const phone = page.locator("#otp-phone");
  123 |   await expect(phone).toHaveAccessibleName(/Telefon numarası.*\+90/);
  124 |   await expect(phone).toHaveAccessibleDescription(/6 haneli/);
  125 |   await page.selectOption("#otp-country", "DE");
  126 |   await expect(phone).toHaveAccessibleName(/\+49/);
  127 |   // Ön ek alanın yanında görünür.
  128 |   await expect(page.locator(".phone-dial")).toHaveText("+49");
  129 | });
  130 | 
  131 | test("number typed with country code is not prefixed twice", async ({ page }) => {
  132 |   await openLogin(page);
  133 |   const { national } = fictionalPhone();
  134 |   await requestCode(page, `+1 ${national}`);
  135 |   await expect(page.locator(".otp-sent")).toContainText(`+1 ${national}`);
  136 |   await expect(page.locator(".otp-sent")).not.toContainText("+1 1");
  137 | });
  138 | 
  139 | test("international number with another country's code switches the country", async ({ page }) => {
  140 |   await openLogin(page);
  141 |   requireDevSms();
  142 |   // Kurgusal Birleşik Krallık numarası, Türkiye seçiliyken uluslararası yazılır.
  143 |   const uk = fictionalUkMobile();
  144 |   await page.fill("#otp-phone", `(+44) 7700 ${uk.national.slice(4)}`);
  145 |   await page.locator("form:has(#otp-phone) button[type=submit]").click();
  146 |   await expect(page.locator("#otp-code")).toBeVisible({ timeout: 15_000 });
  147 |   // Müşteri ülkesi numarayla tutarlı: seçim Birleşik Krallık'a döner (para birimi TRY değil GBP/EUR olur).
  148 |   await expect(page.locator(".otp-sent")).toContainText(`+44 ${uk.national}`);
  149 |   await page.getByRole("button", { name: "Numarayı değiştir" }).click();
  150 |   await expect(page.locator("#otp-country")).toHaveValue("GB");
  151 |   await expect(page.locator(".phone-dial")).toHaveText("+44");
  152 | });
  153 | 
  154 | test("country code outside the list shows field error", async ({ page }) => {
  155 |   await openLogin(page);
  156 |   await page.fill("#otp-phone", "+81 90 1234 5678");
  157 |   await page.locator("form:has(#otp-phone) button[type=submit]").click();
  158 |   const phone = page.locator("#otp-phone");
  159 |   await expect(phone).toHaveAttribute("aria-invalid", "true");
  160 |   await expect(page.locator("#otp-phone-error")).toContainText("Bu ülke kodu listede yok");
  161 |   await expect(page.locator("#otp-country")).toHaveValue("TR");
  162 | });
  163 | 
  164 | const TOO_MANY = {
  165 |   status: 429,
  166 |   contentType: "application/json",
  167 |   body: JSON.stringify({ error: { code: "too_many_requests", message: "çok fazla kod istendi" } }),
  168 | };
  169 | 
  170 | test("rate limit (429) on send shows API message and keeps phone", async ({ page }) => {
  171 |   await openLogin(page);
  172 |   await page.route("**/bff/auth/otp/request", (r) => r.fulfill(TOO_MANY));
  173 |   const { national } = fictionalPhone();
  174 |   await selectUs(page);
  175 |   await page.fill("#otp-phone", national);
> 176 |   await page.locator("form:has(#otp-phone) button[type=submit]").click();
      |                                                                  ^ Error: locator.click: Target crashed 
  177 |   await expect(page.locator(".otp").getByRole("alert")).toHaveText("Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.");
  178 |   await expect(page.locator("#otp-phone")).toHaveValue(national);
  179 |   await expect(page.locator("#otp-code")).toHaveCount(0);
  180 | });
  181 | 
  182 | test("rate limit (429) on resend shows API message and keeps phone", async ({ page }) => {
  183 |   await page.clock.install();
  184 |   await openLogin(page);
  185 |   const national = await requestCode(page);
  186 |   await page.clock.runFor(46_000);
  187 |   await page.route("**/bff/auth/otp/request", (r) => r.fulfill(TOO_MANY));
  188 |   const resend = page.locator("button.otp-resend");
  189 |   await expect(resend).toBeEnabled();
  190 |   await resend.click();
  191 |   await expect(page.locator(".otp").getByRole("alert")).toHaveText("Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.");
  192 |   await expect(page.locator(".otp-sent")).toContainText(`+1 ${national}`);
  193 |   await expect(page.locator("#otp-code")).toBeVisible();
  194 |   // Başarısız istek beklemeyi yeniden başlatmaz.
  195 |   await expect(resend).toBeEnabled();
  196 | });
  197 | 
  198 | test("too short phone number shows field error instead of a silent disabled button", async ({ page }) => {
  199 |   await openLogin(page);
  200 |   const send = page.locator("form:has(#otp-phone) button[type=submit]");
  201 |   await expect(send).toBeEnabled();
  202 |   await page.fill("#otp-phone", "532");
  203 |   await send.click();
  204 |   const phone = page.locator("#otp-phone");
  205 |   await expect(phone).toHaveAttribute("aria-invalid", "true");
  206 |   await expect(phone).toBeFocused();
  207 |   await expect(page.locator("#otp-phone-error")).toHaveText("Telefon numarasını kontrol edin.");
  208 | });
  209 | 
  210 | test("send code network failure shows alert and retry works", async ({ page }) => {
  211 |   await openLogin(page);
  212 |   await page.route("**/bff/auth/otp/request", (r) => r.abort());
  213 |   requireDevSms();
  214 |   await selectUs(page);
  215 |   await page.fill("#otp-phone", fictionalPhone().national);
  216 |   const send = page.locator("form:has(#otp-phone) button[type=submit]");
  217 |   await send.click();
  218 |   await expect(page.locator(".otp").getByRole("alert")).toContainText("Sunucuya ulaşılamadı");
  219 |   await page.unroute("**/bff/auth/otp/request");
  220 |   await send.click();
  221 |   await expect(page.locator("#otp-code")).toBeVisible({ timeout: 15_000 });
  222 | });
  223 | 
  224 | for (const width of [360, 390, 768, 1024, 1440]) {
  225 |   test(`de otp at ${width}px has no horizontal overflow`, async ({ page }, info) => {
  226 |     test.skip(info.project.name !== "desktop", "genişlik testte ayarlanır; tek projede yeter");
  227 |     await page.setViewportSize({ width, height: 900 });
  228 |     const check = async () => {
  229 |       const { scrollWidth, innerWidth } = await page.evaluate(() => ({
  230 |         scrollWidth: document.documentElement.scrollWidth,
  231 |         innerWidth: window.innerWidth,
  232 |       }));
  233 |       expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  234 |       const clipped = await page.evaluate(() =>
  235 |         Array.from(document.querySelectorAll(".otp .btn, .otp label, .otp .dev-hint, .otp .phone-input"))
  236 |           .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== "visible")
  237 |           .map((el) => el.textContent?.trim().slice(0, 40)),
  238 |       );
  239 |       expect(clipped).toEqual([]);
  240 |     };
  241 |     await openLogin(page, "de");
  242 |     await check();
  243 |     requireDevSms();
  244 |     await selectUs(page);
  245 |     await page.fill("#otp-phone", fictionalPhone().national);
  246 |     await page.locator("form:has(#otp-phone) button[type=submit]").click();
  247 |     await expect(page.locator("#otp-code")).toBeVisible({ timeout: 15_000 });
  248 |     await check();
  249 |   });
  250 | }
  251 | 
```