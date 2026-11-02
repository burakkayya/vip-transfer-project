# Lint taban çizgisi

ESLint 9 (flat config; `next/core-web-vitals` + `plugin:jsx-a11y/recommended`) ile ölçülen mevcut ihlaller. Bunlar düzeltilmedi ve susturulmadı; ekran görevleri ilgili dosyaya dokunduğunda giderilir, plan kapanışında lint sıfır ihlalle zorunlu olur.

Ölçüm tarihi: 2026-11-02, dal `chore/ui-infra`. Komut: `cd web && npx eslint .`

## web

Özet: 3 hata, 4 uyarı, 4 dosya (`npm run lint` rc=1).

| Dosya | Kural | Önem | Adet |
|---|---|---|---|
| `web/app/[locale]/page.tsx` | `@next/next/no-img-element` | uyarı | 1 |
| `web/components/BookingWizard.tsx` | `@next/next/no-img-element` | uyarı | 1 |
| `web/components/BookingWizard.tsx` | `jsx-a11y/label-has-associated-control` | hata | 2 |
| `web/components/Motion.tsx` | `@next/next/no-img-element` | uyarı | 2 |
| `web/components/OtpLogin.tsx` | `jsx-a11y/no-autofocus` | hata | 1 |

Not: `web/next.config.ts` içinde `eslint.ignoreDuringBuilds: true` vardır; aksi halde hatalar `next build`'i düşürür. Lint ayrıca `npm run lint` ile çalıştırılır.

## admin

Özet: 1 hata, 2 uyarı, 2 dosya (`npm run lint` rc=1). Ölçüm: 2026-11-02, dal `chore/ui-infra`. Komut: `cd admin && npx eslint .`

| Dosya | Kural | Önem | Adet |
|---|---|---|---|
| `admin/app/login/page.tsx` | `@next/next/no-img-element` | uyarı | 1 |
| `admin/app/login/page.tsx` | `jsx-a11y/no-autofocus` | hata | 1 |
| `admin/components/DocumentReview.tsx` | `@next/next/no-img-element` | uyarı | 1 |

Not: `admin/next.config.ts` içinde `eslint.ignoreDuringBuilds: true` vardır; aksi halde login sayfasındaki hata `next build`'i düşürür.

## mobile

(Hat A sonraki görevi dolduracak.)
