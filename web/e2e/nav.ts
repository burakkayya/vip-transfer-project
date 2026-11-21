import type { Page, Response } from "@playwright/test";

/**
 * K-81: geliştirme sunucusu (`next dev`) sayfayı ilk kez derlerken paralel işçilerde gezinme ara sıra
 * `net::ERR_ABORTED` ile kesilir (derleme bitince sayfa yeniden yüklenir). Yalnızca bu hata en çok iki kez yeniden
 * denenir; diğer hatalar ve üretim sunucusundaki davranış değişmez.
 */
export async function gotoStable(page: Page, url: string): Promise<Response | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.goto(url);
    } catch (e) {
      if (attempt >= 2 || !String(e).includes("net::ERR_ABORTED")) throw e;
      await page.waitForTimeout(500 * (attempt + 1));
    }
  }
}
