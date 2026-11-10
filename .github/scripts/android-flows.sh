#!/usr/bin/env bash
# Android emülatöründe Maestro akışları (.maestro/android). android-emulator.yml içinden, emülatör açıkken çalışır.
# Çıktı: $OUT/screens (ekran görüntüleri), $OUT/emulator.mp4 + emulator-kucuk.mp4 (video), $OUT/app.log, ozet.txt.
set -u
OUT="${OUT:?OUT tanımlı değil}"
mkdir -p "$OUT/screens" "$OUT/rec" "$OUT/debug"

adb wait-for-device
# Sistem dili Türkçe (uygulamalar cihaz diline göre açılır). Kök yetkisiyle kalıcı, olmazsa uygulama bazında.
adb root > /dev/null 2>&1 && sleep 3 && adb wait-for-device
adb shell "setprop persist.sys.locale tr-TR; setprop ctl.restart zygote" || true
sleep 15
adb wait-for-device
for i in $(seq 1 60); do [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ] && break; sleep 3; done
adb shell settings put global window_animation_scale 0 || true
adb shell settings put global transition_animation_scale 0 || true
adb shell settings put global animator_duration_scale 0 || true
# Antalya Havalimanı konumu (sürücünün konumu, iş havuzu mesafesi).
adb emu geo fix 30.8015 36.9002 || true

adb install -r -g android-apps/customer.apk
adb install -r -g android-apps/driver.apk
for P in com.getawaytransfers.app com.getawaytransfers.driver; do
  adb shell cmd locale set-app-locales "$P" --locales tr-TR > /dev/null 2>&1 || true
  adb shell pm grant "$P" android.permission.POST_NOTIFICATIONS > /dev/null 2>&1 || true
done
adb shell getprop persist.sys.locale

# Uygulama günlüğü (JS hataları dahil).
adb logcat -c || true
adb logcat -v time ReactNativeJS:V ReactNative:V AndroidRuntime:E ExpoWidgets:V '*:S' > "$OUT/app.log" 2>&1 &
LOGP=$!

# Hızlı kontrol: iki uygulama açılıyor mu.
for P in com.getawaytransfers.app com.getawaytransfers.driver; do
  adb shell monkey -p "$P" -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1 || true
  sleep 15
  adb exec-out screencap -p > "$OUT/screens/00-acilis-$P.png" || true
  adb shell am force-stop "$P" || true
done

# Ekran kaydı: screenrecord en fazla 180 sn kaydeder; parçalar sırayla alınıp sonda birleştirilir.
rm -f /tmp/stop-rec
(
  i=0
  while [ ! -f /tmp/stop-rec ]; do
    adb shell screenrecord --bit-rate 2000000 --time-limit 170 "/sdcard/rec_$(printf %03d $i).mp4" || sleep 2
    i=$((i + 1))
  done
) &
RECP=$!
sleep 2

FAIL=0
cd "$OUT/screens"
for F in "$GITHUB_WORKSPACE"/.maestro/android/[0-9]*.yaml; do
  N=$(basename "$F" .yaml)
  if [ "$N" = "02b-musteri-odeme-onayi" ]; then
    # Tarayıcıda onaylanmadıysa sahte ödeme backend üzerinden tamamlanır (sayfadaki düğmenin yaptığı istek).
    OID=$(psql "postgresql://getaway:getaway@localhost:5432/getaway" -tAc \
      "select merchant_oid from payments where status='beklemede' order by created_at desc limit 1" | tr -d '[:space:]')
    if [ -n "$OID" ]; then
      echo "Sahte ödeme backend üzerinden onaylanıyor: $OID"
      curl -s -o /dev/null -X POST -d status=success "http://localhost:8000/api/v1/payments/fake/$OID/complete" || true
    fi
  fi
  echo "::group::$N"
  if maestro test "$F" --format junit --output "$OUT/$N.xml" --debug-output "$OUT/debug/$N"; then
    echo "OK $N" | tee -a "$OUT/ozet.txt"
  else
    echo "HATA $N" | tee -a "$OUT/ozet.txt"
    FAIL=1
    adb exec-out screencap -p > "$OUT/screens/HATA-$N.png" || true
    maestro hierarchy > "$OUT/screens/HATA-$N-agac.json" 2> /dev/null || true
  fi
  echo "::endgroup::"
done
cp "$GITHUB_WORKSPACE"/.maestro/android/*.png "$OUT/screens/" 2> /dev/null || true
find "$GITHUB_WORKSPACE" "$HOME/.maestro" -name "[ms][0-9][0-9]-*.png" -not -path "$OUT/*" \
  -exec cp {} "$OUT/screens/" \; 2> /dev/null || true

# Kaydı durdur, parçaları çek ve birleştir.
touch /tmp/stop-rec
adb shell pkill -INT screenrecord || true
sleep 6
kill "$RECP" 2> /dev/null || true
for f in $(adb shell ls /sdcard/ | tr -d '\r' | grep '^rec_.*\.mp4$' | sort); do
  adb pull "/sdcard/$f" "$OUT/rec/$f" > /dev/null || true
done
if ls "$OUT"/rec/*.mp4 > /dev/null 2>&1; then
  (cd "$OUT/rec" && for f in rec_*.mp4; do echo "file '$f'"; done > list.txt)
  ffmpeg -loglevel error -y -f concat -safe 0 -i "$OUT/rec/list.txt" -c copy "$OUT/emulator.mp4" || true
  # Telefondan izlenebilen küçük kopya (360 px, 10 kare/sn).
  ffmpeg -loglevel error -y -i "$OUT/emulator.mp4" -vf "fps=10,scale=360:-2" -c:v libx264 -crf 32 \
    -preset veryfast -an "$OUT/emulator-kucuk.mp4" || true
  rm -rf "$OUT/rec"
fi
kill "$LOGP" 2> /dev/null || true
ls -la "$OUT" "$OUT/screens"
cat "$OUT/ozet.txt"
exit $FAIL
