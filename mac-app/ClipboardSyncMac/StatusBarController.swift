import AppKit

class StatusBarController: NSObject, HTTPServerDelegate, WSServerDelegate {

    private var statusItem: NSStatusItem!
    private var menu: NSMenu!

    private var connectionItem: NSMenuItem!
    private var devicesItem: NSMenuItem!
    private var lastReceivedItem: NSMenuItem!

    override init() {
        super.init()
        setupStatusBar()
    }

    private func setupStatusBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "clipboard", accessibilityDescription: "Clipboard Sync")
            button.imagePosition = .imageLeading
            button.title = " Sync"
        }

        buildMenu()
        statusItem.menu = menu
    }

    private func buildMenu() {
        menu = NSMenu()

        connectionItem = NSMenuItem(title: "Disconnected", action: nil, keyEquivalent: "")
        connectionItem.isEnabled = false
        menu.addItem(connectionItem)

        devicesItem = NSMenuItem(title: "Devices", action: nil, keyEquivalent: "")
        devicesItem.isHidden = true
        devicesItem.submenu = NSMenu()
        menu.addItem(devicesItem)

        menu.addItem(NSMenuItem.separator())

        lastReceivedItem = NSMenuItem(title: "Last received: -", action: nil, keyEquivalent: "")
        lastReceivedItem.isEnabled = false
        menu.addItem(lastReceivedItem)

        let portItem = NSMenuItem(title: "Port: 8787", action: nil, keyEquivalent: "")
        portItem.isEnabled = false
        menu.addItem(portItem)

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(
            title: "Quit",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        menu.addItem(quitItem)
    }

    // MARK: - HTTPServerDelegate

    func didReceiveClipboardText(_ text: String) {
        let preview = text.count > 40 ? String(text.prefix(40)) + "..." : text
        DispatchQueue.main.async {
            self.lastReceivedItem.title = "Last received: \(preview)"
        }
    }

    // MARK: - WSServerDelegate (called on main queue)

    func wsClientsDidChange(clients: [(deviceId: String, deviceName: String, ip: String)]) {
        if clients.isEmpty {
            connectionItem.title = "Disconnected"
            devicesItem.isHidden = true
        } else {
            let plural = clients.count == 1 ? "client" : "clients"
            connectionItem.title = "\(clients.count) \(plural) connected"
            devicesItem.isHidden = false

            let submenu = devicesItem.submenu!
            submenu.removeAllItems()
            for c in clients {
                let item = NSMenuItem(title: "\(c.deviceId) (\(c.ip))", action: nil, keyEquivalent: "")
                item.isEnabled = false
                submenu.addItem(item)
            }
        }
    }

    func wsDidReceiveClipboard(text: String, deviceId: String) {
        let preview = text.count > 40 ? String(text.prefix(40)) + "..." : text
        lastReceivedItem.title = "Last received: \(preview) (from \(deviceId))"
    }
}
