# Clipboard Sync - Android App

Android client for Clipboard Sync. The normal public install path starts from
the Mac DMG: the macOS onboarding launcher downloads the APK from GitHub
Releases and installs it through ADB.

## Requirements

- Node.js `>=20.19.4` and npm `>=10`.
- JDK 17.
- Android Studio / Android SDK.
- Android device with USB debugging for local install.
- Same Wi-Fi/LAN as the Mac app, or a manual Mac WebSocket URL.
- Shizuku or ADB app-op setup required by the native clipboard access path.

## Commands

```bash
cd android-app
npm ci
npm run typecheck
npm run android:debug
npm run android:release
```

`npm run android:debug` builds the APK used by the Mac onboarding launcher for
ADB installation.

`npm run android:release` builds a release variant. Without signing env vars it
is unsigned and only useful for verifying that the release build completes.

## Release Signing

Release signing is only needed for alternative Android distribution channels
that require a private keystore. Do not commit private signing material. Create
the keystore outside the repo and set:

```bash
export CLIPBOARD_SYNC_ANDROID_KEYSTORE=/absolute/path/to/release.keystore
export CLIPBOARD_SYNC_ANDROID_KEYSTORE_PASSWORD=...
export CLIPBOARD_SYNC_ANDROID_KEY_ALIAS=...
export CLIPBOARD_SYNC_ANDROID_KEY_PASSWORD=...
npm run android:release
```

The repo ignores `.jks`, `.keystore`, `.p12`, `.p8`, `.key`, certificates, and
generated build outputs.

## Dev Notes

The Expo dev-client package is intentionally not part of the public release
path. Use the regular Expo/React Native debug build:

```bash
npm run android
npm start
```

The old dev-client network inspector Gradle property was removed with the
dev-client dependency.

## Configuration

The normal path is Mac-first: install the DMG, connect the phone over USB, and
let the macOS onboarding launcher install the APK, open Android, pair the Mac
fingerprint, start Shizuku where possible, and grant the clipboard app-op.

For manual recovery after installing the Android app:

1. Open **Settings**.
2. Tap **Find Mac automatically** to discover `_clipboard-sync._tcp` over
   Bonjour/mDNS.
3. If discovery is blocked, enter a manual URL such as
   `ws://192.168.X.X:8787/ws` or `ws://macbook.local:8787/ws`.
4. Tap **Save & Reconnect**.

The WebSocket session negotiates a key with P-256 ECDH, verifies the signed Mac
identity against the pinned fingerprint, and encrypts application payloads with
AES-256-GCM. Plain HTTP clipboard sync is disabled.

## Background Sync

Auto sync runs through a foreground service and requires the visible Android
notification. Long-running background sync may also require:

- Shizuku or ADB app-op clipboard access.
- Battery optimization disabled for Clipboard Sync.
- OEM background restrictions adjusted.

Boot autostart is best effort. Android 15+ restricts `BOOT_COMPLETED` receivers
from starting `dataSync` foreground services for apps targeting API 35+, so the
app may require manual Auto sync start after reboot.

## Troubleshooting

`configs.toReversed is not a function`

Run the build with Node.js `>=20.19.4`. This repo has `.nvmrc`; `nvm use` should
select the intended version.

Auto-discovery fails

Check that the Mac app is running and that the network does not block mDNS.
Manual IP remains supported.

Background sync stops

Set Android battery mode for Clipboard Sync to unrestricted and keep the
foreground notification enabled.

Release APK is unsigned

Unsigned release builds are not installable production artifacts. The GitHub
release uses the debug-signed APK because the Mac launcher installs it through
ADB during onboarding. A Play Store style distribution would need a separate
signing setup outside this repo.
