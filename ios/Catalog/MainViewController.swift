import UIKit
import WebKit

/// The whole app: Catalog's pages from the computer, and YouTube laid over them when it's opened.
///
/// YouTube here is YouTube's own mobile website, loaded straight from YouTube like any browser
/// does, so it's the real thing (accounts, subscriptions, Shorts, comments). Catalog only adds its
/// no-ads script at the top of each page (WebViews.youtube). Closing YouTube hides it; it's still
/// where it was left the next time.
final class MainViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
	private let holder = UIView()
	private var catalog: WKWebView!
	private var youtube: WKWebView?
	private var notice: UIView?
	private var askedForAddress = false
	/// Catalog failed to load while YouTube was over it: loaded again when YouTube closes.
	private var catalogFailed = false

	private var catalogColor: UIColor = Look.surface
	private var youtubeColor: UIColor = .systemBackground

	private var youtubeShowing: Bool {
		guard let youtube = youtube else { return false }
		return !youtube.isHidden
	}

	override var preferredStatusBarStyle: UIStatusBarStyle {
		let behind = youtubeShowing ? youtubeColor : catalogColor
		return Look.isDark(behind, in: traitCollection) ? .lightContent : .darkContent
	}

	override func viewDidLoad() {
		super.viewDidLoad()
		view.backgroundColor = catalogColor

		// The pages sit inside the screen's safe part (below the clock, above the Home bar); the
		// strips around them take the page's own color.
		holder.translatesAutoresizingMaskIntoConstraints = false
		view.addSubview(holder)
		let safe = view.safeAreaLayoutGuide
		NSLayoutConstraint.activate([
			holder.topAnchor.constraint(equalTo: safe.topAnchor),
			holder.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
			holder.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
			holder.trailingAnchor.constraint(equalTo: safe.trailingAnchor)
		])

		catalog = WebViews.catalog(listener: self)
		catalog.navigationDelegate = self
		catalog.uiDelegate = self
		fill(holder, with: catalog)

		NotificationCenter.default.addObserver(self, selector: #selector(cameBack), name: UIApplication.didBecomeActiveNotification, object: nil)

		if Store.address != nil { loadCatalog() }
	}

	override func viewDidAppear(_ animated: Bool) {
		super.viewDidAppear(animated)
		if Store.address == nil && !askedForAddress {
			askedForAddress = true
			showSetup(first: true)
		}
		// For the builder's test run only (ios/try-simulator.sh): YouTube at once, to take its picture.
		if UserDefaults.standard.bool(forKey: "openYouTubeAtStart") && youtube == nil {
			openYouTube(nil)
		}
	}

	private func fill(_ parent: UIView, with child: UIView) {
		child.translatesAutoresizingMaskIntoConstraints = false
		parent.addSubview(child)
		NSLayoutConstraint.activate([
			child.topAnchor.constraint(equalTo: parent.topAnchor),
			child.bottomAnchor.constraint(equalTo: parent.bottomAnchor),
			child.leadingAnchor.constraint(equalTo: parent.leadingAnchor),
			child.trailingAnchor.constraint(equalTo: parent.trailingAnchor)
		])
	}

	/* ------------------------------------------------------------------ Catalog */

	private func loadCatalog() {
		guard let address = Store.address else { return }
		catalogFailed = false
		hideNotice()
		catalog.load(URLRequest(url: address))
	}

	/// The first-time screen (and "Connect to another computer" from Settings → Phones).
	private func showSetup(first: Bool) {
		if presentedViewController != nil { return }
		let setup = SetupViewController()
		setup.canCancel = !first
		setup.modalPresentationStyle = .fullScreen
		setup.onDone = { [weak self] address in
			Store.address = address
			self?.dismiss(animated: true)
			self?.closeYouTube()
			self?.loadCatalog()
		}
		present(setup, animated: !first)
	}

	/* ------------------------------------------------------------------ YouTube */

	private func openYouTube(_ url: URL?) {
		let web: WKWebView
		if let have = youtube {
			web = have
		} else {
			web = WebViews.youtube(listener: self)
			web.navigationDelegate = self
			web.uiDelegate = self
			fill(holder, with: web)
			youtube = web
		}
		// A particular video or channel is opened; plain "YouTube" shows it as it was left.
		if let url = url, !Hosts.isYouTubeHome(url) {
			web.load(URLRequest(url: url))
		} else if web.url == nil {
			web.load(URLRequest(url: WebViews.youtubeHome))
		}
		web.isHidden = false
		holder.bringSubviewToFront(web)
		if let notice = notice { holder.bringSubviewToFront(notice) }
		applyLook()
	}

	private func closeYouTube() {
		guard let web = youtube, !web.isHidden else { return }
		web.evaluateJavaScript("document.querySelectorAll('video').forEach(function (v) { v.pause(); })", completionHandler: nil)
		web.isHidden = true
		hideNotice()
		applyLook()
		if catalogFailed { loadCatalog() }
	}

	/* ------------------------------------------------------------------ the look */

	private func applyLook() {
		view.backgroundColor = youtubeShowing ? youtubeColor : catalogColor
		setNeedsStatusBarAppearanceUpdate()
	}

	/// The strips around the page take the page's own background color.
	private func matchColor(of web: WKWebView) {
		let ask = "(function () { var see = function (e) { var c = e ? getComputedStyle(e).backgroundColor : ''; "
			+ "return /rgba\\(.*, 0\\)$/.test(c) || c === 'transparent' ? '' : c; }; "
			+ "return see(document.body) || see(document.documentElement) || ''; })()"
		web.evaluateJavaScript(ask) { [weak self] value, _ in
			guard let self = self, let text = value as? String, let color = Look.color(css: text) else { return }
			if web === self.catalog { self.catalogColor = color } else { self.youtubeColor = color }
			self.applyLook()
		}
	}

	@objc private func cameBack() {
		matchColor(of: catalog)
		if let youtube = youtube { matchColor(of: youtube) }
	}

	/* ------------------------------------------------------------------ a page that won't load */

	private func showNotice(_ text: String, retry: @escaping () -> Void, otherTitle: String, other: @escaping () -> Void, youtubeToo: Bool = false) {
		hideNotice()
		let box = UIView()
		box.backgroundColor = youtubeShowing ? youtubeColor : catalogColor

		let label = UILabel()
		label.text = text
		label.numberOfLines = 0
		label.textAlignment = .center
		label.textColor = .label
		label.font = .preferredFont(forTextStyle: .body)

		let againButton = Look.button("Try again", .main, onTap: retry)
		let secondButton = Look.button(otherTitle, .second, onTap: other)

		let stack = UIStackView(arrangedSubviews: [label, againButton, secondButton])
		if youtubeToo {
			// YouTube comes straight from YouTube, so it works with the computer off.
			stack.addArrangedSubview(Look.button("Open YouTube", .second) { [weak self] in
				self?.hideNotice()
				self?.catalogFailed = true
				self?.openYouTube(nil)
			})
		}
		stack.axis = .vertical
		stack.spacing = 14
		stack.translatesAutoresizingMaskIntoConstraints = false
		box.addSubview(stack)
		NSLayoutConstraint.activate([
			stack.centerYAnchor.constraint(equalTo: box.centerYAnchor),
			stack.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 28),
			stack.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -28)
		])
		fill(holder, with: box)
		notice = box
	}

	private func hideNotice() {
		notice?.removeFromSuperview()
		notice = nil
	}

	private func couldNotLoad(_ web: WKWebView, _ error: Error) {
		let problem = error as NSError
		// A load that was stopped on purpose (another page asked for, or handed to YouTube / Safari).
		if problem.domain == NSURLErrorDomain && problem.code == NSURLErrorCancelled { return }
		if problem.domain == "WebKitErrorDomain" && problem.code == 102 { return }
		if web === catalog {
			if youtubeShowing {
				catalogFailed = true
				return
			}
			let place = Store.address?.absoluteString ?? "the computer"
			showNotice(
				"Couldn't reach Catalog at \(place).\n\nIs Catalog open on the computer, and is this phone on the same Wi-Fi, or is Tailscale on?",
				retry: { [weak self] in self?.loadCatalog() },
				otherTitle: "Another address",
				other: { [weak self] in self?.showSetup(first: false) },
				youtubeToo: true
			)
		} else if youtubeShowing {
			showNotice(
				"YouTube couldn't be reached.",
				retry: { [weak self] in
					self?.hideNotice()
					guard let web = self?.youtube else { return }
					if web.url != nil { web.reload() } else { web.load(URLRequest(url: WebViews.youtubeHome)) }
				},
				otherTitle: "Back to Catalog",
				other: { [weak self] in self?.closeYouTube() }
			)
		}
	}

	/* ------------------------------------------------------------------ messages from the pages */

	func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
		guard message.name == WebViews.messages, message.frameInfo.isMainFrame, let text = message.body as? String else { return }
		if message.webView === catalog {
			// From Catalog's own pages (src/lib/phoneApp.ts).
			if text == "youtube" { openYouTube(nil) }
			if text == "setup" { showSetup(first: false) }
		} else if message.webView === youtube {
			// The pink circle beside YouTube's logo (youtube-phone.js).
			if text == "close" { closeYouTube() }
		}
	}

	/* ------------------------------------------------------------------ where each link goes */

	/// True when the page may go there itself; false when it was sent somewhere else instead.
	private func staysHere(_ url: URL, in web: WKWebView) -> Bool {
		let host = (url.host ?? "").lowercased()
		if web === catalog {
			if Hosts.isYouTube(host) {
				openYouTube(url)
				return false
			}
			// Anything that isn't Catalog itself (IMDb, a streaming service) opens in Safari.
			if host != (Store.address?.host ?? "").lowercased() {
				UIApplication.shared.open(url, options: [:], completionHandler: nil)
				return false
			}
			return true
		}
		// YouTube keeps YouTube and Google's sign-in pages; a link out of YouTube opens in Safari.
		if Hosts.isYouTube(host) || Hosts.isGoogle(host) { return true }
		UIApplication.shared.open(url, options: [:], completionHandler: nil)
		return false
	}

	// (Written the "async" way on purpose: with the older decisionHandler way, a newer Xcode can
	// decide the function no longer matches and quietly never call it.)
	func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
		guard let url = navigationAction.request.url else { return .allow }
		let scheme = (url.scheme ?? "").lowercased()
		if scheme != "http" && scheme != "https" {
			// The page's own business (blank frames, files it made itself).
			if scheme == "about" || scheme == "blob" || scheme == "data" { return .allow }
			// "Open in the YouTube app" and the like go nowhere; phone numbers and mail still work.
			if scheme == "tel" || scheme == "mailto" || scheme == "sms" {
				UIApplication.shared.open(url, options: [:], completionHandler: nil)
			}
			return .cancel
		}
		let wholePage = navigationAction.targetFrame?.isMainFrame ?? true
		if !wholePage { return .allow }
		return staysHere(url, in: webView) ? .allow : .cancel
	}

	/// A link that asks for a new tab: there are no tabs, so it opens in place (or where it belongs).
	func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
		if let url = navigationAction.request.url {
			let scheme = (url.scheme ?? "").lowercased()
			if (scheme == "http" || scheme == "https") && staysHere(url, in: webView) {
				webView.load(URLRequest(url: url))
			}
		}
		return nil
	}

	func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
		if webView === catalog || youtubeShowing { hideNotice() }
		matchColor(of: webView)
	}

	func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
		couldNotLoad(webView, error)
	}

	/// iOS closed the page to free memory (it does this to pages left in the background).
	func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
		if webView === catalog {
			if webView.url != nil { webView.reload() } else { loadCatalog() }
		} else if webView.url != nil {
			webView.reload()
		} else {
			webView.load(URLRequest(url: WebViews.youtubeHome))
		}
	}

	/* ------------------------------------------------------------------ a page's own pop-up questions */

	func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {
		if presentedViewController != nil || view.window == nil { return }
		await withCheckedContinuation { (answered: CheckedContinuation<Void, Never>) in
			let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
			alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in answered.resume() })
			self.present(alert, animated: true)
		}
	}

	func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool {
		if presentedViewController != nil || view.window == nil { return false }
		return await withCheckedContinuation { (answered: CheckedContinuation<Bool, Never>) in
			let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
			alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in answered.resume(returning: false) })
			alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in answered.resume(returning: true) })
			self.present(alert, animated: true)
		}
	}
}
