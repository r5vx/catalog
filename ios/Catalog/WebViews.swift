import UIKit
import WebKit

/// The app's two pages: Catalog (from the computer), and YouTube (YouTube's own mobile website,
/// straight from YouTube, with Catalog's no-ads script on top).
@MainActor
enum WebViews {
	static let youtubeHome = URL(string: "https://m.youtube.com/")!

	/// How Catalog's pages know they're inside this app (src/lib/phoneApp.ts looks for it).
	static let appMark = "CatalogPhone/1"

	/// The name pages take messages under: window.webkit.messageHandlers.catalog.postMessage("…")
	static let messages = "catalog"

	/// The app's pages are drawn by the same engine as Safari, so they say so the way Safari does
	/// (an app's web view leaves this part out, and sites then send a cut-down page).
	private static var safariName: String {
		let parts = UIDevice.current.systemVersion.split(separator: ".").map { String($0) }
		let major = parts.first ?? "17"
		let minor = parts.count > 1 ? parts[1] : "0"
		return "Version/\(major).\(minor) Mobile/15E148 Safari/604.1"
	}

	private static func settings() -> WKWebViewConfiguration {
		let config = WKWebViewConfiguration()
		config.allowsInlineMediaPlayback = true
		config.mediaTypesRequiringUserActionForPlayback = []
		config.allowsPictureInPictureMediaPlayback = true
		config.allowsAirPlayForMediaPlayback = true
		config.defaultWebpagePreferences.preferredContentMode = .mobile
		if #available(iOS 15.4, *) {
			// Lets a page's own fullscreen button fill the screen (Catalog's player, YouTube's).
			config.preferences.isElementFullscreenEnabled = true
		}
		return config
	}

	private static func view(_ config: WKWebViewConfiguration) -> WKWebView {
		let web = WKWebView(frame: .zero, configuration: config)
		web.translatesAutoresizingMaskIntoConstraints = false
		web.allowsBackForwardNavigationGestures = true
		// See-through until the page has drawn, so there's no white flash over a dark page.
		web.isOpaque = false
		web.backgroundColor = .clear
		web.scrollView.backgroundColor = .clear
		web.scrollView.contentInsetAdjustmentBehavior = .never
		return web
	}

	static func catalog(listener: WKScriptMessageHandler) -> WKWebView {
		let config = settings()
		config.applicationNameForUserAgent = safariName + " " + appMark
		config.userContentController.add(listener, name: messages)
		return view(config)
	}

	static func youtube(listener: WKScriptMessageHandler) -> WKWebView {
		let config = settings()
		config.applicationNameForUserAgent = safariName
		let scripts = config.userContentController
		// Before any of YouTube's own scripts, on every page of it:
		// youtube-tv.js is the same file the computer and the Fire TV use (android/assets), which
		// asks for videos without ads; youtube-phone.js adds the pink circle back to Catalog.
		for name in ["youtube-tv", "youtube-phone"] {
			guard let file = Bundle.main.url(forResource: name, withExtension: "js"),
				let source = try? String(contentsOf: file, encoding: .utf8) else { continue }
			scripts.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
		}
		scripts.add(listener, name: messages)
		return view(config)
	}
}

/// Which addresses belong where.
enum Hosts {
	private static func within(_ host: String, _ names: [String]) -> Bool {
		for name in names where host == name || host.hasSuffix("." + name) { return true }
		return false
	}

	static func isYouTube(_ host: String) -> Bool {
		return within(host, ["youtube.com", "youtu.be", "youtube-nocookie.com"])
	}

	/// Google's own pages YouTube sends people through (signing in, the cookie question).
	static func isGoogle(_ host: String) -> Bool {
		if within(host, ["google.com", "gstatic.com", "googleusercontent.com", "withgoogle.com"]) { return true }
		return host.hasPrefix("accounts.google.") || host.hasPrefix("consent.google.") || host.hasPrefix("myaccount.google.")
	}

	/// YouTube's front page with nothing asked for: opening it again shows YouTube as it was left.
	static func isYouTubeHome(_ url: URL) -> Bool {
		return (url.path.isEmpty || url.path == "/") && (url.query ?? "").isEmpty
	}
}
