#!/usr/bin/env bash
# Builds the offline signer into an Android APK with no INTERNET permission, using only the SDK's build tools (no Gradle).
# Needs ANDROID_HOME (platform android-35, build-tools 36.0.0) and a JDK 17. Output: packages/signer/android/build/verbatim-signer.apk
# Install on a phone with USB debugging: adb install -r packages/signer/android/build/verbatim-signer.apk
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$SDK/build-tools/${BUILD_TOOLS:-36.0.0}"
JAR="$SDK/platforms/${PLATFORM:-android-35}/android.jar"
JAVA_HOME="${JAVA_HOME_17:-$(/usr/libexec/java_home -v 17 2>/dev/null || echo "${JAVA_HOME:-}")}"
B="$HERE/build"

rm -rf "$B" && mkdir -p "$B/res" "$B/classes" "$B/dex" "$B/assets/www"

# 1. The page: one self-contained HTML file.
(cd "$HERE/.." && pnpm exec vite build >/dev/null)
cp "$HERE/../dist/index.html" "$B/assets/www/index.html"

# 2. Resources and manifest.
"$BT/aapt2" compile --dir "$HERE/res" -o "$B/res/res.zip"
"$BT/aapt2" link -I "$JAR" --manifest "$HERE/AndroidManifest.xml" -A "$B/assets" -o "$B/unsigned.apk" "$B/res/res.zip" --java "$B/gen" --min-sdk-version 26 --target-sdk-version 35

# 3. Code.
"$JAVA_HOME/bin/javac" -source 8 -target 8 -Xlint:-options -bootclasspath "$JAR" -d "$B/classes" "$B/gen/xyz/verbatim/signer/R.java" "$HERE/src/xyz/verbatim/signer/MainActivity.java"
"$BT/d8" --release --min-api 26 --lib "$JAR" --output "$B/dex" $(find "$B/classes" -name '*.class')
(cd "$B/dex" && zip -q "$B/unsigned.apk" classes.dex)

# 4. Align and sign. The debug keystore is fine for a demo phone; use a release key to publish.
"$BT/zipalign" -f -p 4 "$B/unsigned.apk" "$B/aligned.apk"
KS="${SIGNER_KEYSTORE:-$HOME/.android/debug.keystore}"
"$BT/apksigner" sign --ks "$KS" --ks-pass "pass:${SIGNER_KEYSTORE_PASS:-android}" --out "$B/verbatim-signer.apk" "$B/aligned.apk"
"$BT/apksigner" verify "$B/verbatim-signer.apk"

echo "built $B/verbatim-signer.apk"
echo "permissions it asks for:"
"$BT/aapt2" dump permissions "$B/verbatim-signer.apk"
