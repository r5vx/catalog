package app.catalog.tv;

import android.app.Activity;
import android.content.Context;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Display;
import android.view.WindowManager;
import android.webkit.WebView;

/**
 * The TV's refresh rate matched to the video's frame rate, as Netflix does.
 *
 * Films are 24 (or 23.976) frames a second, but a Fire TV normally sends 60 pictures a second to
 * the TV. 60 isn't a multiple of 24, so frames are shown for uneven times and slow camera pans
 * judder. While a video plays, the player measures its frame rate and asks for a mode at the same
 * resolution whose refresh rate is a whole multiple of it (24 → 24 or 48 Hz, 25 → 25 or 50 Hz);
 * leaving the player puts the TV's own mode back. A switch blanks the TV for a second or two
 * (the HDMI link starts again), so the player pauses until the new mode is on.
 *
 * Android 6 (API 23) or newer; older Fire TVs answer "unsupported".
 */
class FrameRate {
	private static final String PREFS = "catalog";
	private static final String KEY_ON = "frameRateMatching";

	private final Activity activity;
	private final WebView web;
	private final Handler main = new Handler(Looper.getMainLooper());
	/** The mode asked for, or 0 for the TV's own. */
	private volatile int asked = 0;
	private DisplayManager.DisplayListener listener;

	FrameRate(Activity activity, WebView web) {
		this.activity = activity;
		this.web = web;
	}

	boolean enabled() {
		return activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ON, true);
	}

	void setEnabled(boolean on) {
		activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ON, on).apply();
		if (!on) restore();
	}

	/** See MainActivity.Bridge.matchFrameRate. */
	String match(double fps) {
		if (!enabled()) return "off";
		if (Build.VERSION.SDK_INT < 23 || fps < 10 || fps > 121) return "unsupported";
		Display display = activity.getWindowManager().getDefaultDisplay();
		Display.Mode current = display.getMode();
		if (multipleOf(current.getRefreshRate(), fps) > 0) return "same";

		Display.Mode best = null;
		int bestTimes = 0;
		for (Display.Mode mode : display.getSupportedModes()) {
			if (mode.getPhysicalWidth() != current.getPhysicalWidth() || mode.getPhysicalHeight() != current.getPhysicalHeight()) continue;
			int times = multipleOf(mode.getRefreshRate(), fps);
			// The lowest multiple: 24 Hz for a film rather than 48 or 72.
			if (times > 0 && (best == null || times < bestTimes)) {
				best = mode;
				bestTimes = times;
			}
		}
		if (best == null) return "unsupported";
		final int id = best.getModeId();
		asked = id;
		main.post(new Runnable() {
			public void run() {
				watchForChange(id);
				setMode(id);
			}
		});
		return "switching";
	}

	/** The TV's own mode again. */
	void restore() {
		if (asked == 0) return;
		asked = 0;
		main.post(new Runnable() {
			public void run() {
				stopWatching();
				setMode(0);
			}
		});
	}

	private void setMode(int id) {
		WindowManager.LayoutParams params = activity.getWindow().getAttributes();
		if (params.preferredDisplayModeId == id) return;
		params.preferredDisplayModeId = id;
		activity.getWindow().setAttributes(params);
	}

	/** Tells the page once the TV is on mode `id`. */
	private void watchForChange(final int id) {
		stopWatching();
		final DisplayManager displays = (DisplayManager) activity.getSystemService(Context.DISPLAY_SERVICE);
		if (displays == null) return;
		listener = new DisplayManager.DisplayListener() {
			public void onDisplayAdded(int displayId) {}

			public void onDisplayRemoved(int displayId) {}

			public void onDisplayChanged(int displayId) {
				if (displayId != Display.DEFAULT_DISPLAY) return;
				if (activity.getWindowManager().getDefaultDisplay().getMode().getModeId() != id) return;
				stopWatching();
				web.evaluateJavascript("window.__catalogTv && window.__catalogTv.displayChanged && window.__catalogTv.displayChanged()", null);
			}
		};
		displays.registerDisplayListener(listener, main);
	}

	private void stopWatching() {
		if (listener == null) return;
		DisplayManager displays = (DisplayManager) activity.getSystemService(Context.DISPLAY_SERVICE);
		if (displays != null) displays.unregisterDisplayListener(listener);
		listener = null;
	}

	/** 1, 2 or 3 when `refresh` is that many times `fps` (59.94 is 2 × 29.97, not 60), else 0. */
	private static int multipleOf(float refresh, double fps) {
		for (int times = 1; times <= 3; times++) {
			if (Math.abs(refresh - fps * times) < 0.01 * times) return times;
		}
		return 0;
	}
}
