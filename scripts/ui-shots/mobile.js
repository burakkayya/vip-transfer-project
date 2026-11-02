// Müşteri mobil uygulaması (web önizlemesi, 8081): tr + de.
// Kullanım: node mobile.js --out <before|after> [--only home,book-vehicle] [--locales tr,de]
// Çıktı: docs/ui-review/screenshots/<out>/mobile/customer-<dil>-<ekran>.png
// --only ekran adı tam ("customer-tr-home") veya son ek ("home") olabilir.
// "customer-tr-booking-live" için sürücü akışı da (8082) çalışır.
require("./mobile-flow")
  .main("customer", "mobile.js")
  .catch((e) => {
    console.error("FAILED", e);
    process.exit(1);
  });
