/* Zugang zur Vereins-Version (Firebase).
 * null  = die App speichert alles nur lokal auf diesem Handy (wie bisher).
 * Sonst die Werte aus Firebase → Projekteinstellungen → Web-App („firebaseConfig“) eintragen,
 * Wer Verwalter ist, steht nur in den Firestore-Regeln (Firebase-Konsole), nicht hier.
 * Diese Werte sind nicht geheim; geschützt werden die Daten durch Anmeldung + firestore.rules.
 */
window.KSV_FIREBASE = {
  apiKey: "AIzaSyDybCCf_SGTDADFmZzDUd7oWPQB9Bwsff8",
  authDomain: "ksv0815.firebaseapp.com",
  projectId: "ksv0815",
  storageBucket: "ksv0815.firebasestorage.app",
  messagingSenderId: "794915316570",
  appId: "1:794915316570:web:6ef711c7457adf16f5c963"
};
/* Beispiel:
window.KSV_FIREBASE = {
  apiKey: "…",
  authDomain: "ksv-0815.firebaseapp.com",
  projectId: "ksv-0815",
  storageBucket: "ksv-0815.firebasestorage.app",
  messagingSenderId: "…",
  appId: "…"
};
*/
