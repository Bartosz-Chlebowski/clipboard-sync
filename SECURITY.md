# Security Policy

Clipboard Sync is an experimental local LAN tool. It is not ready to be treated
as a hardened production security boundary.

## Current security model

- Clipboard payloads are sent over WebSocket and encrypted at the application
  layer with AES-256-GCM.
- Each WebSocket session negotiates a fresh key with P-256 ECDH and
  HKDF-SHA256.
- Plain HTTP clipboard sync is disabled. HTTP is kept only for `GET /health`.

## Known risks

The current implementation does not yet have a complete pairing and device
trust model. A device on the same LAN may be able to impersonate the Mac or
Android peer during discovery or first connection. This means LAN attackers,
malicious hotspots, compromised routers, and unauthorized devices on the same
network are still in scope for MITM or unauthorized pairing attacks.

Use this only on trusted local networks while testing.

## Security roadmap

- QR or PIN based pairing.
- Persistent trusted-device store.
- Public key pinning after pairing.
- Device revocation and reset flow.
- Clear UI for currently trusted peers and active session identity.
