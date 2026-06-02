import AppKit
import CryptoKit
import Darwin
import Dispatch

enum MessageCrypto {
    static func encryptJSON(_ obj: [String: Any], using key: SymmetricKey) -> [String: Any]? {
        guard
            let plain = try? JSONSerialization.data(withJSONObject: obj),
            let sealed = try? AES.GCM.seal(plain, using: key),
            let combined = sealed.combined
        else { return nil }

        return [
            "type": "encrypted",
            "version": 1,
            "alg": "AES-256-GCM",
            "payload": combined.base64EncodedString()
        ]
    }

    static func decryptEnvelope(_ obj: [String: Any], using key: SymmetricKey) -> [String: Any]? {
        guard
            obj["type"] as? String == "encrypted",
            let payload = obj["payload"] as? String,
            let combined = Data(base64Encoded: payload),
            let sealed = try? AES.GCM.SealedBox(combined: combined),
            let plain = try? AES.GCM.open(sealed, using: key),
            let json = try? JSONSerialization.jsonObject(with: plain) as? [String: Any]
        else { return nil }
        return json
    }

    static func deriveSessionKey(
        privateKey: P256.KeyAgreement.PrivateKey,
        remotePublicKey: P256.KeyAgreement.PublicKey
    ) -> SymmetricKey? {
        guard let sharedSecret = try? privateKey.sharedSecretFromKeyAgreement(with: remotePublicKey) else {
            return nil
        }
        return sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Data("ClipboardSyncSessionV1".utf8),
            sharedInfo: Data(),
            outputByteCount: 32
        )
    }
}

enum MacPairingIdentity {
    private static let defaultsKey = "clipboardSyncMacSigningIdentityV1"

    private static var privateKey: P256.Signing.PrivateKey {
        if
            let encoded = UserDefaults.standard.string(forKey: defaultsKey),
            let data = Data(base64Encoded: encoded),
            let key = try? P256.Signing.PrivateKey(rawRepresentation: data)
        {
            return key
        }

        let key = P256.Signing.PrivateKey()
        UserDefaults.standard.set(key.rawRepresentation.base64EncodedString(), forKey: defaultsKey)
        return key
    }

    static var publicKeyData: Data {
        privateKey.publicKey.derRepresentation
    }

    static var publicKeyBase64: String {
        publicKeyData.base64EncodedString()
    }

    static var fingerprint: String {
        SHA256.hash(data: publicKeyData)
            .map { String(format: "%02X", $0) }
            .joined()
    }

    static var displayFingerprint: String {
        fingerprint.chunked(every: 4).joined(separator: " ")
    }

    static func handshakeTranscript(
        clientPublicKeyBase64: String,
        serverPublicKeyBase64: String,
        identityPublicKeyBase64: String
    ) -> Data {
        Data(
            ("ClipboardSyncPairingV1\n" +
             "clientPublicKey=\(clientPublicKeyBase64)\n" +
             "serverPublicKey=\(serverPublicKeyBase64)\n" +
             "identityPublicKey=\(identityPublicKeyBase64)").utf8
        )
    }

    static func signHandshake(clientPublicKeyBase64: String, serverPublicKeyBase64: String) -> String? {
        let identityPublicKeyBase64 = publicKeyBase64
        let transcript = handshakeTranscript(
            clientPublicKeyBase64: clientPublicKeyBase64,
            serverPublicKeyBase64: serverPublicKeyBase64,
            identityPublicKeyBase64: identityPublicKeyBase64
        )
        guard let signature = try? privateKey.signature(for: transcript) else { return nil }
        return signature.derRepresentation.base64EncodedString()
    }
}

private extension String {
    func chunked(every size: Int) -> [String] {
        guard size > 0 else { return [self] }
        var chunks: [String] = []
        var index = startIndex
        while index < endIndex {
            let next = self.index(index, offsetBy: size, limitedBy: endIndex) ?? endIndex
            chunks.append(String(self[index..<next]))
            index = next
        }
        return chunks
    }
}

private enum WSOp: UInt8 {
    case continuation = 0x0
    case text         = 0x1
    case binary       = 0x2
    case close        = 0x8
    case ping         = 0x9
    case pong         = 0xA
}

private struct WSFrame {
    let opcode: WSOp
    let payload: Data
}

protocol WSClientDelegate: AnyObject {
    func wsClientReady(_ client: WSClient)
    func wsClientDidReceiveClipboard(_ client: WSClient, text: String, eventId: String)
    func wsClientDidDisconnect(_ client: WSClient)
}

final class WSClient {
    let id = UUID()
    let fd: Int32
    let remoteIP: String
    private(set) var sourceDeviceId: String = ""
    private(set) var deviceName: String = ""

    private weak var delegate: WSClientDelegate?
    private let queue: DispatchQueue
    private var lastPongTime = Date()
    private var pingTimer: DispatchSourceTimer?
    private let lock = NSLock()
    private var _connected = true
    private var sessionKey: SymmetricKey?

    var isConnected: Bool {
        lock.lock(); defer { lock.unlock() }
        return _connected
    }

    init(fd: Int32, remoteIP: String, delegate: WSClientDelegate, queue: DispatchQueue) {
        self.fd = fd
        self.remoteIP = remoteIP
        self.delegate = delegate
        self.queue = queue
    }

    func start() {
        startPingTimer()
        queue.async { [weak self] in
            self?.readLoop()
        }
    }

    // MARK: - Read loop

    private func readLoop() {
        while isConnected {
            guard let frame = readFrame() else {
                disconnect()
                return
            }
            handleFrame(frame)
        }
    }

    private func handleFrame(_ frame: WSFrame) {
        switch frame.opcode {
        case .text, .binary:
            guard
                let str = String(data: frame.payload, encoding: .utf8),
                let data = str.data(using: .utf8),
                let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let wireType = json["type"] as? String
            else { return }

            if wireType == "key_exchange" {
                handleKeyExchange(json)
                return
            }

            guard
                wireType == "encrypted",
                let sessionKey,
                let decrypted = MessageCrypto.decryptEnvelope(json, using: sessionKey),
                  let type = decrypted["type"] as? String else {
                print("[\(ts())] Rejected unencrypted or invalid WS message from \(remoteIP)")
                return
            }
            handleMessage(type: type, json: decrypted)

        case .ping:
            sendFrame(opcode: .pong, payload: frame.payload)

        case .pong:
            lastPongTime = Date()

        case .close:
            sendFrame(opcode: .close, payload: Data())
            disconnect()

        default:
            break
        }
    }

    private func handleKeyExchange(_ json: [String: Any]) {
        guard
            let publicKeyBase64 = json["publicKey"] as? String,
            let publicKeyData = Data(base64Encoded: publicKeyBase64),
            let remotePublicKey = try? P256.KeyAgreement.PublicKey(derRepresentation: publicKeyData)
        else {
            print("[\(ts())] Invalid WS key exchange from \(remoteIP)")
            disconnect()
            return
        }

        let privateKey = P256.KeyAgreement.PrivateKey()
        let serverPublicKeyBase64 = privateKey.publicKey.derRepresentation.base64EncodedString()
        guard
            let key = MessageCrypto.deriveSessionKey(privateKey: privateKey, remotePublicKey: remotePublicKey),
            let signature = MacPairingIdentity.signHandshake(
                clientPublicKeyBase64: publicKeyBase64,
                serverPublicKeyBase64: serverPublicKeyBase64
            )
        else {
            print("[\(ts())] Failed WS session key derivation for \(remoteIP)")
            disconnect()
            return
        }

        sessionKey = key
        sendPlainJSON([
            "type": "key_exchange_ack",
            "version": 2,
            "alg": "P-256-ECDH+HKDF-SHA256",
            "publicKey": serverPublicKeyBase64,
            "identityAlg": "P-256-ECDSA-SHA256",
            "identityPublicKey": MacPairingIdentity.publicKeyBase64,
            "identityFingerprint": MacPairingIdentity.fingerprint,
            "signature": signature
        ])
        print("[\(ts())] WS session key established with \(remoteIP) [macFingerprint=\(MacPairingIdentity.displayFingerprint)]")
    }

    private func handleMessage(type: String, json: [String: Any]) {
        switch type {
        case "hello":
            sourceDeviceId = json["sourceDeviceId"] as? String ?? "unknown"
            deviceName = json["deviceName"] as? String ?? sourceDeviceId
            sendJSON(["type": "hello_ack", "sourceDeviceId": "macbook-air", "protocolVersion": 1])
            print("[\(ts())] WS hello from \(sourceDeviceId) (\(deviceName)) @ \(remoteIP)")
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.delegate?.wsClientReady(self)
            }

        case "clipboard_update":
            guard let text = json["text"] as? String else { return }
            let eventId = json["eventId"] as? String ?? "-"
            print("[\(ts())] WS clipboard from \(sourceDeviceId) [eventId=\(eventId), chars=\(text.count)]")
            DispatchQueue.main.async {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
            }
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.delegate?.wsClientDidReceiveClipboard(self, text: text, eventId: eventId)
            }

        case "pong":
            lastPongTime = Date()

        default:
            break
        }
    }

    // MARK: - Ping

    private func startPingTimer() {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 20, repeating: 20)
        timer.setEventHandler { [weak self] in self?.sendPing() }
        timer.resume()
        pingTimer = timer
    }

    private func sendPing() {
        if Date().timeIntervalSince(lastPongTime) > 40 {
            print("[\(ts())] WS ping timeout (\(sourceDeviceId)) - disconnecting")
            disconnect()
            return
        }
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        sendJSON(["type": "ping", "timestamp": now])
    }

    // MARK: - Disconnect

    func disconnect() {
        lock.lock()
        guard _connected else { lock.unlock(); return }
        _connected = false
        lock.unlock()

        pingTimer?.cancel()
        pingTimer = nil
        Darwin.close(fd)
        let label = sourceDeviceId.isEmpty ? remoteIP : sourceDeviceId
        print("[\(ts())] WS client \(label) disconnected")
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.delegate?.wsClientDidDisconnect(self)
        }
    }

    // MARK: - Frame I/O

    private func readFrame() -> WSFrame? {
        var h = [UInt8](repeating: 0, count: 2)
        guard readExact(&h, count: 2) else { return nil }

        let opcodeRaw = h[0] & 0x0F
        guard let opcode = WSOp(rawValue: opcodeRaw) else { return nil }
        let masked = (h[1] & 0x80) != 0
        var payloadLen = UInt64(h[1] & 0x7F)

        if payloadLen == 126 {
            var ext = [UInt8](repeating: 0, count: 2)
            guard readExact(&ext, count: 2) else { return nil }
            payloadLen = UInt64(ext[0]) << 8 | UInt64(ext[1])
        } else if payloadLen == 127 {
            var ext = [UInt8](repeating: 0, count: 8)
            guard readExact(&ext, count: 8) else { return nil }
            payloadLen = ext.withUnsafeBytes { $0.load(as: UInt64.self).byteSwapped }
        }

        guard payloadLen <= 1_000_000 else { return nil }

        var maskKey = [UInt8](repeating: 0, count: 4)
        if masked { guard readExact(&maskKey, count: 4) else { return nil } }

        var payload = [UInt8](repeating: 0, count: Int(payloadLen))
        if !payload.isEmpty { guard readExact(&payload, count: Int(payloadLen)) else { return nil } }
        if masked { for i in payload.indices { payload[i] ^= maskKey[i % 4] } }

        return WSFrame(opcode: opcode, payload: Data(payload))
    }

    private func readExact(_ buffer: inout [UInt8], count: Int) -> Bool {
        var got = 0
        while got < count {
            let n = Darwin.recv(fd, &buffer[got], count - got, 0)
            if n <= 0 { return false }
            got += n
        }
        return true
    }

    func sendJSON(_ obj: [String: Any]) {
        guard
            let sessionKey,
            let encrypted = MessageCrypto.encryptJSON(obj, using: sessionKey),
            let data = try? JSONSerialization.data(withJSONObject: encrypted)
        else { return }
        sendFrame(opcode: .text, payload: data)
    }

    private func sendPlainJSON(_ obj: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
        sendFrame(opcode: .text, payload: data)
    }

    private func sendFrame(opcode: WSOp, payload: Data) {
        var frame = Data()
        frame.append(0x80 | opcode.rawValue)
        let len = payload.count
        if len < 126 {
            frame.append(UInt8(len))
        } else if len < 65536 {
            frame.append(126)
            frame.append(UInt8((len >> 8) & 0xFF))
            frame.append(UInt8(len & 0xFF))
        } else {
            frame.append(127)
            for shift in stride(from: 56, through: 0, by: -8) {
                frame.append(UInt8((len >> shift) & 0xFF))
            }
        }
        frame.append(contentsOf: payload)
        frame.withUnsafeBytes { _ = Darwin.send(fd, $0.baseAddress!, frame.count, 0) }
    }

    // MARK: - Helpers

    private func ts() -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f.string(from: Date())
    }
}
