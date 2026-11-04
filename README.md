# KSV 08/15 – Spielbuch-App

Android-App (Samsung & andere ab Android 10) für die Doppelkopfrunde **KSV 08/15**:
Spieltage erfassen, Tabelle nach Platzsumme, Statistik, Saison- und Jahresvergleich,
persönliche Auswertungen und PDF-Bericht.

## App installieren
**Direkter Download der neuesten Version:** https://github.com/Certax91/CX-KSV0815/releases/latest/download/KSV-0815.apk

**iPhone / Browser:** https://certax91.github.io/CX-KSV0815/ öffnen und über „Teilen → Zum Home-Bildschirm“ ablegen.

1. Im Repository auf **Releases** tippen.
2. Beim neuesten Release **KSV-0815.apk** herunterladen.
3. Datei öffnen → **Installieren**. Beim ersten Mal fragt Android, ob der Browser bzw.
   „Eigene Dateien“ Apps installieren darf → erlauben.

Jede Änderung im Repository baut automatisch eine neue Version (Reiter **Actions**).
Neue Versionen lassen sich über die alte installieren – die Daten bleiben erhalten.

## Bedienung
Über die Navigationsleiste am unteren Rand wechselst du zwischen den Rubriken
**Tabelle**, **Spielbuch**, **Statistik** (mit Vergleich der Saisons oder Jahre), **Regeln** und **Optionen**.
Unter **Regeln** fügst du die PDF des Regelwerks ein bzw. ersetzt sie. Ihr Text wird eingelesen und im Design der App
angezeigt (mit Inhaltsverzeichnis der Paragraphen und Suche); „Original“ zeigt die PDF-Seiten. Das Regelwerk ist in
der Datensicherung enthalten.
Neue Spieltage erfasst du über den goldenen Knopf **Spieltag erfassen**; die Zurück-Taste führt zur Tabelle.

## Daten
- Im Repository liegen **keine** Spieldaten. Beim ersten Start einmal unter
  **Optionen** (Navigationsleiste unten rechts) **→ Datensicherung → Sicherung einspielen** die Sicherungsdatei (`KSV-0815_Sicherung_….json`) wählen.
- Danach speichert die App alles **lokal auf dem Handy**.
- Unter **Optionen → Datensicherung** lässt sich eine Sicherung exportieren
  (`Downloads/KSV 08-15/…json`) und auf einem anderen Handy wieder einspielen.
- PDF-Berichte landen ebenfalls unter `Downloads/KSV 08-15` und können direkt geteilt werden.

## Vereins-Version (Firebase)
Ist in `app/src/main/assets/firebase-config.js` ein Firebase-Zugang eingetragen, liegen die Daten in der Cloud
und jedes Mitglied meldet sich mit eigenem Konto (E-Mail + Passwort) an:
- Neue Mitglieder **registrieren** sich in der App, bestätigen ihre E-Mail und warten auf **Freischaltung**.
- Der Verwalter (seine E-Mail steht nur in den Firestore-Regeln) schaltet sie unter **Optionen → Mitglieder & Rechte** frei, ordnet sie einem **Spieler**
  zu und legt fest: *Nur ansehen*, *Darf eintragen* oder *Verwalter*.
- Mitglieder sehen ihren Spieler hervorgehoben, offene Beträge oben in der Tabelle und mit **Ich** ihre Auswertung.
- Die bisherigen Daten des Verwalter-Handys werden unter **Optionen → Daten von diesem Handy** in die Cloud übernommen.
- Zugriffsregeln: `firestore.rules` (in der Firebase-Konsole unter Firestore → Regeln einfügen, `VERWALTER_EMAIL` ersetzen).
- Die Firebase-Bibliothek wird beim Bauen (GitHub Actions) automatisch in die App gelegt.

Ohne Eintrag (`null`) speichert die App wie bisher nur lokal.

## Aufbau
- `app/src/main/assets/index.html` – das Spielbuch (gleiche Oberfläche wie im Browser)
- `app/src/main/assets/pdfjs/` – pdf.js 4.10.38 von Mozilla (Apache-2.0) zum Einlesen des Regelwerks
- `app/src/main/assets/cloud.js` – Vereins-Version: Anmeldung, Freischaltung, Rechte, Cloud-Daten
- `app/src/main/assets/firebase-config.js` – Firebase-Zugang (leer = lokal)
- `app/src/main/assets/shim.js` – lokale Speicherung, PDF-Speichern, Datensicherung
- `app/src/main/java/de/cx/ksv0815/MainActivity.java` – App-Hülle (WebView)
- `.github/workflows/build.yml` – Bau der APK über GitHub Actions
