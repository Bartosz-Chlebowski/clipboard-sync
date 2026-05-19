import AppKit
import CommonCrypto
import Darwin
import Dispatch

protocol HTTPServerDelegate: AnyObject {
    func didReceiveClipboardText(_ text: String)
}

// Called on main queue
protocol WSServerDelegate: AnyObject {
    func wsClientsDidChange(clients: [(deviceId: String, deviceName: String, ip: String)])
    func wsDidReceiveClipboard(text: String, deviceId: String)
}

final class HTTPServer {

    private let port: UInt16
    private weak var httpDelegate: HTTPServerDelegate?
    weak var wsDelegate: WSServerDelegate?

    private var serverFD: Int32 = -1
    private let queue = DispatchQueue(label: "clipboard-sync.http", attributes: .concurrent)

    // Accessed only on main queue
    private var wsClients: [UUID: WSClient] = [:]

    init(port: UInt16, delegate: HTTPServerDelegate) {
        self.port = port
        self.httpDelegate = delegate
    }

    func start() {
        let fd = socket(AF_INET6, SOCK_STREAM, 0)
        guard fd >= 0 else {
            print("[\(ts())] Failed to create socket: \(String(cString: strerror(errno)))")
            return
        }

        var reuse: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))
        setsockopt(fd, SOL_SOCKET, SO_REUSEPORT, &reuse, socklen_t(MemoryLayout<Int32>.size))

        var v6only: Int32 = 0
        setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &v6only, socklen_t(MemoryLayout<Int32>.size))

        var addr = sockaddr_in6()
        addr.sin6_family = sa_family_t(AF_INET6)
        addr.sin6_port = port.bigEndian
        addr.sin6_addr = in6addr_any

        let bindResult = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in6>.size))
            }
        }

        guard bindResult == 0 else {
            print("[\(ts())] Bind failed on port \(port): \(String(cString: strerror(errno)))")
            Darwin.close(fd)
            return
        }

        guard listen(fd, 16) == 0 else {
            print("[\(ts())] Listen failed: \(String(cString: strerror(errno)))")
            Darwin.close(fd)
            return
        }

        serverFD = fd
        print("[\(ts())] Server listening on port \(port) (HTTP + WebSocket)")

        queue.async { [weak self] in
            self?.acceptLoop()
        }
    }

    func stop() {
        if serverFD >= 0 {
            Darwin.close(serverFD)
            serverFD = -1
        }
        DispatchQueue.main.async { [weak self] in
            self?.wsClients.values.forEach { $0.disconnect() }
            self?.wsClients.removeAll()
        }
    }

    // MARK: - Accept loop

    private func acceptLoop() {
        while serverFD >= 0 {
            var clientAddr = sockaddr_in6()
            var addrLen = socklen_t(MemoryLayout<sockaddr_in6>.size)
            let clientFD = withUnsafeMutablePointer(to: &clientAddr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    accept(serverFD, $0, &addrLen)
                }
            }
            guard clientFD >= 0 else { break }

            let ip = extractIP(from: clientAddr)
            queue.async { [weak self] in
                self?.handleClient(clientFD, remoteIP: ip)
            }
        }
    }

    // MARK: - Client handling

    private func handleClient(_ fd: Int32, remoteIP: String) {
        var buffer = Data(count: 8192)
        var received = Data()

        while true {
            let n = buffer.withUnsafeMutableBytes { ptr in
                Darwin.recv(fd, ptr.baseAddress!, 8192, 0)
            }
            if n <= 0 {
                Darwin.close(fd)
                return
            }
            received.append(buffer.prefix(n))

            if let req = parseHTTPRequest(received) {
                if isWebSocketUpgrade(req) {
                    handleWebSocketUpgrade(fd: fd, request: req, remoteIP: remoteIP)
                } else {
                    respond(to: fd, request: req)
                    Darwin.close(fd)
                }
                return
            }

            if received.count > 65536 {
                writeResponse(to: fd, status: "400 Bad Request",
                              body: #"{"status":"error","message":"bad request"}"#)
                Darwin.close(fd)
                return
            }
        }
    }

    // MARK: - HTTP parsing

    private struct Request {
        let method: String
        let path: String
        let headers: [String: String]
        let body: Data
    }

    private func parseHTTPRequest(_ data: Data) -> Request? {
        guard let raw = String(data: data, encoding: .utf8) else { return nil }
        guard let sep = raw.range(of: "\r\n\r\n") else { return nil }

        let headerSection = String(raw[raw.startIndex..<sep.lowerBound])
        let bodyStr = String(raw[sep.upperBound...])

        let lines = headerSection.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return nil }
        let parts = requestLine.components(separatedBy: " ")
        guard parts.count >= 2 else { return nil }

        var headers: [String: String] = [:]
        var contentLength = 0
        for line in lines.dropFirst() {
            let kv = line.split(separator: ":", maxSplits: 1)
            if kv.count == 2 {
                let key = String(kv[0]).lowercased().trimmingCharacters(in: .whitespaces)
                let val = String(kv[1]).trimmingCharacters(in: .whitespaces)
                headers[key] = val
                if key == "content-length" { contentLength = Int(val) ?? 0 }
            }
        }

        let bodyData = bodyStr.data(using: .utf8) ?? Data()
        if contentLength > 0 && bodyData.count < contentLength { return nil }

        return Request(method: parts[0], path: parts[1], headers: headers, body: bodyData)
    }

    // MARK: - WebSocket upgrade

    private func isWebSocketUpgrade(_ req: Request) -> Bool {
        req.headers["upgrade"]?.lowercased() == "websocket" &&
        req.headers["connection"]?.lowercased().contains("upgrade") == true
    }

    private func handleWebSocketUpgrade(fd: Int32, request: Request, remoteIP: String) {
        guard
            let key = request.headers["sec-websocket-key"],
            let accept = wsAcceptKey(key)
        else {
            writeResponse(to: fd, status: "400 Bad Request", body: "")
            Darwin.close(fd)
            return
        }

        let handshake = [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Accept: \(accept)",
            "", ""
        ].joined(separator: "\r\n")

        guard let handshakeData = handshake.data(using: .utf8) else {
            Darwin.close(fd)
            return
        }
        handshakeData.withUnsafeBytes { _ = Darwin.send(fd, $0.baseAddress!, handshakeData.count, 0) }
        print("[\(ts())] WS upgrade from \(remoteIP)")

        let client = WSClient(fd: fd, remoteIP: remoteIP, delegate: self, queue: queue)
        DispatchQueue.main.async { [weak self] in
            self?.wsClients[client.id] = client
        }
        client.start()
    }

    private func wsAcceptKey(_ key: String) -> String? {
        let magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        guard let data = (key + magic).data(using: .utf8) else { return nil }
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA1_DIGEST_LENGTH))
        data.withUnsafeBytes { CC_SHA1($0.baseAddress, CC_LONG(data.count), &digest) }
        return Data(digest).base64EncodedString()
    }

    private func extractIP(from addr: sockaddr_in6) -> String {
        var str = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
        var a = addr
        withUnsafePointer(to: &a.sin6_addr) { inet_ntop(AF_INET6, $0, &str, socklen_t(INET6_ADDRSTRLEN)) }
        let s = String(cString: str)
        return s.hasPrefix("::ffff:") ? String(s.dropFirst(7)) : s
    }

    // MARK: - HTTP request handling

    private func respond(to fd: Int32, request: Request) {
        print("[\(ts())] \(request.method) \(request.path)")

        if request.method == "GET" && request.path == "/health" {
            writeResponse(to: fd, status: "200 OK",
                          body: #"{"status":"ok","device":"macbook-air"}"#)
            return
        }

        guard request.method == "POST", request.path == "/clipboard" else {
            writeResponse(to: fd, status: "404 Not Found",
                          body: #"{"status":"error","message":"not found"}"#)
            return
        }

        guard
            let json = try? JSONSerialization.jsonObject(with: request.body) as? [String: Any],
            let text = json["text"] as? String
        else {
            print("[\(ts())] Bad JSON - missing text field")
            writeResponse(to: fd, status: "400 Bad Request",
                          body: #"{"status":"error","message":"missing text field"}"#)
            return
        }

        let eventId = json["eventId"] as? String ?? "-"
        let sourceDeviceId = json["sourceDeviceId"] as? String ?? "-"
        let preview = text.count > 60 ? String(text.prefix(60)) + "..." : text
        print("[\(ts())] HTTP clipboard from \(sourceDeviceId) [eventId=\(eventId)]: \"\(preview)\"")

        DispatchQueue.main.async {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        }

        httpDelegate?.didReceiveClipboardText(text)
        writeResponse(to: fd, status: "200 OK", body: #"{"status":"ok"}"#)
    }

    private func writeResponse(to fd: Int32, status: String, body: String) {
        let bodyBytes = body.data(using: .utf8) ?? Data()
        let response = "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nContent-Length: \(bodyBytes.count)\r\nConnection: close\r\n\r\n\(body)"
        guard let responseData = response.data(using: .utf8) else { return }
        responseData.withUnsafeBytes { _ = Darwin.send(fd, $0.baseAddress!, responseData.count, 0) }
    }

    // MARK: - Helpers

    private func ts() -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f.string(from: Date())
    }
}

// MARK: - WSClientDelegate

extension HTTPServer: WSClientDelegate {

    func wsClientReady(_ client: WSClient) {
        // Called on main queue
        let snapshot = readyClientsSnapshot()
        print("[\(ts())] WS client ready: \(client.sourceDeviceId). Total: \(snapshot.count)")
        wsDelegate?.wsClientsDidChange(clients: snapshot)
    }

    func wsClientDidReceiveClipboard(_ client: WSClient, text: String, eventId: String) {
        // Called on main queue
        wsDelegate?.wsDidReceiveClipboard(text: text, deviceId: client.sourceDeviceId)
    }

    func wsClientDidDisconnect(_ client: WSClient) {
        // Called on main queue
        wsClients.removeValue(forKey: client.id)
        let snapshot = readyClientsSnapshot()
        wsDelegate?.wsClientsDidChange(clients: snapshot)
    }

    private func readyClientsSnapshot() -> [(deviceId: String, deviceName: String, ip: String)] {
        wsClients.values
            .filter { $0.isConnected && !$0.sourceDeviceId.isEmpty }
            .map { (deviceId: $0.sourceDeviceId, deviceName: $0.deviceName, ip: $0.remoteIP) }
    }
}
