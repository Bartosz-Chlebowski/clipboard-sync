import AppKit
import Darwin
import Dispatch

protocol HTTPServerDelegate: AnyObject {
    func didReceiveClipboardText(_ text: String)
}

final class HTTPServer {

    private let port: UInt16
    private weak var delegate: HTTPServerDelegate?
    private var serverFD: Int32 = -1
    private let queue = DispatchQueue(label: "clipboard-sync.http", attributes: .concurrent)

    init(port: UInt16, delegate: HTTPServerDelegate) {
        self.port = port
        self.delegate = delegate
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

        // Disable IPV6_V6ONLY so we also accept IPv4-mapped addresses
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
        print("[\(ts())] HTTP server listening on port \(port)")

        queue.async { [weak self] in
            self?.acceptLoop()
        }
    }

    func stop() {
        if serverFD >= 0 {
            Darwin.close(serverFD)
            serverFD = -1
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

            queue.async { [weak self] in
                self?.handleClient(clientFD)
            }
        }
    }

    // MARK: - Client handling

    private func handleClient(_ fd: Int32) {
        defer { Darwin.close(fd) }

        var buffer = Data(count: 8192)
        var received = Data()

        while true {
            let n = buffer.withUnsafeMutableBytes { ptr in
                Darwin.recv(fd, ptr.baseAddress!, 8192, 0)
            }
            if n <= 0 { break }
            received.append(buffer.prefix(n))
            if let req = parseHTTPRequest(received) {
                respond(to: fd, request: req)
                return
            }
            if received.count > 65536 { break }
        }

        writeResponse(to: fd, status: "400 Bad Request", body: #"{"status":"error","message":"bad request"}"#)
    }

    // MARK: - HTTP parsing

    private struct Request {
        let method: String
        let path: String
        let body: Data
    }

    private func parseHTTPRequest(_ data: Data) -> Request? {
        guard let raw = String(data: data, encoding: .utf8) else { return nil }
        guard let sep = raw.range(of: "\r\n\r\n") else { return nil }

        let headers = String(raw[raw.startIndex..<sep.lowerBound])
        let bodyStr = String(raw[sep.upperBound...])

        let lines = headers.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return nil }
        let parts = requestLine.components(separatedBy: " ")
        guard parts.count >= 2 else { return nil }

        var contentLength = 0
        for line in lines.dropFirst() {
            if line.lowercased().hasPrefix("content-length:") {
                let val = line.dropFirst("content-length:".count).trimmingCharacters(in: .whitespaces)
                contentLength = Int(val) ?? 0
            }
        }

        let bodyData = bodyStr.data(using: .utf8) ?? Data()
        if contentLength > 0 && bodyData.count < contentLength { return nil }

        return Request(method: parts[0], path: parts[1], body: bodyData)
    }

    // MARK: - Request handling

    private func respond(to fd: Int32, request: Request) {
        print("[\(ts())] \(request.method) \(request.path)")

        guard request.method == "POST", request.path == "/clipboard" else {
            writeResponse(to: fd, status: "404 Not Found", body: #"{"status":"error","message":"not found"}"#)
            return
        }

        guard let json = try? JSONSerialization.jsonObject(with: request.body) as? [String: Any],
              let text = json["text"] as? String else {
            print("[\(ts())] Bad JSON - missing text field")
            writeResponse(to: fd, status: "400 Bad Request", body: #"{"status":"error","message":"missing text field"}"#)
            return
        }

        let preview = text.count > 60 ? String(text.prefix(60)) + "..." : text
        print("[\(ts())] Clipboard set: \"\(preview)\"")

        DispatchQueue.main.async {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        }

        delegate?.didReceiveClipboardText(text)
        writeResponse(to: fd, status: "200 OK", body: #"{"status":"ok"}"#)
    }

    // MARK: - Write response

    private func writeResponse(to fd: Int32, status: String, body: String) {
        let bodyBytes = body.data(using: .utf8) ?? Data()
        let response = "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nContent-Length: \(bodyBytes.count)\r\nConnection: close\r\n\r\n\(body)"
        guard let responseData = response.data(using: .utf8) else { return }
        responseData.withUnsafeBytes { ptr in
            _ = Darwin.send(fd, ptr.baseAddress!, responseData.count, 0)
        }
    }

    // MARK: - Helpers

    private func ts() -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f.string(from: Date())
    }
}
