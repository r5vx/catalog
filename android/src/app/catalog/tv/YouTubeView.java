package app.catalog.tv;

import android.app.Activity;
import android.graphics.Color;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * YouTube on the TV: YouTube's own TV app (the one smart TVs have, at youtube.com/tv), shown full
 * screen over Catalog, with everything it has (accounts, subscriptions, search, Shorts, live).
 * Catalog only adds assets/youtube-tv.js at the top of its page, which takes the ads out (that
 * file says how).
 *
 * YouTube is told this is a Samsung TV: as a Fire TV it expects Amazon's own YouTube engine and
 * won't play anything in a web view ("This video format is not supported", 2026-11-03). A 2023
 * Samsung (Tizen 8): the 2021 one (Tizen 6.5) got "This device no longer fully supports YouTube"
 * once signed in (2026-11-04).
 *
 * The remote: everything goes to YouTube, which handles arrows, OK, play/pause, rewind and
 * fast-forward itself, as in the real YouTube app. Back is YouTube's Back too (see key()); YouTube
 * exiting returns to Catalog, and so does holding Back.
 */
final class YouTubeView {
	static final String HOME = "https://www.youtube.com/tv";
	static final String AGENT = "Mozilla/5.0 (SMART-TV; LINUX; Tizen 8.0) AppleWebKit/537.36 (KHTML, like Gecko) 108.0.5359.1/8.0 TV Safari/537.36";

	private final Activity activity;
	private final FrameLayout root;
	private final Runnable onClosed;
	private WebView view;
	private String script;

	YouTubeView(Activity activity, FrameLayout root, Runnable onClosed) {
		this.activity = activity;
		this.root = root;
		this.onClosed = onClosed;
	}

	boolean showing() {
		return view != null;
	}

	void open() {
		if (view != null) return;
		script = readScript();
		view = new WebView(activity);
		view.setBackgroundColor(Color.BLACK);
		WebSettings settings = view.getSettings();
		settings.setJavaScriptEnabled(true);
		settings.setDomStorageEnabled(true);
		settings.setMediaPlaybackRequiresUserGesture(false);
		settings.setUserAgentString(AGENT);
		CookieManager.getInstance().setAcceptCookie(true);
		CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);
		view.setWebViewClient(new Pages());
		view.addJavascriptInterface(new Bridge(), "CatalogYouTube");
		root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
		view.setFocusable(true);
		view.requestFocus(View.FOCUS_DOWN);
		view.loadUrl(HOME);
	}

	/** Back to Catalog. YouTube is closed for good (it loads again in a few seconds next time). */
	void close() {
		if (view == null) return;
		WebView closing = view;
		view = null;
		CookieManager.getInstance().flush();
		closing.evaluateJavascript("document.querySelectorAll('video').forEach(function (v) { v.pause(); })", null);
		root.removeView(closing);
		closing.destroy();
		onClosed.run();
	}

	/** When Back went down (held a second: out to Catalog whatever YouTube shows). */
	private long backDownAt = 0;

	/**
	 * The remote while YouTube is showing: true when handled here, false to pass it to YouTube.
	 *
	 * Back is always YouTube's own (Escape to its page), as in the real YouTube app: out of a video,
	 * to Home, to its account screen, and from there YouTube itself exits, which closes it back to
	 * Catalog (its window.close, see Bridge). Before 2026-11-06 Back left YouTube whenever the address
	 * was "#/", but YouTube's TV app keeps "#/" on nearly every screen, so Back could drop out of
	 * YouTube where the real app goes back a step. Holding Back for a second always leaves.
	 */
	boolean key(KeyEvent event) {
		if (view == null) return false;
		if (event.getKeyCode() != KeyEvent.KEYCODE_BACK) return false;
		if (event.getAction() != KeyEvent.ACTION_DOWN) return true;
		long now = System.currentTimeMillis();
		if (event.getRepeatCount() == 0) {
			backDownAt = now;
			view.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ESCAPE));
			view.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ESCAPE));
		} else if (backDownAt > 0 && now - backDownAt >= 1000) {
			backDownAt = 0;
			close();
		}
		return true;
	}

	/** Left the TV app (Home button): whatever plays stops. */
	void pause() {
		if (view != null) view.evaluateJavascript("document.querySelectorAll('video').forEach(function (v) { v.pause(); })", null);
	}

	private String readScript() {
		try (InputStream in = activity.getAssets().open("youtube-tv.js")) {
			return new String(readAll(in), StandardCharsets.UTF_8);
		} catch (Exception e) {
			return "";
		}
	}

	private static byte[] readAll(InputStream in) throws Exception {
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		byte[] buffer = new byte[16384];
		int n;
		while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
		return out.toByteArray();
	}

	private class Bridge {
		/** YouTube closing itself (its own "exit" choice). */
		@JavascriptInterface
		public void close() {
			activity.runOnUiThread(new Runnable() {
				public void run() {
					YouTubeView.this.close();
				}
			});
		}
	}

	private class Pages extends WebViewClient {
		/**
		 * YouTube's TV page itself is fetched here, so Catalog's script can go in at the very top,
		 * before any of YouTube's own (they read the formats and ads the moment they start). Its
		 * cookies (the sign-in) go through Android's cookie store both ways, as the web view's own
		 * requests do.
		 */
		@Override
		public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
			if (!request.isForMainFrame() || !"GET".equals(request.getMethod())) return null;
			String host = request.getUrl().getHost();
			String path = request.getUrl().getPath();
			if (!"www.youtube.com".equals(host) || path == null || !path.startsWith("/tv")) return null;
			try {
				return withScript(request);
			} catch (Exception e) {
				return null; // the web view loads it as normal; onPageStarted still adds the script
			}
		}

		@Override
		public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
			// In case the page came without it (a redirect, or the fetch above failed): as early as
			// possible. The script does nothing a second time.
			if (script != null && !script.isEmpty()) v.evaluateJavascript(script, null);
		}

		@Override
		public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
			return false; // YouTube and Google's sign-in pages stay in this view
		}
	}

	private WebResourceResponse withScript(WebResourceRequest request) throws Exception {
		String url = request.getUrl().toString();
		HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
		conn.setInstanceFollowRedirects(false);
		conn.setConnectTimeout(15000);
		conn.setReadTimeout(30000);
		Map<String, String> asked = request.getRequestHeaders();
		if (asked != null) {
			for (Map.Entry<String, String> h : asked.entrySet()) {
				// (Asking for it compressed would leave it compressed: Android only unpacks what it asked for.)
				if (h.getKey().equalsIgnoreCase("Cookie") || h.getKey().equalsIgnoreCase("Accept-Encoding")) continue;
				conn.setRequestProperty(h.getKey(), h.getValue());
			}
		}
		conn.setRequestProperty("User-Agent", AGENT);
		String cookies = CookieManager.getInstance().getCookie(url);
		if (cookies != null) conn.setRequestProperty("Cookie", cookies);

		int status = conn.getResponseCode();
		if (status < 200 || status >= 300) {
			conn.disconnect();
			return null;
		}
		Map<String, String> headers = new HashMap<>();
		for (Map.Entry<String, List<String>> h : conn.getHeaderFields().entrySet()) {
			String name = h.getKey();
			if (name == null || h.getValue().isEmpty()) continue;
			if (name.equalsIgnoreCase("Set-Cookie")) {
				for (String c : h.getValue()) CookieManager.getInstance().setCookie(url, c);
				continue;
			}
			// (Its own rules would also stop Catalog's script; it allows page scripts anyway.)
			if (name.toLowerCase().startsWith("content-security-policy")) continue;
			if (name.equalsIgnoreCase("Content-Length") || name.equalsIgnoreCase("Content-Encoding")) continue;
			headers.put(name, h.getValue().get(0));
		}
		String html = new String(readAll(conn.getInputStream()), StandardCharsets.UTF_8);
		String tag = "<script>" + script + "</script>";
		int head = html.toLowerCase().indexOf("<head>");
		html = head >= 0 ? html.substring(0, head + 6) + tag + html.substring(head + 6) : tag + html;
		return new WebResourceResponse("text/html", "utf-8", status, "OK", headers,
			new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
	}
}
