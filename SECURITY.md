# Security Policy

Clipboard Sync is an experimental local LAN tool. It is not ready to be treated
as a hardened production security boundary.

## Current security model

- Clipboard payloads are sent over WebSocket and encrypted at the application
  layer with AES-256-GCM.
- Each WebSocket session negotiates a fresh key with P-256 ECDH and
  HKDF-SHA256.
- The Mac app owns a persistent P-256 ECDSA signing identity. Its public-key
  fingerprint is shown in the macOS menu bar.
- USB onboarding stores that Mac fingerprint on Android. Android verifies the
  signed key-exchange transcript and rejects sessions from a different Mac
  identity.
- Plain HTTP clipboard sync is disabled. HTTP is kept only for `GET /health`.

## Known risks

The Mac identity is pinned on Android, but the trust model is still intentionally
small:

- The Mac does not yet pin Android device identities, so any phone that knows the
  WebSocket URL can attempt to connect.
- Manual first pairing without USB onboarding still needs a human comparison
  flow. If Android has no stored fingerprint, it pins the first signed Mac
  identity it sees.
- Discovery still happens on the local network with Bonjour/mDNS. Networks that
  block multicast may require a manual WebSocket URL.
- The public GitHub DMG is ad-hoc signed and not notarized yet.

## Security roadmap

- QR or PIN based pairing.
- Paired-device management UI.
- Android identity pinning on the Mac side.
- Device revocation and reset flow.
- Developer ID signing and notarization.
