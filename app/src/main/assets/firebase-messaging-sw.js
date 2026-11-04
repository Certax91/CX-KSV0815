/* Service Worker für Web-Push (Browser-Version, z. B. iPhone vom Home-Bildschirm).
 * Zeigt Nachrichten an, wenn die App geschlossen ist; Tippen öffnet die passende Rubrik. */
self.window = self;
try { importScripts("firebase-config.js"); } catch (e) { }
try { importScripts("firebase/version.js"); } catch (e) { }
(function () {
  var ver = self.KSV_FB_VERSION || "10.14.1";
  try { importScripts("firebase/firebase-app-compat.js", "firebase/firebase-messaging-compat.js"); }
  catch (e) { importScripts("https://www.gstatic.com/firebasejs/" + ver + "/firebase-app-compat.js", "https://www.gstatic.com/firebasejs/" + ver + "/firebase-messaging-compat.js"); }
  var c = self.KSV_FIREBASE; if (!c || !c.apiKey) return;
  var conf = {}; Object.keys(c).forEach(function (k) { if (k !== "adminEmail" && k !== "vapidKey") conf[k] = c[k]; });
  firebase.initializeApp(conf);
  firebase.messaging();   // Nachrichten mit „notification“ zeigt die Bibliothek selbst an
})();
