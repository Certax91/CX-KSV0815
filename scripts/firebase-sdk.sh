#!/usr/bin/env bash
# Legt die Firebase-Bibliothek (Anmeldung + Datenbank) in die App, damit sie ohne Nachladen startet.
# Es wird die neueste Version genommen, für die es die „compat“-Dateien gibt.
set -u
dir="app/src/main/assets/firebase"
mkdir -p "$dir"
for v in 13.1.0 13.0.0 12.6.0 12.0.0 11.10.0 11.0.2 10.14.1; do
  ok=1
  for f in firebase-app-compat.js firebase-auth-compat.js firebase-firestore-compat.js; do
    curl -fsSL "https://www.gstatic.com/firebasejs/$v/$f" -o "$dir/$f" || { ok=0; break; }
  done
  if [ "$ok" = 1 ]; then
    echo "window.KSV_FB_VERSION = \"$v\";" > "$dir/version.js"
    echo "Firebase $v eingebunden"; ls -la "$dir"; exit 0
  fi
done
echo "::warning::Firebase-Bibliothek konnte nicht geladen werden – die App lädt sie dann beim Start aus dem Internet."
rm -f "$dir"/*.js
