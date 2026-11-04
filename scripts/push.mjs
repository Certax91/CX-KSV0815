// Versendet die Push-Nachrichten des KSV 08/15 Spielbuchs (läuft alle ~10 Minuten in GitHub Actions).
//
// 1. Ereignisse aus der Sammlung „ereignisse“ (von der App gemeldet) an die passenden Mitglieder schicken.
// 2. Am Vortag eines Termins erinnern (an alle, die nicht abgesagt haben).
// 3. Sonntags ab 18 Uhr an offene Beträge erinnern (einmal pro Woche).
//
// Empfänger: nur freigeschaltete Konten; wer ein Thema in den Einstellungen abgewählt hat, bekommt es nicht;
// wer das Ereignis selbst ausgelöst hat, bekommt keine Nachricht dazu.
import admin from "firebase-admin";

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore(), fcm = admin.messaging();
const WEB = (process.env.WEB_URL || "").replace(/\/?$/, "/");
const TZ = "Europe/Berlin";

const dayIso = (offsetDays = 0) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 864e5));
const berlin = () => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", hour: "2-digit", hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value])); return { wd: p.weekday, h: +p.hour }; };
const deDate = iso => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };

const nutzer = (await db.collection("nutzer").get()).docs.map(d => ({ uid: d.id, ...d.data() }));
let geraete = (await db.collection("geraete").get()).docs.map(d => ({ token: d.id, ...d.data() }));
const aktiv = nutzer.filter(n => ["lesen", "schreiben", "admin"].includes(n.rolle));

function empfaenger(an) {
  if (!an || an === "alle") return aktiv;
  if (an === "kassierer") return aktiv.filter(n => n.kassierer);
  if (an === "verwalter") return aktiv.filter(n => n.rolle === "admin");
  if (an.startsWith("spieler:")) { const p = an.slice(8); return aktiv.filter(n => n.spielerId === p); }
  if (an.startsWith("uid:")) { const u = an.slice(4); return nutzer.filter(n => n.uid === u); }
  return [];
}

let gesendet = 0;
async function senden(ev, liste) {
  const wer = (liste || empfaenger(ev.an)).filter(n => n.uid !== ev.von && (n.push || {})[ev.kat] !== false);
  const tokens = geraete.filter(g => wer.some(n => n.uid === g.uid)).map(g => g.token);
  if (!tokens.length) return;
  const link = WEB + (ev.tab ? "?tab=" + ev.tab : "");
  for (let i = 0; i < tokens.length; i += 500) {
    const part = tokens.slice(i, i + 500);
    const res = await fcm.sendEachForMulticast({
      tokens: part,
      notification: { title: ev.titel, body: ev.text || "" },
      data: { tab: ev.tab || "", title: ev.titel, body: ev.text || "" },
      android: { priority: "high", notification: { channelId: "ksv", icon: "ic_stat_ksv", color: "#C98A12" } },
      webpush: { fcmOptions: { link }, notification: { icon: WEB + "icons/icon-192.png" } }
    });
    gesendet += res.successCount;
    // nicht mehr gültige Geräte entfernen
    await Promise.all(res.responses.map((r, k) => {
      const code = r.error?.code || "";
      if (!r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) {
        geraete = geraete.filter(g => g.token !== part[k]);
        return db.collection("geraete").doc(part[k]).delete().catch(() => {});
      }
    }));
  }
}

// 1. Gemeldete Ereignisse (gleichartige zusammenfassen, damit niemand zugeschüttet wird)
const evs = (await db.collection("ereignisse").orderBy("zeit").limit(300).get()).docs;
const gruppen = new Map();
for (const d of evs) {
  const e = d.data(), key = [e.kat, e.an, e.titel, e.von].join("|");
  if (!gruppen.has(key)) gruppen.set(key, { ...e, n: 0 });
  const g = gruppen.get(key); g.n++; g.text = e.text;   // jeweils die neueste Meldung
}
for (const ev of gruppen.values()) {
  try { await senden(ev.n > 1 && ev.kat === "antworten" ? { ...ev, text: `${ev.n} neue Antworten` } : ev); }
  catch (e) { console.error("Senden fehlgeschlagen:", e.message); }
}
for (let i = 0; i < evs.length; i += 400) { const b = db.batch(); evs.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit(); }

// 2. Erinnerung am Vortag eines Termins
const morgen = dayIso(1);
const termine = (await db.collection("planung").where("datum", "==", morgen).get()).docs.filter(d => d.data().typ === "termin" && !d.data().erinnert);
for (const d of termine) {
  const t = d.data();
  const absagen = new Set((await d.ref.collection("stimmen").get()).docs.filter(s => s.data().antwort === "nein").map(s => s.id));
  await senden({ kat: "erinnerung", tab: "plan", titel: `Morgen: ${t.titel || "Termin"}`, text: [t.zeit ? t.zeit + " Uhr" : "", t.ort || ""].filter(Boolean).join(" · ") || deDate(t.datum) },
    aktiv.filter(n => !absagen.has(n.uid)));
  await d.ref.update({ erinnert: true });
}

// 3. Wöchentliche Erinnerung an offene Beträge (Sonntag ab 18 Uhr)
const { wd, h } = berlin(), heute = dayIso(0), status = db.doc("push/status");
const st = (await status.get()).data() || {};
if (wd === "Sun" && h >= 18 && st.wocheErinnert !== heute) {
  const offen = {};
  (await db.collection("spieltage").get()).docs.forEach(d => { const g = d.data(); Object.entries(g.pay || {}).forEach(([pid, s]) => { if (s === "open") (offen[pid] ||= []).push(g.date); }); });
  for (const [pid, tage] of Object.entries(offen)) {
    await senden({ kat: "erinnerung", tab: "stand", titel: "Offene Beträge", text: `Du hast noch offene Beträge von ${tage.length} Spieltag${tage.length === 1 ? "" : "en"} – in der App bezahlen.` },
      aktiv.filter(n => n.spielerId === pid));
  }
  await status.set({ wocheErinnert: heute }, { merge: true });
}

console.log(`Ereignisse: ${evs.length}, Erinnerungen: ${termine.length}, zugestellt: ${gesendet}, Geräte: ${geraete.length}`);
