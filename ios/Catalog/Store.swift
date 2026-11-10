import Foundation

/// The one thing the app remembers itself: the address of the computer Catalog runs on.
/// (Sign-ins, the profile and everything else are kept by the pages, as in Safari.)
enum Store {
	private static let key = "catalogAddress"

	static var address: URL? {
		get {
			guard let text = UserDefaults.standard.string(forKey: key) else { return nil }
			return URL(string: text)
		}
		set { UserDefaults.standard.set(newValue?.absoluteString, forKey: key) }
	}

	/// What was typed or scanned, as an address:
	/// "192.168.1.20" → http://192.168.1.20:4173, "my-pc.tail1234.ts.net" → https://my-pc.tail1234.ts.net
	static func tidy(_ typed: String) -> URL? {
		var text = typed.trimmingCharacters(in: .whitespacesAndNewlines)
		if text.isEmpty { return nil }
		let lower = text.lowercased()
		let hasScheme = lower.hasPrefix("http://") || lower.hasPrefix("https://")
		if !hasScheme { text = "http://" + text }
		guard var parts = URLComponents(string: text), let host = parts.host, !host.isEmpty else { return nil }
		if !hasScheme {
			if host.lowercased().hasSuffix(".ts.net") && parts.port == nil {
				// Tailscale's secure address (Settings → Phones).
				parts.scheme = "https"
			} else if parts.port == nil {
				// The computer at home: Catalog's usual port.
				parts.port = 4173
			}
		}
		parts.path = ""
		parts.query = nil
		parts.fragment = nil
		return parts.url
	}

	/// Whether Catalog answers at this address (its diagnostics page answers even behind the PIN).
	static func check(_ address: URL, done: @escaping (Bool) -> Void) {
		var request = URLRequest(url: address.appendingPathComponent("api/diagnostics"))
		request.timeoutInterval = 6
		request.cachePolicy = .reloadIgnoringLocalCacheData
		URLSession.shared.dataTask(with: request) { _, response, _ in
			let ok = (response as? HTTPURLResponse)?.statusCode == 200
			DispatchQueue.main.async { done(ok) }
		}.resume()
	}
}
