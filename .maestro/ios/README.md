# iOS simülatör akışları (Maestro)

`.github/workflows/ios-simulator.yml` bu klasördeki `NN-*.yaml` dosyalarını sırayla, aynı simülatörde çalıştırır.
Müşteri (`com.getawaytransfers.app`) ve sürücü (`com.getawaytransfers.driver`) aynı backend'e bağlıdır; akışlar
birbirinin bıraktığı durumdan devam eder (sürücü çevrimiçi → müşteri anlık rezervasyon → sürücü kabul → canlı takip).

- Metin seçicileri Türkçedir (simülatör `tr_TR` açılır); Maestro'da metin tam eşleşen düzenli ifadedir.
- `takeScreenshot` çıktıları iş akışının `ios-out/screens` klasörüne düşer, yapıt adı `ios-simulator-sonuc`.
- Mac'te Maestro kuruluysa yerelde: `maestro test .maestro/ios/01-surucu-cevrimici.yaml`.
