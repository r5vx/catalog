package app.catalog.tv;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Catalog on a TV: Catalog's own pages, from the computer running Catalog in the same house,
 * shown full screen, with the remote driving them.
 *
 * Four jobs on top of showing the pages:
 *  - Finding that computer. It answers a "CATALOG_DISCOVER" broadcast on UDP 41734
 *    (electron/main.cjs); the setup screen (assets/setup.html) asks through `CatalogTV`.
 *  - Video. Febbox's video servers only serve a page that says it's Febbox (the Referer),
 *    which is what the desktop app does too. Requests that leave the house get that
 *    header added here, and are allowed back into the page.
 *  - The remote. Back goes back; play/pause and fast-forward/rewind reach the player.
 *  - Full screen. The player's full-screen button asks the page to fill the TV.
 */
public class MainActivity extends Activity {
	private static final String PREFS = "catalog";
	private static final String KEY_SERVER = "server";
	private static final int DISCOVERY_PORT = 41734;
	private static final String SETUP_PAGE = "file:///android_asset/setup.html";

	private WebView web;
	private FrameLayout root;
	private View fullscreenView;
	private WebChromeClient.CustomViewCallback fullscreenDone;
	/** "http://192.168.1.23:4173" — requests there are Catalog's own and are left alone. */
	private volatile String serverOrigin;

	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

		root = new FrameLayout(this);
		root.setBackgroundColor(Color.parseColor("#111614"));
		web = new WebView(this);
		root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
		setContentView(root);

		WebSettings settings = web.getSettings();
		settings.setJavaScriptEnabled(true);
		settings.setDomStorageEnabled(true);
		settings.setMediaPlaybackRequiresUserGesture(false);
		settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
		settings.setLoadWithOverviewMode(true);
		settings.setUseWideViewPort(true);
		// Catalog switches to its TV layout and remote controls when it sees this.
		settings.setUserAgentString(settings.getUserAgentString() + " CatalogTV/1");

		web.setBackgroundColor(Color.parseColor("#111614"));
		web.setWebViewClient(new Pages());
		web.setWebChromeClient(new FullScreen());
		web.addJavascriptInterface(new Bridge(), "CatalogTV");

		String saved = prefs().getString(KEY_SERVER, null);
		if (saved != null) open(saved);
		else web.loadUrl(SETUP_PAGE);
	}

	private SharedPreferences prefs() {
		return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
	}

	private void open(String url) {
		Uri uri = Uri.parse(url);
		serverOrigin = uri.getScheme() + "://" + uri.getAuthority();
		web.loadUrl(url);
	}

	/* ------------------------------------------------------------ pages and video */

	private class Pages extends WebViewClient {
		@Override
		public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
			if (!"GET".equals(request.getMethod()) || request.isForMainFrame()) return null;
			String url = request.getUrl().toString();
			if (!url.startsWith("http")) return null;
			String origin = serverOrigin;
			if (origin != null && url.startsWith(origin)) return null;
			if (!looksLikeVideo(request)) return null;
			try {
				return asFebbox(request);
			} catch (Exception e) {
				return null; // let the page try it as normal
			}
		}

		@Override
		public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
			// The computer is off, or its address changed: back to setup, saying so.
			if (request.isForMainFrame() && !request.getUrl().toString().startsWith("file:")) {
				String tried = prefs().getString(KEY_SERVER, "");
				view.loadUrl(SETUP_PAGE + "?unreachable=" + Uri.encode(tried));
			}
		}
	}

	/** Posters, fonts and the like don't care who's asking; video and playlists do. */
	private static boolean looksLikeVideo(WebResourceRequest request) {
		String host = request.getUrl().getHost();
		if (host == null) return false;
		if (host.endsWith("tmdb.org") || host.endsWith("anilist.co") || host.endsWith("googleapis.com")
				|| host.endsWith("gstatic.com") || host.endsWith("aniskip.com")) return false;
		Map<String, String> headers = request.getRequestHeaders();
		String accept = headers == null ? null : headers.get("Accept");
		return accept == null || !(accept.startsWith("image/") || accept.startsWith("text/css") || accept.contains("text/html"));
	}

	/** Fetches it with Febbox as the asking page, and lets the Catalog page read the answer. */
	private WebResourceResponse asFebbox(WebResourceRequest request) throws Exception {
		HttpURLConnection conn = (HttpURLConnection) new URL(request.getUrl().toString()).openConnection();
		conn.setInstanceFollowRedirects(true);
		conn.setConnectTimeout(15000);
		conn.setReadTimeout(30000);
		Map<String, String> asked = request.getRequestHeaders();
		if (asked != null) {
			for (Map.Entry<String, String> h : asked.entrySet()) {
				String name = h.getKey();
				if (name.equalsIgnoreCase("Referer") || name.equalsIgnoreCase("Origin") || name.equalsIgnoreCase("Host")) continue;
				conn.setRequestProperty(name, h.getValue());
			}
		}
		conn.setRequestProperty("Referer", "https://www.febbox.com/");
		conn.setRequestProperty("Origin", "https://www.febbox.com");

		int status = conn.getResponseCode();
		Map<String, String> headers = new HashMap<>();
		for (Map.Entry<String, List<String>> h : conn.getHeaderFields().entrySet()) {
			if (h.getKey() == null || h.getValue().isEmpty()) continue;
			String name = h.getKey();
			if (name.toLowerCase().startsWith("access-control-")) continue;
			headers.put(name, h.getValue().get(0));
		}
		String origin = serverOrigin;
		headers.put("Access-Control-Allow-Origin", origin != null ? origin : "*");
		headers.put("Access-Control-Allow-Credentials", "true");

		String type = conn.getContentType();
		String mime = "application/octet-stream";
		String charset = null;
		if (type != null) {
			String[] parts = type.split(";");
			mime = parts[0].trim();
			for (String part : parts) {
				part = part.trim();
				if (part.toLowerCase().startsWith("charset=")) charset = part.substring(8);
			}
		}
		InputStream body = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
		// Android only accepts 1xx/2xx/4xx/5xx here; redirects were already followed.
		if (status >= 300 && status < 400) status = 200;
		String reason = conn.getResponseMessage();
		if (reason == null || reason.isEmpty()) reason = status < 400 ? "OK" : "Error";
		return new WebResourceResponse(mime, charset, status, reason, headers, body);
	}

	/* ------------------------------------------------------------ full screen */

	private class FullScreen extends WebChromeClient {
		@Override
		public void onShowCustomView(View view, CustomViewCallback callback) {
			if (fullscreenView != null) {
				callback.onCustomViewHidden();
				return;
			}
			fullscreenView = view;
			fullscreenDone = callback;
			root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
		}

		@Override
		public void onHideCustomView() {
			if (fullscreenView == null) return;
			root.removeView(fullscreenView);
			fullscreenView = null;
			if (fullscreenDone != null) fullscreenDone.onCustomViewHidden();
			fullscreenDone = null;
		}
	}

	/* ------------------------------------------------------------ the remote */

	@Override
	public boolean dispatchKeyEvent(KeyEvent event) {
		int code = event.getKeyCode();
		boolean down = event.getAction() == KeyEvent.ACTION_DOWN;

		if (code == KeyEvent.KEYCODE_BACK) {
			if (!down) return true;
			if (fullscreenView != null) {
				web.evaluateJavascript("document.exitFullscreen && document.exitFullscreen()", null);
				return true;
			}
			if (web.canGoBack()) web.goBack();
			else finish();
			return true;
		}

		String call = null;
		switch (code) {
			case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
			case KeyEvent.KEYCODE_MEDIA_PLAY:
			case KeyEvent.KEYCODE_MEDIA_PAUSE:
				call = "playPause()";
				break;
			case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
				call = "seek(30)";
				break;
			case KeyEvent.KEYCODE_MEDIA_REWIND:
				call = "seek(-30)";
				break;
			case KeyEvent.KEYCODE_MENU:
				call = "menu()";
				break;
		}
		if (call != null) {
			if (down) web.evaluateJavascript("window.__catalogTv && window.__catalogTv." + call, null);
			return true;
		}
		return super.dispatchKeyEvent(event);
	}

	@Override
	protected void onPause() {
		super.onPause();
		// Leaving the app pauses whatever was playing.
		web.evaluateJavascript("document.querySelectorAll('video').forEach(function (v) { v.pause(); })", null);
	}

	/* ------------------------------------------------------------ for setup.html */

	private class Bridge {
		/** Computers on this Wi-Fi running Catalog, as JSON: [{"name": "...", "url": "http://..."}]. */
		@JavascriptInterface
		public String discover() {
			Set<String> found = new LinkedHashSet<>();
			StringBuilder json = new StringBuilder("[");
			WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
			WifiManager.MulticastLock lock = wifi != null ? wifi.createMulticastLock("catalog") : null;
			try {
				if (lock != null) lock.acquire();
			} catch (Exception e) {
				lock = null; // looking still works on most TVs without it
			}
			try (DatagramSocket socket = new DatagramSocket()) {
				socket.setBroadcast(true);
				socket.setSoTimeout(600);
				byte[] ask = "CATALOG_DISCOVER".getBytes(StandardCharsets.UTF_8);
				for (InetAddress target : broadcastAddresses(wifi)) {
					socket.send(new DatagramPacket(ask, ask.length, target, DISCOVERY_PORT));
				}
				long until = System.currentTimeMillis() + 2500;
				byte[] buffer = new byte[2048];
				while (System.currentTimeMillis() < until) {
					DatagramPacket reply = new DatagramPacket(buffer, buffer.length);
					try {
						socket.receive(reply);
					} catch (SocketTimeoutException e) {
						continue;
					}
					String text = new String(reply.getData(), 0, reply.getLength(), StandardCharsets.UTF_8);
					// {"app":"catalog","name":"Mum's laptop","port":4173}
					if (!text.contains("\"app\":\"catalog\"")) continue;
					String name = pick(text, "name");
					String port = pickNumber(text, "port");
					String url = "http://" + reply.getAddress().getHostAddress() + ":" + (port != null ? port : "4173");
					if (found.add(url)) {
						if (json.length() > 1) json.append(',');
						json.append("{\"name\":").append(quote(name != null ? name : "Catalog"))
							.append(",\"url\":").append(quote(url)).append('}');
					}
				}
			} catch (Exception ignored) {
				// No Wi-Fi, or broadcasts blocked: the setup page offers typing the address.
			} finally {
				if (lock != null && lock.isHeld()) lock.release();
			}
			return json.append(']').toString();
		}

		@JavascriptInterface
		public void connect(final String url) {
			prefs().edit().putString(KEY_SERVER, url).apply();
			runOnUiThread(new Runnable() {
				public void run() {
					open(url);
				}
			});
		}

		/** Back to choosing a computer (from Catalog's settings on the TV). */
		@JavascriptInterface
		public void forget() {
			prefs().edit().remove(KEY_SERVER).apply();
			runOnUiThread(new Runnable() {
				public void run() {
					serverOrigin = null;
					web.loadUrl(SETUP_PAGE);
				}
			});
		}

		@JavascriptInterface
		public String saved() {
			return prefs().getString(KEY_SERVER, "");
		}
	}

	/** The Wi-Fi's own broadcast address, plus the everyone-address as a fallback. */
	private static Set<InetAddress> broadcastAddresses(WifiManager wifi) throws Exception {
		Set<InetAddress> out = new LinkedHashSet<>();
		if (wifi != null && wifi.getDhcpInfo() != null) {
			int ip = wifi.getDhcpInfo().ipAddress;
			int mask = wifi.getDhcpInfo().netmask;
			if (ip != 0 && mask != 0) {
				int broadcast = (ip & mask) | ~mask;
				byte[] quads = new byte[4];
				for (int k = 0; k < 4; k++) quads[k] = (byte) ((broadcast >> (k * 8)) & 0xFF);
				out.add(InetAddress.getByAddress(quads));
			}
		}
		out.add(InetAddress.getByName("255.255.255.255"));
		return out;
	}

	private static String pick(String json, String key) {
		String marker = "\"" + key + "\":\"";
		int at = json.indexOf(marker);
		if (at < 0) return null;
		int start = at + marker.length();
		int end = json.indexOf('"', start);
		return end < 0 ? null : json.substring(start, end);
	}

	private static String pickNumber(String json, String key) {
		String marker = "\"" + key + "\":";
		int at = json.indexOf(marker);
		if (at < 0) return null;
		int start = at + marker.length();
		int end = start;
		while (end < json.length() && Character.isDigit(json.charAt(end))) end++;
		return end > start ? json.substring(start, end) : null;
	}

	private static String quote(String text) {
		return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
	}
}
