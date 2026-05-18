import AppKit

class AppDelegate: NSObject, NSApplicationDelegate {

    private var statusBarController: StatusBarController!
    private var httpServer: HTTPServer!

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusBarController = StatusBarController()
        httpServer = HTTPServer(port: 8787, delegate: statusBarController)
        httpServer.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        httpServer.stop()
    }
}
