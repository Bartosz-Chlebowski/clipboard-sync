# Clipboard Sync - Communication Protocol

## Transport

- Current: WebSocket over local Wi-Fi (`ws://macbook.local:8787/ws`)
- Discovery: Bonjour/mDNS service `_clipboard-sync._tcp` with TXT record `path=/ws`.
- HTTP is kept only for `GET /health`.

Both devices must be on the same local network. No internet connection required.

## Encryption

Application payloads are encrypted before they are written to the socket. The WebSocket URL can still be `ws://`, but clipboard data is not sent as plaintext.

- Algorithm: AES-256-GCM
- Session key agreement: automatic P-256 ECDH during WebSocket connection
- Key derivation: HKDF-SHA256 with salt `ClipboardSyncSessionV1`
- Wire format: JSON encrypted envelope

Initial key exchange messages are the only plaintext WebSocket application frames:

```json
{
  "type": "key_exchange",
  "version": 1,
  "alg": "P-256-ECDH+HKDF-SHA256",
  "publicKey": "base64(x509-der-public-key)"
}
```

```json
{
  "type": "key_exchange_ack",
  "version": 1,
  "alg": "P-256-ECDH+HKDF-SHA256",
  "publicKey": "base64(x509-der-public-key)"
}
```

After that, all logical messages use the encrypted envelope:

```json
{
  "type": "encrypted",
  "version": 1,
  "alg": "AES-256-GCM",
  "payload": "base64(nonce || ciphertext || tag)"
}
```

The decrypted payload is one of the message objects from `message-types.md`.

## Endpoints

### POST /clipboard

Disabled. Clipboard transfer requires the encrypted WebSocket session because the AES-GCM key is negotiated during WebSocket connection setup.

**Response**

```
HTTP/1.1 426 Upgrade Required
Content-Type: application/json

{"status": "error", "message": "use encrypted websocket"}
```

## Security

Clipboard payloads and application-level WebSocket messages are encrypted and authenticated with AES-GCM. Messages that cannot be decrypted with the negotiated session key are rejected.

This is not a complete pairing or trust model. The current ECDH exchange protects the session from passive plaintext capture, but it does not authenticate the peer before the first connection. A malicious device on the same LAN could still attempt MITM or unauthorized pairing until QR/PIN pairing, key pinning, a trusted-device store, and revocation are implemented.

## Notes

- `timestamp` is Unix time in milliseconds (epoch ms).
- `eventId` is UUID v4, used to deduplicate retransmissions.
- `sourceDeviceId` is a fixed string per device, set at first launch.
