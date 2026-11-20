#!/usr/bin/env bash
# Compila la app sorpresa a APK firmado.
# Necesita: java, python3 + Pillow, apktool.jar y apksig.jar en $TOOLS.
set -euo pipefail
cd "$(dirname "$0")"
TOOLS=${TOOLS:-./.tools}
mkdir -p "$TOOLS" out
[ -f "$TOOLS/apktool.jar" ] || curl -sL -o "$TOOLS/apktool.jar" https://github.com/iBotPeaches/Apktool/releases/download/v2.12.1/apktool_2.12.1.jar
[ -f "$TOOLS/apksig.jar" ] || curl -sL -o "$TOOLS/apksig.jar" https://repo1.maven.org/maven2/com/android/tools/build/apksig/2.3.0/apksig-2.3.0.jar
python3 build-tools/make_icon.py src/res
java -jar "$TOOLS/apktool.jar" b src -o out/unsigned.apk
[ -f "$TOOLS/sorpresa.p12" ] || keytool -genkeypair -keystore "$TOOLS/sorpresa.p12" -storetype PKCS12 \
  -storepass sorpresa -keypass sorpresa -alias sorpresa -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Sorpresa" >/dev/null 2>&1
javac -cp "$TOOLS/apksig.jar" -d "$TOOLS" build-tools/Sign.java
java --add-exports java.base/sun.security.x509=ALL-UNNAMED --add-exports java.base/sun.security.pkcs=ALL-UNNAMED --add-exports java.base/sun.security.util=ALL-UNNAMED -cp "$TOOLS/apksig.jar:$TOOLS" Sign "$TOOLS/sorpresa.p12" sorpresa out/unsigned.apk Sorpresa.apk
rm -f out/unsigned.apk
echo "Listo: $(pwd)/Sorpresa.apk"
