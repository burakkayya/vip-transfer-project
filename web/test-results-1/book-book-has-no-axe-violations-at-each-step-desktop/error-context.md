# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: book.spec.ts >> book has no axe violations at each step
- Location: e2e\book.spec.ts:38:5

# Error details

```
Error: axe ihlalleri:
color-contrast [serious] a[aria-label="Getaway Transfers"] > .brand > .brand-text > .brand-sub

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "color-contrast [serious] a[aria-label=\"Getaway Transfers\"] > .brand > .brand-text > .brand-sub",
+ ]
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - banner [ref=e2]:
    - generic [ref=e3]:
      - link "Getaway Transfers" [ref=e4] [cursor=pointer]:
        - /url: /tr
        - generic [ref=e9]:
          - generic [ref=e10]: GETAWAY
          - generic [ref=e11]: TRANSFERS
      - navigation "Bölümler" [ref=e12]:
        - link "Hizmetler" [ref=e13] [cursor=pointer]:
          - /url: /tr#services
        - link "Filo" [ref=e14] [cursor=pointer]:
          - /url: /tr#fleet
        - link "SSS" [ref=e15] [cursor=pointer]:
          - /url: /tr#faq
      - navigation [ref=e16]:
        - link "Rezervasyonlarım" [ref=e17] [cursor=pointer]:
          - /url: /tr/bookings
        - link "Hesabım" [ref=e21] [cursor=pointer]:
          - /url: /tr/account
        - combobox "Dil" [ref=e25]:
          - option "Türkçe" [selected]
          - option "English"
          - option "Deutsch"
          - option "Русский"
        - link "Rezervasyon" [ref=e26] [cursor=pointer]:
          - /url: /tr/book
  - main [ref=e27]:
    - generic [ref=e28]:
      - heading "Rezervasyon" [level=1] [ref=e29]
      - generic [ref=e30]:
        - 'region "Rota haritası: Antalya Havalimanı (AYT) → Kemer" [ref=e32]':
          - paragraph: 61 km, yaklaşık 63 dk
        - generic [ref=e35]:
          - list "Rezervasyon adımları" [ref=e36]:
            - listitem [ref=e37]:
              - generic [ref=e38]: Araç
              - generic [ref=e39]: (tamamlandı)
            - listitem [ref=e40]:
              - generic [ref=e41]: Bilgiler
              - generic [ref=e42]: (tamamlandı)
            - listitem [ref=e43]:
              - generic [ref=e44]: Doğrulama
            - listitem [ref=e45]:
              - generic [ref=e46]: Onay
          - generic [ref=e47]:
            - generic [ref=e48]:
              - heading "Telefonunuzu doğrulayın" [active] [level=2] [ref=e49]
              - button "Geri" [ref=e50] [cursor=pointer]
            - paragraph [ref=e53]: Rezervasyonunuz telefon numaranızla ilişkilendirilir. Şifre gerekmez.
            - generic [ref=e54]:
              - generic [ref=e55]:
                - generic [ref=e56]:
                  - generic [ref=e57]: Ülke
                  - combobox "Ülke" [ref=e58]:
                    - option "Türkiye (+90)" [selected]
                    - option "Deutschland (+49)"
                    - option "United Kingdom (+44)"
                    - option "Россия (+7)"
                    - option "Nederland (+31)"
                    - option "Österreich (+43)"
                    - option "Schweiz (+41)"
                    - option "België (+32)"
                    - option "France (+33)"
                    - option "Polska (+48)"
                    - option "Україна (+380)"
                    - option "Қазақстан (+7)"
                    - option "Sverige (+46)"
                    - option "Danmark (+45)"
                    - option "Norge (+47)"
                    - option "Italia (+39)"
                    - option "España (+34)"
                    - option "United States (+1)"
                - generic [ref=e59]:
                  - generic [ref=e60]: Telefon numarası
                  - generic [ref=e61]:
                    - generic [ref=e62]: "+90"
                    - textbox "Telefon numarası +90" [ref=e63]:
                      - /placeholder: 532 123 45 67
                  - generic [ref=e64]: Ülke kodu olmadan yazın. SMS ile 6 haneli bir kod göndereceğiz.
              - button "Kod gönder" [ref=e66] [cursor=pointer]
        - complementary [ref=e67]:
          - generic [ref=e68]:
            - generic [ref=e69]:
              - heading "Özet" [level=3] [ref=e70]
              - button "Rotayı değiştir" [ref=e71] [cursor=pointer]
            - generic [ref=e72]:
              - generic [ref=e73]: Antalya Havalimanı (AYT)
              - generic [ref=e74]: Kemer
            - generic [ref=e75]:
              - term [ref=e76]: Tarih
              - definition [ref=e79]: 16 Kas 2026 10:00
              - term [ref=e80]: Yolcu ve bagaj
              - definition [ref=e83]: 2 yolcu · 2 bagaj
              - term [ref=e84]: Araç
              - definition [ref=e87]: Minivan
            - generic [ref=e88]:
              - generic [ref=e89]:
                - generic [ref=e90]: Transfer ücreti
                - generic [ref=e91]: ₺5.040,00
              - generic [ref=e92]:
                - generic [ref=e93]: Toplam
                - generic [ref=e94]: ₺5.040,00
            - list [ref=e95]:
              - listitem [ref=e96]: Sabit fiyat
              - listitem [ref=e99]: Alıştan 48 saat öncesine kadar ücretsiz iptal
              - listitem [ref=e102]: Güvenli ödeme
  - contentinfo [ref=e105]:
    - generic [ref=e107]:
      - generic [ref=e108]:
        - generic [ref=e109]:
          - generic [ref=e114]:
            - generic [ref=e115]: GETAWAY
            - generic [ref=e116]: TRANSFERS
          - paragraph [ref=e117]: Antalya ve Muğla'da şoförlü özel transfer.
          - paragraph [ref=e118]: "TÜRSAB belge no: [TÜRSAB belge no]"
        - generic [ref=e119]:
          - heading "Havalimanları" [level=4] [ref=e120]
          - list [ref=e121]:
            - listitem [ref=e122]:
              - link "Antalya (AYT)" [ref=e123] [cursor=pointer]:
                - /url: /tr/book?from=ayt
            - listitem [ref=e124]:
              - link "Gazipaşa-Alanya (GZP)" [ref=e125] [cursor=pointer]:
                - /url: /tr/book?from=gzp
            - listitem [ref=e126]:
              - link "Dalaman (DLM)" [ref=e127] [cursor=pointer]:
                - /url: /tr/book?from=dlm
            - listitem [ref=e128]:
              - link "Milas-Bodrum (BJV)" [ref=e129] [cursor=pointer]:
                - /url: /tr/book?from=bjv
        - generic [ref=e130]:
          - heading "Popüler rotalar" [level=4] [ref=e131]
          - list [ref=e132]:
            - listitem [ref=e133]:
              - link "Antalya Havalimanı → Kemer" [ref=e134] [cursor=pointer]:
                - /url: /tr/book?from=ayt&to=kemer
            - listitem [ref=e135]:
              - link "Antalya Havalimanı → Belek" [ref=e136] [cursor=pointer]:
                - /url: /tr/book?from=ayt&to=serik
            - listitem [ref=e137]:
              - link "Antalya Havalimanı → Alanya" [ref=e138] [cursor=pointer]:
                - /url: /tr/book?from=ayt&to=alanya
            - listitem [ref=e139]:
              - link "Dalaman Havalimanı → Fethiye" [ref=e140] [cursor=pointer]:
                - /url: /tr/book?from=dlm&to=fethiye
            - listitem [ref=e141]:
              - link "Bodrum Havalimanı → Bodrum" [ref=e142] [cursor=pointer]:
                - /url: /tr/book?from=bjv&to=bodrum
        - generic [ref=e143]:
          - heading "Yasal" [level=4] [ref=e144]
          - list [ref=e145]:
            - listitem [ref=e146]:
              - link "İptal ve iade politikası" [ref=e147] [cursor=pointer]:
                - /url: /tr/legal/cancellation
            - listitem [ref=e148]:
              - link "KVKK aydınlatma metni" [ref=e149] [cursor=pointer]:
                - /url: /tr/legal/privacy
            - listitem [ref=e150]:
              - link "Mesafeli satış ön bilgilendirme" [ref=e151] [cursor=pointer]:
                - /url: /tr/legal/distance-sales
            - listitem [ref=e152]:
              - link "Çerez politikası" [ref=e153] [cursor=pointer]:
                - /url: /tr/legal/cookies
            - listitem [ref=e154]:
              - link "Veri talep formu" [ref=e155] [cursor=pointer]:
                - /url: /tr/data-request
        - generic [ref=e156]:
          - heading "İletişim" [level=4] [ref=e157]
          - list [ref=e158]:
            - listitem [ref=e159]:
              - link "info@getawaytransfers.com" [ref=e160] [cursor=pointer]:
                - /url: mailto:info@getawaytransfers.com
            - listitem [ref=e161]: "[Adres], Antalya, Türkiye"
      - generic [ref=e162]:
        - generic [ref=e163]: © 2026 Getaway Transfers. Tüm hakları saklıdır.
        - generic [ref=e164]: PayTR · Visa · Mastercard
  - alert [ref=e167]
```

# Test source

```ts
  1  | import AxeBuilder from "@axe-core/playwright";
  2  | import { expect, type Page } from "@playwright/test";
  3  | 
  4  | const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
  5  | 
  6  | export async function expectNoAxeViolations(
  7  |   page: Page,
  8  |   opts?: { include?: string; exclude?: string[] },
  9  | ): Promise<void> {
  10 |   let builder = new AxeBuilder({ page }).withTags(TAGS);
  11 |   if (opts?.include) builder = builder.include(opts.include);
  12 |   for (const selector of opts?.exclude ?? []) builder = builder.exclude(selector);
  13 |   const { violations } = await builder.analyze();
  14 |   const summary = violations.map(
  15 |     (v) => `${v.id} [${v.impact ?? "n/a"}] ${v.nodes[0]?.target?.join(" ") ?? "-"}`,
  16 |   );
> 17 |   expect(summary, `axe ihlalleri:\n${summary.join("\n")}`).toEqual([]);
     |                                                            ^ Error: axe ihlalleri:
  18 | }
  19 | 
```