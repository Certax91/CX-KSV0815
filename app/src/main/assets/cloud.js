/* KSV 08/15 – Vereins-Version mit Firebase (Anmeldung, Freischaltung, Rechte, gemeinsame Daten)
 *
 * Ist in firebase-config.js kein Zugang eingetragen, passiert hier nichts: Die App speichert dann
 * wie bisher nur lokal auf dem Handy (shim.js).
 *
 * Rollen (Dokument nutzer/{uid} in Firestore):
 *   warten    – registriert, noch nicht freigeschaltet (sieht nichts)
 *   lesen     – sieht den aktuellen Stand
 *   schreiben – darf zusätzlich Spieltage, Einstellungen und das Regelwerk ändern
 *   admin     – darf zusätzlich Mitglieder freischalten, Rechte vergeben und Spieler zuordnen
 * Die Rechte prüft Firebase auf dem Server (siehe firestore.rules im Repository).
 */
(function () {
  "use strict";
  var CFG = window.KSV_FIREBASE;
  if (!CFG || !CFG.apiKey) return;

  var ADMIN = String(CFG.adminEmail || "").trim().toLowerCase();
  var VER = window.KSV_FB_VERSION || "10.14.1";
  var ROLLEN = { warten: "Wartet auf Freischaltung", lesen: "Nur ansehen", schreiben: "Darf eintragen", admin: "Verwalter" };
  var DARF_LESEN = { lesen: 1, schreiben: 1, admin: 1 }, DARF_SCHREIBEN = { schreiben: 1, admin: 1 };

  // ---------- Daten erst nach erfolgreicher Anmeldung an die App geben ----------
  var resolveReady, ready = new Promise(function (r) { resolveReady = r; });
  var local = window.claude;
  window.claude = {
    use: function (name) {
      if (name === "downloads") return local.use("downloads");
      return ready.then(function (ctx) { return name === "db" ? ctx.db : name === "user" ? ctx.user : null; });
    }
  };
  window.KSV_CLOUD_MODE = true;

  var fb = null, auth = null, fs = null, me = null, started = false, pendingName = "";

  // ---------- Hilfen ----------
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function load(src) {
    return new Promise(function (ok, bad) { var s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = function () { bad(new Error(src)); }; document.head.appendChild(s); });
  }
  function loadSdk() {
    var files = ["firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js"];
    var seq = function (base) { return files.reduce(function (p, f) { return p.then(function () { return load(base + f); }); }, Promise.resolve()); };
    return seq("firebase/").catch(function () { return seq("https://www.gstatic.com/firebasejs/" + VER + "/"); });
  }
  var FEHLER = {
    "auth/invalid-email": "Die E-Mail-Adresse ist ungültig.",
    "auth/missing-password": "Bitte ein Passwort eingeben.",
    "auth/user-not-found": "E-Mail oder Passwort ist falsch.",
    "auth/wrong-password": "E-Mail oder Passwort ist falsch.",
    "auth/invalid-credential": "E-Mail oder Passwort ist falsch.",
    "auth/invalid-login-credentials": "E-Mail oder Passwort ist falsch.",
    "auth/email-already-in-use": "Für diese E-Mail gibt es schon ein Konto. Bitte anmelden.",
    "auth/weak-password": "Das Passwort muss mindestens 6 Zeichen haben.",
    "auth/too-many-requests": "Zu viele Versuche. Bitte später erneut probieren.",
    "auth/network-request-failed": "Keine Internetverbindung.",
    "auth/user-disabled": "Dieses Konto ist gesperrt.",
    "auth/operation-not-allowed": "Die Anmeldung mit E-Mail/Passwort ist in Firebase noch nicht aktiviert (Authentication → Anmeldemethode).",
    "auth/configuration-not-found": "Die Anmeldung ist in Firebase noch nicht eingerichtet (Authentication → Los geht's).",
    "permission-denied": "Keine Berechtigung – bitte die Firestore-Regeln prüfen.",
    "failed-precondition": "Die Firestore-Datenbank ist noch nicht angelegt.",
    "not-found": "Die Firestore-Datenbank ist noch nicht angelegt.",
    "unavailable": "Keine Verbindung zur Datenbank."
  };
  function msgOf(e) { return (e && FEHLER[e.code]) || (e && e.message) || "Unbekannter Fehler."; }

  // ---------- Aussehen der Anmeldeseite ----------
  var css = document.createElement("style");
  css.textContent = [
    ".auth{position:fixed;inset:0;z-index:90;background:var(--bg,#fff);color:var(--ink,#111);overflow-y:auto;display:flex;justify-content:center;align-items:flex-start;padding:max(24px,env(safe-area-inset-top,0px)) 16px 32px}",
    ".auth-card{width:100%;max-width:400px;display:flex;flex-direction:column;gap:14px;margin-top:6vh}",
    ".auth-brand{display:flex;gap:12px;align-items:center;border-bottom:3px solid var(--ink,#111);padding-bottom:12px}",
    ".auth-brand img{width:52px;height:auto;border-radius:6px;background:#000}",
    ".auth-brand h1{font-family:var(--f-display);font-weight:400;font-size:28px;margin:0;line-height:1}",
    ".auth-brand p{margin:4px 0 0;color:var(--muted,#666);font-size:13px}",
    ".auth form,.auth .auth-box{display:flex;flex-direction:column;gap:10px}",
    ".auth label{display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted,#666)}",
    ".auth input{font:inherit;font-size:16px;text-transform:none;letter-spacing:0;color:var(--ink,#111);border:1px solid var(--line,#ccc);background:var(--surface,#f6f5f2);border-radius:8px;padding:10px 12px}",
    ".auth .btn{padding:11px 16px;font-size:15px}",
    ".auth .auth-tabs{display:grid;grid-template-columns:1fr 1fr}",
    ".auth .auth-tabs button{font:inherit;font-weight:700;border:0;border-bottom:2px solid var(--line,#ccc);background:none;color:var(--muted,#666);padding:8px;cursor:pointer}",
    ".auth .auth-tabs button[aria-pressed=true]{color:var(--ink,#111);border-bottom-color:var(--gold,#c98a12)}",
    ".auth .linkbtn{border:0;background:none;color:var(--gold-ink,#8a5d06);font:inherit;font-size:14px;font-weight:600;cursor:pointer;padding:4px 0;align-self:flex-start}",
    ".auth .auth-msg{font-size:14px;color:var(--muted,#666);min-height:1em}",
    ".auth .auth-msg.err{color:var(--danger,#b3261e)}",
    ".auth .auth-info{background:var(--surface,#f6f5f2);border:1px solid var(--line,#ccc);border-radius:10px;padding:14px;font-size:15px;line-height:1.5}",
    ".auth .auth-info b{display:block;font-size:16px;margin-bottom:4px}",
    ".konto-row{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;padding:10px 0;border-top:1px solid var(--line,#ccc)}",
    ".konto-row:first-child{border-top:0;padding-top:2px}",
    ".konto-row.wait{background:color-mix(in srgb,var(--gold,#c98a12) 12%,transparent);margin:0 -8px;padding:10px 8px;border-radius:8px}",
    ".konto-row .who{display:flex;flex-direction:column;min-width:0}",
    ".konto-row .who b{font-size:15px}",
    ".konto-row .who span{font-size:12px;color:var(--muted,#666);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".konto-row .ctl{display:flex;gap:6px;flex-wrap:wrap;align-items:center}",
    ".konto-row select{border:1px solid var(--line,#ccc);background:var(--bg,#fff);color:var(--ink,#111);border-radius:6px;padding:5px 6px;font:inherit;font-size:13px;max-width:100%}",
    ".konto-row select.need{border-color:var(--gold,#c98a12)}",
    ".konto-me{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:14px}",
    ".kass-cb{display:inline-flex;align-items:center;gap:4px;font-size:13px;font-weight:600;cursor:pointer;padding:4px 2px}",
    ".konto-me .tag{font-size:11px;font-weight:700;border:1px solid var(--gold,#c98a12);color:var(--gold-ink,#8a5d06);border-radius:999px;padding:1px 8px}",
    ".ro .fab,.ro #regelUpload,.ro #bkImport{display:none!important}"
  ].join("\n");
  document.head.appendChild(css);

  var overlay = null, body = null;
  function ensureOverlay() {
    if (overlay) return;
    overlay = h("div", "auth"); overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true");
    var card = h("div", "auth-card"), brand = h("div", "auth-brand"), logo = document.querySelector(".club img");
    if (logo) { var im = h("img"); im.src = logo.src; im.alt = ""; brand.appendChild(im); }
    var t = h("div"); t.appendChild(h("h1", null, "KSV 08/15")); t.appendChild(h("p", null, "Spielbuch der Doppelkopfrunde")); brand.appendChild(t);
    body = h("div", "auth-box");
    card.appendChild(brand); card.appendChild(body); overlay.appendChild(card);
    document.body.appendChild(overlay);
  }
  function show(build) { ensureOverlay(); overlay.hidden = false; body.textContent = ""; build(body); }
  function hide() { if (overlay) overlay.hidden = true; }
  function button(text, cls, fn) { var b = h("button", cls || "btn", text); b.type = "button"; b.onclick = fn; return b; }
  function info(box, title, text) { var d = h("div", "auth-info"); d.appendChild(h("b", null, title)); d.appendChild(document.createTextNode(text)); box.appendChild(d); }

  // ---------- Anmelden / Registrieren ----------
  function viewLogin(mode, note, isErr) {
    show(function (box) {
      var tabs = h("div", "auth-tabs");
      [["login", "Anmelden"], ["reg", "Registrieren"]].forEach(function (x) {
        var b = button(x[1], "", function () { viewLogin(x[0]); }); b.setAttribute("aria-pressed", String(mode === x[0])); tabs.appendChild(b);
      });
      box.appendChild(tabs);
      var f = h("form"); f.noValidate = true;
      var fld = function (lab, type, name, ac) { var l = h("label", null, lab), i = h("input"); i.type = type; i.name = name; i.autocomplete = ac; l.appendChild(i); f.appendChild(l); return i; };
      var nm = mode === "reg" ? fld("Dein Name", "text", "name", "name") : null;
      var em = fld("E-Mail", "email", "email", "email");
      var pw = fld("Passwort", "password", "password", mode === "reg" ? "new-password" : "current-password");
      try { em.value = localStorage.getItem("ksv-lastmail") || ""; } catch (e) { }
      var msg = h("div", "auth-msg" + (isErr ? " err" : ""), note || (mode === "reg" ? "Nach der Registrierung bekommst du eine Mail zur Bestätigung. Danach schaltet dich der Verwalter frei." : ""));
      var go = h("button", "btn", mode === "reg" ? "Konto anlegen" : "Anmelden"); go.type = "submit";
      f.appendChild(go); f.appendChild(msg);
      if (mode === "login") f.appendChild(button("Passwort vergessen?", "linkbtn", function () {
        var mail = em.value.trim(); if (!mail) { msg.className = "auth-msg err"; msg.textContent = "Bitte zuerst die E-Mail-Adresse eintragen."; return; }
        auth.sendPasswordResetEmail(mail).then(function () { msg.className = "auth-msg"; msg.textContent = "Wir haben dir eine Mail zum Zurücksetzen des Passworts geschickt."; })
          .catch(function (e) { msg.className = "auth-msg err"; msg.textContent = msgOf(e); });
      }));
      f.onsubmit = function (e) {
        e.preventDefault();
        var mail = em.value.trim(), pass = pw.value;
        if (mode === "reg" && !nm.value.trim()) { msg.className = "auth-msg err"; msg.textContent = "Bitte deinen Namen eintragen."; return; }
        go.disabled = true; msg.className = "auth-msg"; msg.textContent = "Bitte warten …";
        try { localStorage.setItem("ksv-lastmail", mail); } catch (x) { }
        var p = mode === "reg"
          ? auth.createUserWithEmailAndPassword(mail, pass).then(function (c) {
              pendingName = nm.value.trim();
              return c.user.updateProfile({ displayName: pendingName }).then(function () { return c.user.sendEmailVerification(); });
            })
          : auth.signInWithEmailAndPassword(mail, pass);
        p.catch(function (x) { go.disabled = false; msg.className = "auth-msg err"; msg.textContent = msgOf(x); });
      };
      box.appendChild(f);
      (mode === "reg" ? nm : em.value ? pw : em).focus();
    });
  }

  function viewVerify(u, note) {
    show(function (box) {
      info(box, "Bitte E-Mail bestätigen", "Wir haben eine Mail an " + u.email + " geschickt. Tippe dort auf den Link und komm dann hierher zurück. Schau auch im Spam-Ordner nach.");
      var msg = h("div", "auth-msg", note || "");
      box.appendChild(button("Ich habe bestätigt", "btn", function () {
        msg.className = "auth-msg"; msg.textContent = "Prüfe …";
        u.reload().then(function () { return auth.currentUser.getIdToken(true); }).then(function () {
          if (auth.currentUser.emailVerified) handleUser(auth.currentUser);
          else { msg.className = "auth-msg err"; msg.textContent = "Noch nicht bestätigt. Bitte den Link in der Mail antippen."; }
        }).catch(function (e) { msg.className = "auth-msg err"; msg.textContent = msgOf(e); });
      }));
      box.appendChild(button("Mail erneut senden", "btn ghost", function () {
        u.sendEmailVerification().then(function () { msg.className = "auth-msg"; msg.textContent = "Mail wurde erneut gesendet."; })
          .catch(function (e) { msg.className = "auth-msg err"; msg.textContent = msgOf(e); });
      }));
      box.appendChild(button("Abmelden", "linkbtn", function () { auth.signOut(); }));
      box.appendChild(msg);
    });
  }

  function viewWait(d) {
    show(function (box) {
      info(box, "Wartet auf Freischaltung", "Hallo " + (d.name || "") + ", dein Konto ist angelegt. Der Verwalter muss dich noch freischalten und deinem Spieler zuordnen. Sobald das passiert ist, geht es hier automatisch weiter.");
      box.appendChild(button("Abmelden", "btn ghost", function () { auth.signOut(); }));
    });
  }

  function viewError(text) {
    show(function (box) {
      info(box, "Keine Verbindung", text);
      box.appendChild(button("Erneut versuchen", "btn", function () { location.reload(); }));
    });
  }

  // ---------- Ablauf nach der Anmeldung ----------
  var unsubMe = null;
  function handleUser(u) {
    if (unsubMe) { unsubMe(); unsubMe = null; }
    if (!u) { if (started) { location.reload(); return; } viewLogin("login"); return; }
    if (!u.emailVerified) { viewVerify(u); return; }
    show(function (box) { box.appendChild(h("div", "auth-msg", "Lade …")); });
    var ref = fs.doc("nutzer/" + u.uid);
    unsubMe = ref.onSnapshot(function (snap) {
      if (!auth.currentUser || auth.currentUser.uid !== u.uid) return;   // Meldung zu einem vorher angemeldeten Konto
      if (!snap.exists) {
        // Erst als Verwalter versuchen: Das erlauben die Regeln in Firebase nur der Verwalter-Adresse.
        // Alle anderen werden abgewiesen und als „wartet auf Freischaltung“ angelegt.
        var mk = function (rolle) { return ref.set({ email: u.email, name: pendingName || u.displayName || String(u.email).split("@")[0], rolle: rolle, spielerId: null, angelegt: firebase.firestore.FieldValue.serverTimestamp() }); };
        var first = ADMIN ? (String(u.email || "").toLowerCase() === ADMIN ? "admin" : "warten") : "admin";
        mk(first).catch(function (e) { if (first === "admin") return mk("warten"); throw e; })
          .catch(function (e) { viewError("Konto konnte nicht angelegt werden: " + msgOf(e)); });
        return;
      }
      var d = snap.data();
      if (started) {   // Rolle oder Spieler wurde geändert → neu starten, damit alles passt
        if (!me || d.rolle !== me.rolle || (d.spielerId || null) !== (me.spielerId || null) || !!d.kassierer !== me.kassierer) location.reload();
        return;
      }
      if (DARF_LESEN[d.rolle]) start(u, d); else viewWait(d);
    }, function (e) { viewError("Dein Konto konnte nicht geladen werden (" + msgOf(e) + ")."); });
  }

  function start(u, d) {
    started = true;
    var canWrite = !!DARF_SCHREIBEN[d.rolle];
    me = { uid: u.uid, email: u.email, name: d.name || "", rolle: d.rolle, spielerId: d.spielerId || null, canWrite: canWrite, admin: d.rolle === "admin", kassierer: !!d.kassierer };
    window.KSV_ME = me;
    window.KSV_LOGOUT = function () { auth.signOut(); };
    document.body.classList.add("cloud");
    document.body.classList.toggle("admin", me.admin);
    document.body.classList.toggle("ro", !canWrite);
    window.KSV_CLOUD = cloudApi();
    resolveReady({
      db: fs,
      user: {
        can: function (perm) { return Promise.resolve(perm === "data.write" ? canWrite : true); },
        canEdit: function () { return canWrite; }, isOwner: function () { return me.admin; },
        id: function () { return Promise.resolve(u.uid); }, me: function () { return Promise.resolve({ id: u.uid, name: me.name }); },
        profiles: function () { return Promise.resolve({}); }
      }
    });
    hide();
    buildKonto();
    if (window.__ksvMeReady) window.__ksvMeReady(me);
  }

  // ---------- Regelwerk in der Cloud (PDF in Teilen, eingelesener Text, Kopfdaten) ----------
  var CHUNK = 700000;
  function cloudApi() {
    return {
      regel: {
        meta: function () { return fs.doc("regelwerk/meta").get().then(function (s) { return s.exists ? s.data() : null; }); },
        text: function () { return fs.doc("regelwerk/text").get().then(function (s) { return s.exists ? s.data().blocks || null : null; }); },
        pdf: function (m) {
          var ps = []; for (var i = 0; i < (m.chunks || 0); i++) ps.push(fs.doc("regelwerk/pdf_" + i).get());
          return Promise.all(ps).then(function (ss) { return ss.map(function (s) { return s.exists ? s.data().d : ""; }).join(""); });
        },
        save: function (b64, name, blocks, pages) {
          return fs.doc("regelwerk/meta").get().then(function (old) {
            // b64 = null: nur der (bearbeitete) Text wird gespeichert, alte PDF-Teile werden entfernt
            var n = b64 ? Math.ceil(b64.length / CHUNK) : 0, batch = fs.batch(), oldN = old.exists ? old.data().chunks || 0 : 0;
            for (var i = 0; i < n; i++) batch.set(fs.doc("regelwerk/pdf_" + i), { d: b64.slice(i * CHUNK, (i + 1) * CHUNK) });
            for (var j = n; j < oldN; j++) batch.delete(fs.doc("regelwerk/pdf_" + j));
            var now = Date.now();
            batch.set(fs.doc("regelwerk/text"), { blocks: JSON.parse(JSON.stringify(blocks || [])), updated: now });
            batch.set(fs.doc("regelwerk/meta"), { name: name || "Regelwerk", size: b64 ? Math.round(b64.length * 3 / 4) : JSON.stringify(blocks || []).length, pages: pages || 0, chunks: n, updated: now, von: me ? me.name : "" });
            return batch.commit().then(function () { return now; });
          });
        }
      }
    };
  }

  // ---------- Datensicherung über die Cloud ----------
  window.KSV_BACKUP = {
    canRestore: function () { return !!(me && me.canWrite); },
    dump: function () {
      return Promise.all([fs.doc("config/main").get(), fs.collection("spieltage").get(), fs.doc("regelwerk/text").get()]).then(function (r) {
        return { app: "KSV 08/15 Spielbuch", version: 1, exported: new Date().toISOString(), config: r[0].exists ? r[0].data() : {},
          spieltage: r[1].docs.map(function (d) { return { id: d.id, data: d.data() }; }), regelwerk: null,
          regeltext: r[2].exists ? r[2].data().blocks || null : null };
      });
    },
    restore: function (obj) {
      if (!me || !me.canWrite) return Promise.reject(new Error("Nur wer eintragen darf, kann eine Sicherung einspielen."));
      return fs.collection("spieltage").get().then(function (cur) {
        var ops = [];
        var keep = {}; obj.spieltage.forEach(function (g) { keep[g.id] = 1; });
        cur.docs.forEach(function (d) { if (!keep[d.id]) ops.push(function (b) { b.delete(d.ref); }); });
        ops.push(function (b) { b.set(fs.doc("config/main"), obj.config); });
        obj.spieltage.forEach(function (g) { if (g && g.id && g.data) ops.push(function (b) { b.set(fs.doc("spieltage/" + g.id), g.data); }); });
        return commitInBatches(ops).then(function () {
          if (obj.regeltext && window.KSV_CLOUD) return window.KSV_CLOUD.regel.save(null, "Regelwerk", obj.regeltext, 0);
        }).then(function () { if (window.__ksvRegelReload) window.__ksvRegelReload(); });
      });
    }
  };
  function commitInBatches(ops) {
    var p = Promise.resolve();
    for (var i = 0; i < ops.length; i += 400) (function (part) {
      p = p.then(function () { var b = fs.batch(); part.forEach(function (op) { op(b); }); return b.commit(); });
    })(ops.slice(i, i + 400));
    return p;
  }

  // ---------- Optionen: Konto, Mitglieder & Rechte, Übernahme der lokalen Daten ----------
  function buildKonto() {
    var settings = document.getElementById("settings"); if (!settings) return;
    var grid = h("div", "setgrid"); grid.id = "kontoGrid";
    var head = settings.querySelector(".sechead");
    if (head && head.nextSibling) settings.insertBefore(grid, head.nextSibling); else settings.appendChild(grid);

    // Eigenes Konto
    var acc = h("div", "field set-keep"); acc.appendChild(h("span", "label", "Dein Konto"));
    var line = h("div", "konto-me");
    line.appendChild(h("b", null, me.name || me.email));
    line.appendChild(h("span", "tag", ROLLEN[me.rolle] || me.rolle));
    if (me.kassierer) line.appendChild(h("span", "tag", "Kassierer"));
    var pl = h("span", "msg", ""); line.appendChild(pl);
    acc.appendChild(line);
    acc.appendChild(h("span", "msg", me.email));
    var out = button("Abmelden", "iconbtn", function () { auth.signOut(); }); out.style.alignSelf = "flex-start"; out.style.marginTop = "6px";
    acc.appendChild(out);
    grid.appendChild(acc);

    var players = [];
    fs.doc("config/main").onSnapshot(function (s) {
      players = (s.exists && s.data().players) || [];
      var p = players.find(function (x) { return x.id === me.spielerId; });
      pl.textContent = p ? "Spieler: " + p.name : "Noch keinem Spieler zugeordnet";
      if (me.admin) renderUsers();
    }, function () { });

    // Lokale Daten dieses Handys in die Cloud übernehmen (einmalig, für Verwalter/Eintragende)
    if (me.canWrite) offerMigration(grid);

    if (!me.admin) return;
    var box = h("div", "field"); box.appendChild(h("span", "label", "Mitglieder & Rechte"));
    var list = h("div"); box.appendChild(list);
    box.appendChild(h("span", "msg", "Neue Mitglieder registrieren sich selbst in der App. Hier schaltest du sie frei, ordnest sie einem Spieler zu und legst die Rechte fest. Kassierer bestätigen gemeldete Zahlungen."));
    var umsg = h("span", "msg", ""); box.appendChild(umsg);
    grid.appendChild(box);
    var users = [];
    function renderUsers() {
      list.textContent = "";
      var waiting = 0;
      users.sort(function (a, b) { return (a.d.rolle === "warten" ? 0 : 1) - (b.d.rolle === "warten" ? 0 : 1) || String(a.d.name).localeCompare(String(b.d.name), "de"); });
      users.forEach(function (x) {
        var d = x.d, self = x.id === me.uid, row = h("div", "konto-row" + (d.rolle === "warten" ? " wait" : ""));
        if (d.rolle === "warten") waiting++;
        var who = h("div", "who"); who.appendChild(h("b", null, (d.name || "?") + (self ? " (du)" : ""))); who.appendChild(h("span", null, d.email || "")); row.appendChild(who);
        var ctl = h("div", "ctl");
        var sp = h("select"); sp.setAttribute("aria-label", "Spieler von " + (d.name || ""));
        var o0 = h("option", null, "– Spieler wählen –"); o0.value = ""; sp.appendChild(o0);
        players.filter(function (p) { return !p.hidden || p.id === d.spielerId; }).forEach(function (p) { var o = h("option", null, p.name + (p.guest ? " (Gast)" : "")); o.value = p.id; sp.appendChild(o); });
        sp.value = d.spielerId || ""; if (!d.spielerId) sp.classList.add("need");
        sp.onchange = function () { fs.doc("nutzer/" + x.id).update({ spielerId: sp.value || null }).catch(function (e) { umsg.textContent = msgOf(e); }); };
        var rl = h("select"); rl.setAttribute("aria-label", "Rechte von " + (d.name || ""));
        Object.keys(ROLLEN).forEach(function (k) { var o = h("option", null, ROLLEN[k]); o.value = k; rl.appendChild(o); });
        rl.value = d.rolle; rl.disabled = self; if (d.rolle === "warten") rl.classList.add("need");
        rl.onchange = function () { fs.doc("nutzer/" + x.id).update({ rolle: rl.value }).catch(function (e) { umsg.textContent = msgOf(e); }); };
        var kl = h("label", "kass-cb"), kc = h("input"); kc.type = "checkbox"; kc.checked = !!d.kassierer;
        kc.onchange = function () { fs.doc("nutzer/" + x.id).update({ kassierer: kc.checked }).catch(function (e) { kc.checked = !kc.checked; umsg.textContent = msgOf(e); }); };
        kl.appendChild(kc); kl.appendChild(document.createTextNode(" Kassierer"));
        ctl.appendChild(sp); ctl.appendChild(rl); ctl.appendChild(kl);
        if (!self) ctl.appendChild(button("Entfernen", "iconbtn", function () {
          window.appConfirm({ title: "Mitglied entfernen?", text: (d.name || d.email) + " hat danach keinen Zugriff mehr auf das Spielbuch.", ok: "Entfernen", danger: true }).then(function (ok) {
            if (ok) fs.doc("nutzer/" + x.id).delete().catch(function (e) { umsg.textContent = msgOf(e); });
          });
        }));
        row.appendChild(ctl); list.appendChild(row);
      });
      var ab = document.getElementById("acctBtn"), sb = document.getElementById("setBadge");
      if (ab) ab.classList.toggle("dot", waiting > 0);
      if (sb) { sb.hidden = !waiting; sb.textContent = String(waiting); }
    }
    fs.collection("nutzer").onSnapshot(function (s) {
      users = s.docs.map(function (d) { return { id: d.id, d: d.data() }; }); renderUsers();
    }, function (e) { umsg.textContent = "Mitgliederliste nicht verfügbar: " + msgOf(e); });
  }

  function offerMigration(grid) {
    var P = "ksvdb:", localCfg = null, games = [];
    try {
      localCfg = localStorage.getItem(P + "config/main");
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(P + "spieltage/") === 0) games.push(k); }
    } catch (e) { return; }
    var hasRules = false; try { hasRules = !!(window.AndroidApp && window.AndroidApp.rulesInfo && window.AndroidApp.rulesInfo()); } catch (e) { }
    if (!localCfg && !games.length) return;
    fs.doc("config/main").get().then(function (s) {
      if (s.exists && localStorage.getItem("ksv-migriert")) return;
      var box = h("div", "field"); box.appendChild(h("span", "label", "Daten von diesem Handy"));
      box.appendChild(h("span", "msg", "Auf diesem Handy liegen " + games.length + " Spieltage" + (hasRules ? " und das Regelwerk" : "") + " aus der bisherigen App." +
        (s.exists ? " In der Cloud sind schon Daten vorhanden – beim Übernehmen werden sie ersetzt." : " Die Cloud ist noch leer.")));
      var m = h("span", "msg", "");
      var go = button("In die Cloud übernehmen", "btn", function () {
        (s.exists ? window.appConfirm({ title: "Daten übernehmen?", text: "Die Daten in der Cloud werden durch die Daten dieses Handys ersetzt.", ok: "Übernehmen", danger: true }) : Promise.resolve(true)).then(function (ok) { if (ok) migrate(); });
      });
      var migrate = function () {
        go.disabled = true; m.textContent = "Übertrage …";
        var obj = { config: JSON.parse(localCfg || "{}"), spieltage: games.map(function (k) { return { id: k.slice((P + "spieltage/").length), data: JSON.parse(localStorage.getItem(k)) }; }) };
        window.KSV_BACKUP.restore(obj).then(function () {
          if (!hasRules || !window.__ksvRegelToCloud) return null;
          m.textContent = "Übertrage das Regelwerk …";
          return window.__ksvRegelToCloud(window.AndroidApp.loadRules(), "Regelwerk.pdf");
        }).then(function () {
          try { localStorage.setItem("ksv-migriert", new Date().toISOString()); } catch (e) { }
          m.textContent = "Fertig: " + obj.spieltage.length + " Spieltage" + (hasRules ? " und das Regelwerk" : "") + " sind jetzt in der Cloud.";
          go.hidden = true;
        }).catch(function (e) { go.disabled = false; m.textContent = "Übertragung fehlgeschlagen: " + msgOf(e); });
      };
      go.style.alignSelf = "flex-start"; go.style.marginTop = "6px";
      box.appendChild(go); box.appendChild(m); grid.appendChild(box);
    }).catch(function () { });
  }

  // ---------- Start ----------
  function boot() {
    show(function (box) { box.appendChild(h("div", "auth-msg", "Verbinde …")); });
    loadSdk().then(function () {
      var conf = {}; Object.keys(CFG).forEach(function (k) { if (k !== "adminEmail") conf[k] = CFG[k]; });
      fb = firebase.initializeApp(conf);
      auth = firebase.auth(); auth.languageCode = "de";
      fs = firebase.firestore();
      try { fs.enablePersistence().catch(function () { }); } catch (e) { }
      auth.onAuthStateChanged(handleUser);
    }).catch(function () { viewError("Die Anmeldung konnte nicht geladen werden. Bitte prüfe die Internetverbindung."); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
