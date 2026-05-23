# Message Types

All logical messages are JSON objects. Every logical message includes a `type` field. WebSocket messages are sent inside the encrypted envelope described in `protocol.md`.

## Common Fields (clipboard_update)

| Field          | Type   | Description                                              |
|----------------|--------|----------------------------------------------------------|
| type           | string | Message type identifier (see types below)                |
| eventId        | string | UUID v4 - unique per event, used for deduplication       |
| sourceDeviceId | string | Fixed identifier of the sending device                   |
| source         | string | `"android"` or `"mac"`                                   |
| timestamp      | number | Unix time in milliseconds                                |

## Message Type: `clipboard_update`

Sent when clipboard content should be pushed to the other device.

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

| Field | Type   | Description              |
|-------|--------|--------------------------|
| text  | string | Plain text clipboard data |

## Message Type: `hello`

Sent by client immediately after WebSocket connection is established.

```json
{
  "type": "hello",
  "sourceDeviceId": "samsung-s23-plus",
  "deviceName": "Bart's S23+",
  "protocolVersion": 1
}
```

## Message Type: `hello_ack`

Sent by server in response to `hello`.

```json
{
  "type": "hello_ack",
  "sourceDeviceId": "macbook-air",
  "protocolVersion": 1
}
```

## Message Type: `ping` / `pong`

Server sends `ping` every 20 seconds. Client responds with `pong` echoing the timestamp. If no `pong` is received within 40 seconds, the server closes the connection.

```json
{ "type": "ping", "timestamp": 1710000000000 }
{ "type": "pong", "timestamp": 1710000000000 }
```

## Device ID Conventions

| Device         | sourceDeviceId      |
|----------------|---------------------|
| Samsung S23+   | `samsung-s23-plus`  |
| MacBook Air    | `macbook-air`       |

## Connection Lifecycle

```
Client                          Server
  |                               |
  |---[ TCP connect ]------------>|
  |                               |
  |---[ HTTP GET /ws ]----------->|  (Upgrade: websocket header)
  |<--[ 101 Switching Protocols ]-|
  |                               |  -- WebSocket established --
  |---{ key_exchange }----------->|
  |<--{ key_exchange_ack }--------|
  |---{ encrypted(hello) }------->|
  |<--{ encrypted(hello_ack) }----|
  |                               |  -- Ready: clipboard_update can be sent --
  |---{ encrypted(clipboard_update) }---->|
  |                               |
  |<--{ encrypted(ping) } (every 20s)-----|
  |---{ encrypted(pong) }---------------->|
  |                               |
  |  (connection drop / network)  |
  |                               |
  |  [client auto-reconnects]     |
  |   backoff: 1s, 2s, 4s...30s  |
```

### States (Android client)

- `disconnected` - initial state, not trying to connect
- `connecting` - TCP + WebSocket handshake in progress
- `connected` - `hello_ack` received, ready to send
- `reconnecting` - connection lost, waiting for backoff before retrying

### HTTP endpoints

- `GET /health` - returns `{"status":"ok","device":"macbook-air"}`
- `POST /clipboard` - disabled; returns `426 Upgrade Required`
