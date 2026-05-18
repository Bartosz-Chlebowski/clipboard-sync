# Clipboard Sync - Communication Protocol

## Transport

- Stage 1 (current): HTTP over local Wi-Fi
- Stage 2 (planned): WebSocket over local Wi-Fi (`ws://macbook.local:8787`)

Both devices must be on the same local network. No internet connection required.

## Endpoints (Stage 1)

### POST /clipboard

Set clipboard content on the receiving device.

**Request**

```
POST http://macbook.local:8787/clipboard
Content-Type: application/json
```

```json
{
  "type": "clipboard_update",
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "sourceDeviceId": "samsung-s23-plus",
  "source": "android",
  "text": "Hello from Android!",
  "timestamp": 1710000000000
}
```

**Response - success**

```
HTTP/1.1 200 OK
Content-Type: application/json

{"status": "ok"}
```

**Response - error**

```
HTTP/1.1 400 Bad Request
Content-Type: application/json

{"status": "error", "message": "missing text field"}
```

## Security

Stage 1: no authentication. Local network only, single user.
Stage 2: shared secret token in `Authorization` header (planned).

## Notes

- `timestamp` is Unix time in milliseconds (epoch ms).
- `eventId` is UUID v4, used to deduplicate retransmissions.
- `sourceDeviceId` is a fixed string per device, set at first launch.
