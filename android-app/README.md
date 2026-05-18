# Clipboard Sync - Android App

Samsung S23+ -> Mac clipboard sync. Etap 2: przycisk Send przez HTTP.

## Wymagania

- Node.js 18+
- Android Studio (Flamingo lub nowszy) + Android SDK
- JDK 17
- Samsung S23+ w trybie deweloperskim (USB debugging ON)
- Ten sam Wi-Fi co MacBook
- Mac app z Etapu 1 uruchomiona (`mac-app/ClipboardSyncMac.xcodeproj`)

## Uruchomienie (dev build na telefonie)

```bash
cd android-app
npm install

# Pierwsze uruchomienie - buduje apk i instaluje na telefonie
npx expo run:android

# Kolejne uruchomienia (jezeli apk juz zainstalowana)
npx expo start --dev-client
```

## Konfiguracja

Po pierwszym uruchomieniu na telefonie:

1. Dotknij **Settings** (prawy gorny rog).
2. Wpisz adres Maca: `192.168.X.X:8787` lub `macbook.local:8787`.
   - Adres IP znajdziesz w `System Settings > Wi-Fi > Details`.
3. Dotknij **Save**.
4. Dotknij **Test connection** - powinno pojawic sie "Connected - device: macbook-air".

## Jak uzywac

1. Skopiuj tekst na Samsungu (dlugie przycisnij -> Copy).
2. Otwoz Clipboard Sync.
3. Dotknij **Send clipboard to Mac**.
4. Na Macu: `Cmd+V` wkleja tekst.

## Struktura projektu

```
android-app/
  App.tsx           - glowny ekran (UI)
  lib/
    api.ts          - sendToMac(), checkHealth()
    storage.ts      - AsyncStorage helper
    types.ts        - typy wiadomosci JSON
    constants.ts    - DEVICE_ID, DEFAULT_MAC_ADDRESS, itp.
  android/          - natywny kod Android (generowany przez prebuild)
  app.json          - konfiguracja Expo
```

## Budowanie APK (bez kabla USB)

```bash
npx expo run:android --variant release
```

APK pojawi sie w `android/app/build/outputs/apk/release/`.

## Troubleshooting

**"Network error: Network request failed"**
- Upewnij sie ze Mac i Samsung sa w tej samej sieci Wi-Fi.
- Sprawdz czy Mac app jest uruchomiona (ikona w menu barze).
- Jesli uzywasz `macbook.local`, sprobuj zamiast tego bezposredniego IP.

**"Timed out (5s)"**
- Firewall na Macu moze blokowac port 8787.
- Sprawdz: `System Settings > Network > Firewall`.

**"Clipboard is empty"**
- Skopiuj tekst zanim klikniesz Send.
- Dotknij **Refresh** zeby odswiezyc podglad schowka.

**Apka nie widzi zmian po edycji kodu**
- Potrząsnij telefonem -> "Reload" lub uzyj `npx expo start --dev-client`.
