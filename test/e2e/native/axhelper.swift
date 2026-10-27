import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

/*
 * 星屿真机黑盒测试的 macOS 原生辅助程序。
 *
 * 只做“人能做到的动作”：AX 查找/按下、鼠标点击、键盘快捷键、粘贴、滚动、拖拽、
 * 读取窗口信息。业务断言和测试编排在 Node 运行器中。
 *
 * 所有输出为单行 JSON；查询/文本参数使用 base64，避免中文与引号在 shell 中被改写。
 */

func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(el, name as CFString, &value)
    return error == .success ? value : nil
}

func text(_ el: AXUIElement, _ name: String) -> String? {
    return attr(el, name) as? String
}

func number(_ el: AXUIElement, _ name: String) -> Double? {
    return attr(el, name) as? Double
}

func boolean(_ el: AXUIElement, _ name: String) -> Bool? {
    return attr(el, name) as? Bool
}

func frame(_ el: AXUIElement) -> (CGPoint, CGSize) {
    var point = CGPoint.zero
    var size = CGSize.zero
    if let value = attr(el, kAXPositionAttribute) {
        AXValueGetValue(value as! AXValue, .cgPoint, &point)
    }
    if let value = attr(el, kAXSizeAttribute) {
        AXValueGetValue(value as! AXValue, .cgSize, &size)
    }
    return (point, size)
}

func decodeBase64(_ raw: String) -> String? {
    guard let data = Data(base64Encoded: raw) else { return nil }
    return String(data: data, encoding: .utf8)
}

func json(_ object: Any, code: Int32 = 0) -> Never {
    let data = try? JSONSerialization.data(withJSONObject: object, options: [])
    FileHandle.standardOutput.write(data ?? Data("{}".utf8))
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(code)
}

func failure(_ message: String, code: Int32 = 1) -> Never {
    json(["ok": false, "error": message], code: code)
}

func escape(_ value: String) -> String {
    return value
}

func findApp() -> NSRunningApplication {
    let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.jh.starris")
    if let active = apps.first(where: { $0.isActive }) { return active }
    if let app = apps.first { return app }
    if let app = NSWorkspace.shared.runningApplications.first(where: {
        $0.executableURL?.lastPathComponent == "starris-rust"
    }) {
        return app
    }
    failure("starris-rust 未运行", code: 4)
}

func mainWindowInfo(pid: pid_t) -> [String: Any]? {
    let options = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
    guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        return nil
    }
    let candidates = windows.compactMap { window -> [String: Any]? in
        guard let owner = window[kCGWindowOwnerPID as String] as? NSNumber,
              owner.int32Value == pid,
              let layer = window[kCGWindowLayer as String] as? NSNumber,
              layer.intValue == 0,
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let width = bounds["Width"] as? NSNumber,
              let height = bounds["Height"] as? NSNumber else {
            return nil
        }
        let area = width.doubleValue * height.doubleValue
        let name = window[kCGWindowName as String] as? String ?? ""
        return ["window": window, "area": area, "name": name]
    }
    return candidates.max { left, right in
        (left["area"] as? Double ?? 0) < (right["area"] as? Double ?? 0)
    }?["window"] as? [String: Any]
}

func activate(_ app: NSRunningApplication, _ axApp: AXUIElement) {
    app.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
    AXUIElementSetAttributeValue(axApp, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    usleep(120_000)
}

func click(at point: CGPoint, right: Bool = false, count: Int = 1) {
    let source = CGEventSource(stateID: .combinedSessionState)
    let button: CGMouseButton = right ? .right : .left
    let down: CGEventType = right ? .rightMouseDown : .leftMouseDown
    let up: CGEventType = right ? .rightMouseUp : .leftMouseUp
    CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: button)?
        .post(tap: .cghidEventTap)
    usleep(60_000)
    for _ in 0..<max(1, count) {
        CGEvent(mouseEventSource: source, mouseType: down, mouseCursorPosition: point, mouseButton: button)?
            .post(tap: .cghidEventTap)
        usleep(40_000)
        CGEvent(mouseEventSource: source, mouseType: up, mouseCursorPosition: point, mouseButton: button)?
            .post(tap: .cghidEventTap)
        usleep(40_000)
    }
}

let keyCodes: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
    "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26,
    "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35,
    "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45,
    "m": 46, ".": 47, "`": 50,
    "return": 36, "enter": 76, "tab": 48, "escape": 53, "esc": 53, "space": 49,
    "delete": 51, "backspace": 51, "forwarddelete": 117,
    "up": 126, "down": 125, "left": 123, "right": 124,
    "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
]

func keyEvent(_ combo: String) {
    let parts = combo.lowercased().split(separator: "+").map(String.init)
    var flags: CGEventFlags = []
    var keyName: String?
    for part in parts {
        switch part {
        case "cmd", "command": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "alt", "option", "opt": flags.insert(.maskAlternate)
        case "ctrl", "control": flags.insert(.maskControl)
        default: keyName = part
        }
    }
    guard var keyName, var code = keyCodes[keyName] else {
        failure("未知按键: \(combo)")
    }
    if keyName.count == 1, keyName >= "A", keyName <= "Z" {
        flags.insert(.maskShift)
        keyName = keyName.lowercased()
        code = keyCodes[keyName] ?? code
    }
    let source = CGEventSource(stateID: .combinedSessionState)
    let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true)
    let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)
    down?.flags = flags
    up?.flags = flags
    down?.post(tap: .cghidEventTap)
    usleep(35_000)
    up?.post(tap: .cghidEventTap)
    usleep(40_000)
}

func pasteText(_ value: String) {
    let pasteboard = NSPasteboard.general
    let old = pasteboard.string(forType: .string)
    pasteboard.clearContents()
    pasteboard.setString(value, forType: .string)
    keyEvent("cmd+v")
    usleep(220_000)
    pasteboard.clearContents()
    if let old { pasteboard.setString(old, forType: .string) }
}

struct Match {
    let element: AXUIElement
    let role: String
    let title: String
    let description: String
    let value: String
    let placeholder: String
    let point: CGPoint
    let size: CGSize
    let depth: Int
}

func collect(_ element: AXUIElement, query: String, roleFilter: String?, depth: Int, visited: inout Int, matches: inout [Match]) {
    if depth > 60 || visited > 60_000 || matches.count >= 120 { return }
    visited += 1
    let role = text(element, kAXRoleAttribute) ?? ""
    let title = text(element, kAXTitleAttribute) ?? ""
    let description = text(element, kAXDescriptionAttribute) ?? ""
    let value = text(element, kAXValueAttribute) ?? ""
    let placeholder = text(element, "AXPlaceholderValue") ?? ""
    let haystacks = [title, description, value, placeholder].map { $0.lowercased() }
    let needle = query.lowercased()
    let roleMatches = roleFilter == nil || role == roleFilter
    if roleMatches && haystacks.contains(where: { $0.contains(needle) }) {
        let (point, size) = frame(element)
        matches.append(Match(
            element: element, role: role, title: title, description: description,
            value: value, placeholder: placeholder, point: point, size: size, depth: depth
        ))
    }
    if let children = attr(element, kAXChildrenAttribute) as? [AXUIElement] {
        for child in children {
            collect(child, query: query, roleFilter: roleFilter, depth: depth + 1, visited: &visited, matches: &matches)
            if matches.count >= 120 { return }
        }
    }
}

func allMatches(axApp: AXUIElement, query: String, roleFilter: String?) -> [Match] {
    var matches: [Match] = []
    var visited = 0
    collect(axApp, query: query, roleFilter: roleFilter, depth: 0, visited: &visited, matches: &matches)
    return matches
}

func matchJSON(_ match: Match) -> [String: Any] {
    var actions: [String] = []
    var actionNames: CFArray?
    if AXUIElementCopyActionNames(match.element, &actionNames) == .success,
       let names = actionNames as? [String] {
        actions = names
    }
    return [
        "role": match.role,
        "title": match.title,
        "description": match.description,
        "value": String(match.value.prefix(300)),
        "placeholder": match.placeholder,
        "point": ["x": match.point.x, "y": match.point.y],
        "size": ["width": match.size.width, "height": match.size.height],
        "depth": match.depth,
        "actions": actions,
    ]
}

func priority(_ role: String) -> Int {
    switch role {
    case "AXButton": return 0
    case "AXMenuItem": return 1
    case "AXCheckBox": return 2
    case "AXRadioButton": return 3
    case "AXPopUpButton": return 4
    case "AXLink": return 5
    case "AXTab": return 6
    default: return 20
    }
}

let args = CommandLine.arguments
if args.count < 2 { failure("缺少命令") }
if AXIsProcessTrusted() == false {
    failure("辅助程序缺少辅助功能权限；请在系统设置→隐私与安全性→辅助功能中授权运行 pnpm run test 的终端", code: 3)
}

let app = findApp()
let pid = app.processIdentifier
let axApp = AXUIElementCreateApplication(pid)

switch args[1] {
case "window":
    guard let window = mainWindowInfo(pid: pid),
          let bounds = window[kCGWindowBounds as String] as? [String: Any],
          let id = window[kCGWindowNumber as String] as? NSNumber else {
        failure("找不到应用窗口")
    }
    json([
        "ok": true,
        "pid": pid,
        "windowId": id.intValue,
        "name": window[kCGWindowName as String] as? String ?? "",
        "bounds": bounds,
    ])
case "activate":
    activate(app, axApp)
    json(["ok": true, "pid": pid])
case "find", "tree":
    let query: String
    if args[1] == "tree" {
        query = ""
    } else {
        guard args.count >= 3, let decoded = decodeBase64(args[2]) else { failure("查询参数不是 base64") }
        query = decoded
    }
    var roleFilter: String?
    if let index = args.firstIndex(of: "--role"), index + 1 < args.count {
        roleFilter = args[index + 1]
    }
    let matches = allMatches(axApp: axApp, query: query, roleFilter: roleFilter)
    json(["ok": true, "count": matches.count, "matches": matches.map(matchJSON)])
case "press", "fill":
    guard args.count >= 3, let query = decodeBase64(args[2]) else { failure("查询参数不是 base64") }
    let exact = args.contains("--exact")
    var roleFilter: String?
    if let index = args.firstIndex(of: "--role"), index + 1 < args.count {
        roleFilter = args[index + 1]
    }
    activate(app, axApp)
    let matches = allMatches(axApp: axApp, query: query, roleFilter: roleFilter)
    guard !matches.isEmpty else { failure("找不到元素: \(query)") }
    let ordered = matches.sorted { left, right in
        let leftExact = [left.title, left.description, left.value].contains { $0.caseInsensitiveCompare(query) == .orderedSame }
        let rightExact = [right.title, right.description, right.value].contains { $0.caseInsensitiveCompare(query) == .orderedSame }
        if exact && leftExact != rightExact { return leftExact }
        if leftExact != rightExact { return leftExact }
        return priority(left.role) < priority(right.role)
    }
    let preferred: [Match]
    if args[1] == "fill" {
        let fieldRoles = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"]
        let fields = ordered.filter { fieldRoles.contains($0.role) }
        preferred = fields.isEmpty ? ordered : fields
    } else {
        let interactive = ordered.filter { priority($0.role) < 20 }
        preferred = interactive.isEmpty ? ordered : interactive
    }
    guard let target = preferred.first else { failure("找不到可操作元素: \(query)") }
    if args[1] == "fill" {
        guard args.count >= 4, let value = decodeBase64(args[3]) else { failure("文本参数不是 base64") }
        let center = CGPoint(x: target.point.x + target.size.width / 2, y: target.point.y + target.size.height / 2)
        click(at: center)
        usleep(100_000)
        keyEvent("cmd+a")
        pasteText(value)
        json(["ok": true, "action": "fill", "role": target.role, "title": target.title, "value": value])
    }
    // Radix 触发器与单选卡片只认真实指针事件，AXPress 可能被忽略。
    if target.role != "AXPopUpButton" && target.role != "AXRadioButton" {
        let pressError = AXUIElementPerformAction(target.element, kAXPressAction as CFString)
        if pressError == .success {
            json(["ok": true, "action": "press", "role": target.role, "title": target.title])
        }
    }
    let center = CGPoint(x: target.point.x + target.size.width / 2, y: target.point.y + target.size.height / 2)
    click(at: center)
    json(["ok": true, "action": "click-trigger", "role": target.role, "title": target.title])
case "click":
    guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else { failure("click 需要 x y") }
    activate(app, axApp)
    click(at: CGPoint(x: x, y: y))
    json(["ok": true, "action": "click", "x": x, "y": y])
case "rightclick":
    guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else { failure("rightclick 需要 x y") }
    activate(app, axApp)
    click(at: CGPoint(x: x, y: y), right: true)
    json(["ok": true, "action": "rightclick", "x": x, "y": y])
case "doubleclick":
    guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else { failure("doubleclick 需要 x y") }
    activate(app, axApp)
    click(at: CGPoint(x: x, y: y), count: 2)
    json(["ok": true, "action": "doubleclick", "x": x, "y": y])
case "hover":
    guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else { failure("hover 需要 x y") }
    activate(app, axApp)
    let source = CGEventSource(stateID: .combinedSessionState)
    // 先到目标附近再移到中心：WebKit 依赖连续 mouseMoved 触发 mouseenter。
    CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: x - 40, y: y - 40), mouseButton: .left)?
        .post(tap: .cghidEventTap)
    usleep(80_000)
    CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)?
        .post(tap: .cghidEventTap)
    json(["ok": true, "action": "hover", "x": x, "y": y])
case "scroll":
    guard args.count >= 5, let x = Double(args[2]), let y = Double(args[3]), let dy = Int32(args[4]) else {
        failure("scroll 需要 x y dy")
    }
    activate(app, axApp)
    let source = CGEventSource(stateID: .combinedSessionState)
    CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)?
        .post(tap: .cghidEventTap)
    usleep(80_000)
    CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0)?
        .post(tap: .cghidEventTap)
    json(["ok": true, "action": "scroll", "x": x, "y": y, "dy": dy])
case "drag":
    guard args.count >= 6, let x1 = Double(args[2]), let y1 = Double(args[3]),
          let x2 = Double(args[4]), let y2 = Double(args[5]) else {
        failure("drag 需要 x1 y1 x2 y2")
    }
    activate(app, axApp)
    let source = CGEventSource(stateID: .combinedSessionState)
    let start = CGPoint(x: x1, y: y1)
    let end = CGPoint(x: x2, y: y2)
    CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: start, mouseButton: .left)?
        .post(tap: .cghidEventTap)
    usleep(80_000)
    CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: start, mouseButton: .left)?
        .post(tap: .cghidEventTap)
    for step in 1...12 {
        let ratio = Double(step) / 12.0
        let point = CGPoint(x: x1 + (x2 - x1) * ratio, y: y1 + (y2 - y1) * ratio)
        CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: point, mouseButton: .left)?
            .post(tap: .cghidEventTap)
        usleep(25_000)
    }
    CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: end, mouseButton: .left)?
        .post(tap: .cghidEventTap)
    json(["ok": true, "action": "drag", "from": [x1, y1], "to": [x2, y2]])
case "key":
    guard args.count >= 3 else { failure("key 需要组合键") }
    activate(app, axApp)
    keyEvent(args[2])
    json(["ok": true, "action": "key", "combo": args[2]])
case "paste":
    guard args.count >= 3, let value = decodeBase64(args[2]) else { failure("文本参数不是 base64") }
    activate(app, axApp)
    pasteText(value)
    json(["ok": true, "action": "paste"])
default:
    failure("未知命令: \(args[1])")
}
