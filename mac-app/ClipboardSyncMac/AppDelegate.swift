import AppKit
import ServiceManagement

class AppDelegate: NSObject, NSApplicationDelegate {

    private var statusBarController: StatusBarController!
    private var httpServer: HTTPServer!

    func applicationDidFinishLaunching(_ notification: Notification) {
        registerForLogin()

        statusBarController = StatusBarController()
        httpServer = HTTPServer(port: 8787, delegate: statusBarController)
        httpServer.wsDelegate = statusBarController
        httpServer.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        httpServer.stop()
    }

    private func registerForLogin() {
        do {
            try SMAppService.mainApp.register()
        } catch {
            NSLog("ClipboardSyncMac login item registration failed: \(error.localizedDescription)")
        }
    }
}
