package de.cx.ksv0815;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.os.Build;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.Environment;
import android.provider.CalendarContract;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.widget.Toast;

import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * KSV 08/15 Spielbuch als App: zeigt die Spielbuch-Seite aus den Assets in einer WebView.
 * Die Daten speichert die Seite lokal auf dem Gerät (siehe assets/shim.js).
 */
public class MainActivity extends Activity {

    private static final int FILE_CHOOSER = 4711;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingTab;   // Rubrik aus einer angetippten Benachrichtigung

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        if (night) web.setBackgroundColor(0xFF0E0E0E);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setTextZoom(100);

        web.addJavascriptInterface(new Bridge(), "AndroidApp");

        pendingTab = getIntent() != null ? getIntent().getStringExtra("tab") : null;
        PushService.ensureChannel(this);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                openTab();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("file".equals(scheme)) return false;
                // Externe Links im Browser öffnen
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(i, FILE_CHOOSER);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        // Kaltstart → Tabelle; wurde die App im Hintergrund vom System beendet → letzte Rubrik
        if (savedInstanceState != null) web.loadUrl("file:///android_asset/index.html#resume");
        else web.loadUrl("file:///android_asset/index.html");
    }

    /** App wurde über eine Benachrichtigung geöffnet, während sie schon lief. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        pendingTab = intent.getStringExtra("tab");
        openTab();
    }

    private void openTab() {
        if (pendingTab == null || web == null) return;
        String js = "window.__ksvGoTab && window.__ksvGoTab(" + JSONObject.quote(pendingTab) + ")";
        pendingTab = null;
        web.evaluateJavascript(js, null);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER && fileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) result = new Uri[]{ data.getData() };
            fileCallback.onReceiveValue(result);
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Dunkelmodus des Handys umgeschaltet → Darstellung „Automatisch“ sofort anpassen
        if (web != null) web.evaluateJavascript("window.__ksvTheme && window.__ksvTheme()", null);
    }

    @Override
    public void onBackPressed() {
        // Zuerst offene Popups in der Seite schließen, sonst App verlassen
        web.evaluateJavascript("(window.__ksvBack && window.__ksvBack()) ? '1' : '0'", value -> {
            if (value == null || !value.contains("1")) MainActivity.super.onBackPressed();
        });
    }

    /** Schnittstelle für die Seite: Dateien in „Downloads“ speichern und teilen. */
    private class Bridge {
        private Uri save(String name, String base64, String mime) throws Exception {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            ContentResolver cr = getContentResolver();
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/KSV 08-15");
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new Exception("Speichern nicht möglich");
            try (OutputStream os = cr.openOutputStream(uri)) {
                if (os == null) throw new Exception("Speichern nicht möglich");
                os.write(bytes);
            }
            return uri;
        }

        private void toast(String msg) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
        }

        /** true, wenn das Handy im dunklen Modus ist (für die Darstellung „Automatisch“). */
        /** Daten für das Startbildschirm-Widget (Tabellenstand, Termin, offener Betrag). */
        @JavascriptInterface
        public void updateWidget(String json) {
            try { KsvWidget.save(getApplicationContext(), json); } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public boolean isNightMode() {
            int m = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            return m == Configuration.UI_MODE_NIGHT_YES;
        }

        /** Hintergrund der App an die gewählte Darstellung anpassen (kein weißes Aufblitzen im Dunkelmodus). */
        @JavascriptInterface
        public void setDark(boolean dark) {
            runOnUiThread(() -> {
                int bg = dark ? 0xFF0E0E0E : 0xFFFFFFFF;
                web.setBackgroundColor(bg);
                getWindow().getDecorView().setBackgroundColor(bg);
            });
        }

        /** Öffnet die Kalender-App des Handys mit einem vorausgefüllten Termin (Google, Samsung …). */
        @JavascriptInterface
        public String addToCalendar(String title, double beginMs, double endMs, boolean allDay, String location, String description) {
            Intent i = new Intent(Intent.ACTION_INSERT)
                    .setData(CalendarContract.Events.CONTENT_URI)
                    .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, (long) beginMs)
                    .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, (long) endMs)
                    .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, allDay)
                    .putExtra(CalendarContract.Events.TITLE, title)
                    .putExtra(CalendarContract.Events.EVENT_LOCATION, location)
                    .putExtra(CalendarContract.Events.DESCRIPTION, description);
            runOnUiThread(() -> {
                try { startActivity(i); } catch (Exception e) { toast("Keine Kalender-App gefunden."); }
            });
            return "ok";
        }

        // ---------- Push-Nachrichten ----------

        /** true, wenn Firebase eingerichtet ist (google-services.json beim Bauen vorhanden). */
        @JavascriptInterface
        public boolean pushAvailable() {
            try { return !FirebaseApp.getApps(MainActivity.this).isEmpty(); } catch (Throwable t) { return false; }
        }

        /** Erlaubnis anfragen (Android 13+) und Gerätekennung holen; Ergebnis an window.__ksvPushToken(token, fehler). */
        @JavascriptInterface
        public void requestPush() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED)
                    requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 77);
                try {
                    FirebaseMessaging.getInstance().getToken().addOnCompleteListener(t -> {
                        String tok = t.isSuccessful() && t.getResult() != null ? t.getResult() : "";
                        String err = t.isSuccessful() ? "" : String.valueOf(t.getException());
                        web.evaluateJavascript("window.__ksvPushToken && window.__ksvPushToken(" + JSONObject.quote(tok) + ", " + JSONObject.quote(err) + ")", null);
                    });
                } catch (Throwable e) {
                    web.evaluateJavascript("window.__ksvPushToken && window.__ksvPushToken('', " + JSONObject.quote(String.valueOf(e)) + ")", null);
                }
            });
        }

        /** Sind Benachrichtigungen für die App in Android erlaubt? */
        @JavascriptInterface
        public boolean notificationsAllowed() {
            NotificationManager nm = getSystemService(NotificationManager.class);
            return nm != null && nm.areNotificationsEnabled();
        }

        // ---------- Regelwerk (PDF) ----------
        // Die PDF liegt im internen App-Speicher; die Seiten werden mit dem Android-PDF-Renderer als Bilder gezeichnet.

        private File rulesFile() { return new File(getFilesDir(), "regelwerk.pdf"); }

        /** Speichert eine neue PDF als Regelwerk (ersetzt die alte). Rückgabe "ok", "notpdf" oder "error:…". */
        @JavascriptInterface
        public synchronized String saveRules(String base64) {
            File tmp = new File(getFilesDir(), "regelwerk.tmp");
            try {
                byte[] d = Base64.decode(base64, Base64.DEFAULT);
                if (d.length < 5 || d[0] != '%' || d[1] != 'P' || d[2] != 'D' || d[3] != 'F') return "notpdf";
                try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(d); }
                try (ParcelFileDescriptor fd = ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.MODE_READ_ONLY);
                     PdfRenderer r = new PdfRenderer(fd)) {
                    if (r.getPageCount() < 1) return "error:Die PDF hat keine Seiten.";
                }
                File f = rulesFile();
                if (f.exists() && !f.delete()) return "error:Alte PDF ließ sich nicht ersetzen.";
                if (!tmp.renameTo(f)) return "error:Speichern nicht möglich.";
                return "ok";
            } catch (Exception e) {
                return "error:" + e.getMessage();
            } finally {
                if (tmp.exists()) tmp.delete();
            }
        }

        /** Angaben zum gespeicherten Regelwerk als JSON ({pages,size,updated}) oder "" wenn keins vorhanden. */
        @JavascriptInterface
        public synchronized String rulesInfo() {
            File f = rulesFile();
            if (!f.exists()) return "";
            try (ParcelFileDescriptor fd = ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
                 PdfRenderer r = new PdfRenderer(fd)) {
                return "{\"pages\":" + r.getPageCount() + ",\"size\":" + f.length() + ",\"updated\":" + f.lastModified() + "}";
            } catch (Exception e) {
                return "";
            }
        }

        /** Zeichnet eine Seite (ab 0) in der gewünschten Breite und liefert sie als PNG (Base64). */
        @JavascriptInterface
        public synchronized String rulesPage(int index, int width) {
            File f = rulesFile();
            if (!f.exists()) return "";
            try (ParcelFileDescriptor fd = ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
                 PdfRenderer r = new PdfRenderer(fd)) {
                if (index < 0 || index >= r.getPageCount()) return "";
                try (PdfRenderer.Page page = r.openPage(index)) {
                    int w = Math.max(200, Math.min(2400, width));
                    int h = Math.max(1, Math.round((float) w * page.getHeight() / page.getWidth()));
                    Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                    bmp.eraseColor(Color.WHITE);
                    page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
                    bmp.recycle();
                    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
                }
            } catch (Exception e) {
                return "";
            }
        }

        /** Die gespeicherte PDF als Base64 (für die Datensicherung) oder "". */
        @JavascriptInterface
        public synchronized String loadRules() {
            File f = rulesFile();
            if (!f.exists()) return "";
            try (FileInputStream in = new FileInputStream(f)) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384]; int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            } catch (Exception e) {
                return "";
            }
        }

        /** Speichert die Datei unter Downloads/KSV 08-15. Rückgabe "ok" oder Fehlermeldung. */
        @JavascriptInterface
        public String saveFile(String name, String base64, String mime) {
            try {
                save(name, base64, mime);
                toast("Gespeichert: Downloads/KSV 08-15/" + name);
                return "ok";
            } catch (Exception e) {
                return "error:" + e.getMessage();
            }
        }

        /** Speichert die Datei und öffnet danach „Teilen“ (z. B. WhatsApp). */
        @JavascriptInterface
        public String saveAndShare(String name, String base64, String mime) {
            try {
                Uri uri = save(name, base64, mime);
                toast("Gespeichert: Downloads/KSV 08-15/" + name);
                runOnUiThread(() -> {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType(mime);
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try { startActivity(Intent.createChooser(send, "Bericht teilen")); } catch (Exception ignored) { }
                });
                return "ok";
            } catch (Exception e) {
                return "error:" + e.getMessage();
            }
        }
    }
}
