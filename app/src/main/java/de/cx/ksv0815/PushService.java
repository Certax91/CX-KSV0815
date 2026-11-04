package de.cx.ksv0815;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Empfängt Push-Nachrichten (Firebase Cloud Messaging).
 * Ist die App im Hintergrund, zeigt Android die Nachricht selbst an; ist sie geöffnet, zeigt dieser Dienst sie an.
 * Antippen öffnet die App in der passenden Rubrik (Extra „tab“).
 */
public class PushService extends FirebaseMessagingService {

    static final String CHANNEL = "ksv";

    static void ensureChannel(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "KSV 08/15", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Neuigkeiten aus dem Spielbuch: Spieltage, Beträge, Planung");
            nm.createNotificationChannel(ch);
        }
    }

    @Override
    public void onNewToken(String token) {
        getSharedPreferences("ksv", MODE_PRIVATE).edit().putString("pushToken", token).apply();
    }

    @Override
    public void onMessageReceived(RemoteMessage msg) {
        Map<String, String> d = msg.getData();
        String title = null, body = null;
        if (msg.getNotification() != null) {
            title = msg.getNotification().getTitle();
            body = msg.getNotification().getBody();
        }
        if (title == null) title = d.get("title");
        if (body == null) body = d.get("body");
        if (title == null && body == null) return;
        ensureChannel(this);
        Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        String tab = d.get("tab");
        if (tab != null && !tab.isEmpty()) i.putExtra("tab", tab);
        PendingIntent pi = PendingIntent.getActivity(this, (int) (System.currentTimeMillis() % 100000), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_ksv)
                .setColor(0xFFC98A12)
                .setContentTitle(title != null ? title : "KSV 08/15")
                .setContentText(body != null ? body : "")
                .setStyle(new Notification.BigTextStyle().bigText(body != null ? body : ""))
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build();
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.notify((int) (System.currentTimeMillis() % 100000), n);
    }
}
