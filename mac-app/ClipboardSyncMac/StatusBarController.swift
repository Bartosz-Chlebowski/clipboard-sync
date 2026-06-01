import AppKit
import Darwin

class StatusBarController: NSObject, HTTPServerDelegate, WSServerDelegate {

    private let port = 8787

    private var statusItem: NSStatusItem!
    private var menu: NSMenu!

    private var appTitleItem: NSMenuItem!
    private var connectionItem: NSMenuItem!
    private var devicesItem: NSMenuItem!
    private var lastReceivedItem: NSMenuItem!
    private var addressItem: NSMenuItem!
    private var copyAddressItem: NSMenuItem!
    private var encryptionItem: NSMenuItem!
    private var androidSetupWindow: AndroidSetupWindowController?

    override init() {
        super.init()
        setupStatusBar()
    }

    private func setupStatusBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)

        if let button = statusItem.button {
            let image = NSImage(named: "StatusBarIcon")
                ?? NSImage(systemSymbolName: "clipboard", accessibilityDescription: "Clipboard Sync")
            image?.size = NSSize(width: 17, height: 17)
            image?.isTemplate = true
            button.image = image
            button.imagePosition = .imageOnly
            button.imageScaling = .scaleProportionallyDown
            button.title = ""
            button.setAccessibilityLabel("Clipboard Sync")
            button.setAccessibilityHelp("Open Clipboard Sync status menu")
        }

        buildMenu()
        updateDisplayedAddress()
        statusItem.menu = menu
    }

    private func buildMenu() {
        menu = NSMenu()
        menu.autoenablesItems = false

        appTitleItem = NSMenuItem(title: "Clipboard Sync", action: nil, keyEquivalent: "")
        appTitleItem.isEnabled = false
        menu.addItem(appTitleItem)

        connectionItem = NSMenuItem(title: "Connection: Waiting for Android", action: nil, keyEquivalent: "")
        connectionItem.isEnabled = false
        menu.addItem(connectionItem)

        devicesItem = NSMenuItem(title: "Android devices: None", action: nil, keyEquivalent: "")
        devicesItem.isEnabled = false
        menu.addItem(devicesItem)

        menu.addItem(NSMenuItem.separator())

        lastReceivedItem = NSMenuItem(title: "Last clipboard: Nothing received", action: nil, keyEquivalent: "")
        lastReceivedItem.isEnabled = false
        menu.addItem(lastReceivedItem)

        menu.addItem(NSMenuItem.separator())

        addressItem = NSMenuItem(title: "Mac address: Not available", action: nil, keyEquivalent: "")
        addressItem.isEnabled = false
        menu.addItem(addressItem)

        copyAddressItem = NSMenuItem(
            title: "Copy Mac Address",
            action: #selector(copyAddress),
            keyEquivalent: ""
        )
        copyAddressItem.target = self
        menu.addItem(copyAddressItem)

        encryptionItem = NSMenuItem(title: "Encryption: AES-256-GCM", action: nil, keyEquivalent: "")
        encryptionItem.isEnabled = false
        menu.addItem(encryptionItem)

        menu.addItem(NSMenuItem.separator())

        let androidSetupItem = NSMenuItem(
            title: "Set Up Android Phone...",
            action: #selector(showAndroidSetup),
            keyEquivalent: ""
        )
        androidSetupItem.target = self
        menu.addItem(androidSetupItem)

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(
            title: "Quit",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        menu.addItem(quitItem)
    }

    private func updateDisplayedAddress() {
        let address = currentListeningAddress()

        if let button = statusItem.button {
            button.imagePosition = .imageOnly
            button.title = ""
            button.toolTip = address.map { "Clipboard Sync\nListening at \($0)" } ?? "Clipboard Sync\nAddress unavailable"
        }

        addressItem?.title = address.map { "Mac address: \($0)" } ?? "Mac address: Not available"
        addressItem?.toolTip = address
        copyAddressItem?.isEnabled = address != nil
    }

    func showAndroidSetupIfNeeded() {
        if !UserDefaults.standard.bool(forKey: "androidUSBSetupComplete") {
            showAndroidSetup()
        }
    }

    @objc private func copyAddress() {
        guard let address = currentListeningAddress() else { return }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(address, forType: .string)
        copyAddressItem.title = "Copied Mac Address"
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            self.copyAddressItem.title = "Copy Mac Address"
        }
    }

    @objc private func showAndroidSetup() {
        if androidSetupWindow == nil {
            androidSetupWindow = AndroidSetupWindowController()
        }
        androidSetupWindow?.showWindow(nil)
        androidSetupWindow?.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private static func localIPv4Address() -> String? {
        var interfaces: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&interfaces) == 0, let firstInterface = interfaces else {
            return nil
        }
        defer { freeifaddrs(interfaces) }

        var fallback: String?
        var pointer: UnsafeMutablePointer<ifaddrs>? = firstInterface
        while let interface = pointer?.pointee {
            defer { pointer = interface.ifa_next }

            let flags = Int32(interface.ifa_flags)
            let isUp = (flags & IFF_UP) != 0
            let isRunning = (flags & IFF_RUNNING) != 0
            let isLoopback = (flags & IFF_LOOPBACK) != 0
            guard isUp, isRunning, !isLoopback else { continue }
            guard interface.ifa_addr.pointee.sa_family == UInt8(AF_INET) else { continue }

            var address = interface.ifa_addr.pointee
            var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            let result = getnameinfo(
                &address,
                socklen_t(address.sa_len),
                &hostname,
                socklen_t(hostname.count),
                nil,
                0,
                NI_NUMERICHOST
            )
            guard result == 0 else { continue }

            let ip = String(cString: hostname)
            let name = String(cString: interface.ifa_name)
            if name == "en0" || name == "en1" {
                return ip
            }
            fallback = fallback ?? ip
        }

        return fallback
    }

    private func currentListeningAddress() -> String? {
        guard let ip = Self.localIPv4Address() else { return nil }
        return "ws://\(ip):\(port)/ws"
    }

    private static func previewText(_ text: String, limit: Int = 42) -> String {
        let normalized = text
            .replacingOccurrences(of: "\n", with: " ")
            .replacingOccurrences(of: "\r", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !normalized.isEmpty else { return "Empty text" }
        guard normalized.count > limit else { return normalized }

        let endIndex = normalized.index(normalized.startIndex, offsetBy: limit)
        return "\(normalized[..<endIndex])..."
    }

    private static func deviceCountTitle(_ count: Int) -> String {
        count == 1 ? "1 device connected" : "\(count) devices connected"
    }

    // MARK: - HTTPServerDelegate

    func didReceiveClipboardText(_ text: String) {
        DispatchQueue.main.async {
            self.lastReceivedItem.title = "Last clipboard: \(Self.previewText(text))"
            self.lastReceivedItem.toolTip = text
        }
    }

    // MARK: - WSServerDelegate (called on main queue)

    func wsClientsDidChange(clients: [(deviceId: String, deviceName: String, ip: String)]) {
        if clients.isEmpty {
            connectionItem.title = "Connection: Waiting for Android"
            devicesItem.title = "Android devices: None"
            devicesItem.isEnabled = false
            devicesItem.submenu = nil
        } else {
            connectionItem.title = "Connection: Active"
            devicesItem.title = "Android devices: \(Self.deviceCountTitle(clients.count))"
            devicesItem.isEnabled = true

            let submenu = devicesItem.submenu ?? NSMenu()
            devicesItem.submenu = submenu
            submenu.removeAllItems()
            for c in clients {
                let deviceName = c.deviceName.trimmingCharacters(in: .whitespacesAndNewlines)
                let displayName = deviceName.isEmpty ? c.deviceId : deviceName
                let item = NSMenuItem(title: "\(displayName)  \(c.ip)", action: nil, keyEquivalent: "")
                item.toolTip = "Device ID: \(c.deviceId)"
                item.isEnabled = false
                submenu.addItem(item)
            }
        }
    }

    func wsDidReceiveClipboard(text: String, deviceId: String) {
        lastReceivedItem.title = "Last clipboard: \(Self.previewText(text))"
        lastReceivedItem.toolTip = "From \(deviceId): \(text)"
    }
}
