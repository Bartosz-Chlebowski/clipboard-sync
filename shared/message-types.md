# Message Types

All messages are JSON objects. Every message includes the common fields below.

## Common Fields

| Field          | Type   | Description                                              |
|----------------|--------|----------------------------------------------------------|
| type           | string | Message type identifier (see types below)                |
| eventId        | string | UUID v4 - unique per event, used for deduplication       |
| sourceDeviceId | string | Fixed identifier of the sending device                   |
| source         | string | `"android"` or `"mac"`                                   |
| timestamp      | number | Unix time in milliseconds                                |

## Message Type: `clipboard_update`

Sent when clipboard content changes on the source device and should be pushed to the other device.

```json
{
  "type": "clipboard_update",
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "sourceDeviceId": "samsung-s23-plus",
  "source": "android",
  "text": "copied text here",
  "timestamp": 1710000000000
}
```

Additional fields:

| Field | Type   | Description              |
|-------|--------|--------------------------|
| text  | string | Plain text clipboard data |

## Device ID Conventions

| Device         | sourceDeviceId      |
|----------------|---------------------|
| Samsung S23+   | `samsung-s23-plus`  |
| MacBook Air    | `macbook-air`       |

## Future Message Types (not implemented yet)

- `ping` - keepalive / connection check
- `ack` - delivery acknowledgement
- `pair_request` - pairing handshake
- `pair_accept` - pairing confirmation
