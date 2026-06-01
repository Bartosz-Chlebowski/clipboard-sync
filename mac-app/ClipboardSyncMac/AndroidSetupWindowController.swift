import AppKit

final class AndroidSetupWindowController: NSWindowController {
    private static let clipboardSyncAPKAssetName = "ClipboardSyncAndroid.apk"
    private static let clipboardSyncAPKDownloadURL = URL(string: "https://github.com/Bartosz-Chlebowski/clipboard-sync/releases/latest/download/ClipboardSyncAndroid.apk")!

    private enum SetupMode: Int, CaseIterable {
        case usb
        case wireless

        var title: String {
            switch self {
            case .usb: return "USB Cable"
            case .wireless: return "Wireless Debugging"
            }
        }

        var readyTitle: String {
            switch self {
            case .usb: return "First setup: USB recommended"
            case .wireless: return "Advanced setup: Wireless debugging"
            }
        }

        var hint: String {
            switch self {
            case .usb:
                return "Recommended for the first install. Use a USB data cable; after Android trusts this Mac, setup installs, opens, and configures everything it can."
            case .wireless:
                return "Advanced path for no-cable setup, reconnects, or recovery. Keep Wireless debugging open; pairing and connect ports can change."
            }
        }

        var readyMessage: String {
            switch self {
            case .usb:
                return "Recommended first setup: connect the phone with a USB data cable, unlock Android, then run setup."
            case .wireless:
                return "Advanced setup: use Wireless debugging when no cable is available, or for reconnecting after setup."
            }
        }

        var phoneReadyCue: String {
            switch self {
            case .usb:
                return "Use a data-capable USB cable, unlock Android, and approve the USB debugging prompt."
            case .wireless:
                return "Open Developer options > Wireless debugging and keep the pairing code and connect address visible."
            }
        }

        var workingFallback: String {
            switch self {
            case .usb:
                return "Keep the USB cable connected. Approve Android prompts if they appear."
            case .wireless:
                return "Keep Wireless debugging open. This path is for no-cable setup or reconnects, not the recommended first install."
            }
        }

        var completePhoneCue: String {
            switch self {
            case .usb:
                return "The Android app should show Ready. You can disconnect USB after confirming it syncs."
            case .wireless:
                return "The Android app should show Ready. Turn Wireless debugging off after confirming it syncs."
            }
        }

        var transportName: String {
            switch self {
            case .usb: return "USB cable"
            case .wireless: return "Wireless debugging"
            }
        }
    }

    private enum Step: Int, CaseIterable {
        case adb
        case phone
        case shizuku
        case authorization
        case permissions

        var title: String {
            switch self {
            case .adb: return "Prepare the Mac"
            case .phone: return "Trust this Mac"
            case .shizuku: return "Start Shizuku"
            case .authorization: return "Open Clipboard Sync"
            case .permissions: return "Enable clipboard access"
            }
        }

        func details(for mode: SetupMode) -> String {
            switch self {
            case .adb:
                return "Checking Android Platform Tools so setup can continue."
            case .phone:
                switch mode {
                case .usb:
                    return "Waiting for the phone to trust this Mac over USB debugging."
                case .wireless:
                    return "Advanced path: pairing and connecting to Android Wireless debugging over the local network."
                }
            case .shizuku:
                return "Installing Shizuku if needed, then starting its privileged service."
            case .authorization:
                return "Installing or updating the Android app and opening it on the phone."
            case .permissions:
                return "Granting the Android clipboard app-op and leaving the app ready."
            }
        }

        func phoneCue(for mode: SetupMode) -> String {
            switch self {
            case .adb:
                switch mode {
                case .usb:
                    return "Keep the phone connected. No phone action yet."
                case .wireless:
                    return "Keep the Wireless debugging screen available. No phone action yet."
                }
            case .phone:
                switch mode {
                case .usb:
                    return "Unlock Android and approve the USB debugging prompt for this Mac."
                case .wireless:
                    return "Use Android's Wireless debugging screen to pair this Mac, then keep Wireless debugging enabled."
                }
            case .shizuku:
                return "If Shizuku opens, leave it visible while the Mac starts the service."
            case .authorization:
                return "When Clipboard Sync opens, allow the Shizuku permission prompt if Android shows it."
            case .permissions:
                return "Stay on the Clipboard Sync screen. The Mac is finishing access setup."
            }
        }
    }

    private let packageName = "com.clipboardsync.android"
    private let shizukuPackageName = "moe.shizuku.privileged.api"
    private var step: Step = .adb
    private var completedSteps = Set<Step>()
    private var adbPath: String?
    private var targetSerial: String?
    private var selectedMode: SetupMode = .usb
    private var isWorking = false
    private var hasStarted = false
    private var failureMessage: String?
    private var statusMessages: [Step: String] = [:]

    private let modeControl = NSSegmentedControl(
        labels: SetupMode.allCases.map(\.title),
        trackingMode: .selectOne,
        target: nil,
        action: nil
    )
    private let modeHintLabel = NSTextField(wrappingLabelWithString: "")
    private let wirelessFieldsStack = NSStackView()
    private let pairingAddressField = NSTextField(string: "")
    private let pairingCodeField = NSTextField(string: "")
    private let connectAddressField = NSTextField(string: "")
    private let titleLabel = NSTextField(labelWithString: "")
    private let countLabel = NSTextField(labelWithString: "")
    private let detailsLabel = NSTextField(wrappingLabelWithString: "")
    private let statusLabel = NSTextField(wrappingLabelWithString: "")
    private let statusTitleLabel = NSTextField(labelWithString: "")
    private let phoneTitleLabel = NSTextField(labelWithString: "")
    private let phoneLabel = NSTextField(wrappingLabelWithString: "")
    private let progressIndicator = NSProgressIndicator()
    private let stepListView = NSStackView()
    private let logStack = NSStackView()
    private var stepRows: [Step: StepRowView] = [:]
    private let logView = NSTextView()
    private let detailsButton = NSButton(title: "Show Details", target: nil, action: nil)
    private let actionButton = NSButton(title: "", target: nil, action: nil)
    private let doneButton = NSButton(title: "Done", target: nil, action: nil)
    private var logVisible = false

    init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 760, height: 700),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Android setup"
        window.minSize = NSSize(width: 700, height: 620)
        window.center()
        super.init(window: window)
        buildUI()
        render()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func buildUI() {
        guard let contentView = window?.contentView else { return }
        contentView.wantsLayer = true
        contentView.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        let root = NSStackView()
        root.orientation = .vertical
        root.spacing = 16
        root.edgeInsets = NSEdgeInsets(top: 26, left: 30, bottom: 24, right: 30)
        root.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(root)

        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            root.topAnchor.constraint(equalTo: contentView.topAnchor),
            root.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
        ])

        let eyebrowRow = NSStackView()
        eyebrowRow.orientation = .horizontal
        eyebrowRow.alignment = .centerY
        eyebrowRow.spacing = 8

        countLabel.font = .systemFont(ofSize: 12, weight: .semibold)
        countLabel.textColor = .secondaryLabelColor
        countLabel.alignment = .left
        countLabel.setContentHuggingPriority(.required, for: .horizontal)

        let spacer = NSView()
        spacer.translatesAutoresizingMaskIntoConstraints = false
        eyebrowRow.addArrangedSubview(countLabel)
        eyebrowRow.addArrangedSubview(spacer)

        titleLabel.font = .systemFont(ofSize: 26, weight: .semibold)
        titleLabel.lineBreakMode = .byWordWrapping
        titleLabel.maximumNumberOfLines = 2
        titleLabel.setContentCompressionResistancePriority(.required, for: .vertical)

        detailsLabel.font = .systemFont(ofSize: 14)
        detailsLabel.textColor = .secondaryLabelColor
        detailsLabel.maximumNumberOfLines = 3
        detailsLabel.setContentCompressionResistancePriority(.required, for: .vertical)

        progressIndicator.isIndeterminate = false
        progressIndicator.minValue = 0
        progressIndicator.maxValue = Double(Step.allCases.count)
        progressIndicator.controlSize = .small

        let header = NSStackView()
        header.orientation = .vertical
        header.spacing = 8
        header.addArrangedSubview(eyebrowRow)
        header.addArrangedSubview(titleLabel)
        header.addArrangedSubview(detailsLabel)
        header.addArrangedSubview(progressIndicator)
        header.setCustomSpacing(2, after: eyebrowRow)

        let modeBox = NSView()
        modeBox.wantsLayer = true
        modeBox.layer?.cornerRadius = 8
        modeBox.layer?.borderWidth = 1
        modeBox.layer?.borderColor = NSColor.separatorColor.cgColor
        modeBox.layer?.backgroundColor = NSColor.controlBackgroundColor.withAlphaComponent(0.72).cgColor
        modeBox.translatesAutoresizingMaskIntoConstraints = false

        let modeStack = NSStackView()
        modeStack.orientation = .vertical
        modeStack.spacing = 10
        modeStack.translatesAutoresizingMaskIntoConstraints = false
        modeBox.addSubview(modeStack)

        NSLayoutConstraint.activate([
            modeStack.leadingAnchor.constraint(equalTo: modeBox.leadingAnchor, constant: 14),
            modeStack.trailingAnchor.constraint(equalTo: modeBox.trailingAnchor, constant: -14),
            modeStack.topAnchor.constraint(equalTo: modeBox.topAnchor, constant: 12),
            modeStack.bottomAnchor.constraint(equalTo: modeBox.bottomAnchor, constant: -12),
        ])

        let modeHeader = NSStackView()
        modeHeader.orientation = .horizontal
        modeHeader.alignment = .centerY
        modeHeader.spacing = 12

        let modeTitle = NSTextField(labelWithString: "Setup path")
        modeTitle.font = .systemFont(ofSize: 13, weight: .semibold)
        modeTitle.setContentHuggingPriority(.required, for: .horizontal)

        modeControl.selectedSegment = selectedMode.rawValue
        modeControl.segmentStyle = .rounded
        modeControl.target = self
        modeControl.action = #selector(changeSetupMode)
        modeControl.setContentHuggingPriority(.required, for: .horizontal)

        let modeSpacer = NSView()
        modeSpacer.translatesAutoresizingMaskIntoConstraints = false
        modeHeader.addArrangedSubview(modeTitle)
        modeHeader.addArrangedSubview(modeSpacer)
        modeHeader.addArrangedSubview(modeControl)

        modeHintLabel.font = .systemFont(ofSize: 12)
        modeHintLabel.textColor = .secondaryLabelColor
        modeHintLabel.maximumNumberOfLines = 3
        modeHintLabel.lineBreakMode = .byWordWrapping

        pairingAddressField.placeholderString = "Optional; auto-discovered when Wireless debugging is open"
        pairingCodeField.placeholderString = "Code from Pair device with pairing code"
        connectAddressField.placeholderString = "Optional; auto-discovered when already paired"
        [pairingAddressField, pairingCodeField, connectAddressField].forEach { field in
            field.controlSize = .regular
            field.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        }

        let pairRow = NSStackView()
        pairRow.orientation = .horizontal
        pairRow.spacing = 10
        pairRow.addArrangedSubview(makeFieldColumn(title: "Pair address", field: pairingAddressField))
        pairRow.addArrangedSubview(makeFieldColumn(title: "Code", field: pairingCodeField))

        wirelessFieldsStack.orientation = .vertical
        wirelessFieldsStack.spacing = 8
        wirelessFieldsStack.addArrangedSubview(pairRow)
        wirelessFieldsStack.addArrangedSubview(makeFieldColumn(title: "Connect address", field: connectAddressField))

        modeStack.addArrangedSubview(modeHeader)
        modeStack.addArrangedSubview(modeHintLabel)
        modeStack.addArrangedSubview(wirelessFieldsStack)

        stepListView.orientation = .vertical
        stepListView.spacing = 8
        stepListView.setContentHuggingPriority(.defaultLow, for: .horizontal)
        for step in Step.allCases {
            let row = StepRowView()
            row.configure(title: step.title, detail: step.details(for: selectedMode), state: .pending)
            stepRows[step] = row
            stepListView.addArrangedSubview(row)
        }

        let statusBox = NSView()
        statusBox.wantsLayer = true
        statusBox.layer?.cornerRadius = 8
        statusBox.layer?.borderWidth = 1
        statusBox.layer?.borderColor = NSColor.separatorColor.cgColor
        statusBox.layer?.backgroundColor = NSColor.controlBackgroundColor.withAlphaComponent(0.72).cgColor
        statusBox.translatesAutoresizingMaskIntoConstraints = false

        let statusStack = NSStackView()
        statusStack.orientation = .vertical
        statusStack.spacing = 12
        statusStack.alignment = .top
        statusStack.translatesAutoresizingMaskIntoConstraints = false
        statusBox.addSubview(statusStack)

        NSLayoutConstraint.activate([
            statusStack.leadingAnchor.constraint(equalTo: statusBox.leadingAnchor, constant: 16),
            statusStack.trailingAnchor.constraint(equalTo: statusBox.trailingAnchor, constant: -16),
            statusStack.topAnchor.constraint(equalTo: statusBox.topAnchor, constant: 14),
            statusStack.bottomAnchor.constraint(equalTo: statusBox.bottomAnchor, constant: -14),
        ])

        statusTitleLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        statusTitleLabel.maximumNumberOfLines = 1

        statusLabel.font = .systemFont(ofSize: 13)
        statusLabel.maximumNumberOfLines = 5
        statusLabel.lineBreakMode = .byWordWrapping

        phoneTitleLabel.font = .systemFont(ofSize: 13, weight: .semibold)
        phoneTitleLabel.maximumNumberOfLines = 1
        phoneLabel.font = .systemFont(ofSize: 13)
        phoneLabel.maximumNumberOfLines = 5
        phoneLabel.lineBreakMode = .byWordWrapping

        let macColumn = makeInfoColumn(title: statusTitleLabel, body: statusLabel)
        let phoneColumn = makeInfoColumn(title: phoneTitleLabel, body: phoneLabel)
        statusStack.addArrangedSubview(macColumn)
        statusStack.addArrangedSubview(phoneColumn)

        let body = NSStackView()
        body.orientation = .horizontal
        body.spacing = 18
        body.alignment = .top

        let mainColumn = NSStackView()
        mainColumn.orientation = .vertical
        mainColumn.spacing = 16
        mainColumn.addArrangedSubview(header)
        mainColumn.addArrangedSubview(modeBox)
        mainColumn.addArrangedSubview(statusBox)

        let sidebar = NSView()
        sidebar.wantsLayer = true
        sidebar.layer?.cornerRadius = 8
        sidebar.layer?.borderWidth = 1
        sidebar.layer?.borderColor = NSColor.separatorColor.cgColor
        sidebar.layer?.backgroundColor = NSColor.controlBackgroundColor.withAlphaComponent(0.72).cgColor
        sidebar.addSubview(stepListView)
        stepListView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            stepListView.leadingAnchor.constraint(equalTo: sidebar.leadingAnchor, constant: 14),
            stepListView.trailingAnchor.constraint(equalTo: sidebar.trailingAnchor, constant: -14),
            stepListView.topAnchor.constraint(equalTo: sidebar.topAnchor, constant: 14),
            stepListView.bottomAnchor.constraint(lessThanOrEqualTo: sidebar.bottomAnchor, constant: -14),
            sidebar.widthAnchor.constraint(equalToConstant: 230),
        ])

        body.addArrangedSubview(mainColumn)
        body.addArrangedSubview(sidebar)
        body.setCustomSpacing(18, after: mainColumn)
        mainColumn.setContentHuggingPriority(.defaultLow, for: .horizontal)

        logView.isEditable = false
        logView.isSelectable = true
        logView.textContainerInset = NSSize(width: 10, height: 8)
        logView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        logView.textColor = .labelColor
        logView.backgroundColor = .textBackgroundColor
        logView.isAutomaticQuoteSubstitutionEnabled = false
        logView.isAutomaticDashSubstitutionEnabled = false
        logView.string = ""

        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.documentView = logView
        scrollView.borderType = .noBorder
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.wantsLayer = true
        scrollView.layer?.cornerRadius = 8
        scrollView.layer?.borderWidth = 1
        scrollView.layer?.borderColor = NSColor.separatorColor.cgColor
        scrollView.heightAnchor.constraint(greaterThanOrEqualToConstant: 150).isActive = true

        let logLabel = NSTextField(labelWithString: "Technical details")
        logLabel.font = .systemFont(ofSize: 12, weight: .semibold)
        logLabel.textColor = .secondaryLabelColor

        logStack.orientation = .vertical
        logStack.spacing = 6
        logStack.addArrangedSubview(logLabel)
        logStack.addArrangedSubview(scrollView)
        logStack.isHidden = true

        let buttonRow = NSStackView()
        buttonRow.orientation = .horizontal
        buttonRow.spacing = 8
        buttonRow.alignment = .centerY

        detailsButton.target = self
        detailsButton.action = #selector(toggleDetails)
        detailsButton.bezelStyle = .rounded
        actionButton.target = self
        actionButton.action = #selector(runCurrentStep)
        actionButton.bezelStyle = .rounded
        doneButton.target = self
        doneButton.action = #selector(closeSetup)
        doneButton.bezelStyle = .rounded

        let buttonSpacer = NSView()
        buttonSpacer.translatesAutoresizingMaskIntoConstraints = false
        buttonRow.addArrangedSubview(detailsButton)
        buttonRow.addArrangedSubview(buttonSpacer)
        buttonRow.addArrangedSubview(actionButton)
        buttonRow.addArrangedSubview(doneButton)
        buttonSpacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        [detailsButton, actionButton, doneButton].forEach { button in
            button.heightAnchor.constraint(greaterThanOrEqualToConstant: 30).isActive = true
            button.setContentHuggingPriority(.required, for: .horizontal)
        }

        root.addArrangedSubview(body)
        root.addArrangedSubview(logStack)
        root.addArrangedSubview(buttonRow)
    }

    private func makeInfoColumn(title: NSTextField, body: NSTextField) -> NSStackView {
        let column = NSStackView()
        column.orientation = .vertical
        column.spacing = 4
        column.addArrangedSubview(title)
        column.addArrangedSubview(body)
        column.setContentCompressionResistancePriority(.required, for: .vertical)
        return column
    }

    private func makeFieldColumn(title: String, field: NSTextField) -> NSStackView {
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 11, weight: .semibold)
        label.textColor = .secondaryLabelColor
        label.maximumNumberOfLines = 1

        let column = NSStackView()
        column.orientation = .vertical
        column.spacing = 4
        column.addArrangedSubview(label)
        column.addArrangedSubview(field)
        column.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.heightAnchor.constraint(greaterThanOrEqualToConstant: 28).isActive = true
        return column
    }

    private func render() {
        countLabel.stringValue = hasStarted
            ? "\(selectedMode.transportName) setup - step \(min(completedSteps.count + 1, Step.allCases.count)) of \(Step.allCases.count)"
            : selectedMode.readyTitle
        titleLabel.stringValue = allStepsCompleted
            ? "Android is ready"
            : "Set up Clipboard Sync on Android"
        detailsLabel.stringValue = step.details(for: selectedMode)
        actionButton.title = isWorking
            ? "Setting Up"
            : allStepsCompleted
                ? "Run Again"
                : failureMessage == nil ? "Run Setup" : "Retry"
        detailsButton.title = logVisible ? "Hide Details" : "Show Details"
        logStack.isHidden = !logVisible
        doneButton.title = allStepsCompleted ? "Done" : "Close"
        doneButton.isEnabled = !isWorking
        actionButton.isEnabled = !isWorking
        actionButton.keyEquivalent = isWorking || allStepsCompleted ? "" : "\r"
        doneButton.keyEquivalent = allStepsCompleted && !isWorking ? "\r" : ""
        progressIndicator.doubleValue = Double(completedSteps.count)
        modeControl.selectedSegment = selectedMode.rawValue
        modeControl.isEnabled = !isWorking
        modeHintLabel.stringValue = selectedMode.hint
        wirelessFieldsStack.isHidden = selectedMode != .wireless
        [pairingAddressField, pairingCodeField, connectAddressField].forEach { field in
            field.isEnabled = !isWorking && selectedMode == .wireless
        }

        for item in Step.allCases {
            guard let row = stepRows[item] else { continue }
            if completedSteps.contains(item) {
                row.configure(title: item.title, detail: statusMessages[item] ?? item.details(for: selectedMode), state: .complete)
            } else if item == step {
                row.configure(title: item.title, detail: statusMessages[item] ?? item.details(for: selectedMode), state: isWorking || hasStarted ? .active : .pending)
            } else {
                row.configure(title: item.title, detail: item.details(for: selectedMode), state: .pending)
            }
        }

        if isWorking {
            statusTitleLabel.textColor = .controlAccentColor
            statusTitleLabel.stringValue = "Mac is working"
            statusLabel.textColor = .secondaryLabelColor
            statusLabel.stringValue = statusMessages[step]
                ?? selectedMode.workingFallback
            phoneTitleLabel.textColor = .labelColor
            phoneTitleLabel.stringValue = "On the phone"
            phoneLabel.textColor = .secondaryLabelColor
            phoneLabel.stringValue = step.phoneCue(for: selectedMode)
        } else if let failureMessage {
            statusTitleLabel.textColor = .systemRed
            statusTitleLabel.stringValue = "Needs attention"
            statusLabel.textColor = .systemRed
            statusLabel.stringValue = failureMessage
            phoneTitleLabel.textColor = .labelColor
            phoneTitleLabel.stringValue = "Try this"
            phoneLabel.textColor = .secondaryLabelColor
            phoneLabel.stringValue = step.phoneCue(for: selectedMode)
        } else if allStepsCompleted {
            statusTitleLabel.textColor = .systemGreen
            statusTitleLabel.stringValue = "Setup complete"
            statusLabel.textColor = .systemGreen
            statusLabel.stringValue = "Clipboard Sync, Shizuku authorization, and Android clipboard access are configured."
            phoneTitleLabel.textColor = .labelColor
            phoneTitleLabel.stringValue = "On the phone"
            phoneLabel.textColor = .secondaryLabelColor
            phoneLabel.stringValue = selectedMode.completePhoneCue
        } else if completedSteps.contains(step) {
            statusTitleLabel.textColor = .systemGreen
            statusTitleLabel.stringValue = "Completed"
            statusLabel.textColor = .systemGreen
            statusLabel.stringValue = statusMessages[step] ?? "This stage is complete."
            phoneTitleLabel.textColor = .labelColor
            phoneTitleLabel.stringValue = "On the phone"
            phoneLabel.textColor = .secondaryLabelColor
            phoneLabel.stringValue = step.phoneCue(for: selectedMode)
        } else {
            statusTitleLabel.textColor = .secondaryLabelColor
            statusTitleLabel.stringValue = "Ready"
            statusLabel.textColor = .secondaryLabelColor
            statusLabel.stringValue = selectedMode.readyMessage
            phoneTitleLabel.textColor = .labelColor
            phoneTitleLabel.stringValue = "On the phone"
            phoneLabel.textColor = .secondaryLabelColor
            phoneLabel.stringValue = selectedMode.phoneReadyCue
        }

        actionButton.toolTip = "Run the complete Android setup from the Mac using \(selectedMode.transportName)."
        detailsButton.toolTip = "Show or hide the raw setup log."
        doneButton.toolTip = allStepsCompleted ? "Close this setup window." : "Close setup without changing the phone further."

        countLabel.setAccessibilityLabel("Setup progress")
        titleLabel.setAccessibilityLabel(step.title)
        detailsLabel.setAccessibilityLabel(step.details(for: selectedMode))
        statusLabel.setAccessibilityLabel(statusLabel.stringValue)
        phoneLabel.setAccessibilityLabel(phoneLabel.stringValue)
        logView.setAccessibilityLabel("Setup log")
    }

    private var allStepsCompleted: Bool {
        completedSteps.count == Step.allCases.count
    }

    @objc private func changeSetupMode() {
        guard !isWorking else {
            modeControl.selectedSegment = selectedMode.rawValue
            return
        }
        guard let mode = SetupMode(rawValue: modeControl.selectedSegment) else { return }
        selectedMode = mode
        hasStarted = false
        failureMessage = nil
        completedSteps.removeAll()
        statusMessages.removeAll()
        targetSerial = nil
        step = .adb
        render()
    }

    @objc private func runCurrentStep() {
        guard !isWorking else { return }
        let setupMode = selectedMode
        hasStarted = true
        isWorking = true
        failureMessage = nil
        completedSteps.removeAll()
        statusMessages.removeAll()
        targetSerial = nil
        step = .adb
        render()
        appendLog("Starting automatic Android setup with \(setupMode.transportName).")

        DispatchQueue.global(qos: .userInitiated).async {
            let result: Result<String, Error>
            do {
                try self.performAutomatedSetup(mode: setupMode)
                result = .success("Android setup complete.")
            } catch {
                result = .failure(error)
            }

            DispatchQueue.main.async {
                self.isWorking = false
                switch result {
                case .success(let message):
                    self.failureMessage = nil
                    self.statusMessages[self.step] = message
                    self.appendLog("OK: \(message)")
                    UserDefaults.standard.set(true, forKey: "androidSetupComplete")
                    UserDefaults.standard.set(true, forKey: "androidUSBSetupComplete")
                case .failure(let error):
                    self.failureMessage = error.localizedDescription
                    self.appendLog("ERROR: \(error.localizedDescription)")
                }
                self.render()
            }
        }
    }

    private func performAutomatedSetup(mode: SetupMode) throws {
        for setupStep in Step.allCases {
            updateCurrentStep(setupStep)
            let message = try perform(step: setupStep, mode: mode)
            complete(step: setupStep, message: message)
        }
    }

    private func updateCurrentStep(_ nextStep: Step, message: String? = nil) {
        DispatchQueue.main.sync {
            self.step = nextStep
            if let message {
                self.statusMessages[nextStep] = message
            }
            self.render()
        }
    }

    private func updateCurrentStepMessage(_ message: String) {
        DispatchQueue.main.async {
            self.statusMessages[self.step] = message
            self.render()
        }
    }

    private func complete(step completedStep: Step, message: String) {
        DispatchQueue.main.sync {
            self.completedSteps.insert(completedStep)
            self.statusMessages[completedStep] = message
            self.render()
        }
        appendLog("OK: \(message)")
    }

    @objc private func toggleDetails() {
        logVisible.toggle()
        render()
    }

    @objc private func closeSetup() {
        close()
    }

    private func perform(step: Step, mode: SetupMode) throws -> String {
        switch step {
        case .adb:
            adbPath = try findADB()
            return "ADB found at \(adbPath!)."
        case .phone:
            let adb = try requireADB()
            let serial = try prepareDeviceConnection(adb: adb, mode: mode)
            targetSerial = serial
            return "\(mode.transportName) Android device found: \(serial)."
        case .shizuku:
            let adb = try requireADB()
            if !isPackageInstalled(shizukuPackageName, adb: adb) {
                updateCurrentStepMessage("Installing Shizuku on the phone.")
                appendLog("Shizuku is not installed. Downloading latest APK from GitHub Releases.")
                let apkURL = try downloadLatestShizukuAPK()
                defer { try? FileManager.default.removeItem(at: apkURL) }
                _ = try run(adb, adbArguments(["install", "-r", apkURL.path]))
            }
            updateCurrentStepMessage("Starting Shizuku service over \(mode.transportName).")
            _ = try? run(adb, adbArguments(["shell", "monkey", "-p", shizukuPackageName, "-c", "android.intent.category.LAUNCHER", "1"]))
            Thread.sleep(forTimeInterval: 1.0)
            let output = try startShizuku(adb: adb)
            return output.isEmpty ? "Shizuku start command sent." : output
        case .authorization:
            let adb = try requireADB()
            if isPackageInstalled(packageName, adb: adb) {
                if let apkURL = try? findClipboardSyncAPK() {
                    updateCurrentStepMessage("Updating Clipboard Sync on the phone.")
                    _ = try run(adb, adbArguments(["install", "-r", apkURL.path]))
                } else {
                    updateCurrentStepMessage("Clipboard Sync is already installed. Opening the app.")
                }
            } else {
                updateCurrentStepMessage("Installing Clipboard Sync on the phone.")
                let apkURL = try findClipboardSyncAPK()
                _ = try run(adb, adbArguments(["install", "-r", apkURL.path]))
            }
            _ = try run(adb, adbArguments(["shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"]))
            updateCurrentStepMessage("Approve the Shizuku permission prompt on the phone if Android shows one.")
            Thread.sleep(forTimeInterval: 8.0)
            return "Clipboard Sync is installed and open on the phone."
        case .permissions:
            let adb = try requireADB()
            _ = try run(adb, adbArguments(["shell", "pm", "path", packageName]))
            updateCurrentStepMessage("Granting Android clipboard app-op.")
            do {
                _ = try run(adb, adbArguments(["shell", "appops", "set", packageName, "READ_CLIPBOARD", "allow"]))
            } catch {
                appendLog("READ_CLIPBOARD failed, retrying android:read_clipboard")
                _ = try run(adb, adbArguments(["shell", "appops", "set", packageName, "android:read_clipboard", "allow"]))
            }
            _ = try? run(adb, adbArguments(["shell", "dumpsys", "deviceidle", "whitelist", "+\(packageName)"]))
            _ = try? run(adb, adbArguments(["shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"]))
            return "Clipboard app-op granted for \(packageName). The Android app should now show Ready."
        }
    }

    private struct WirelessConfiguration {
        let pairAddress: String
        let pairCode: String
        let connectAddress: String
    }

    private func prepareDeviceConnection(adb: String, mode: SetupMode) throws -> String {
        switch mode {
        case .usb:
            return try waitForAuthorizedDevice(adb: adb, mode: mode)
        case .wireless:
            return try connectWirelessDevice(adb: adb)
        }
    }

    private func connectWirelessDevice(adb: String) throws -> String {
        let configuration = currentWirelessConfiguration()
        var pairAddress = configuration.pairAddress
        var connectAddress = configuration.connectAddress
        let hasPairCode = !configuration.pairCode.isEmpty

        if hasPairCode, pairAddress.isEmpty {
            pairAddress = try discoverWirelessDebuggingAddress(adb: adb, service: "_adb-tls-pairing._tcp")
        }

        if connectAddress.isEmpty {
            connectAddress = try discoverWirelessDebuggingAddress(adb: adb, service: "_adb-tls-connect._tcp")
        }

        guard !connectAddress.isEmpty else {
            throw SetupError.message("Enter the Wireless debugging connect address from Android, or keep Wireless debugging open so the Mac can discover it.")
        }
        try validateWirelessAddress(connectAddress, label: "Wireless debugging connect address")

        if !pairAddress.isEmpty || hasPairCode {
            guard !pairAddress.isEmpty, hasPairCode else {
                throw SetupError.message("Enter both the Wireless debugging pair address and pairing code, or leave both empty if this Mac was already paired.")
            }
            try validateWirelessAddress(pairAddress, label: "Wireless debugging pair address")
            updateCurrentStepMessage("Pairing this Mac with Android Wireless debugging.")
            _ = try run(adb, ["pair", pairAddress, configuration.pairCode])
        } else {
            appendLog("Wireless pairing skipped because no pair address/code was provided.")
        }

        updateCurrentStepMessage("Connecting to Android Wireless debugging at \(connectAddress).")
        let connectOutput = try run(adb, ["connect", connectAddress])
        let normalizedOutput = connectOutput.lowercased()
        guard normalizedOutput.contains("connected") || normalizedOutput.contains("already connected") else {
            throw SetupError.message(connectOutput.isEmpty
                ? "Wireless debugging did not report a successful connection."
                : "Wireless debugging did not connect: \(connectOutput)")
        }

        return try waitForAuthorizedDevice(
            adb: adb,
            preferredSerial: connectAddress,
            mode: .wireless
        )
    }

    private func currentWirelessConfiguration() -> WirelessConfiguration {
        let readFields = {
            WirelessConfiguration(
                pairAddress: self.pairingAddressField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines),
                pairCode: self.pairingCodeField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines),
                connectAddress: self.connectAddressField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        }

        if Thread.isMainThread {
            return readFields()
        }
        return DispatchQueue.main.sync(execute: readFields)
    }

    private func discoverWirelessDebuggingAddress(adb: String, service: String) throws -> String {
        updateCurrentStepMessage("Looking for \(service) with ADB mDNS.")
        let output = try run(adb, ["mdns", "services"])
        let candidates = output
            .split(separator: "\n")
            .map(String.init)
            .filter { $0.contains(service) }

        for candidate in candidates {
            let tokens = candidate.split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
            if let address = tokens.last(where: { $0.contains(":") }) {
                appendLog("Discovered \(service): \(address)")
                return address
            }
        }

        return ""
    }

    private func validateWirelessAddress(_ value: String, label: String) throws {
        let parts = value.split(separator: ":")
        guard parts.count == 2, let port = Int(String(parts[1])), port > 0 else {
            throw SetupError.message("\(label) must look like 192.168.1.23:42123.")
        }
    }

    private func waitForAuthorizedDevice(
        adb: String,
        preferredSerial: String? = nil,
        mode: SetupMode
    ) throws -> String {
        let deadline = Date().addingTimeInterval(180)
        var lastPrompt: String?

        while Date() < deadline {
            let output = (try? run(adb, ["devices"], logOutput: false)) ?? ""
            let deviceRows = output
                .split(separator: "\n")
                .dropFirst()
                .map(String.init)

            let authorizedRows = deviceRows.filter { $0.contains("\tdevice") || $0.contains(" device") }
            let authorized = preferredSerial.flatMap { preferred in
                authorizedRows.first { row in
                    row.hasPrefix("\(preferred)\t") || row.hasPrefix("\(preferred) ") || row.contains(preferred)
                }
            } ?? (preferredSerial == nil ? authorizedRows.first : nil)

            if let authorized {
                let serial = authorized
                    .split(whereSeparator: { $0 == " " || $0 == "\t" })
                    .first
                    .map(String.init) ?? "connected"
                appendLog("Authorized Android device: \(serial)")
                return serial
            }

            let prompt: String
            switch mode {
            case .usb:
                if deviceRows.contains(where: { $0.contains("unauthorized") }) {
                    prompt = "Approve the USB debugging prompt on the phone."
                } else {
                    prompt = "Connect the Android phone with USB. Waiting for an authorized device."
                }
            case .wireless:
                if let preferredSerial,
                   deviceRows.contains(where: { $0.contains(preferredSerial) && $0.contains("offline") }) {
                    prompt = "Wireless debugging is connected but offline. Reopen Wireless debugging on Android and reconnect."
                } else {
                    prompt = "Waiting for the paired Wireless debugging device to become available."
                }
            }

            if prompt != lastPrompt {
                updateCurrentStepMessage(prompt)
                appendLog(prompt)
                lastPrompt = prompt
            }
            Thread.sleep(forTimeInterval: 2.0)
        }

        switch mode {
        case .usb:
            throw SetupError.message("No authorized Android phone was found. Connect the phone with USB and approve the USB debugging prompt.")
        case .wireless:
            throw SetupError.message("No authorized Wireless debugging device was found. Check the pair/connect address in Android Wireless debugging and run setup again.")
        }
    }

    private func findClipboardSyncAPK() throws -> URL {
        let repoRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let currentDirectory = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)

        var candidates: [URL] = []
        if let resourceURL = Bundle.main.resourceURL {
            candidates.append(resourceURL.appendingPathComponent(Self.clipboardSyncAPKAssetName))
            candidates.append(resourceURL.appendingPathComponent("app-debug.apk"))
        }
        candidates.append(repoRoot.appendingPathComponent("dist/\(Self.clipboardSyncAPKAssetName)"))
        candidates.append(repoRoot.appendingPathComponent("android-app/android/app/build/outputs/apk/debug/app-debug.apk"))
        candidates.append(currentDirectory.appendingPathComponent("dist/\(Self.clipboardSyncAPKAssetName)").standardizedFileURL)
        candidates.append(currentDirectory.appendingPathComponent("../android-app/android/app/build/outputs/apk/debug/app-debug.apk").standardizedFileURL)
        candidates.append(currentDirectory.appendingPathComponent("android-app/android/app/build/outputs/apk/debug/app-debug.apk").standardizedFileURL)

        for candidate in candidates where FileManager.default.isReadableFile(atPath: candidate.path) {
            appendLog("Using Android APK: \(candidate.path)")
            return candidate
        }

        appendLog("Clipboard Sync APK was not found locally. Downloading from GitHub Releases.")
        return try downloadClipboardSyncAPK()
    }

    private func startShizuku(adb: String) throws -> String {
        let scriptPaths = [
            "/sdcard/Android/data/\(shizukuPackageName)/start.sh",
            "/storage/emulated/0/Android/data/\(shizukuPackageName)/start.sh",
            "/sdcard/Android/data/\(shizukuPackageName)/files/start.sh",
            "/storage/emulated/0/Android/data/\(shizukuPackageName)/files/start.sh",
        ]

        for path in scriptPaths {
            do {
                return try run(adb, adbArguments(["shell", "sh", path]))
            } catch {
                appendLog("Could not start Shizuku with \(path). Trying the APK library fallback.")
            }
        }

        let fallback = """
        dir=$(pm path \(shizukuPackageName) | head -1 | cut -d: -f2 | sed 's|/base.apk$||'); "$dir"/lib/*/libshizuku.so
        """
        return try run(adb, adbArguments(["shell", fallback]))
    }

    private func isPackageInstalled(_ packageName: String, adb: String) -> Bool {
        do {
            let output = try run(adb, adbArguments(["shell", "pm", "path", packageName]))
            return !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        } catch {
            return false
        }
    }

    private func downloadLatestShizukuAPK() throws -> URL {
        guard let apiURL = URL(string: "https://api.github.com/repos/RikkaApps/Shizuku/releases/latest") else {
            throw SetupError.message("Invalid Shizuku release URL.")
        }

        let releaseData = try blockingDownload(apiURL)
        let json = try JSONSerialization.jsonObject(with: releaseData) as? [String: Any]
        let assets = json?["assets"] as? [[String: Any]] ?? []
        guard let asset = assets.first(where: { asset in
            guard let name = asset["name"] as? String else { return false }
            return name.lowercased().hasSuffix(".apk")
        }),
        let urlString = asset["browser_download_url"] as? String,
        let apkRemoteURL = URL(string: urlString) else {
            throw SetupError.message("Could not find a Shizuku APK in the latest GitHub release.")
        }

        appendLog("Downloading \(apkRemoteURL.absoluteString)")
        let apkData = try blockingDownload(apkRemoteURL)
        let targetURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("Shizuku-\(UUID().uuidString).apk")
        try apkData.write(to: targetURL)
        return targetURL
    }

    private func downloadClipboardSyncAPK() throws -> URL {
        let apkRemoteURL = Self.clipboardSyncAPKDownloadURL
        appendLog("Downloading \(apkRemoteURL.absoluteString)")
        let apkData = try blockingDownload(apkRemoteURL)
        guard apkData.count > 1_000_000 else {
            throw SetupError.message("Downloaded Clipboard Sync APK was unexpectedly small.")
        }

        let targetURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("ClipboardSync-\(UUID().uuidString).apk")
        try apkData.write(to: targetURL, options: .atomic)
        return targetURL
    }

    private func blockingDownload(_ url: URL) throws -> Data {
        var result: Result<Data, Error>?
        let semaphore = DispatchSemaphore(value: 0)
        let task = URLSession.shared.dataTask(with: url) { data, response, error in
            if let error {
                result = .failure(error)
            } else if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                result = .failure(SetupError.message("Download failed with HTTP \(http.statusCode)."))
            } else {
                result = .success(data ?? Data())
            }
            semaphore.signal()
        }
        task.resume()
        semaphore.wait()
        return try result?.get() ?? Data()
    }

    private func findADB() throws -> String {
        let candidates = [
            "/opt/homebrew/bin/adb",
            "/usr/local/bin/adb",
            "\(NSHomeDirectory())/Library/Android/sdk/platform-tools/adb",
            "/Applications/Android Studio.app/Contents/bin/adb",
        ]

        for candidate in candidates where FileManager.default.isExecutableFile(atPath: candidate) {
            return candidate
        }

        let envPath = (ProcessInfo.processInfo.environment["PATH"] ?? "")
            .split(separator: ":")
            .map(String.init)
        for dir in envPath {
            let candidate = "\(dir)/adb"
            if FileManager.default.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }

        throw SetupError.message("ADB was not found. Install Android Platform Tools, for example with: brew install android-platform-tools")
    }

    private func requireADB() throws -> String {
        if let adbPath { return adbPath }
        let found = try findADB()
        adbPath = found
        return found
    }

    private func adbArguments(_ arguments: [String]) -> [String] {
        guard let targetSerial else { return arguments }
        return ["-s", targetSerial] + arguments
    }

    private func run(_ executable: String, _ arguments: [String], logOutput: Bool = true) throws -> String {
        if logOutput {
            appendLog("$ \(executable) \(arguments.joined(separator: " "))")
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments

        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        try process.run()
        process.waitUntilExit()

        let output = String(data: outputPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let error = String(data: errorPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let combined = (output + error).trimmingCharacters(in: .whitespacesAndNewlines)
        if logOutput, !combined.isEmpty { appendLog(combined) }

        guard process.terminationStatus == 0 else {
            throw SetupError.message(combined.isEmpty ? "Command failed with exit code \(process.terminationStatus)." : combined)
        }

        return output.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func appendLog(_ line: String) {
        DispatchQueue.main.async {
            let next = self.logView.string.isEmpty ? line : "\(self.logView.string)\n\(line)"
            self.logView.string = next
            self.logView.scrollToEndOfDocument(nil)
        }
    }
}

private final class StepRowView: NSView {
    enum State {
        case pending
        case active
        case complete
    }

    private let marker = NSTextField(labelWithString: "")
    private let titleLabel = NSTextField(labelWithString: "")
    private let detailLabel = NSTextField(wrappingLabelWithString: "")

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setup()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setup()
    }

    private func setup() {
        wantsLayer = true
        layer?.cornerRadius = 7

        marker.alignment = .center
        marker.font = .systemFont(ofSize: 12, weight: .bold)
        marker.translatesAutoresizingMaskIntoConstraints = false
        marker.wantsLayer = true
        marker.layer?.cornerRadius = 9

        titleLabel.font = .systemFont(ofSize: 12, weight: .semibold)
        titleLabel.maximumNumberOfLines = 1
        titleLabel.lineBreakMode = .byTruncatingTail

        detailLabel.font = .systemFont(ofSize: 11)
        detailLabel.maximumNumberOfLines = 2
        detailLabel.textColor = .secondaryLabelColor
        detailLabel.lineBreakMode = .byWordWrapping

        let copy = NSStackView()
        copy.orientation = .vertical
        copy.spacing = 2
        copy.addArrangedSubview(titleLabel)
        copy.addArrangedSubview(detailLabel)

        let row = NSStackView()
        row.orientation = .horizontal
        row.alignment = .top
        row.spacing = 8
        row.translatesAutoresizingMaskIntoConstraints = false
        row.addArrangedSubview(marker)
        row.addArrangedSubview(copy)
        addSubview(row)

        NSLayoutConstraint.activate([
            marker.widthAnchor.constraint(equalToConstant: 18),
            marker.heightAnchor.constraint(equalToConstant: 18),
            row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 8),
            row.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
            row.topAnchor.constraint(equalTo: topAnchor, constant: 8),
            row.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -8),
        ])
    }

    func configure(title: String, detail: String, state: State) {
        titleLabel.stringValue = title
        detailLabel.stringValue = detail

        switch state {
        case .pending:
            marker.stringValue = ""
            marker.layer?.backgroundColor = NSColor.separatorColor.withAlphaComponent(0.8).cgColor
            marker.textColor = .clear
            titleLabel.textColor = .secondaryLabelColor
            detailLabel.textColor = .tertiaryLabelColor
            layer?.backgroundColor = NSColor.clear.cgColor
        case .active:
            marker.stringValue = "•"
            marker.layer?.backgroundColor = NSColor.controlAccentColor.cgColor
            marker.textColor = .white
            titleLabel.textColor = .labelColor
            detailLabel.textColor = .secondaryLabelColor
            layer?.backgroundColor = NSColor.controlAccentColor.withAlphaComponent(0.10).cgColor
        case .complete:
            marker.stringValue = "✓"
            marker.layer?.backgroundColor = NSColor.systemGreen.cgColor
            marker.textColor = .white
            titleLabel.textColor = .labelColor
            detailLabel.textColor = .secondaryLabelColor
            layer?.backgroundColor = NSColor.systemGreen.withAlphaComponent(0.08).cgColor
        }
    }
}

private enum SetupError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self {
        case .message(let message): return message
        }
    }
}
