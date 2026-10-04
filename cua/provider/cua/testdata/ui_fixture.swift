import AppKit
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let window = NSWindow(contentRect: NSRect(x: 150, y: 150, width: 420, height: 360), styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "AIC UI protocol fixture"
let text = NSTextField(frame: NSRect(x: 25, y: 100, width: 340, height: 28))
text.setAccessibilityLabel("Fixture name")
window.contentView!.addSubview(text)
class Handler: NSObject {
 var count = 0
 @objc func click(_ sender: Any?) { count += 1 }
}
let handler = Handler()
let button = NSButton(title: "Fixture save", target: handler, action: #selector(Handler.click(_:)))
button.frame = NSRect(x: 25, y: 40, width: 160, height: 32)
window.contentView!.addSubview(button)
let scroll = NSScrollView(frame: NSRect(x: 25, y: 180, width: 340, height: 150))
scroll.hasVerticalScroller = true
let document = NSTextView(frame: NSRect(x: 0, y: 0, width: 320, height: 1800))
document.isEditable = false
document.string = (1...100).map { "Fixture row \($0)" }.joined(separator: "\n")
scroll.documentView = document
scroll.setAccessibilityLabel("Fixture scroll")
window.contentView!.addSubview(scroll)
window.orderBack(nil)
// Export independent fixture geometry and effects for the live test oracle.
func normalizedPoint(_ view: NSView) -> [Double] {
 let point = view.convert(NSPoint(x: view.bounds.midX, y: view.bounds.midY), to: nil)
 return [Double(point.x / window.frame.width), Double((window.frame.height - point.y) / window.frame.height)]
}
let output = CommandLine.arguments[1]
Timer.scheduledTimer(withTimeInterval: 0.03, repeats: true) { _ in
 if let data = try? JSONSerialization.data(withJSONObject: ["value":text.stringValue, "clicks":handler.count, "scroll_y":scroll.contentView.bounds.origin.y, "points":["button":normalizedPoint(button), "scroll":normalizedPoint(scroll)]]) { try? data.write(to: URL(fileURLWithPath:output), options:.atomic) }
}
app.run()
