/* KSV 08/15 – App-Anbindung
 * Ersetzt die Claude-Schnittstellen (db, user, downloads) durch eine lokale Speicherung auf dem Gerät.
 * Beim ersten Start werden die mitgelieferten Daten (seed.js) übernommen.
 */
(function () {
  "use strict";
  var P = "ksvdb:";
  var store = {
    get: function (k) { try { return localStorage.getItem(P + k); } catch (e) { return null; } },
    set: function (k, v) { localStorage.setItem(P + k, v); },
    del: function (k) { localStorage.removeItem(P + k); },
    keys: function () { var o = []; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(P) === 0) o.push(k.slice(P.length)); } return o; }
  };

  function seed() {
    if (store.get("__seeded")) return;
    var s = window.KSV_SEED; if (!s) return;
    store.set("config/main", JSON.stringify(s.config || {}));
    (s.spieltage || []).forEach(function (g) { store.set("spieltage/" + g.id, JSON.stringify(g.data)); });
    store.set("__seeded", new Date().toISOString());
  }
  seed();

  var clone = function (o) { return o == null ? o : JSON.parse(JSON.stringify(o)); };
  function merge(a, b) {
    var out = clone(a) || {};
    Object.keys(b).forEach(function (k) {
      var v = b[k];
      if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = merge(out[k], v);
      else out[k] = clone(v);
    });
    return out;
  }
  function read(path) { var r = store.get(path); return r == null ? null : JSON.parse(r); }
  function docSnap(path) {
    var d = read(path), id = path.split("/").pop();
    return { id: id, exists: d != null, data: function () { return d == null ? undefined : clone(d); }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function colSnap(col) {
    var pre = col + "/", docs = store.keys().filter(function (k) { return k.indexOf(pre) === 0 && k.slice(pre.length).indexOf("/") < 0; }).sort()
      .map(function (k) { return docSnap(k); });
    return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }

  var docL = {}, colL = {};
  function notify(path) {
    var col = path.split("/").slice(0, -1).join("/");
    setTimeout(function () {
      (docL[path] || []).forEach(function (f) { f(docSnap(path)); });
      (colL[col] || []).forEach(function (f) { f(colSnap(col)); });
    }, 0);
  }
  function notifyAll() {
    setTimeout(function () {
      Object.keys(docL).forEach(function (p) { docL[p].forEach(function (f) { f(docSnap(p)); }); });
      Object.keys(colL).forEach(function (c) { colL[c].forEach(function (f) { f(colSnap(c)); }); });
    }, 0);
  }
  function listen(map, key, fn, snap) {
    (map[key] = map[key] || []).push(fn);
    setTimeout(function () { fn(snap()); }, 0);
    return function () { map[key] = (map[key] || []).filter(function (x) { return x !== fn; }); };
  }

  function docRef(path) {
    return {
      id: path.split("/").pop(), path: path,
      get: function () { return Promise.resolve(docSnap(path)); },
      set: function (data) { store.set(path, JSON.stringify(data)); notify(path); return Promise.resolve(); },
      update: function (data) {
        var cur = read(path);
        if (cur == null) return Promise.reject({ code: "invalid_argument", message: "Dokument fehlt" });
        store.set(path, JSON.stringify(merge(cur, data))); notify(path); return Promise.resolve();
      },
      delete: function () { store.del(path); notify(path); return Promise.resolve(); },
      onSnapshot: function (next) { return listen(docL, path, next, function () { return docSnap(path); }); },
      collection: function (sub) { return colRef(path + "/" + sub); }
    };
  }
  function colRef(col) {
    return {
      path: col,
      doc: function (id) { return docRef(col + "/" + (id || Math.random().toString(36).slice(2, 12))); },
      add: function (data) { var r = docRef(col + "/" + Math.random().toString(36).slice(2, 12)); return r.set(data).then(function () { return r; }); },
      get: function () { return Promise.resolve(colSnap(col)); },
      onSnapshot: function (next) { return listen(colL, col, next, function () { return colSnap(col); }); },
      where: function () { return this; }, orderBy: function () { return this; }, limit: function () { return this; }
    };
  }
  var db = { doc: docRef, collection: colRef };

  function toBase64(bytes) {
    var bin = "", CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }
  function mimeOf(name) { return /\.pdf$/i.test(name) ? "application/pdf" : /\.json$/i.test(name) ? "application/json" : "application/octet-stream"; }
  var downloads = {
    save: function (req) {
      return new Promise(function (resolve, reject) {
        var bytes = req.data instanceof Uint8Array ? req.data : typeof req.data === "string" ? new TextEncoder().encode(req.data) : new Uint8Array(req.data);
        if (!window.AndroidApp) {   // Browser / iPhone: Teilen-Menü, sonst normaler Download
          var mime = mimeOf(req.filename), blob = new Blob([bytes], { type: mime }), file = null;
          var download = function () { var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = req.filename; document.body.appendChild(a); a.click(); a.remove(); resolve({ status: "saved" }); };
          try { file = new File([blob], req.filename, { type: mime }); } catch (e) { }
          if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: req.filename }).then(function () { resolve({ status: "shared" }); })
              .catch(function (e) { if (e && e.name === "AbortError") reject({ code: "declined" }); else download(); });
          } else download();
          return;
        }
        var r = window.AndroidApp.saveAndShare(req.filename, toBase64(bytes), mimeOf(req.filename));
        if (r === "ok") resolve({ status: "saved" }); else reject({ code: "unavailable", message: r });
      });
    }
  };
  var user = { can: function () { return Promise.resolve(true); }, canEdit: function () { return true; }, isOwner: function () { return true; },
    id: function () { return Promise.resolve("local"); }, me: function () { return Promise.resolve({ id: "local", name: "" }); }, profiles: function () { return Promise.resolve({}); } };

  window.claude = { use: function (name) { return Promise.resolve(name === "db" ? db : name === "user" ? user : name === "downloads" ? downloads : null); } };


  // ---------- Rückfragen im Design der App (statt der Systemabfrage „Auf der Seite file:// steht …“) ----------
  // appConfirm({ title, text, ok, cancel, danger, onOk }) → Promise<boolean>; onOk läuft direkt beim Tippen (z. B. für Links)
  var dlgClose = null;
  window.appConfirm = function (o) {
    o = o || {};
    return new Promise(function (resolve) {
      if (dlgClose) dlgClose(false);
      var ov = document.createElement("div"); ov.className = "app-dlg"; ov.setAttribute("role", "alertdialog"); ov.setAttribute("aria-modal", "true");
      var box = document.createElement("div"); box.className = "app-dlg-box";
      var h = document.createElement("h2"); h.textContent = o.title || "Bitte bestätigen"; h.id = "appDlgT"; ov.setAttribute("aria-labelledby", "appDlgT");
      var t = document.createElement("p"); t.textContent = o.text || "";
      var act = document.createElement("div"); act.className = "app-dlg-act";
      var no = document.createElement("button"); no.type = "button"; no.className = "btn ghost"; no.textContent = o.cancel || "Abbrechen";
      var yes = document.createElement("button"); yes.type = "button"; yes.className = "btn" + (o.danger ? " btn-danger" : "") + (o.okClass ? " " + o.okClass : ""); yes.textContent = o.ok || "OK";
      act.appendChild(no); act.appendChild(yes);
      box.appendChild(h); if (o.text) box.appendChild(t); box.appendChild(act); ov.appendChild(box);
      var done = function (v) {
        if (!ov.parentNode) return; ov.parentNode.removeChild(ov); dlgClose = null;
        document.removeEventListener("keydown", key, true); resolve(v);
      };
      var key = function (e) { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
      no.onclick = function () { done(false); };
      yes.onclick = function () { if (o.onOk) { try { o.onOk(); } catch (e) { } } done(true); };
      ov.onclick = function (e) { if (e.target === ov) done(false); };
      document.addEventListener("keydown", key, true);
      document.body.appendChild(ov); dlgClose = done;
      setTimeout(function () { yes.focus(); }, 0);
    });
  };

  // Zurück-Taste: offene Popups schließen
  window.__ksvBack = function () {
    if (dlgClose) { dlgClose(false); return true; }
    var em = document.getElementById("em"), pd = document.getElementById("pd");
    if ((em && !em.hidden) || (pd && !pd.hidden)) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return true; }
    if (window.__ksvTabBack && window.__ksvTabBack()) return true;   // andere Rubrik → zurück zur Tabelle
    return false;
  };

  // ---------- Datensicherung (Export / Import) ----------
  function dump() {
    var sp = store.keys().filter(function (k) { return k.indexOf("spieltage/") === 0; }).sort()
      .map(function (k) { return { id: k.slice(10), data: read(k) }; });
    var rw = null; try { rw = (window.AndroidApp && window.AndroidApp.loadRules) ? (window.AndroidApp.loadRules() || null) : null; } catch (e) { }
    var rt = null; try { rt = (JSON.parse(localStorage.getItem("ksv-regelwerk-text") || "null") || {}).blocks || null; } catch (e) { }
    return { app: "KSV 08/15 Spielbuch", version: 1, exported: new Date().toISOString(), config: read("config/main") || {}, spieltage: sp, regelwerk: rw, regeltext: rt };
  }
  function restore(obj) {
    if (!obj || typeof obj !== "object" || !obj.config || !Array.isArray(obj.spieltage)) throw new Error("Das ist keine Sicherung des Spielbuchs.");
    store.keys().forEach(function (k) { if (k !== "__seeded") store.del(k); });
    store.set("config/main", JSON.stringify(obj.config));
    obj.spieltage.forEach(function (g) { if (g && g.id && g.data) store.set("spieltage/" + g.id, JSON.stringify(g.data)); });
    if (obj.regelwerk && window.AndroidApp && window.AndroidApp.saveRules) { try { window.AndroidApp.saveRules(obj.regelwerk); } catch (e) { } }
    try {   // Regeltext: übernehmen, sonst aus der eingespielten PDF neu einlesen lassen
      if (obj.regeltext) localStorage.setItem("ksv-regelwerk-text", JSON.stringify({ blocks: obj.regeltext, updated: Date.now(), name: "Regelwerk" }));
      else if (obj.regelwerk) localStorage.removeItem("ksv-regelwerk-text");
    } catch (e) { }
    notifyAll();
    if (window.__ksvRegelReload) window.__ksvRegelReload();
  }
  function addBackupUI() {
    var details = document.getElementById("settings"); if (!details) return;
    var box = document.createElement("div"); box.className = "setgrid";
    box.innerHTML = '<div class="field"><span class="label">Datensicherung</span>' +
      '<div class="actions"><button class="iconbtn" id="bkExport" type="button">Sicherung exportieren</button>' +
      '<button class="iconbtn" id="bkImport" type="button">Sicherung einspielen</button>' +
      '<input type="file" id="bkFile" accept=".json,application/json" hidden></div>' +
      '<span class="msg" id="bkMsg"></span></div>';
    var ver = document.getElementById("appVersion");   // Versionszeile bleibt ganz unten
    if (ver && ver.parentNode === details) details.insertBefore(box, ver); else details.appendChild(box);
    var msg = function (t) { document.getElementById("bkMsg").textContent = t; };
    // Vereins-Version (cloud.js): Sicherung kommt aus der Cloud bzw. wird dorthin eingespielt
    var cloud = function () { return window.KSV_BACKUP || null; };
    document.getElementById("bkExport").onclick = function () {
      var d = new Date(), stamp = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      var name = "KSV-0815_Sicherung_" + stamp + ".json";
      Promise.resolve(cloud() ? cloud().dump() : dump()).then(function (data) {
        var json = JSON.stringify(data, null, 1);
        var r = "error";
        if (window.AndroidApp) r = window.AndroidApp.saveFile(name, toBase64(new TextEncoder().encode(json)), "application/json");
        else { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([json], { type: "application/json" })); a.download = name; a.click(); r = "ok"; }
        msg(r === "ok" ? "Sicherung gespeichert: " + (window.AndroidApp ? "Downloads/KSV 08-15/" : "") + name : "Sicherung konnte nicht gespeichert werden.");
      }).catch(function (e) { msg("Sicherung fehlgeschlagen: " + (e && e.message || e)); });
    };
    if (!window.KSV_CLOUD_MODE && !read("config/main")) {   // Erster Start ohne Daten: direkt zur Datensicherung führen
      if (window.__ksvGoTab) window.__ksvGoTab("set");   // direkt die Rubrik Einstellungen öffnen
      msg("Noch keine Daten auf diesem Handy. Tippe auf „Sicherung einspielen“ und wähle die Datei „KSV-0815_Sicherung_….json“.");
      document.getElementById("bkMsg").style.color = "var(--red)";
      setTimeout(function () { box.scrollIntoView({ block: "center" }); }, 300);
    }
    document.getElementById("bkImport").onclick = function () { document.getElementById("bkFile").click(); };
    document.getElementById("bkFile").onchange = function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var obj = JSON.parse(rd.result);
          if (!obj || !obj.config || !Array.isArray(obj.spieltage)) throw new Error("Das ist keine Sicherung des Spielbuchs.");
          if (cloud()) {
            if (!cloud().canRestore()) throw new Error("Nur wer eintragen darf, kann eine Sicherung einspielen.");
            window.appConfirm({ title: "Sicherung einspielen?", text: "Sicherung vom " + (obj.exported || "?").slice(0, 10) + " mit " + obj.spieltage.length + " Spieltagen für alle einspielen? Die aktuellen Daten in der Cloud werden dabei ersetzt.", ok: "Einspielen", danger: true }).then(function (ok) {
              if (!ok) return;
              msg("Spiele ein …");
              cloud().restore(obj).then(function () { msg("Sicherung eingespielt: " + obj.spieltage.length + " Spieltage."); })
                .catch(function (err) { msg("Einspielen fehlgeschlagen: " + (err && err.message || err)); });
            });
            return;
          }
          window.appConfirm({ title: "Sicherung einspielen?", text: "Sicherung vom " + (obj.exported || "?").slice(0, 10) + " mit " + (obj.spieltage || []).length + " Spieltagen einspielen? Die aktuellen Daten auf diesem Handy werden dabei ersetzt.", ok: "Einspielen", danger: true }).then(function (ok) {
            if (!ok) return;
            try { restore(obj); msg("Sicherung eingespielt: " + obj.spieltage.length + " Spieltage."); } catch (err) { msg("Einspielen fehlgeschlagen: " + err.message); }
          });
        } catch (err) { msg("Einspielen fehlgeschlagen: " + err.message); }
        e.target.value = "";
      };
      rd.readAsText(f);
    };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addBackupUI); else addBackupUI();
})();
