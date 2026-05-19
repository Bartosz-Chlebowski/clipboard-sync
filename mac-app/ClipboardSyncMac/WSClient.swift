import AppKit
import Darwin
import Dispatch

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
                let type = json["type"] as? String
            else { return }
            handleMessage(type: type, json: json)

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
            let preview = text.count > 60 ? String(text.prefix(60)) + "..." : text
            print("[\(ts())] WS clipboard from \(sourceDeviceId) [eventId=\(eventId)]: \"\(preview)\"")
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
