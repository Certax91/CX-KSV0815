package de.cx.ksv0815;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Typeface;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.StyleSpan;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** Startbildschirm-Widget: zeigt Tabellenstand, nächsten Termin und den eigenen offenen Betrag.
 *  Die Daten liefert die App (index.html) bei jedem Öffnen über AndroidApp.updateWidget(json). */
public class KsvWidget extends AppWidgetProvider {
    private static final String PREFS = "ksv_widget", KEY = "json";
    private static final int[] ROW = { R.id.w_row1, R.id.w_row2, R.id.w_row3, R.id.w_row4, R.id.w_row5 };
    private static final int[] RK = { R.id.w_r1, R.id.w_r2, R.id.w_r3, R.id.w_r4, R.id.w_r5 };
    private static final int[] NM = { R.id.w_n1, R.id.w_n2, R.id.w_n3, R.id.w_n4, R.id.w_n5 };
    private static final int[] VL = { R.id.w_v1, R.id.w_v2, R.id.w_v3, R.id.w_v4, R.id.w_v5 };

    /** Neue Daten speichern und alle Widgets neu zeichnen. */
    public static void save(Context ctx, String json) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (json != null && json.equals(sp.getString(KEY, null))) return;
        sp.edit().putString(KEY, json).apply();
        AppWidgetManager m = AppWidgetManager.getInstance(ctx);
        int[] ids = m.getAppWidgetIds(new ComponentName(ctx, KsvWidget.class));
        for (int id : ids) m.updateAppWidget(id, build(ctx));
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, build(ctx));
    }

    private static RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_ksv);
        Intent open = new Intent(ctx, MainActivity.class);
        open.putExtra("tab", "stand");
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        v.setOnClickPendingIntent(R.id.w_root, PendingIntent.getActivity(ctx, 7, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        String json = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null);
        for (int r : ROW) v.setViewVisibility(r, View.GONE);
        if (json == null) return v;
        try {
            JSONObject o = new JSONObject(json);
            v.setTextViewText(R.id.w_title, o.optString("titel", "KSV 08/15"));
            v.setTextViewText(R.id.w_stand, o.optString("stand", ""));
            v.setTextViewText(R.id.w_zeitraum, o.optString("zeitraum", ""));
            String live = o.optString("live", "");
            v.setViewVisibility(R.id.w_live, live.isEmpty() ? View.GONE : View.VISIBLE);
            v.setTextViewText(R.id.w_live, "● " + live);
            JSONArray rows = o.optJSONArray("rows");
            int n = rows == null ? 0 : Math.min(rows.length(), ROW.length);
            v.setViewVisibility(R.id.w_empty, n == 0 ? View.VISIBLE : View.GONE);
            if (n == 0) v.setTextViewText(R.id.w_empty, "Noch keine Platzierungen im Zeitraum.");
            for (int i = 0; i < n; i++) {
                JSONObject r = rows.getJSONObject(i);
                v.setViewVisibility(ROW[i], View.VISIBLE);
                v.setTextViewText(RK[i], r.optInt("r", i + 1) + ".");
                CharSequence name = r.optString("n", "");
                if (r.optBoolean("me", false)) {
                    SpannableString s = new SpannableString(name + " (du)");
                    s.setSpan(new StyleSpan(Typeface.BOLD), 0, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    name = s;
                }
                v.setTextViewText(NM[i], name);
                v.setTextViewText(VL[i], r.optString("v", ""));
            }
            v.setTextViewText(R.id.w_termin, "Nächster Termin: " + o.optString("termin", "–"));
            String offen = o.optString("offen", "");
            v.setViewVisibility(R.id.w_offen, offen.isEmpty() ? View.GONE : View.VISIBLE);
            v.setTextViewText(R.id.w_offen, offen);
        } catch (Exception e) {
            v.setViewVisibility(R.id.w_empty, View.VISIBLE);
        }
        return v;
    }
}
