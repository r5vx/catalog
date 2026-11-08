package app.catalog.tv;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.WebView;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * The TV app updating itself from the computer (`/catalog-tv.apk`), so a new version never needs
 * Downloader again (owner, 2026-11-03: setting the TVs up was "so annoying"). Signed with the same
 * key, so it installs over this one and keeps everything (which computer, profiles).
 *
 * Fire TV asks once to allow Catalog to install apps (Install unknown apps → Catalog), and shows
 * its own "Update" screen each time. The page hears how it went through
 * `window.__catalogTvUpdate(state, detail)`: "downloading" (percent), "allow" (that setting is
 * off; its screen was opened), "confirm" (Fire TV's screen is up), "failed" (why).
 */
final class SelfUpdate {
	private static final String DONE = "app.catalog.tv.UPDATE_DONE";
	private final Activity activity;
	private final WebView page;
	private boolean listening;

	SelfUpdate(Activity activity, WebView page) {
		this.activity = activity;
		this.page = page;
	}

	void install(final String url) {
		if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
			tell("allow", "");
			try {
				activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
					Uri.parse("package:" + activity.getPackageName())));
			} catch (Exception ignored) {
				// No such screen on this TV: the page says where the setting is.
			}
			return;
		}
		listen();
		new Thread(new Runnable() {
			public void run() {
				PackageInstaller.Session session = null;
				try {
					PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
					PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
					params.setAppPackageName(activity.getPackageName());
					int id = installer.createSession(params);
					session = installer.openSession(id);

					HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
					conn.setConnectTimeout(15000);
					conn.setReadTimeout(30000);
					if (conn.getResponseCode() != 200) throw new Exception("The computer answered " + conn.getResponseCode());
					long total = conn.getContentLength();
					try (InputStream in = conn.getInputStream();
						OutputStream out = session.openWrite("catalog-tv.apk", 0, total > 0 ? total : -1)) {
						byte[] buffer = new byte[65536];
						long done = 0;
						int lastPercent = -1;
						int n;
						while ((n = in.read(buffer)) > 0) {
							out.write(buffer, 0, n);
							done += n;
							int percent = total > 0 ? (int) (done * 100 / total) : 0;
							if (percent != lastPercent && percent % 10 == 0) {
								lastPercent = percent;
								tell("downloading", String.valueOf(percent));
							}
						}
						session.fsync(out);
					}
					int flags = PendingIntent.FLAG_UPDATE_CURRENT;
					if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
					Intent done = new Intent(DONE).setPackage(activity.getPackageName());
					PendingIntent result = PendingIntent.getBroadcast(activity, id, done, flags);
					session.commit(result.getIntentSender());
					session.close();
					session = null;
				} catch (Exception e) {
					if (session != null) session.abandon();
					tell("failed", e.getMessage() != null ? e.getMessage() : e.toString());
				}
			}
		}).start();
	}

	/** Fire TV's answers: its "Update" screen to show, or how it ended. */
	private void listen() {
		if (listening) return;
		listening = true;
		BroadcastReceiver receiver = new BroadcastReceiver() {
			@Override
			public void onReceive(Context context, Intent intent) {
				int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
				if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
					Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
					if (confirm != null) {
						confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
						activity.startActivity(confirm);
						tell("confirm", "");
					}
				} else if (status != PackageInstaller.STATUS_SUCCESS) {
					String why = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
					tell("failed", why != null ? why : "Fire TV didn't install it");
				}
				// Success: Fire TV restarts the app as the new version.
			}
		};
		IntentFilter filter = new IntentFilter(DONE);
		if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
		else activity.registerReceiver(receiver, filter);
	}

	private void tell(final String state, final String detail) {
		activity.runOnUiThread(new Runnable() {
			public void run() {
				page.evaluateJavascript("window.__catalogTvUpdate && window.__catalogTvUpdate("
					+ quote(state) + "," + quote(detail) + ")", null);
			}
		});
	}

	private static String quote(String text) {
		return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ") + "\"";
	}
}
