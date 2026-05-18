import AppKit

class StatusBarController: NSObject, HTTPServerDelegate {

    private var statusItem: NSStatusItem!
    private var menu: NSMenu!

    private var lastReceivedItem: NSMenuItem!
    private var portItem: NSMenuItem!

    private var lastReceivedText: String = "-"

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

        lastReceivedItem = NSMenuItem(title: "Last received: -", action: nil, keyEquivalent: "")
        lastReceivedItem.isEnabled = false
        menu.addItem(lastReceivedItem)

        portItem = NSMenuItem(title: "Port: 8787", action: nil, keyEquivalent: "")
        portItem.isEnabled = false
        menu.addItem(portItem)

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quitItem)
    }

    // MARK: - HTTPServerDelegate

    func didReceiveClipboardText(_ text: String) {
        let preview = text.count > 40 ? String(text.prefix(40)) + "..." : text
        lastReceivedText = preview

        DispatchQueue.main.async {
            self.lastReceivedItem.title = "Last received: \(preview)"
        }
    }
}
