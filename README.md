# Clipboard Sync

Prywatna aplikacja do synchronizacji schowka miedzy Samsung S23+ (Android) a MacBook Air (macOS) przez lokalne Wi-Fi.

## Architektura

```
Samsung S23+  <-->  MacBook Air
  Android App        mac-app/
  (Expo + RN)        (SwiftUI menu bar)
        |                  |
        +------ Wi-Fi -----+
           HTTP / WebSocket
              port 8787
```

## Etap 1 - macOS MVP (obecny)

One-way HTTP receive: Android wysyla POST, Mac ustawia schowek.

### Wymagania

- macOS 13+
- Xcode 15+

### Uruchomienie

1. Otworz `mac-app/ClipboardSyncMac.xcodeproj` w Xcode.
2. Wybierz schemat `ClipboardSyncMac` i uruchom (Cmd+R).
3. Ikona pojawi sie w menu barze - kliknij, zeby zobaczyc status.

### Test curl

```bash
curl -X POST http://localhost:8787/clipboard \
  -H "Content-Type: application/json" \
  -d '{"text":"test z Etapu 1"}'
```

Oczekiwana odpowiedz:

```json
{"status": "ok"}
```

Po wykonaniu: Cmd+V w dowolnym edytorze wkleja `test z Etapu 1`.

### Pelna struktura wiadomosci

```json
{
  "type": "clipboard_update",
  "eventId": "uuid",
  "sourceDeviceId": "samsung-s23-plus",
  "source": "android",
  "text": "...",
  "timestamp": 1710000000000
}
```

Endpoint akceptuje rowniez uproszczony format `{"text": "..."}`.

Szczegoly protokolu: [shared/protocol.md](shared/protocol.md)

## Etap 2 (planowany)

- WebSocket zamiast HTTP
- Obserwacja NSPasteboard (Mac -> Android)
- Android app (Expo Dev Build + Kotlin native module)

## Struktura repo

```
clipboard-sync/
  mac-app/
    ClipboardSyncMac/     - kod Swift
    ClipboardSyncMac.xcodeproj/
  android-app/            - (pusty, Etap 2)
  shared/
    protocol.md           - opis protokolu HTTP/WebSocket
    message-types.md      - typy wiadomosci JSON
  README.md
  .gitignore
```
