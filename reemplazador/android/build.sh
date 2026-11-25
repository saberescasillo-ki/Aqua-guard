#!/usr/bin/env bash
# Compila el APK sin Gradle. Requiere (Ubuntu/Debian):
#   apt-get install aapt apksigner zipalign android-sdk-platform-23 dalvik-exchange openjdk-17-jdk
set -euo pipefail
cd "$(dirname "$0")"
SDK_JAR=/usr/lib/android-sdk/platforms/android-23/android.jar
OUT=build
rm -rf "$OUT" && mkdir -p "$OUT/gen" "$OUT/classes" assets
cp ../index.html assets/index.html

aapt package -f -m -J "$OUT/gen" -M AndroidManifest.xml -S res -A assets -I "$SDK_JAR" -F "$OUT/app.unsigned.apk"
javac --release 8 -nowarn -classpath "$SDK_JAR" -d "$OUT/classes" $(find src "$OUT/gen" -name '*.java') 2>&1 | grep -v "warning" || true
dalvik-exchange --dex --output="$OUT/classes.dex" "$OUT/classes"
(cd "$OUT" && aapt add app.unsigned.apk classes.dex >/dev/null)
zipalign -f 4 "$OUT/app.unsigned.apk" "$OUT/app.aligned.apk"

KS=${KEYSTORE:-reemplazador.keystore}
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -alias reemplazador -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass reemplazador -keypass reemplazador -dname "CN=Reemplazador" >/dev/null 2>&1
fi
apksigner sign --ks "$KS" --ks-pass pass:reemplazador --key-pass pass:reemplazador --out Reemplazador.apk "$OUT/app.aligned.apk"
apksigner verify Reemplazador.apk && echo "OK -> $(pwd)/Reemplazador.apk"
