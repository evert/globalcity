# GlobalCity for Android

A Trusted Web Activity (TWA): a small Android app that opens https://globalcity.evertpot.com full screen in
Chrome, with no address bar. Game updates ship through the website as usual; a new app release is only needed
for app-level changes (name, icon, version). Generated with Bubblewrap from the site's `manifest.json`;
settings live in `twa-manifest.json` and `app/build.gradle` (package `com.evertpot.globalcity`).

## Building

```sh
android/build-release.sh
```

This builds and signs `release/globalcity-<version>.aab` (for the Play Console) and
`release/globalcity-<version>.apk` (to install on a phone directly, e.g. `adb install -r`).

Requirements, installed once under `~/.bubblewrap`: JDK 17 (`jdk/`) and the Android SDK (`android_sdk/`, with
`platforms;android-36` and build tools). The upload signing key is **not** in the repo: it lives in
`~/.globalcity-android/upload.jks` with its password in `upload-password.txt`. Back both up somewhere safe;
without them no update can be uploaded.

To release a new version, bump `versionCode` (must always increase) and `versionName` in `app/build.gradle`
and `twa-manifest.json`, then run the script.

## Publishing on Google Play

1. Create a Play Console developer account (one-time fee) and create the app "GlobalCity".
2. Upload `release/globalcity-1.0.0.aab` to a **closed testing** track. New personal accounts need at least 12
   testers opted in for 14 days before the app can go to production.
3. Keep **Play App Signing** on (the default). Google then re-signs the app with its own key, so the site must
   also trust that key: in the Play Console open *Test and release → App integrity → App signing*, copy the
   "App signing key certificate" SHA-256 fingerprint, and add it to the `sha256_cert_fingerprints` list in
   `client/public/.well-known/assetlinks.json` (keep the upload key's fingerprint there too). Deploy the site.
   Without this, the Play Store version shows a browser address bar at the top.
4. Fill in the store listing: description, screenshots, the 512 px icon (`store_icon.png`), the privacy policy
   URL (https://globalcity.evertpot.com/privacy.html, from `client/public/privacy.html`), the content rating questionnaire and the data safety form.

Check the site/app link at any time:
https://digitalassetlinks.googleapis.com/v1/assetlinks:check?source.web.site=https://globalcity.evertpot.com&relation=delegate_permission/common.handle_all_urls&target.android_app.package_name=com.evertpot.globalcity&target.android_app.certificate.sha256_fingerprint=F8:F3:E8:0B:D2:02:61:72:A8:84:10:47:FC:31:A5:C0:14:BF:7C:6C:09:17:9A:BF:9E:1E:91:8D:9E:17:79:D6
