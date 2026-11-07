package de.cx.ksv0815;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.widget.Toast;

/** Rückmeldung von Android zur Update-Installation (PackageInstaller). */
public class UpdateReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            // Android fragt den Nutzer: „Möchtest du diese App aktualisieren?“
            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try { ctx.startActivity(confirm); } catch (Exception e) { MainActivity.updateState("error", "Bestätigung konnte nicht geöffnet werden."); }
            }
        } else if (status == PackageInstaller.STATUS_SUCCESS) {
            Toast.makeText(ctx, "KSV 08/15 wurde aktualisiert.", Toast.LENGTH_SHORT).show();
        } else if (status == PackageInstaller.STATUS_FAILURE_ABORTED) {
            MainActivity.updateState("cancel", "");
        } else {
            String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            if (status == PackageInstaller.STATUS_FAILURE_CONFLICT || status == PackageInstaller.STATUS_FAILURE_INCOMPATIBLE)
                msg = "Die installierte App wurde mit einem anderen Schlüssel erstellt. Bitte die neue Version einmal von Hand installieren.";
            MainActivity.updateState("error", msg != null ? msg : "Unbekannter Fehler");
        }
    }
}
