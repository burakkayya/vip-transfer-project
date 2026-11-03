// Sürücü uygulaması (web önizlemesi, 8082): tr. Teklif ve sefer ekranları için bir müşteri rezervasyonu (8081) açılır.
// Kullanım: node driver.js --out <before|after> [--only home-offer,documents]
// Çıktı: docs/ui-review/screenshots/<out>/mobile/driver-tr-<ekran>.png
// --only ekran adı tam ("driver-tr-documents") veya son ek ("documents") olabilir.
require("./mobile-flow")
  .main("driver", "driver.js")
  .catch((e) => {
    console.error("FAILED", e);
    process.exit(1);
  });
