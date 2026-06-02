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
- Mac authentication: persistent P-256 ECDSA identity signs the ECDH transcript
- Android trust: pinned SHA-256 fingerprint of the Mac identity public key
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
  "version": 2,
  "alg": "P-256-ECDH+HKDF-SHA256",
  "publicKey": "base64(x509-der-ephemeral-public-key)",
  "identityAlg": "P-256-ECDSA-SHA256",
  "identityPublicKey": "base64(x509-der-mac-signing-public-key)",
  "identityFingerprint": "hex(sha256(identityPublicKey))",
  "signature": "base64(der-ecdsa-signature)"
}
```

The Mac signs this UTF-8 transcript exactly:

```text
ClipboardSyncPairingV1
clientPublicKey=<Android key_exchange publicKey>
serverPublicKey=<Mac key_exchange_ack publicKey>
identityPublicKey=<Mac identityPublicKey>
```

Android verifies the signature before deriving the session key. If no Mac
fingerprint is stored yet, Android stores the first verified Mac identity. In
the normal public install flow the Mac sets that fingerprint over USB onboarding
before the first network sync.

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

The Mac side of the session is authenticated with a signed ECDH transcript and
an Android-pinned Mac identity fingerprint. Remaining gaps are Android identity
pinning on the Mac side, revocation/reset UI, and QR/PIN comparison for fully
manual first pairing.

## Notes

- `timestamp` is Unix time in milliseconds (epoch ms).
- `eventId` is UUID v4, used to deduplicate retransmissions.
- `sourceDeviceId` is a fixed string per device, set at first launch.
