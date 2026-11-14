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

	/// The address without any page on the end: http://192.168.1.20:4173
	static func home(of address: URL) -> URL? {
		guard var parts = URLComponents(url: address, resolvingAgainstBaseURL: false) else { return nil }
		parts.path = ""
		parts.query = nil
		parts.fragment = nil
		return parts.url
	}

	/* Catalog's no-connection page (static/offline.html: it lists and plays what's kept on this
	   phone). A copy is saved whenever Catalog is reached, so the app can show it when it isn't. */

	private static var offlineFile: URL? {
		guard let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
		try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
		return folder.appendingPathComponent("offline.html")
	}

	static var offlinePage: String? {
		guard let file = offlineFile else { return nil }
		return try? String(contentsOf: file, encoding: .utf8)
	}

	static func keepOfflinePage(from address: URL) {
		guard let home = home(of: address), let file = offlineFile else { return }
		var request = URLRequest(url: home.appendingPathComponent("offline.html"))
		request.timeoutInterval = 15
		request.cachePolicy = .reloadIgnoringLocalCacheData
		URLSession.shared.dataTask(with: request) { data, response, _ in
			// Only the real page (a sign-in page or an error would be no use with no connection).
			guard (response as? HTTPURLResponse)?.statusCode == 200, let data = data,
				let text = String(data: data, encoding: .utf8), text.contains("catalog:keptPlaces") else { return }
			try? data.write(to: file, options: .atomic)
		}.resume()
	}

	/* The app's diary: one line per thing worth knowing later (a download starting, failing…).
	   Kept small, in the app's own throwaway folder; ios/try-simulator.sh prints it. */

	private static var diaryFile: URL? {
		return FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("catalog-app.log")
	}

	static func note(_ line: String) {
		guard let file = diaryFile else { return }
		var text = (try? String(contentsOf: file, encoding: .utf8)) ?? ""
		if text.count > 40000 { text = String(text.suffix(20000)) }
		text += "\(Date()) \(line)\n"
		try? text.write(to: file, atomically: true, encoding: .utf8)
	}

	/// Whether Catalog answers at this address (its diagnostics page answers even behind the PIN).
	static func check(_ address: URL, done: @escaping (Bool) -> Void) {
		var request = URLRequest(url: (home(of: address) ?? address).appendingPathComponent("api/diagnostics"))
		request.timeoutInterval = 6
		request.cachePolicy = .reloadIgnoringLocalCacheData
		URLSession.shared.dataTask(with: request) { _, response, _ in
			let ok = (response as? HTTPURLResponse)?.statusCode == 200
			DispatchQueue.main.async { done(ok) }
		}.resume()
	}
}
