# Clipboard Sync

Clipboard Sync is a local LAN clipboard bridge between a macOS menu bar app and
an Android phone.

The GitHub release is Mac-first: install the DMG on macOS, then use the Mac
onboarding launcher to install and configure the Android app automatically over
USB. The Android APK is published as a release asset, but users do not need to
install it manually during the normal setup flow.

## Status

- Public GitHub release for trusted local-network testing.
- Clipboard data is transferred over an encrypted WebSocket on port `8787`.
- macOS advertises `_clipboard-sync._tcp` with Bonjour/mDNS.
- Android can discover the Mac automatically or use a manual `ws://.../ws`
  URL.
- Designed for trusted local networks; see [SECURITY.md](SECURITY.md) for the
  security model and roadmap.

## GitHub Install Flow

The latest GitHub release publishes two files:

- `ClipboardSyncMac.dmg` - the file users install on the Mac.
- `ClipboardSyncAndroid.apk` - used by the Mac onboarding launcher, and also
  available for manual recovery.

Normal setup:

1. Download and install `ClipboardSyncMac.dmg` on the Mac.
2. Open Clipboard Sync from the macOS menu bar and start Android onboarding.
3. Connect the Android phone with a USB data cable.
4. Approve Android USB debugging prompts on the phone.
5. The Mac launcher downloads `ClipboardSyncAndroid.apk` from the latest GitHub
   release, installs or updates it through ADB, opens the Android app, starts
   Shizuku where possible, and grants the clipboard app-op.

Android Platform Tools must be available on the Mac (`adb` on PATH, Android
Studio SDK, or `brew install android-platform-tools`). The Android APK should
only be installed manually if the automated onboarding path fails.

## Requirements

For the normal GitHub install flow:

- macOS 13+.
- Android phone with USB debugging enabled.
- Android Platform Tools available on the Mac (`adb` on PATH, Android Studio
  SDK, or `brew install android-platform-tools`).
- Both devices on the same trusted local network.

For source builds:

- Node.js `>=20.19.4` and npm `>=10`.
  - The repo has `.nvmrc`; run `nvm use` before Android commands.
  - Older Node versions can fail Android release bundling with
    `TypeError: configs.toReversed is not a function`.
- JDK 17.
- Android Studio / Android SDK.
- macOS 13+ and Xcode 15+ for the Mac app.

## Android

The public release publishes `ClipboardSyncAndroid.apk` so the Mac onboarding
launcher can install it through ADB. It is also available for manual recovery,
but the normal user flow starts from the Mac DMG.

Source build setup:

```bash
cd android-app
npm ci
npm run typecheck
```

Build the APK used for ADB onboarding:

```bash
cd android-app
npm run android:debug
```

Build a release variant only to verify the release build path:

```bash
cd android-app
npm run android:release
```

If no release signing environment variables are set, Gradle produces an
unsigned release APK. That is useful for build verification only. The GitHub
release asset uses the debug-signed APK because the Mac launcher installs it
through ADB during onboarding.

Release signing is only needed for alternative Android distribution channels
that require a private keystore. Create the keystore outside the repo and set:

```bash
export CLIPBOARD_SYNC_ANDROID_KEYSTORE=/absolute/path/to/release.keystore
export CLIPBOARD_SYNC_ANDROID_KEYSTORE_PASSWORD=...
export CLIPBOARD_SYNC_ANDROID_KEY_ALIAS=...
export CLIPBOARD_SYNC_ANDROID_KEY_PASSWORD=...
cd android-app
npm run android:release
```

Do not commit `.jks`, `.keystore`, `.p12`, `.p8`, `.key`, certificates, or APK
build outputs.

## macOS

Most users should install `ClipboardSyncMac.dmg` from the latest GitHub release.
The source build path below is for development.

Local debug build from Xcode:

```bash
open mac-app/ClipboardSyncMac.xcodeproj
```

Select the `ClipboardSyncMac` scheme and run it locally.

Local release build:

```bash
cd mac-app
xcodebuild -project ClipboardSyncMac.xcodeproj \
  -scheme ClipboardSyncMac \
  -configuration Release \
  -sdk macosx \
  build
```

The project intentionally leaves `DEVELOPMENT_TEAM` empty and uses local
ad-hoc signing for source builds. The public GitHub DMG is not notarized.
Developer ID Application signing, hardened runtime release settings, and
notarization can be added later with an Apple Developer account. Do not commit
private team IDs, profiles, or certificates.

## Discovery

The Mac app publishes Bonjour/mDNS service `_clipboard-sync._tcp` with
`path=/ws`. Android discovery uses that service to build the WebSocket URL.

Manual fallback examples:

```text
ws://192.168.1.10:8787/ws
ws://macbook.local:8787/ws
```

Some guest Wi-Fi, VPN, enterprise, and router isolation modes block multicast
DNS. In that case use the manual URL.

## Android Background Behavior

Android clipboard monitoring uses a foreground service with a visible
notification, but background sync is best effort and not guaranteed. Behavior
depends on Android version, OEM policy, battery settings, and whether the native
clipboard access path is available. Local testing may require:

- Shizuku or the ADB app-op setup used by the native Android module.
- Battery optimization disabled for Clipboard Sync.
- The foreground notification kept enabled.
- Vendor-specific background restrictions adjusted, especially on Samsung One
  UI and other aggressive OEM builds.

`BootReceiver` attempts boot restore only where Android allows it. Android 15+
restricts `BOOT_COMPLETED` receivers from starting `dataSync` foreground
services for apps targeting API 35+, so autostart after reboot must be treated
as best effort. Start Auto sync from the app if the system blocks it.

Reference: [Android foreground service launch restrictions](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start).

## Security Notes

Clipboard payloads are encrypted with AES-256-GCM after a P-256 ECDH key
exchange. Plain HTTP clipboard sync is disabled; HTTP is only kept for
`GET /health`.

This does not yet authenticate peers. A malicious or unauthorized device on the
same LAN may still attempt MITM or unauthorized pairing during discovery or
first connection. Planned work:

- QR or PIN pairing.
- Device trust store.
- Public key pinning.
- Device revocation.

See [SECURITY.md](SECURITY.md) and [shared/protocol.md](shared/protocol.md).

## Troubleshooting

`TypeError: configs.toReversed is not a function`

Use Node.js `>=20.19.4` and rerun the Android build from a shell where `node -v`
matches the repo requirement.

Auto-discovery does not find the Mac

Check that both devices are on the same network and that the network allows
Bonjour/mDNS. Try the manual `ws://<mac-ip>:8787/ws` URL.

Android service stops in the background

Disable battery optimization for the app, keep the foreground notification
enabled, and check vendor-specific background limits. Android 15+ and some OEM
builds may still stop or block background work.

macOS warns that the app is not notarized

That is expected for the current GitHub release. The app is ad-hoc signed, not
Developer ID notarized.

## Repo Layout

```text
clipboard-sync/
  android-app/            Android app (Expo + React Native + Kotlin module)
  mac-app/                macOS menu bar app (Swift)
  shared/                 protocol and message documentation
  SECURITY.md
  README.md
```
