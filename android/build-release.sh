#!/usr/bin/env bash
# Build and sign the GlobalCity Android app (a Trusted Web Activity around https://globalcity.evertpot.com).
#   release/globalcity-<version>.aab  upload this to the Play Console (signed with the upload key)
#   release/globalcity-<version>.apk  side-load on a phone for testing (adb install -r ...)
# The upload key lives OUTSIDE the repo in ~/.globalcity-android (upload.jks + upload-password.txt). Back it up:
# without it no update can be uploaded. Toolchain: JDK 17 + Android SDK in ~/.bubblewrap (see README.md).
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME:-$HOME/.bubblewrap/jdk}" ANDROID_HOME="${ANDROID_HOME:-$HOME/.bubblewrap/android_sdk}"
KEY="$HOME/.globalcity-android/upload.jks"; ALIAS=globalcity-upload; PASS="$(cat "$HOME/.globalcity-android/upload-password.txt")"
BT="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"
VERSION=$(sed -n 's/.*versionName "\(.*\)"/\1/p' app/build.gradle | head -1)
echo "sdk.dir=$ANDROID_HOME" > local.properties
./gradlew --no-daemon -q bundleRelease assembleRelease
mkdir -p release
cp app/build/outputs/bundle/release/app-release.aab "release/globalcity-$VERSION.aab"
"$JAVA_HOME/bin/jarsigner" -keystore "$KEY" -storepass "$PASS" -keypass "$PASS" -sigalg SHA256withRSA -digestalg SHA-256 "release/globalcity-$VERSION.aab" "$ALIAS" > /dev/null
"$BT/zipalign" -f -p 4 app/build/outputs/apk/release/app-release-unsigned.apk "release/globalcity-$VERSION-aligned.apk"
"$BT/apksigner" sign --ks "$KEY" --ks-key-alias "$ALIAS" --ks-pass "pass:$PASS" --key-pass "pass:$PASS" --out "release/globalcity-$VERSION.apk" "release/globalcity-$VERSION-aligned.apk"
rm -f "release/globalcity-$VERSION-aligned.apk" "release/globalcity-$VERSION.apk.idsig"
"$BT/apksigner" verify "release/globalcity-$VERSION.apk" && echo "signed: release/globalcity-$VERSION.aab, release/globalcity-$VERSION.apk"
