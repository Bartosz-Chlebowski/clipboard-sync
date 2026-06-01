# Clipboard Sync

Clipboard Sync is an experimental local LAN clipboard bridge between a macOS
menu bar app and an Android phone.

The GitHub release is Mac-first: install the DMG on macOS, then use the Mac
onboarding launcher to install and configure the Android app automatically over
USB. The Android APK is published as a release asset, but users do not need to
install it manually during the normal setup flow.

## Status

- Experimental local Wi-Fi/LAN project.
- Clipboard data is transferred over an encrypted WebSocket on port `8787`.
- macOS advertises `_clipboard-sync._tcp` with Bonjour/mDNS.
- Android can discover the Mac automatically or use a manual `ws://.../ws`
  URL.
- Security and pairing flows are incomplete; see [SECURITY.md](SECURITY.md).

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

- Node.js `>=20.19.4` and npm `>=10`.
  - The repo has `.nvmrc`; run `nvm use` before Android commands.
  - Older Node versions can fail Android release bundling with
    `TypeError: configs.toReversed is not a function`.
- JDK 17.
- Android Studio / Android SDK for Android builds.
- macOS 13+ and Xcode 15+ for the Mac app.
- Android device with USB debugging for local install/testing.
- Both devices on the same trusted local network.

## Android

Install and typecheck:

```bash
cd android-app
npm ci
npm run typecheck
```

Build a debug APK for local testing:

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
unsigned release APK. That is useful for build verification only, not local
installation or public distribution. Use the debug APK for normal local device
testing.

Release signing is optional and only for downstream users or forks that have
their own keystore. Create the keystore outside the repo and set:

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
ad-hoc signing for source builds. The upstream project does not ship notarized
macOS releases. Developer ID Application signing, hardened runtime release
settings, and notarization are optional downstream distribution work for a fork
or user with their own Apple Developer account. Do not commit private team IDs,
profiles, or certificates.

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

macOS build signs locally only

That is expected. Developer ID signing and notarization are optional downstream
steps for users who decide to distribute their own fork.

## Repo Layout

```text
clipboard-sync/
  android-app/            Android app (Expo + React Native + Kotlin module)
  mac-app/                macOS menu bar app (Swift)
  shared/                 protocol and message documentation
  SECURITY.md
  README.md
```
