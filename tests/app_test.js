#!/usr/bin/env node
/*
 * Browsertests für die App (index.html, app.js, styles.css).
 *
 * Aufruf aus der Repo-Wurzel:  node tests/app_test.js
 *
 * Braucht Playwright mit Chromium (in Claude-Code-Cloud-Sitzungen vorinstalliert).
 * Läuft ohne Internet: Ein eigener kleiner Server liefert die App aus, alle Anfragen
 * an raw.githubusercontent.com kommen aus tests/daten/, YouTube wird nachgebaut.
 *
 * tests/daten/ enthält die Beispieldaten aus Sitzung 2 (taeglich/2026-10-30, 2026-10-31,
 * woechentlich/2026-10-25_2026-10-31) und erfundene Ausgaben für Sonderfälle
 * (ruhiger Tag, Fehler als neueste Ausgabe, Monats- und Jahresrückblick, ein Thema,
 * das es in themen.json nicht mehr gibt, HTML in den Daten). Diese erfundenen Dateien
 * verstoßen absichtlich teils gegen config/regeln.md.
 *
 * Das Vorlesen wird mit Attrappen für speechSynthesis, SpeechSynthesisUtterance,
 * navigator.wakeLock und die Sichtbarkeit der Seite geprüft, weil der Testbrowser keine
 * Stimmen hat. Ob echte Stimmen, Wake Lock und App-Wechsel am Handy funktionieren, lässt
 * sich nur dort prüfen.
 *
 * Alle Szenarien bis auf „PWA“ blockieren den Service Worker. Das PWA-Szenario liefert die App
 * wie GitHub Pages unter /mein-feed/ aus (nicht im Wurzelverzeichnis), prüft Manifest und Icons
 * und mit echtem Service Worker den Offline-Fall. Weil Playwright Anfragen, die der Test selbst
 * beantwortet, auch bei context.setOffline(true) durchlässt, bricht der Test sie dann zusätzlich ab.
 *
 * Exit-Code 0, wenn alle Prüfungen bestehen.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const WURZEL = path.resolve(__dirname, '..');
const APP = '/mein-feed/'; // Pfad der App auf GitHub Pages, nur im PWA-Szenario genutzt
const DATEN = path.join(__dirname, 'daten');
const START = '2026-10-25'; // „start“ in index.json (erste Tagesausgabe der Beispieldaten)
const BEISPIEL = new Set([
  'data/taeglich/2026-10-30.json',
  'data/taeglich/2026-10-31.json',
  'data/woechentlich/2026-10-25_2026-10-31.json',
]);

// ------------------------------------------------------------ Prüfen

let bestanden = 0;
const fehlgeschlagen = [];
function pruefe(name, bedingung, info = '') {
  if (bedingung) {
    bestanden += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fehlgeschlagen.push(name);
    console.log(`  ✗ ${name}${info ? `\n      ${info}` : ''}`);
  }
}

// ------------------------------------------------------------ Server und Daten

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// Nur fürs PWA-Szenario, je angefragtem Pfad: eine neue Version der Datei auf dem Server (ersatz)
// oder ein Server, der so viele Millisekunden nicht antwortet (verzoegerung). Das gehört in den
// Server, weil der Browser das Update von sw.js an context.route vorbei lädt.
const SERVER = { ersatz: new Map(), verzoegerung: new Map() };

function starteServer() {
  const server = http.createServer(async (anfrage, antwort) => {
    const angefragt = decodeURIComponent(new URL(anfrage.url, 'http://x').pathname);
    if (SERVER.verzoegerung.has(angefragt)) await warte(SERVER.verzoegerung.get(angefragt));
    // Wie auf GitHub Pages liegt die App auch unter /mein-feed/.
    const pfad = angefragt.startsWith(APP) ? angefragt.slice(APP.length - 1) : angefragt;
    const datei = path.join(WURZEL, pfad === '/' ? 'index.html' : pfad);
    if (!datei.startsWith(WURZEL + path.sep)) {
      antwort.writeHead(403);
      antwort.end();
      return;
    }
    if (SERVER.ersatz.has(angefragt)) {
      antwort.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] || 'application/octet-stream' });
      antwort.end(SERVER.ersatz.get(angefragt));
      return;
    }
    fs.readFile(datei, (fehler, inhalt) => {
      if (fehler) {
        antwort.writeHead(404);
        antwort.end('404');
        return;
      }
      antwort.writeHead(200, { 'content-type': TYPEN[path.extname(datei)] || 'application/octet-stream' });
      antwort.end(inhalt);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function alleAusgaben() {
  const liste = [];
  for (const format of ['taeglich', 'woechentlich', 'monatlich', 'jaehrlich']) {
    const ordner = path.join(DATEN, format);
    if (!fs.existsSync(ordner)) continue;
    for (const name of fs.readdirSync(ordner).filter((n) => n.endsWith('.json')).sort().reverse()) {
      const d = JSON.parse(fs.readFileSync(path.join(ordner, name), 'utf8'));
      liste.push({ format, titel: d.titel, zeitraum: d.zeitraum, datei: `data/${format}/${name}`, status: d.status, erschienen: d.erschienen });
    }
  }
  return liste;
}

// Nachgebaute YouTube-API: meldet für die Video-ID „Beispiel-00“ den Fehler 100 (nicht gefunden).
const YT_ATTRAPPE = `
  window.YT = { Player: function (ziel, o) {
    window.__yt = { host: o.host, videoId: o.videoId, playerVars: o.playerVars };
    var f = document.createElement('iframe'); f.src = o.host + '/embed/' + o.videoId; ziel.replaceWith(f);
    this.destroy = function () { f.remove(); };
    if (o.videoId === 'Beispiel-00') setTimeout(function () { o.events.onError({ data: 100 }); }, 50);
  } };
  window.onYouTubeIframeAPIReady();`;

function zusatzAusgaben(zusatz) {
  return Object.entries(zusatz || {}).map(([datei, d]) => ({ format: d.format, titel: d.titel, zeitraum: d.zeitraum, datei, status: d.status, erschienen: d.erschienen }));
}

/*
 * Ein Szenario bekommt einen frischen Browser-Kontext (leere Merkliste, leeres Feedback).
 * einstellungen.dateien: Set der Dateien, die index.json nennt (änderbar während des Laufs)
 * einstellungen.youtube: 'attrappe' oder 'gesperrt'
 * einstellungen.index: 'normal', '404' oder 'offline'
 * einstellungen.zusatz: weitere Ausgaben nur für dieses Szenario, { datei: Ausgabe }
 * einstellungen.vorbereitung: Funktion, die vor app.js in jeder Seite läuft (Attrappen)
 * Nur PWA-Szenario:
 * einstellungen.serviceWorker: true lässt den Service Worker zu
 * einstellungen.offline: true bricht jede Anfrage ab (zusätzlich zu context.setOffline)
 * einstellungen.anfragen: Array, sammelt alle Adressen (auch die des Service Workers)
 */
async function szenario(browser, basis, name, einstellungen, ablauf) {
  console.log(`\n${name}`);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'de-AT',
    acceptDownloads: true,
    // Ohne Block liefert der Service Worker alte Dateien aus seinem Cache; nur das PWA-Szenario lässt ihn zu.
    serviceWorkers: einstellungen.serviceWorker ? 'allow' : 'block',
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: basis });
  if (einstellungen.vorbereitung) await ctx.addInitScript(einstellungen.vorbereitung);
  await ctx.route('**/*', async (route) => {
    const url = route.request().url();
    if (einstellungen.anfragen) einstellungen.anfragen.push(url);
    if (einstellungen.offline) return route.abort('internetdisconnected');
    if (url.startsWith(basis)) return route.continue();
    const daten = url.split('/claude/feed-daten/')[1];
    if (url.startsWith('https://raw.githubusercontent.com/') && daten) {
      const kopf = { 'access-control-allow-origin': '*' };
      if (daten === 'data/index.json') {
        if (einstellungen.index === 'offline') return route.abort();
        if (einstellungen.index === '404') return route.fulfill({ status: 404, body: '404: Not Found', headers: kopf });
        const ausgaben = alleAusgaben().concat(zusatzAusgaben(einstellungen.zusatz)).filter((a) => einstellungen.dateien.has(a.datei));
        return route.fulfill({ json: { aktualisiert: '2026-11-01T03:45:00+01:00', start: START, ausgaben }, headers: kopf });
      }
      if (einstellungen.zusatz && einstellungen.zusatz[daten]) return route.fulfill({ json: einstellungen.zusatz[daten], headers: kopf });
      const datei = path.join(DATEN, daten.replace(/^data\//, ''));
      if (datei.startsWith(DATEN + path.sep) && fs.existsSync(datei)) {
        return route.fulfill({ body: fs.readFileSync(datei), contentType: 'application/json', headers: kopf });
      }
      return route.fulfill({ status: 404, body: '404: Not Found', headers: kopf });
    }
    if (url === 'https://www.youtube.com/iframe_api' && einstellungen.youtube === 'attrappe') {
      return route.fulfill({ contentType: 'text/javascript', body: YT_ATTRAPPE });
    }
    if (url.startsWith('https://www.youtube-nocookie.com/')) {
      return route.fulfill({ contentType: 'text/html', body: '<body style="background:#333;color:#fff">Player</body>' });
    }
    return route.abort(); // alles andere: kein Netz im Test
  });
  const seite = await ctx.newPage();
  const fehler = [];
  seite.on('pageerror', (e) => fehler.push(e.message));
  seite.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) fehler.push(m.text());
  });
  try {
    await ablauf(seite, ctx);
    if (!einstellungen.serviceWorker) {
      const sw = await seite.evaluate(async () => !navigator.serviceWorker
        || (!navigator.serviceWorker.controller && (await navigator.serviceWorker.getRegistrations()).length === 0));
      pruefe('Service Worker blockiert', sw);
    }
  } catch (e) {
    pruefe(`${name}: Ablauf ohne Abbruch`, false, e.stack || String(e));
  }
  pruefe('Keine Skriptfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const merkAnzahl = (seite) => seite.$$eval('.merk-eintrag', (e) => e.length);

// ------------------------------------------------------------ Attrappen fürs Vorlesen

/*
 * Läuft vor app.js in der Seite (deshalb ohne Zugriff auf diese Datei). Steuerung über
 * window.__sprache:
 *   gesprochen[]       alle speak()-Aufrufe mit Text, Stimme, Sprache und Tempo
 *   ende()             die laufende Äußerung ist fertig (onend)
 *   automatisch/dauer  jede Äußerung endet von selbst nach dauer ms
 *   stimmen(liste)     Stimmen „kommen an“ (voiceschanged)
 *   sichtbarkeit(w)    'hidden' oder 'visible', wie bei App-Wechsel oder Bildschirm aus
 *   wach()             hält gerade eine Wake-Lock-Sperre den Bildschirm an?
 *   sperreVerweigern   wakeLock.request() schlägt fehl
 *   abgebrochen, pausen, doppelt, anforderungen: Zähler für cancel(), pause(),
 *   speak() während noch gesprochen wird, und wakeLock.request()
 */
function sprachAttrappe() {
  const log = {
    gesprochen: [], abgebrochen: 0, pausen: 0, doppelt: 0, anforderungen: 0,
    automatisch: false, dauer: 5, sperreVerweigern: false,
  };
  window.__sprache = log;

  let stimmen = [];
  let aktuell = null;
  let uhr = 0;
  const synth = new EventTarget();
  synth.speaking = false;
  synth.pending = false;
  synth.paused = false;
  synth.getVoices = () => stimmen.slice();
  synth.speak = (u) => {
    if (aktuell) log.doppelt += 1;
    aktuell = u;
    synth.speaking = true;
    log.gesprochen.push({ text: u.text, stimme: u.voice ? u.voice.voiceURI : null, lang: u.lang, rate: u.rate });
    if (log.automatisch) uhr = setTimeout(() => log.ende(), log.dauer);
  };
  synth.cancel = () => {
    clearTimeout(uhr);
    const u = aktuell;
    aktuell = null;
    synth.speaking = false;
    log.abgebrochen += 1;
    if (u && u.onerror) setTimeout(() => u.onerror({ error: 'interrupted', utterance: u }), 0); // wie Chrome: später
  };
  synth.pause = () => { log.pausen += 1; };
  synth.resume = () => {};
  log.ende = () => {
    clearTimeout(uhr);
    const u = aktuell;
    aktuell = null;
    synth.speaking = false;
    if (u && u.onend) u.onend({ utterance: u });
  };
  log.stimmen = (liste) => {
    stimmen = liste;
    synth.dispatchEvent(new Event('voiceschanged'));
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => synth });
  window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) {
    Object.assign(this, { text: String(text), lang: '', voice: null, rate: 1, pitch: 1, volume: 1, onend: null, onerror: null });
  };

  let sicht = 'visible';
  const sperren = [];
  log.wach = () => sperren.some((s) => !s.released);
  const wakeLock = {
    request: async (typ) => {
      log.anforderungen += 1;
      if (log.sperreVerweigern) throw new DOMException('Abgelehnt', 'NotAllowedError');
      if (sicht !== 'visible') throw new DOMException('Seite nicht sichtbar', 'NotAllowedError');
      const s = new EventTarget();
      s.type = typ;
      s.released = false;
      s.release = async () => {
        if (s.released) return;
        s.released = true;
        s.dispatchEvent(new Event('release'));
      };
      sperren.push(s);
      return s;
    },
  };
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, get: () => wakeLock });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => sicht });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => sicht !== 'visible' });
  log.sichtbarkeit = (wert) => {
    sicht = wert;
    if (wert !== 'visible') sperren.forEach((s) => s.release()); // gibt der Browser beim Verstecken selbst frei
    document.dispatchEvent(new Event('visibilitychange'));
  };
}

const STIMMEN = [
  { name: 'English (US)', lang: 'en-US', voiceURI: 'en-us', localService: true },
  { name: 'Deutsch', lang: 'de-DE', voiceURI: 'de-de', localService: true },
  { name: 'Österreichisch', lang: 'de_AT', voiceURI: 'de-at', localService: true }, // manche Geräte melden „de_AT“
];

// Erfundener Jahresrückblick nur fürs Vorlesen: vier Kapitel, knifflige Satzgrenzen, zwei Videos, ein Verweis.
const JAHR_2025 = {
  beispiel: true,
  format: 'jaehrlich',
  titel: 'Jahresrückblick 2025',
  zeitraum: { von: '2025-01-01', bis: '2025-12-31' },
  erschienen: '2026-01-01T04:40:00+01:00',
  status: 'ok',
  fehler: null,
  ruhig: ['tirol', 'startups'],
  luecken: [],
  ausnahmen: [{ thema: 'weltpolitik', grund: 'Dieser Grund wird nicht vorgelesen.' }],
  meldungen: [
    {
      id: '2025-weltpolitik-1', datum: '2025-03-01', datum_bis: null, titel: 'Satzgrenzen im Test',
      text: 'Die Sitzung ist am 17. Dezember in St. Johann. Es geht u. a. um z. B. Straßen, rd. 25 Mio. Euro und Dr. Muster. Danach folgt die 2. Lesung im Jänner 2026. Wirklich? Ja!',
      warum_wichtig: 'Weil es z. B. ab 1. Jänner gilt.',
      themen: ['weltpolitik', 'ki'], hauptthema: 'weltpolitik', update: false, quellen: [{ name: 'Q', url: 'https://example.com/1' }],
    },
    {
      id: '2025-ki-1', datum: '2025-04-01', datum_bis: null, titel: 'Kapitel KI', text: 'Ein Satz.', warum_wichtig: 'Noch einer.',
      themen: ['ki'], hauptthema: 'ki', update: false, quellen: [{ name: 'Q', url: 'https://example.com/2' }],
    },
    {
      id: '2025-wirtschaft-1', datum: '2025-05-01', datum_bis: null, titel: 'Kapitel Wirtschaft', text: 'Der Zins bleibt bei 2 Prozent.', warum_wichtig: 'Kredite bleiben gleich teuer.',
      themen: ['wirtschaft'], hauptthema: 'wirtschaft', update: false, quellen: [{ name: 'Q', url: 'https://example.com/3' }],
    },
  ],
  videos: [
    { titel: 'Video A', kanal: 'Asianometry', dauer_min: 15, datum: '2025-06-01', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', thema: 'wirtschaft', warum: 'A.', hintergrund: false, neuer_kanal: false },
    { titel: 'Video B', kanal: 'Ben Felix', dauer_min: 20, datum: '2025-07-01', url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', thema: 'wirtschaft', warum: 'B.', hintergrund: false, neuer_kanal: false },
  ],
  abschnitte: [
    { typ: 'monatsueberblick', thema: 'politik', titel: 'Monatsüberblick', eintraege: [{ monat: '2025-11', text: 'Neue Regierung angelobt.' }] },
  ],
};
const JAHR_2025_SAETZE = [
  'Weltpolitik',
  'Satzgrenzen im Test',
  'Die Sitzung ist am 17. Dezember in St. Johann.',
  'Es geht u. a. um z. B. Straßen, rd. 25 Mio. Euro und Dr. Muster.',
  'Danach folgt die 2. Lesung im Jänner 2026.',
  'Wirklich?',
  'Ja!',
  'Warum wichtig: Weil es z. B. ab 1. Jänner gilt.',
  'Politik in Österreich, Deutschland und der EU',
  'Monatsüberblick',
  'November: Neue Regierung angelobt.',
  'KI und Claude',
  'Kapitel KI',
  'Ein Satz.',
  'Warum wichtig: Noch einer.',
  'Börse und Wirtschaft',
  'Kapitel Wirtschaft',
  'Der Zins bleibt bei 2 Prozent.',
  'Warum wichtig: Kredite bleiben gleich teuer.',
  'Dazu gibt es zwei Video-Empfehlungen.',
  'Dieses Jahr ruhig: Tirol und Innsbruck, Startups',
];

// ------------------------------------------------------------ Szenarien

async function beispieldaten(seite, ctx, basis, einstellungen, ordner) {
  await seite.clock.setFixedTime(new Date('2026-11-01T08:00:00+01:00'));
  await seite.goto(basis);
  await seite.waitForSelector('.ausgabe .meldung');

  // Kopf und Reihenfolge
  const titel = await seite.$$eval('.ausgabe-titel', (h) => h.map((x) => x.textContent.trim()));
  pruefe('Heute: neueste oben, ältere darunter', titel[0] === 'Samstag, 31. Oktober 2026' && titel[1] === 'Freitag, 30. Oktober 2026', JSON.stringify(titel));
  pruefe('Ältere Ausgabe zugeklappt', (await seite.$$('.ausgabe--zu')).length === 1);
  const meta = await seite.$eval('.ausgabe .ausgabe-meta', (p) => p.textContent);
  pruefe('Kopf: Zeitraum und Stand', meta === 'Zeitraum: 31.10.2026 · Stand: 1.11.2026, 3:12 Uhr', meta);
  const pills = await seite.$$eval('.ausgabe:first-of-type .pills .pill', (p) => p.map((x) => x.textContent));
  pruefe('Kopf: Beispiel und Status', JSON.stringify(pills) === '["Beispiel","Vollständig"]', JSON.stringify(pills));
  pruefe('Zugeklappte Fehlerausgabe zeigt „Fehler“', (await seite.$eval('.ausgabe--zu .pill', (p) => p.textContent)) === 'Fehler');
  pruefe('Am 1.11. um 8:00 kein Hinweis „noch keine Ausgabe“', !(await seite.$('.hinweis--warnung')));

  const themen = await seite.$$eval('.ausgabe:first-of-type .thema-titel', (h) => h.map((x) => x.textContent));
  pruefe('Themen in Reihenfolge, leere ausgeblendet', JSON.stringify(themen) === JSON.stringify(['Weltpolitik', 'Politik in Österreich, Deutschland und der EU', 'KI und Claude', 'Börse und Wirtschaft']), JSON.stringify(themen));
  const ruhig = await seite.$eval('.ausgabe:first-of-type .ruhig', (p) => p.textContent);
  pruefe('Ruhig-Zeile', ruhig === 'Heute ruhig: Tirol und Innsbruck, Startups', ruhig);
  const ausnahme = await seite.$eval('.thema[data-thema="weltpolitik"] .ausnahme', (p) => p.textContent);
  pruefe('Ausnahme-Hinweis', ausnahme.startsWith('4 statt 3 Meldungen: Wahl, Waffenruhe'), ausnahme);
  pruefe('Kennzeichen „Update“', (await seite.$$('.marke--update')).length === 1);
  const quellen = await seite.$$eval('[data-meldung="2026-10-31-weltpolitik-2"] .quellen a', (a) => a.map((x) => [x.href, x.target]));
  pruefe('Quellenlinks öffnen in neuem Tab', quellen.length === 3 && quellen[0][0].startsWith('https://example.com/') && quellen[0][1] === '_blank', JSON.stringify(quellen));

  // Verweis
  const voll = await seite.$$eval('.meldung', (m) => m.filter((x) => x.dataset.meldung === '2026-10-31-politik-1').length);
  const verweis = await seite.$$eval('.thema[data-thema="ki"] .verweis', (v) => v.map((x) => x.textContent));
  pruefe('Meldung mit zwei Themen: einmal vollständig, einmal Verweis', voll === 1 && verweis.length === 1 && verweis[0].endsWith('→ siehe Politik in Österreich, Deutschland und der EU'), JSON.stringify(verweis));
  await seite.click('.thema[data-thema="ki"] .verweis');
  await warte(900);
  const sprung = await seite.evaluate(() => {
    const z = [...document.querySelectorAll('.meldung')].find((m) => m.dataset.meldung === '2026-10-31-politik-1');
    const r = z.getBoundingClientRect();
    return { oben: r.top, kopf: document.querySelector('.app-kopf').getBoundingClientRect().bottom, fokus: document.activeElement === z, ziel: z.classList.contains('ziel') };
  });
  pruefe('Verweis springt zur Meldung', sprung.fokus && sprung.ziel && sprung.oben >= sprung.kopf - 2 && sprung.oben < sprung.kopf + 40, JSON.stringify(sprung));

  // Fehlerausgabe aufklappen
  await seite.click('.ausgabe--zu .ausgabe-umschalter');
  await seite.waitForSelector('.hinweis--fehler');
  const fh = await seite.$eval('.hinweis--fehler', (h) => h.textContent);
  pruefe('Fehlerhinweis mit Text', fh.includes('Bei dieser Ausgabe ist etwas schiefgegangen.') && fh.includes('Keine der festen Quellen war erreichbar') && fh.includes('Davor gibt es noch keine erfolgreiche Ausgabe.'), fh);
  await seite.evaluate(() => window.scrollTo(0, 0));

  // Themen-Chips
  await seite.click('.chip[data-thema="ki"]');
  await warte(200);
  let sichtbar = await seite.$$eval('.ausgabe:first-of-type .thema', (s) => s.map((x) => x.dataset.thema));
  pruefe('Chip KI filtert', JSON.stringify(sichtbar) === '["ki"]', JSON.stringify(sichtbar));
  pruefe('Ruhig-Zeile richtet sich nach dem Filter', !(await seite.$('.ausgabe:first-of-type .ruhig')));
  await seite.click('.thema[data-thema="ki"] .verweis');
  await warte(900);
  sichtbar = await seite.$$eval('.ausgabe:first-of-type .thema', (s) => s.map((x) => x.dataset.thema));
  const chipsAn = await seite.$$eval('.chip[aria-pressed="true"]', (c) => c.map((x) => x.textContent));
  pruefe('Verweis bei Filter blendet das Zielthema ein', JSON.stringify(sichtbar) === '["politik","ki"]' && JSON.stringify(chipsAn) === '["Politik","KI"]', JSON.stringify([sichtbar, chipsAn]));
  await seite.click('.chip[data-thema="tirol"]');
  await seite.click('.chip[data-thema="politik"]');
  await seite.click('.chip[data-thema="ki"]');
  await warte(200);
  const nurTirol = await seite.$eval('.ausgabe:first-of-type .ausgabe-koerper', (k) => [k.querySelectorAll('.thema').length, k.querySelector('.ruhig') && k.querySelector('.ruhig').textContent]);
  pruefe('Filter Tirol: nur die Ruhig-Zeile', nurTirol[0] === 0 && nurTirol[1] === 'Heute ruhig: Tirol und Innsbruck', JSON.stringify(nurTirol));
  await seite.click('.chip:first-child');
  await warte(200);
  pruefe('„Alle“ setzt den Filter zurück', (await seite.$$('.ausgabe:first-of-type .thema')).length === 4);

  // Feedback
  await seite.click('[data-meldung="2026-10-31-weltpolitik-4"] .knopf--unnoetig');
  pruefe('„Unnötig“ markiert', (await seite.$eval('[data-meldung="2026-10-31-weltpolitik-4"] .knopf--unnoetig', (b) => b.getAttribute('aria-pressed'))) === 'true');
  await seite.click('.ausgabe:first-of-type .gefehlt summary');
  await seite.fill('.ausgabe:first-of-type .gefehlt textarea', 'Die Sperre der Inntalautobahn bei Kufstein');
  await seite.click('.ausgabe:first-of-type .gefehlt button[type="submit"]');
  const gef = await seite.$eval('.ausgabe:first-of-type .gefehlt', (g) => [g.querySelector('summary').textContent, g.querySelectorAll('.gefehlt-liste li').length]);
  pruefe('„Hat gefehlt“ notiert', gef[0] === 'Hat etwas gefehlt? (1 notiert)' && gef[1] === 1, JSON.stringify(gef));

  // Speichern
  await seite.click('[data-meldung="2026-10-31-wirtschaft-1"] .knopf--merk');
  await warte(150);
  await seite.click('.ausgabe:first-of-type .aktionen--kopf .knopf--merk');
  await warte(150);
  pruefe('Speichern-Knopf wechselt', (await seite.$eval('[data-meldung="2026-10-31-wirtschaft-1"] .knopf--merk', (b) => b.textContent)) === 'Gespeichert ✓');

  // Woche
  await seite.click('.tabs a[data-tab="woche"]');
  await seite.waitForSelector('.abschnitt--finanzierungsrunden');
  const w = await seite.evaluate(() => ({
    titel: document.querySelector('.ausgabe-titel').textContent,
    themen: [...document.querySelectorAll('.ausgabe .thema')].map((s) => s.dataset.thema),
    ruhig: document.querySelector('.ruhig').textContent,
    datum: document.querySelector('[data-meldung="2026-10-25_2026-10-31-weltpolitik-1"] .meldung-datum').textContent,
    verweis: [...document.querySelectorAll('.thema[data-thema="wirtschaft"] .verweis-ziel')].map((v) => v.textContent),
    videos: [...document.querySelectorAll('.video')].map((v) => [v.closest('.thema').dataset.thema, v.querySelector('.video-meta').textContent]),
    runden: document.querySelectorAll('.abschnitt--finanzierungsrunden li').length,
    amEnde: document.querySelector('.thema[data-thema="startups"]').lastElementChild.classList.contains('abschnitt'),
  }));
  pruefe('Woche: Titel', w.titel === 'Woche vom 25. bis 31. Oktober 2026', w.titel);
  pruefe('Woche: Themen', JSON.stringify(w.themen) === '["weltpolitik","politik","ki","wirtschaft","startups"]', JSON.stringify(w.themen));
  pruefe('Woche: Ruhig-Zeile', w.ruhig === 'Diese Woche ruhig: Tirol und Innsbruck', w.ruhig);
  pruefe('Woche: Zeitraum der Meldung', w.datum === '27. bis 31. Oktober', w.datum);
  pruefe('Woche: Verweis „→ siehe KI und Claude“', JSON.stringify(w.verweis) === '["→ siehe KI und Claude"]', JSON.stringify(w.verweis));
  pruefe('Woche: Videos im Thema', w.videos.length === 2 && w.videos[0][0] === 'ki' && w.videos[0][1] === 'AI Explained · 14 Min. · 30. Oktober', JSON.stringify(w.videos));
  pruefe('Woche: Finanzierungsrunden kompakt am Themenende', w.runden === 3 && w.amEnde);

  // Video ohne YouTube-API (hier gesperrt): einfaches iframe über youtube-nocookie.com
  const video = seite.locator('.thema[data-thema="wirtschaft"] .video');
  await video.locator('.video-start').click();
  await seite.waitForSelector('.thema[data-thema="wirtschaft"] .video iframe', { timeout: 15000 });
  const src = await video.locator('iframe').getAttribute('src');
  pruefe('Video eingebettet über youtube-nocookie.com', src.startsWith('https://www.youtube-nocookie.com/embed/gADulYiRSww?'), src);
  await video.locator('.knopf--merk').click();
  await warte(150);
  await video.locator('.video-start').click();
  pruefe('Video lässt sich schließen', (await video.locator('iframe').count()) === 0);

  // Monat und Jahr
  await seite.click('.tabs a[data-tab="monat"]');
  await warte(300);
  const monat = await seite.$eval('#inhalt', (m) => m.textContent.trim());
  pruefe('Monat: Hinweis, dass der Oktober-Rückblick fehlt', monat.includes('Noch kein Monatsrückblick') && monat.includes('Oktober 2026'), monat);
  await seite.click('.tabs a[data-tab="jahr"]');
  await warte(300);
  const jahr = await seite.$eval('#inhalt', (m) => m.textContent.trim());
  pruefe('Jahr: leer mit nächstem Termin', jahr === 'Noch kein Jahresrückblick vorhanden. Der nächste erscheint am 1. Jänner 2027.', jahr);

  // Merkliste
  await seite.click('.tabs a[data-tab="merkliste"]');
  await seite.waitForSelector('.merk-eintrag');
  const merk = await seite.$$eval('.merk-eintrag', (e) => e.map((x) => x.querySelector('.meldung-titel, .video-titel, .ausgabe-titel').textContent));
  pruefe('Merkliste: 3 Einträge, zuletzt gespeichert zuerst', merk.length === 3 && merk[0].startsWith('Silicon Valley') && merk[1] === 'Samstag, 31. Oktober 2026' && merk[2].startsWith('Beispiel-Halbleiter'), JSON.stringify(merk));
  await seite.click('.merk-eintrag .ausgabe-umschalter');
  await warte(200);
  pruefe('Gespeicherte Ausgabe lässt sich öffnen', (await seite.$$('.merk-eintrag .ausgabe .thema')).length === 4);
  await seite.click('#feedback .knopf--primaer');
  await warte(200);
  const clip = await seite.evaluate(() => navigator.clipboard.readText());
  pruefe('Feedback kopieren', clip.includes('config/regeln.md') && clip.includes('Inselstaat Musterhafen') && clip.includes('Die Sperre der Inntalautobahn') && clip.includes('Beispieldaten'), clip);

  await seite.evaluate(() => window.scrollTo(0, 0));
  const [download] = await Promise.all([seite.waitForEvent('download'), seite.click('.merk-kopf .knopf:has-text("Exportieren")')]);
  const exportPfad = path.join(ordner, download.suggestedFilename());
  await download.saveAs(exportPfad);
  const exp = JSON.parse(fs.readFileSync(exportPfad, 'utf8'));
  pruefe('Export-Datei', exp.app === 'mein-feed' && exp.eintraege.length === 3, download.suggestedFilename());

  await seite.reload();
  await seite.waitForSelector('.merk-eintrag');
  pruefe('Merkliste bleibt nach Neuladen', (await merkAnzahl(seite)) === 3);
  pruefe('Feedback bleibt nach Neuladen', (await seite.$eval('#feedback .klein', (p) => p.textContent)).includes('1 × „Unnötig“, 1 × „Hat gefehlt“'));

  // Ausgabe im Repo gelöscht
  einstellungen.dateien.delete('data/taeglich/2026-10-31.json');
  await seite.reload();
  await seite.waitForSelector('.merk-eintrag');
  pruefe('Merkliste bleibt, obwohl die Ausgabe im Repo fehlt', (await merkAnzahl(seite)) === 3);
  await seite.click('.tabs a[data-tab="heute"]');
  await seite.waitForSelector('.ansicht:not(.merkliste) .ausgabe');
  pruefe('Heute zeigt dann nur noch den 30.10.', (await seite.$$eval('.ausgabe-titel', (h) => h.map((x) => x.textContent))).join() === 'Freitag, 30. Oktober 2026');
  einstellungen.dateien.add('data/taeglich/2026-10-31.json');

  // Import
  await seite.click('.tabs a[data-tab="merkliste"]');
  await seite.waitForSelector('.merk-eintrag');
  await seite.evaluate(() => new Promise((fertig) => {
    const r = indexedDB.open('mein-feed', 1);
    r.onsuccess = () => {
      const t = r.result.transaction('merkliste', 'readwrite');
      t.objectStore('merkliste').clear();
      t.oncomplete = () => { r.result.close(); fertig(); };
    };
  }));
  await seite.reload();
  await seite.waitForSelector('.merkliste');
  pruefe('Merkliste geleert', (await merkAnzahl(seite)) === 0);
  await seite.setInputFiles('.merk-kopf input[type="file"]', exportPfad);
  await seite.waitForSelector('.merk-eintrag');
  pruefe('Import stellt die Merkliste wieder her', (await merkAnzahl(seite)) === 3 && (await seite.$eval('#toast', (t) => t.textContent)) === '3 Einträge importiert.');
  await seite.setInputFiles('.merk-kopf input[type="file"]', exportPfad);
  await warte(300);
  pruefe('Zweiter Import erkennt Doppelte', (await seite.$eval('#toast', (t) => t.textContent)) === '0 Einträge importiert, 3 schon vorhanden.');
  await seite.locator('.merk-eintrag').first().locator('.knopf--merk').first().click();
  await warte(200);
  pruefe('Entfernen aus der Merkliste', (await merkAnzahl(seite)) === 2);
  await seite.click('#toast .toast-aktion');
  await warte(300);
  pruefe('Rückgängig', (await merkAnzahl(seite)) === 3);

  // „Heute noch keine Ausgabe“ nach 6:00
  await seite.clock.setFixedTime(new Date('2026-11-07T09:00:00+01:00'));
  await seite.goto(`${basis}#heute`);
  await seite.waitForSelector('.hinweis--warnung');
  const warn = await seite.$eval('.hinweis--warnung', (h) => h.textContent);
  pruefe('Nach 6:00 ohne Tagesausgabe: „Heute noch keine Ausgabe“', warn.startsWith('Heute noch keine Ausgabe') && warn.includes('Freitag, 6. November 2026'), warn);
  await seite.clock.setFixedTime(new Date('2026-11-07T05:30:00+01:00'));
  await seite.reload();
  await seite.waitForSelector('.ausgabe');
  pruefe('Vor 6:00 kein solcher Hinweis', !(await seite.$('.hinweis--warnung')));

  // Tippen auf den aktiven Tab: nach oben
  await seite.goto('about:blank');
  await seite.goto(`${basis}#woche`);
  await seite.waitForSelector('.video');
  await seite.evaluate(() => window.scrollTo(0, 1500));
  await seite.click('.tabs a[data-tab="woche"]');
  await warte(800);
  pruefe('Aktiver Tab scrollt nach oben', (await seite.evaluate(() => window.scrollY)) === 0);
}

async function sonderfaelle(seite, ctx, basis) {
  await seite.clock.setFixedTime(new Date('2026-11-03T08:00:00+01:00'));
  await seite.goto(basis);
  await seite.waitForSelector('.ausgabe .hinweis--fehler');

  pruefe('Fehlerausgabe ist die neueste', (await seite.$eval('.ausgabe-titel', (h) => h.textContent)) === 'Montag, 2. November 2026');
  const fh = await seite.$eval('.hinweis--fehler', (h) => h.textContent);
  pruefe('Fehlerhinweis nennt die letzte erfolgreiche Ausgabe', fh.includes('Test: Das Skript ist abgestürzt.') && fh.includes('Letzte erfolgreiche Ausgabe: Sonntag, 1. November 2026 (Stand: 2.11.2026, 3:12 Uhr)'), fh);
  pruefe('Leere Fehlerausgabe: kein Speichern, kein „Hat gefehlt“', !(await seite.$('.ausgabe:first-of-type .knopf--merk')) && !(await seite.$('.ausgabe:first-of-type .gefehlt')));
  pruefe('Kein „noch keine Ausgabe“, wenn eine Fehlerausgabe da ist', !(await seite.$('.hinweis--warnung')));
  await seite.click('.hinweis--fehler .link-knopf');
  await warte(800);
  const r = await seite.evaluate(() => {
    const a = [...document.querySelectorAll('.ausgabe')].find((x) => x.dataset.datei === 'data/taeglich/2026-11-01.json');
    const oben = a.getBoundingClientRect().top;
    const unten = Math.abs(window.scrollY + innerHeight - document.documentElement.scrollHeight) < 3;
    return { zu: a.classList.contains('ausgabe--zu'), ruhig: a.querySelector('.ruhig') && a.querySelector('.ruhig').textContent, themen: a.querySelectorAll('.thema').length, sichtbar: oben < 150 || unten };
  });
  pruefe('Link öffnet die ruhige Ausgabe: nur „Heute nichts Wichtiges“', !r.zu && r.ruhig === 'Heute nichts Wichtiges' && r.themen === 0 && r.sichtbar, JSON.stringify(r));

  await seite.click('.tabs a[data-tab="monat"]');
  await seite.waitForSelector('.abschnitt--gescheitert');
  const m = await seite.evaluate(() => ({
    titel: document.querySelector('.ausgabe-titel').textContent,
    themen: [...document.querySelectorAll('.ausgabe .thema')].map((s) => [s.dataset.thema, s.querySelector('.thema-titel').textContent]),
    ausnahme: document.querySelector('.thema[data-thema="ki"] .ausnahme').textContent,
    xss: window.__xss,
    titelText: document.querySelector('[data-meldung="2026-10-politik-1"] .meldung-titel').textContent,
    html: document.querySelectorAll('#inhalt img, #inhalt b').length,
    quellen: [...document.querySelectorAll('[data-meldung="2026-10-politik-1"] .quellen > *:not(.quellen-label)')].map((x) => [x.tagName, x.getAttribute('href')]),
    datum: document.querySelector('[data-meldung="2026-10-politik-1"] .meldung-datum').textContent,
    verweisAlt: [...document.querySelectorAll('.thema[data-thema="kultur"] .verweis-ziel')].map((x) => x.textContent),
    videoMarken: [...document.querySelectorAll('.thema[data-thema="politik"] .video .marke')].map((x) => x.textContent),
    gescheitert: document.querySelector('.abschnitt--gescheitert').textContent,
    ruhig: document.querySelector('.ruhig').textContent,
  }));
  pruefe('Monat: Titel', m.titel === 'Oktober 2026 (ab 25. Oktober)', m.titel);
  pruefe('Altes Thema steht am Ende, mit ID als Name', JSON.stringify(m.themen.map((x) => x[0])) === '["politik","ki","startups","kultur"]' && m.themen[3][1] === 'kultur', JSON.stringify(m.themen));
  pruefe('Monat: Ausnahme mit Obergrenze 8', m.ausnahme === '9 statt 8 Meldungen: Test-Grund für die Ausnahme.', m.ausnahme);
  pruefe('HTML aus den Daten wird nur als Text gezeigt', m.xss === undefined && m.html === 0 && m.titelText.startsWith('<img'), JSON.stringify([m.xss, m.html]));
  pruefe('javascript:-Link wird nicht verlinkt', m.quellen[0][0] === 'SPAN' && m.quellen[0][1] === null && m.quellen[1][1] === 'https://example.com/a', JSON.stringify(m.quellen));
  pruefe('Zeitraum über die Monatsgrenze', m.datum === '28. Oktober bis 2. November', m.datum);
  pruefe('Verweis im alten Thema', JSON.stringify(m.verweisAlt) === '["→ siehe KI und Claude"]', JSON.stringify(m.verweisAlt));
  pruefe('Video-Marken „Hintergrund“ und „Neuer Kanal“', JSON.stringify(m.videoMarken) === '["Video-Empfehlung","Hintergrund","Neuer Kanal"]', JSON.stringify(m.videoMarken));
  pruefe('Abschnitt „Gescheitert und warum“', m.gescheitert.includes('Gescheitert und warum') && m.gescheitert.includes('Musterkiste'), m.gescheitert);
  pruefe('Monat: Ruhig-Zeile', m.ruhig === 'Diesen Monat ruhig: Tirol und Innsbruck', m.ruhig);

  const kaputt = seite.locator('.thema[data-thema="ki"] .video');
  await kaputt.locator('.video-start').click();
  await seite.waitForSelector('.video--weg');
  const vf = await kaputt.evaluate((k) => ({ text: k.querySelector('.video-player').textContent, titel: k.querySelector('.video-titel').textContent, warum: k.querySelector('.video-warum').textContent, iframes: k.querySelectorAll('iframe').length, yt: window.__yt }));
  pruefe('„Video nicht mehr verfügbar“, Titel und Begründung bleiben', vf.text === 'Video nicht mehr verfügbar.' && vf.titel === 'Kaputtes Video' && vf.warum.startsWith('Soll') && vf.iframes === 0, JSON.stringify(vf));
  pruefe('YouTube-API mit youtube-nocookie.com als Host', vf.yt.host === 'https://www.youtube-nocookie.com' && vf.yt.videoId === 'Beispiel-00' && vf.yt.playerVars.rel === 0, JSON.stringify(vf.yt));
  const gut = seite.locator('.thema[data-thema="politik"] .video');
  await gut.locator('.video-start').click();
  await seite.waitForSelector('.thema[data-thema="politik"] .video iframe');
  pruefe('Anderes Video spielt eingebettet', (await gut.locator('iframe').getAttribute('src')) === 'https://www.youtube-nocookie.com/embed/abcdefghijk');
  pruefe('Hinweis beim kaputten Video bleibt stehen', (await kaputt.locator('.video-fehler').count()) === 1);

  await seite.click('.tabs a[data-tab="jahr"]');
  await seite.waitForSelector('.abschnitt--ausblick');
  const j = await seite.evaluate(() => ({
    monate: [...document.querySelectorAll('.kompakt--monate dt, .kompakt--monate dd')].map((x) => x.textContent),
    ausblick: [...document.querySelectorAll('.abschnitt--ausblick li')].map((x) => x.textContent),
    ruhig: document.querySelector('.ruhig').textContent,
  }));
  pruefe('Jahr: Monatsüberblick', JSON.stringify(j.monate) === JSON.stringify(['November', 'Im November viel los.', 'Dezember', 'Im Dezember Schnee.']), JSON.stringify(j.monate));
  pruefe('Jahr: Ausblick mit Tag und Monat', j.ausblick[0] === '15. Jänner 2027 – Gemeinderatssitzung. · Stadt' && j.ausblick[1] === 'März 2027 – Baustart. · Land', JSON.stringify(j.ausblick));
  pruefe('Jahr: Ruhig-Zeile', j.ruhig.startsWith('Dieses Jahr ruhig: Weltpolitik, Politik in Österreich'), j.ruhig);

  await seite.click('.tabs a[data-tab="monat"]');
  await seite.waitForSelector('.abschnitt--gescheitert');
  await seite.evaluate(() => window.scrollTo(0, 900));
  await seite.click('.tabs a[data-tab="jahr"]');
  await seite.waitForSelector('.abschnitt--ausblick');
  await seite.click('.tabs a[data-tab="monat"]');
  await seite.waitForSelector('.abschnitt--gescheitert');
  const y = await seite.evaluate(() => window.scrollY);
  pruefe('Jeder Tab merkt sich seine Scrollposition', Math.abs(y - 900) < 5, String(y));
}

async function ohneDaten(seite, ctx, basis) {
  await seite.goto(basis);
  await seite.waitForSelector('#inhalt .leer');
  const text = await seite.$eval('#inhalt', (m) => m.textContent.trim());
  pruefe('index.json fehlt (404): „Noch keine Tagesausgabe vorhanden.“', text === 'Noch keine Tagesausgabe vorhanden.', text);
}

async function offline(seite, ctx, basis) {
  await seite.goto(basis);
  await seite.waitForSelector('.hinweis--fehler');
  pruefe('Offline: Hinweis mit „Erneut versuchen“', (await seite.$eval('.hinweis--fehler', (h) => h.textContent)).includes('Die Ausgaben konnten nicht geladen werden.'));
  await seite.click('.tabs a[data-tab="merkliste"]');
  await seite.waitForSelector('.merkliste');
  pruefe('Offline: Merkliste geht trotzdem', (await seite.$$('.merk-kopf')).length === 1);
}

// ------------------------------------------------------------ PWA: Manifest, Icons, Service Worker

const DATEN_URL = 'https://raw.githubusercontent.com/luisgoetzi-maker/mein-feed/refs/heads/claude/feed-daten/';
const APP_DATEIEN = ['', 'app.js', 'config/themen.json', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/icon-maskable-512.png', 'icons/icon.svg', 'manifest.webmanifest', 'styles.css'];

function cacheInhalt(seite) {
  return seite.evaluate(async () => {
    const inhalt = {};
    for (const name of await caches.keys()) inhalt[name] = (await (await caches.open(name)).keys()).map((r) => r.url);
    return inhalt;
  });
}

async function datenImCache(seite) {
  return ((await cacheInhalt(seite))['mein-feed-daten'] || []).map((u) => u.replace(DATEN_URL, '')).sort();
}

// Wartet, bis genau diese Dateien vom Daten-Branch im Cache liegen.
async function warteAufDaten(seite, erwartet) {
  const ende = Date.now() + 10000;
  let jetzt = await datenImCache(seite);
  while (JSON.stringify(jetzt) !== JSON.stringify(erwartet) && Date.now() < ende) {
    await warte(100);
    jetzt = await datenImCache(seite);
  }
  return jetzt;
}

function pngKopf(datei) {
  const b = fs.readFileSync(datei);
  const png = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.toString('ascii', 12, 16) === 'IHDR';
  return png ? { breite: b.readUInt32BE(16), hoehe: b.readUInt32BE(20) } : null;
}

// Zeitpunkt in Wiener Zeit wie „7.11.2026, 8:15 Uhr“.
function wienZeit(iso) {
  const t = {};
  const format = new Intl.DateTimeFormat('de-AT', {
    timeZone: 'Europe/Vienna', day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
  });
  for (const p of format.formatToParts(new Date(iso))) t[p.type] = p.value;
  return `${t.day}.${t.month}.${t.year}, ${t.hour}:${t.minute} Uhr`;
}

async function pwa(seite, ctx, basis, einstellungen) {
  const app = `${basis}${APP}`;
  const beginn = Date.now();
  await seite.clock.setFixedTime(new Date('2026-11-01T08:00:00+01:00'));
  await seite.goto(app);
  await seite.waitForSelector('.ausgabe .meldung');

  // Manifest
  const kopf = await seite.evaluate(() => ({
    manifest: document.querySelector('link[rel="manifest"]').href,
    apple: document.querySelector('link[rel="apple-touch-icon"]').href,
    icon: document.querySelector('link[rel="icon"]').href,
    farben: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => [m.media, m.content]),
  }));
  const m = await seite.evaluate((url) => fetch(url).then((a) => a.json()), kopf.manifest);
  const css = fs.readFileSync(path.join(WURZEL, 'styles.css'), 'utf8');
  const hell = (/:root\s*{[^}]*--bg:\s*(#[0-9a-f]{6})/i.exec(css) || [])[1];
  const dunkel = (/prefers-color-scheme:\s*dark\)\s*{\s*:root\s*{[^}]*--bg:\s*(#[0-9a-f]{6})/i.exec(css) || [])[1];
  pruefe('Manifest verlinkt und neben index.html', kopf.manifest === `${app}manifest.webmanifest`, kopf.manifest);
  pruefe('Manifest: Name und Kurzname „Mein Feed“, standalone, Sprache de', m.name === 'Mein Feed' && m.short_name === 'Mein Feed' && m.display === 'standalone' && m.lang === 'de', JSON.stringify(m));
  pruefe('Manifest: start_url und scope „./“, alle Pfade relativ', m.start_url === './' && m.scope === './'
    && [m.id, m.start_url, m.scope, ...m.icons.map((i) => i.src)].every((p) => typeof p === 'string' && !/^(\/|[a-z]+:)/i.test(p)), JSON.stringify(m));
  pruefe('Farben wie styles.css (hell #f3f2ee, dunkel #111317)', hell === '#f3f2ee' && dunkel === '#111317' && m.theme_color === hell && m.background_color === hell
    && JSON.stringify(kopf.farben) === JSON.stringify([['(prefers-color-scheme: light)', hell], ['(prefers-color-scheme: dark)', dunkel]]), JSON.stringify([hell, dunkel, m.theme_color, kopf.farben]));
  const cdp = await ctx.newCDPSession(seite);
  const chrome = await cdp.send('Page.getAppManifest');
  pruefe('Chrome liest das Manifest ohne Fehler, Start und Scope im App-Ordner', chrome.errors.length === 0 && chrome.manifest
    && chrome.manifest.startUrl === app && chrome.manifest.scope === app, JSON.stringify([chrome.errors, chrome.manifest && [chrome.manifest.startUrl, chrome.manifest.scope]]));

  // Icons: PNG-Größen wie angegeben, maskable mit Sicherheitsrand, apple-touch-icon ohne Transparenz
  const icons = m.icons.map((i) => ({ ...i, url: new URL(i.src, kopf.manifest).href, datei: path.join(WURZEL, i.src) }));
  const png = icons.filter((i) => i.type === 'image/png');
  pruefe('Icons: PNG in 192 und 512 Pixeln, Größe stimmt', ['192x192', '512x512'].every((g) => png.some((i) => i.sizes === g && i.purpose === 'any'))
    && png.every((i) => { const k = pngKopf(i.datei); return k && `${k.breite}x${k.hoehe}` === i.sizes; }), JSON.stringify(png.map((i) => [i.src, i.sizes, pngKopf(i.datei)])));
  const bild = (url) => seite.evaluate(async ({ url: u, hg }) => {
    const img = new Image();
    img.src = u;
    await img.decode();
    const n = img.naturalWidth;
    const c = document.createElement('canvas');
    c.width = n;
    c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let durchsichtig = 0;
    let ausserhalb = 0;
    let motiv = 0;
    for (let y = 0; y < c.height; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const i = (y * n + x) * 4;
        if (d[i + 3] < 255) durchsichtig += 1;
        const hintergrund = Math.abs(d[i] - hg[0]) <= 2 && Math.abs(d[i + 1] - hg[1]) <= 2 && Math.abs(d[i + 2] - hg[2]) <= 2;
        if (!hintergrund) {
          motiv += 1;
          if (Math.hypot(x + 0.5 - n / 2, y + 0.5 - c.height / 2) > 0.4 * n) ausserhalb += 1;
        }
      }
    }
    return { breite: n, hoehe: c.height, durchsichtig, ausserhalb, motiv };
  }, { url, hg: [0xf3, 0xf2, 0xee] });
  const maskable = icons.find((i) => i.purpose === 'maskable');
  const mb = maskable && await bild(maskable.url);
  pruefe('Maskable-Icon: vollflächig, Motiv nur im Sicherheitskreis (Radius 40 %)', mb && mb.breite >= 512 && mb.durchsichtig === 0 && mb.ausserhalb === 0 && mb.motiv > 0, JSON.stringify(mb));
  const ab = await bild(kopf.apple);
  pruefe('apple-touch-icon: 180 Pixel, ohne Transparenz', ab.breite === 180 && ab.hoehe === 180 && ab.durchsichtig === 0 && ab.motiv > 0, JSON.stringify(ab));
  const svg = await seite.evaluate((u) => { const img = new Image(); img.src = u; return img.decode().then(() => true, () => false); }, kopf.icon);
  pruefe('SVG-Vorlage als Favicon und im Manifest', svg && kopf.icon === `${app}icons/icon.svg` && icons.some((i) => i.type === 'image/svg+xml' && i.url === kopf.icon));
  const install = await cdp.send('Page.getInstallabilityErrors');
  const installFehler = install.installabilityErrors.map((f) => f.errorId).filter((id) => id !== 'in-incognito');
  pruefe('Chrome: App installierbar', installFehler.length === 0, JSON.stringify(install.installabilityErrors));
  await cdp.detach();

  // Service Worker übernimmt; was schon geladen war, landet im Cache
  await seite.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 10000 });
  const sw = await seite.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { scope: reg.scope, skript: reg.active.scriptURL, steuert: navigator.serviceWorker.controller.scriptURL };
  });
  pruefe('Service Worker liegt neben index.html, Scope ist der App-Ordner', sw.scope === app && sw.skript === `${app}sw.js` && sw.steuert === sw.skript, JSON.stringify(sw));
  let daten = await warteAufDaten(seite, ['data/index.json', 'data/taeglich/2026-10-31.json']);
  pruefe('Nach dem ersten Laden: index.json und die gezeigte Ausgabe im Cache', JSON.stringify(daten) === '["data/index.json","data/taeglich/2026-10-31.json"]', JSON.stringify(daten));
  let c = await cacheInhalt(seite);
  const appCache = (c['mein-feed-app'] || []).map((u) => u.replace(app, '')).sort();
  pruefe('App-Dateien im Cache', JSON.stringify(appCache) === JSON.stringify(APP_DATEIEN), JSON.stringify(appCache));
  pruefe('Alle App-Anfragen bleiben im App-Ordner', einstellungen.anfragen.filter((u) => u.startsWith(basis)).every((u) => u.startsWith(app)),
    JSON.stringify(einstellungen.anfragen.filter((u) => u.startsWith(basis) && !u.startsWith(app))));

  // Woche öffnen, etwas merken, ein Video abspielen
  await seite.click('.tabs a[data-tab="woche"]');
  await seite.waitForSelector('.abschnitt--finanzierungsrunden');
  await seite.click('[data-meldung="2026-10-25_2026-10-31-weltpolitik-1"] .knopf--merk');
  await warte(150);
  const video = seite.locator('.thema[data-thema="wirtschaft"] .video');
  await video.locator('.video-start').click();
  await seite.waitForSelector('.thema[data-thema="wirtschaft"] .video iframe');
  await video.locator('.video-start').click();
  daten = await warteAufDaten(seite, ['data/index.json', 'data/taeglich/2026-10-31.json', 'data/woechentlich/2026-10-25_2026-10-31.json']);
  pruefe('Jede geladene Ausgabe kommt in den Cache', daten.includes('data/woechentlich/2026-10-25_2026-10-31.json'), JSON.stringify(daten));
  c = await cacheInhalt(seite);
  const fremd = Object.values(c).flat().filter((u) => !u.startsWith(app) && !u.startsWith(DATEN_URL));
  const yt = einstellungen.anfragen.filter((u) => /youtube(-nocookie)?\.com/.test(u));
  pruefe('YouTube und andere fremde Seiten nicht im Cache', fremd.length === 0 && yt.length >= 2, JSON.stringify([fremd, yt]));

  // Neue Version auf dem Server: kommt beim nächsten Laden sofort an
  const stil = fs.readFileSync(path.join(WURZEL, 'styles.css'), 'utf8');
  SERVER.ersatz.set(`${APP}styles.css`, `${stil}\n:root { --pwa-test: neu; }\n`);
  await seite.reload();
  await seite.waitForSelector('.ausgabe .meldung');
  const version = await seite.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--pwa-test').trim());
  SERVER.ersatz.delete(`${APP}styles.css`);
  pruefe('Neue Version einer App-Datei gilt beim ersten Neuladen, ohne Versionsnummer', version === 'neu', version);

  // Server antwortet nicht: nach etwa 4 Sekunden aus dem Cache
  SERVER.verzoegerung.set(`${APP}app.js`, 9000);
  const t0 = Date.now();
  await seite.reload();
  await seite.waitForSelector('.ausgabe .meldung');
  const dauer = Date.now() - t0;
  SERVER.verzoegerung.delete(`${APP}app.js`);
  pruefe('Hängt der Server, kommt app.js nach etwa 4 Sekunden aus dem Cache', dauer >= 3800 && dauer < 7000, `${dauer} ms`);

  // Offline: zuletzt geladene Ausgaben mit Hinweis
  await seite.clock.setFixedTime(new Date('2026-11-02T09:00:00+01:00')); // online wäre „Heute noch keine Ausgabe“ fällig
  einstellungen.offline = true;
  await ctx.setOffline(true);
  const vorher = einstellungen.anfragen.length;
  await seite.goto('about:blank');
  await seite.goto(`${app}#heute`);
  await seite.waitForSelector('.ausgabe .meldung');
  const stand = await seite.evaluate((url) => caches.match(url).then((a) => a.headers.get('X-Mein-Feed-Stand')), `${DATEN_URL}data/index.json`);
  let o = await seite.evaluate(() => ({
    online: navigator.onLine,
    hinweis: [...document.querySelectorAll('.offline-hinweis')].map((h) => h.textContent),
    titel: [...document.querySelectorAll('.ausgabe-titel')].map((h) => h.textContent),
    meldungen: document.querySelectorAll('.ausgabe:first-of-type .meldung').length,
    warnung: Boolean(document.querySelector('.hinweis--warnung')),
  }));
  pruefe('Offline: App startet aus dem Cache, obwohl jede Anfrage scheitert', !o.online && einstellungen.anfragen.length > vorher, JSON.stringify(o));
  const tag = JSON.parse(fs.readFileSync(path.join(DATEN, 'taeglich/2026-10-31.json'), 'utf8'));
  pruefe('Offline: zuletzt geladene Ausgaben', JSON.stringify(o.titel) === '["Samstag, 31. Oktober 2026","Freitag, 30. Oktober 2026"]' && o.meldungen === tag.meldungen.length, JSON.stringify(o));
  pruefe('Offline-Hinweis mit dem Zeitpunkt des letzten frischen Ladens', stand && Date.parse(stand) >= beginn && Date.parse(stand) <= Date.now()
    && JSON.stringify(o.hinweis) === JSON.stringify([`Offline – Stand vom ${wienZeit(stand)}`]), JSON.stringify([stand, o.hinweis]));
  pruefe('Offline: kein „Heute noch keine Ausgabe“', !o.warnung);
  await seite.click('.ausgabe--zu .ausgabe-umschalter');
  await seite.waitForSelector('.ausgabe[data-datei="data/taeglich/2026-10-30.json"] .hinweis--fehler');
  const nie = await seite.$eval('.ausgabe[data-datei="data/taeglich/2026-10-30.json"] .hinweis--fehler', (h) => h.textContent);
  pruefe('Offline: nie geöffnete Ausgabe ist nicht im Cache', nie.startsWith('Diese Ausgabe konnte nicht geladen werden'), nie);
  await seite.click('#neu-laden');
  await seite.waitForSelector('#toast:not([hidden])');
  const t = await seite.$eval('#toast', (x) => x.textContent);
  pruefe('Offline: „Aktualisieren“ meldet keine Verbindung', t === 'Keine Verbindung. Du siehst den zuletzt geladenen Stand.', t);
  await seite.click('.tabs a[data-tab="woche"]');
  await seite.waitForSelector('.abschnitt--finanzierungsrunden');
  o = await seite.evaluate(() => [document.querySelectorAll('.offline-hinweis').length, document.querySelector('.ausgabe-titel').textContent]);
  pruefe('Offline: auch der Wochenrückblick mit Hinweis', o[0] === 1 && o[1] === 'Woche vom 25. bis 31. Oktober 2026', JSON.stringify(o));
  await seite.click('.tabs a[data-tab="merkliste"]');
  await seite.waitForSelector('.merk-eintrag');
  pruefe('Offline: Merkliste da, ohne Offline-Hinweis', (await merkAnzahl(seite)) === 1 && !(await seite.$('.offline-hinweis')));

  // Wieder online, im Repo inzwischen: neue Tagesausgabe, Wochenrückblick gelöscht
  einstellungen.dateien.add('data/taeglich/2026-11-01.json');
  einstellungen.dateien.delete('data/woechentlich/2026-10-25_2026-10-31.json');
  await seite.click('.tabs a[data-tab="heute"]');
  await seite.waitForSelector('.offline-hinweis');
  einstellungen.offline = false;
  await ctx.setOffline(false);
  await seite.waitForFunction(() => !document.querySelector('.offline-hinweis')
    && (document.querySelector('.ausgabe-titel') || {}).textContent === 'Sonntag, 1. November 2026', null, { timeout: 10000 }).catch(() => {});
  o = await seite.evaluate(() => ({
    hinweis: document.querySelectorAll('.offline-hinweis').length,
    titel: [...document.querySelectorAll('.ausgabe-titel')].map((h) => h.textContent),
    ruhig: (document.querySelector('.ruhig') || {}).textContent,
  }));
  pruefe('Wieder online: frische Daten ohne Hinweis, ohne Neuladen', o.hinweis === 0 && o.titel[0] === 'Sonntag, 1. November 2026' && o.ruhig === 'Heute nichts Wichtiges', JSON.stringify(o));
  // 30.10. ist offline aufgeklappt worden und wird jetzt frisch geladen; die Woche steht nicht mehr in index.json.
  const erwartet = ['data/index.json', 'data/taeglich/2026-10-30.json', 'data/taeglich/2026-10-31.json', 'data/taeglich/2026-11-01.json'];
  daten = await warteAufDaten(seite, erwartet);
  pruefe('Ausgabe, die nicht mehr in index.json steht, fliegt aus dem Cache', JSON.stringify(daten) === JSON.stringify(erwartet), JSON.stringify(daten));
  await seite.click('.tabs a[data-tab="merkliste"]');
  await seite.waitForSelector('.merk-eintrag');
  const merk = await seite.$$eval('.merk-eintrag .meldung-titel', (h) => h.map((x) => x.textContent));
  pruefe('Merkliste bleibt davon unberührt', merk.length === 1 && merk[0].length > 0, JSON.stringify(merk));

  // Neuer Service Worker übernimmt ohne Rückfrage und räumt alte Caches auf
  await seite.evaluate(async () => {
    await (await caches.open('mein-feed-alt')).put('/alt', new Response('alt'));
    await (await caches.open('andere-seite')).put('/fremd', new Response('fremd'));
    window.__alterSw = navigator.serviceWorker.controller;
    window.__wechsel = 0;
    navigator.serviceWorker.addEventListener('controllerchange', () => { window.__wechsel += 1; });
  });
  SERVER.ersatz.set(`${APP}sw.js`, `${fs.readFileSync(path.join(WURZEL, 'sw.js'), 'utf8')}\n// neue Fassung\n`);
  await seite.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  // controllerchange kommt schon beim Aktivieren, das Aufräumen im activate-Ereignis danach.
  await seite.waitForFunction(() => window.__wechsel > 0 && navigator.serviceWorker.controller !== window.__alterSw
    && navigator.serviceWorker.controller.state === 'activated', null, { timeout: 10000 }).catch(() => {});
  const neu = await seite.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { wechsel: window.__wechsel, wartet: Boolean(reg.waiting), steuert: Boolean(reg.active) && reg.active === navigator.serviceWorker.controller, caches: (await caches.keys()).sort() };
  });
  SERVER.ersatz.delete(`${APP}sw.js`);
  pruefe('Neuer Service Worker übernimmt sofort, ohne Rückfrage', neu.wechsel === 1 && !neu.wartet && neu.steuert, JSON.stringify(neu));
  pruefe('Alte Caches von Mein Feed weg, fremde bleiben', JSON.stringify(neu.caches) === '["andere-seite","mein-feed-app","mein-feed-daten"]', JSON.stringify(neu.caches));

  // Daten-Branch gelöscht (index.json 404): keine alten Daten mehr, auch nicht offline
  einstellungen.index = '404';
  await seite.click('.tabs a[data-tab="heute"]');
  await seite.click('#neu-laden');
  await seite.waitForSelector('#inhalt .leer');
  daten = await warteAufDaten(seite, []);
  pruefe('index.json 404: Daten-Cache geleert', daten.length === 0, JSON.stringify(daten));
  einstellungen.offline = true;
  await ctx.setOffline(true);
  await seite.reload();
  await seite.waitForSelector('#inhalt .hinweis--fehler');
  pruefe('Danach offline: Hinweis statt alter Beispieldaten', (await seite.$eval('#inhalt', (x) => x.textContent)).includes('Die Ausgaben konnten nicht geladen werden.') && !(await seite.$('.ausgabe')));
  await seite.click('.tabs a[data-tab="merkliste"]');
  await seite.waitForSelector('.merk-eintrag');
  pruefe('Merkliste auch dann noch da', (await merkAnzahl(seite)) === 1);
  einstellungen.offline = false;
  await ctx.setOffline(false);
}

// Zustand der Vorlese-Ansicht und der Attrappen auf einen Blick.
function vlZustand(seite) {
  return seite.evaluate(() => {
    const w = document.getElementById('vorlesen');
    const s = window.__sprache;
    const q = (sel) => (w ? w.querySelector(sel) : null);
    const text = (sel) => (q(sel) ? q(sel).textContent : null);
    const letzter = s.gesprochen[s.gesprochen.length - 1] || {};
    return {
      offen: Boolean(w && !w.hidden),
      satz: text('.vl-satz'),
      zaehler: text('.vl-zaehler'),
      haupt: text('.vl-haupt'),
      thema: q('.vl-thema') && !q('.vl-thema').hidden ? text('.vl-thema-name') : '',
      kapitel: text('.vl-kapitel'),
      hinweis: q('.vl-hinweis') && !q('.vl-hinweis').hidden ? text('.vl-hinweis') : '',
      naechstes: q('.vl-naechstes') ? [q('.vl-naechstes').disabled, text('.vl-naechstes-name')] : null,
      wach: s.wach(),
      anzahl: s.gesprochen.length,
      text: letzter.text,
      stimme: letzter.stimme,
      lang: letzter.lang,
      rate: letzter.rate,
      abgebrochen: s.abgebrochen,
      pausen: s.pausen,
      doppelt: s.doppelt,
      anforderungen: s.anforderungen,
      inert: document.getElementById('inhalt').inert,
      position: JSON.parse(localStorage.getItem('mein-feed.vorleseposition.v1')),
      einstellungen: JSON.parse(localStorage.getItem('mein-feed.vorlesen.v1')),
    };
  });
}

const warteAufSaetze = (seite, n) => seite.waitForFunction((x) => window.__sprache.gesprochen.length >= x, n, { timeout: 5000 });
const warteAufWach = (seite, wach) => seite.waitForFunction((x) => window.__sprache.wach() === x, wach, { timeout: 5000 });
const warteAufHaupt = (seite, text) => seite.waitForFunction((x) => {
  const b = document.querySelector('#vorlesen .vl-haupt');
  return b && b.textContent === x;
}, text, { timeout: 10000 });

// Liest eine Ausgabe mit selbst endenden Äußerungen ganz vor und gibt die gesprochenen Sätze zurück.
async function liesGanz(seite, knopf) {
  const vorher = await seite.evaluate(() => {
    window.__sprache.automatisch = true;
    return window.__sprache.gesprochen.length;
  });
  await seite.click(knopf);
  await warteAufHaupt(seite, 'Von vorn');
  const saetze = await seite.evaluate((n) => {
    window.__sprache.automatisch = false;
    return window.__sprache.gesprochen.slice(n).map((g) => g.text);
  }, vorher);
  await seite.click('#vorlesen .vl-schliessen');
  await warte(100);
  return saetze;
}

async function vorlesenTests(seite, ctx, basis) {
  await seite.clock.setFixedTime(new Date('2026-11-01T08:00:00+01:00'));
  await seite.goto(`${basis}#heute`);
  await seite.waitForSelector('.aktionen--kopf .knopf--vorlesen');
  const KOPF = '.ausgabe:first-of-type .aktionen--kopf .knopf--vorlesen';
  const tagesdaten = JSON.parse(fs.readFileSync(path.join(DATEN, 'taeglich/2026-10-31.json'), 'utf8'));

  const k = await seite.evaluate(() => ({
    kopf: [...document.querySelectorAll('.ausgabe:first-of-type .aktionen--kopf .knopf--vorlesen')].map((b) => [b.textContent, b.getAttribute('aria-label')]),
    themen: [...document.querySelectorAll('.ausgabe:first-of-type .thema .knopf--vorlesen')].map((b) => [b.closest('.thema').dataset.thema, b.getAttribute('aria-label')]),
    titel: [...document.querySelectorAll('.ausgabe:first-of-type .thema-titel')].map((h) => h.textContent),
    weiter: document.querySelectorAll('.knopf--weiter').length,
    zu: document.querySelectorAll('.ausgabe--zu .knopf--vorlesen').length,
  }));
  pruefe('Vorlesen-Knopf für die Ausgabe und pro Überthema', JSON.stringify(k.kopf) === '[["Vorlesen","Ausgabe vorlesen"]]'
    && JSON.stringify(k.themen.map((t) => t[0])) === '["weltpolitik","politik","ki","wirtschaft"]' && k.themen[2][1] === 'KI und Claude vorlesen'
    && k.titel[2] === 'KI und Claude' && k.weiter === 0 && k.zu === 0, JSON.stringify(k));

  // Start, noch ohne Stimmen
  await seite.click(KOPF);
  await warteAufSaetze(seite, 1);
  await warteAufWach(seite, true);
  let z = await vlZustand(seite);
  const gesamt = Number((/von (\d+)$/.exec(z.zaehler) || [])[1]);
  pruefe('Vorlese-Ansicht offen, Feed dahinter gesperrt', z.offen && z.inert && (await seite.$eval('#vorlesen', (w) => w.getAttribute('aria-modal'))) === 'true', JSON.stringify(z));
  pruefe('Beginnt mit dem Themennamen, groß angezeigt', z.text === 'Weltpolitik' && z.satz === 'Weltpolitik' && z.thema === 'Weltpolitik' && z.zaehler === `Satz 1 von ${gesamt}` && gesamt > 30, JSON.stringify(z));
  pruefe('Beim Lesen: Knopf „Pause“, Bildschirm bleibt an', z.haupt === 'Pause' && z.wach, JSON.stringify(z));
  pruefe('Ohne Stimmen: deutsche Sprache, Standardtempo', z.lang === 'de-DE' && z.stimme === null && z.rate === 1, JSON.stringify(z));
  let stimmen = await seite.$$eval('#vl-stimme option', (o) => o.map((x) => x.textContent));
  pruefe('Stimmenauswahl wartet auf die Stimmen', JSON.stringify(stimmen) === '["Standardstimme des Geräts"]', JSON.stringify(stimmen));

  // Stimmen kommen verzögert (voiceschanged)
  await seite.evaluate((s) => window.__sprache.stimmen(s), STIMMEN);
  stimmen = await seite.$$eval('#vl-stimme option', (o) => o.map((x) => x.textContent));
  pruefe('Nach voiceschanged: nur deutsche Stimmen, österreichische zuerst', JSON.stringify(stimmen) === '["Österreichisch (de-AT)","Deutsch (de-DE)"]' && (await seite.$eval('#vl-stimme', (s) => s.value)) === 'de-at', JSON.stringify(stimmen));
  await seite.evaluate(() => window.__sprache.ende());
  z = await vlZustand(seite);
  pruefe('Satz für Satz: danach der Titel der ersten Meldung', z.anzahl === 2 && z.text === tagesdaten.meldungen[0].titel && z.zaehler === `Satz 2 von ${gesamt}`, JSON.stringify(z));
  pruefe('Nächster Satz mit der gewählten Stimme', z.stimme === 'de-at' && z.lang === 'de-AT', JSON.stringify(z));
  pruefe('Fortschrittsbalken', (await seite.$eval('.vl-balken', (b) => [b.getAttribute('aria-valuenow'), b.getAttribute('aria-valuemax')].join('/'))) === `2/${gesamt}`);

  // Pause = cancel(), Weiter = Neustart am aktuellen Satz
  const vorPause = z;
  await seite.click('.vl-haupt');
  await warteAufWach(seite, false);
  z = await vlZustand(seite);
  pruefe('Pause: cancel() statt pause(), Knopf „Weiter“', z.haupt === 'Weiter' && z.abgebrochen > vorPause.abgebrochen && z.pausen === 0 && z.anzahl === vorPause.anzahl, JSON.stringify(z));
  pruefe('Pause gibt den Bildschirm frei', !z.wach);
  pruefe('Position wird laufend gespeichert', z.position && z.position.datei === 'data/taeglich/2026-10-31.json' && z.position.satz === 1 && z.position.gesamt === gesamt, JSON.stringify(z.position));
  await seite.click('.vl-haupt');
  await warteAufWach(seite, true);
  z = await vlZustand(seite);
  pruefe('Weiter: derselbe Satz noch einmal von vorn, Bildschirm wieder an', z.anzahl === vorPause.anzahl + 1 && z.text === vorPause.text && z.haupt === 'Pause' && z.wach, JSON.stringify(z));

  // Satz vor und zurück, nächstes Thema
  await seite.click('.vl-vor');
  await warteAufSaetze(seite, z.anzahl + 1);
  z = await vlZustand(seite);
  pruefe('Satz vor', z.text === teileZumTest(tagesdaten.meldungen[0].text)[0] && z.zaehler === `Satz 3 von ${gesamt}`, JSON.stringify(z));
  await seite.click('.vl-zurueck');
  await warteAufSaetze(seite, z.anzahl + 1);
  z = await vlZustand(seite);
  pruefe('Satz zurück', z.text === tagesdaten.meldungen[0].titel && z.zaehler === `Satz 2 von ${gesamt}` && z.doppelt === 0, JSON.stringify(z));
  pruefe('„Nächstes Thema“ nennt das Ziel', JSON.stringify(z.naechstes) === '[false,"Politik in Österreich, Deutschland und der EU"]', JSON.stringify(z.naechstes));
  await seite.click('.vl-naechstes');
  await warteAufSaetze(seite, z.anzahl + 1);
  z = await vlZustand(seite);
  const politikSatz = Number(/Satz (\d+)/.exec(z.zaehler)[1]);
  pruefe('Nächstes Thema springt zum Themennamen', z.text === 'Politik in Österreich, Deutschland und der EU' && z.thema === z.text && politikSatz > 10, JSON.stringify(z));

  // Tempo und Stimme wählen: gilt sofort und bleibt gespeichert
  await seite.click('.vl-einstellungen summary');
  await seite.selectOption('#vl-tempo', '1.2');
  await warteAufSaetze(seite, z.anzahl + 1);
  z = await vlZustand(seite);
  pruefe('Tempo gilt sofort für den aktuellen Satz', z.rate === 1.2 && z.text === 'Politik in Österreich, Deutschland und der EU', JSON.stringify(z));
  await seite.selectOption('#vl-stimme', 'de-de');
  await warteAufSaetze(seite, z.anzahl + 1);
  z = await vlZustand(seite);
  pruefe('Stimme gewechselt', z.stimme === 'de-de' && z.rate === 1.2, JSON.stringify(z));
  pruefe('Stimme und Tempo gespeichert', z.einstellungen && z.einstellungen.stimme === 'de-de' && z.einstellungen.tempo === 1.2, JSON.stringify(z.einstellungen));

  // App-Wechsel oder Bildschirm aus
  const vorWechsel = z;
  await seite.evaluate(() => window.__sprache.sichtbarkeit('hidden'));
  z = await vlZustand(seite);
  pruefe('App-Wechsel: Vorlesen hält an, Bildschirm frei', !z.wach && z.abgebrochen > vorWechsel.abgebrochen && z.anzahl === vorWechsel.anzahl, JSON.stringify(z));
  pruefe('App-Wechsel: „Weiter ab Satz …“ mit Hinweis', z.haupt === `Weiter ab Satz ${politikSatz}` && z.hinweis === 'Das Vorlesen wurde unterbrochen.' && z.position.satz === politikSatz - 1, JSON.stringify(z));
  await seite.evaluate(() => window.__sprache.sichtbarkeit('visible'));
  await warteAufWach(seite, true);
  z = await vlZustand(seite);
  pruefe('Zurück in der App: Wake Lock neu angefordert, noch kein Ton', z.wach && z.anforderungen > vorWechsel.anforderungen && z.anzahl === vorWechsel.anzahl && z.haupt === `Weiter ab Satz ${politikSatz}`, JSON.stringify(z));
  await seite.click('.vl-haupt');
  z = await vlZustand(seite);
  pruefe('„Weiter ab Satz …“ liest den gemerkten Satz', z.anzahl === vorWechsel.anzahl + 1 && z.text === 'Politik in Österreich, Deutschland und der EU' && z.haupt === 'Pause' && z.hinweis === '', JSON.stringify(z));

  // Schließen: Stelle bleibt gemerkt
  await seite.click('.vl-schliessen');
  await warte(100);
  z = await vlZustand(seite);
  const fokus = await seite.evaluate(() => document.activeElement && document.activeElement.classList.contains('knopf--vorlesen'));
  pruefe('Schließen: Ton aus, Bildschirm frei, Feed wieder bedienbar', !z.offen && !z.wach && !z.inert && fokus && (await seite.evaluate(() => location.hash)) === '#heute', JSON.stringify([z, fokus]));
  let weiter = await seite.$$eval('.knopf--weiter', (b) => b.map((x) => [x.textContent, Boolean(x.closest('.aktionen--kopf'))]));
  pruefe('Kopf bietet „Weiter ab Satz …“ an', JSON.stringify(weiter) === JSON.stringify([[`Weiter ab Satz ${politikSatz}`, true]]), JSON.stringify(weiter));

  // Nach Neuladen (App beendet): weiter ab dem gemerkten Satz, mit gespeicherter Stimme und Tempo
  await seite.reload();
  await seite.waitForSelector('.knopf--weiter');
  await seite.evaluate((s) => window.__sprache.stimmen(s), STIMMEN);
  weiter = await seite.$$eval('.knopf--weiter', (b) => b.map((x) => x.textContent));
  pruefe('Nach Neuladen: „Weiter ab Satz …“ noch da', JSON.stringify(weiter) === JSON.stringify([`Weiter ab Satz ${politikSatz}`]), JSON.stringify(weiter));
  await seite.click('.knopf--weiter');
  await warteAufSaetze(seite, 1);
  z = await vlZustand(seite);
  pruefe('Weiterlesen nach Neuladen am gemerkten Satz', z.text === 'Politik in Österreich, Deutschland und der EU' && z.zaehler === `Satz ${politikSatz} von ${gesamt}`, JSON.stringify(z));
  pruefe('Gespeicherte Stimme und Tempo nach Neuladen', z.stimme === 'de-de' && z.rate === 1.2 && (await seite.$eval('#vl-tempo', (s) => s.value)) === '1.2', JSON.stringify(z));

  // Bis zum Ende
  await seite.evaluate(() => {
    window.__sprache.automatisch = true;
    window.__sprache.ende();
  });
  await warteAufHaupt(seite, 'Von vorn');
  z = await vlZustand(seite);
  pruefe('Ende: Ruhig-Zeile zuletzt', z.text === 'Heute ruhig: Tirol und Innsbruck, Startups' && z.satz === 'Ausgabe fertig vorgelesen.' && z.zaehler === `Satz ${gesamt} von ${gesamt}`, JSON.stringify(z));
  pruefe('Ende: Bildschirm frei, keine Position mehr', !z.wach && z.position === null, JSON.stringify(z));

  // Die ganze Ausgabe am Stück
  const vorher = z.anzahl;
  await seite.click('.vl-haupt');
  await warteAufHaupt(seite, 'Von vorn');
  const saetze = await seite.evaluate((n) => {
    window.__sprache.automatisch = false;
    return window.__sprache.gesprochen.slice(n).map((g) => g.text);
  }, vorher);
  const themenNamen = ['Weltpolitik', 'Politik in Österreich, Deutschland und der EU', 'KI und Claude', 'Börse und Wirtschaft'];
  pruefe('„Von vorn“ liest alle Sätze', saetze.length === gesamt && saetze[0] === 'Weltpolitik', String(saetze.length));
  pruefe('Themen in der Reihenfolge der Anzeige', JSON.stringify(saetze.filter((s) => themenNamen.includes(s))) === JSON.stringify(themenNamen), JSON.stringify(saetze));
  pruefe('Jede Meldung genau einmal (Verweis nicht gelesen)', tagesdaten.meldungen.every((m) => saetze.filter((s) => s === m.titel).length === 1) && !saetze.some((s) => s.includes('siehe')), JSON.stringify(saetze));
  pruefe('Titel, Text und „Warum wichtig“ jeder Meldung', saetze.filter((s) => s.startsWith('Warum wichtig: ')).length === tagesdaten.meldungen.length
    && saetze.includes(`Warum wichtig: ${tagesdaten.meldungen[0].warum_wichtig}`) && saetze.join(' ').includes(tagesdaten.meldungen[4].text), JSON.stringify(saetze));
  pruefe('Ausnahme-Hinweis wird nicht gelesen', !saetze.some((s) => s.includes('Klimagipfel und Handelsbeitritt fielen')));

  // Zurück-Taste schließt
  await seite.click('.vl-haupt');
  await seite.evaluate(() => history.back());
  await seite.waitForSelector('#vorlesen', { state: 'hidden' });
  z = await vlZustand(seite);
  pruefe('Zurück-Taste schließt die Vorlese-Ansicht, Tab bleibt', !z.offen && !z.wach && (await seite.evaluate(() => location.hash)) === '#heute' && (await seite.$eval('.tabs a[aria-current="page"]', (a) => a.dataset.tab)) === 'heute', JSON.stringify(z));
  await warte(100);

  // Themenfilter: „Vorlesen“ der Ausgabe liest trotzdem alle Themen
  await seite.click('.chip[data-thema="ki"]');
  await warte(200);
  await seite.click(KOPF);
  await warteAufSaetze(seite, z.anzahl + 1);
  z = await vlZustand(seite);
  pruefe('Mit Filter KI: trotzdem ab Weltpolitik, gleiche Satzzahl', z.text === 'Weltpolitik' && z.zaehler === `Satz 1 von ${gesamt}`, JSON.stringify(z));
  await seite.evaluate(() => window.__sprache.ende());
  await seite.evaluate(() => window.__sprache.ende());
  await seite.click('.vl-schliessen');
  await warte(100);
  await seite.click('.chip:first-child');
  await warte(200);
  pruefe('Mit Filter gemerkt: „Weiter ab Satz 3“', (await seite.$eval('.knopf--weiter', (b) => b.textContent)) === 'Weiter ab Satz 3');

  // Ein Überthema allein
  const wirtschaft = tagesdaten.meldungen.filter((m) => m.hauptthema === 'wirtschaft');
  await seite.click('.thema[data-thema="wirtschaft"] .knopf--vorlesen');
  await warteAufSaetze(seite, z.anzahl + 3);
  z = await vlZustand(seite);
  const themaGesamt = Number((/von (\d+)$/.exec(z.zaehler) || [])[1]);
  pruefe('Thema allein: beginnt mit seinem Namen, eigene Zählung', z.text === 'Börse und Wirtschaft' && z.zaehler === `Satz 1 von ${themaGesamt}` && themaGesamt < gesamt && z.naechstes[0] === true, JSON.stringify(z));
  await seite.click('.vl-schliessen');
  await warte(100);
  const themaSaetze = await liesGanz(seite, '.thema[data-thema="wirtschaft"] .knopf--vorlesen');
  pruefe('Thema allein: endet nach seiner letzten Meldung, ohne Ruhig-Zeile', themaSaetze.length === themaGesamt && themaSaetze[themaGesamt - 1] === `Warum wichtig: ${wirtschaft[1].warum_wichtig}`, JSON.stringify(themaSaetze));
  weiter = await seite.$$eval('.knopf--weiter', (b) => b.map((x) => [x.textContent, Boolean(x.closest('.thema'))]));
  pruefe('Thema allein überschreibt die gemerkte Stelle der Ausgabe nicht', JSON.stringify(weiter) === '[["Weiter ab Satz 3",false]]', JSON.stringify(weiter));

  // Fehlerausgabe: der Satz aus „fehler“
  await seite.click('.ausgabe--zu .ausgabe-umschalter');
  await seite.waitForSelector('.ausgabe[data-datei="data/taeglich/2026-10-30.json"] .knopf--vorlesen');
  const fehlerSaetze = await liesGanz(seite, '.ausgabe[data-datei="data/taeglich/2026-10-30.json"] .knopf--vorlesen');
  pruefe('Fehlerausgabe: nur der Satz aus „fehler“', JSON.stringify(fehlerSaetze) === JSON.stringify(['Beispiel: Keine der festen Quellen war erreichbar, die Ausgabe konnte nicht erstellt werden.']), JSON.stringify(fehlerSaetze));

  // Wochenrückblick: Video-Satz, Finanzierungsrunden, Ordnungszahl
  await seite.click('.tabs a[data-tab="woche"]');
  await seite.waitForSelector('.ausgabe .aktionen--kopf .knopf--vorlesen');
  const woche = await liesGanz(seite, KOPF);
  const wIndex = (s) => woche.indexOf(s);
  pruefe('Woche: „Dazu gibt es eine Video-Empfehlung“ pro Thema mit Video', woche.filter((s) => s === 'Dazu gibt es eine Video-Empfehlung.').length === 2
    && woche[wIndex('Börse und Wirtschaft') - 1] === 'Dazu gibt es eine Video-Empfehlung.' && !woche.some((s) => s.includes('Praxistest')), JSON.stringify(woche));
  pruefe('Woche: Finanzierungsrunden als kurzer Satz pro Runde', woche[wIndex('Finanzierungsrunden der Woche') + 1] === 'Musterhand Robotics, 48 Millionen Euro, Deutschland'
    && woche.filter((s, i) => i > wIndex('Finanzierungsrunden der Woche') && s !== woche[woche.length - 1]).length === 3, JSON.stringify(woche));
  pruefe('Woche: keine Satzgrenze nach „17.“', woche.includes('Die nächste Entscheidung fällt am 17. Dezember.'), JSON.stringify(woche));
  pruefe('Woche: Ruhig-Zeile am Ende', woche[woche.length - 1] === 'Diese Woche ruhig: Tirol und Innsbruck');

  // Monatsrückblick: „Gescheitert und warum“, Ausnahme nicht gelesen
  await seite.click('.tabs a[data-tab="monat"]');
  await seite.waitForSelector('.ausgabe .aktionen--kopf .knopf--vorlesen');
  const monat = await liesGanz(seite, KOPF);
  const g = monat.indexOf('Gescheitert und warum');
  pruefe('Monat: „Gescheitert und warum“ mit Text', JSON.stringify(monat.slice(g, g + 5)) === JSON.stringify(['Gescheitert und warum', 'Musterkiste', 'Wollte in zehn Minuten liefern.', 'Scheiterte am Geld.', 'Lehre: Wachstum kostet.']), JSON.stringify(monat));
  pruefe('Monat: Ausnahme-Grund nicht gelesen, Verweis im alten Thema nicht gelesen', !monat.includes('Test-Grund für die Ausnahme.') && monat.filter((s) => s === 'KI-Meldung 1').length === 1 && monat.includes('kultur'), JSON.stringify(monat));

  // Jahresrückblick: Monatsüberblick und Ausblick; Kapitel
  await seite.click('.tabs a[data-tab="jahr"]');
  await seite.waitForSelector('.ausgabe .aktionen--kopf .knopf--vorlesen');
  const kurz = await liesGanz(seite, KOPF);
  pruefe('Jahr: Monatsüberblick und Ausblick mit ihrem Text', JSON.stringify(kurz) === JSON.stringify(['Tirol und Innsbruck', 'Monatsüberblick', 'November: Im November viel los.', 'Dezember: Im Dezember Schnee.',
    'Ausblick auf 2027', '15. Jänner 2027: Gemeinderatssitzung.', 'März 2027: Baustart.',
    'Dieses Jahr ruhig: Weltpolitik, Politik in Österreich, Deutschland und der EU, KI und Claude, Börse und Wirtschaft, Startups']), JSON.stringify(kurz));
  await seite.click('.ausgabe--zu .ausgabe-umschalter');
  const J2025 = '.ausgabe[data-datei="data/jaehrlich/2025.json"] .aktionen--kopf .knopf--vorlesen';
  await seite.waitForSelector(J2025);
  z = await vlZustand(seite);
  await seite.click(J2025);
  await warteAufSaetze(seite, z.anzahl + 1);
  z = await vlZustand(seite);
  pruefe('Jahr kapitelweise: Kapitel 1 von 4', z.thema === 'Weltpolitik' && z.kapitel === 'Kapitel 1 von 4', JSON.stringify(z));
  await seite.click('.vl-naechstes');
  await warteAufSaetze(seite, z.anzahl + 1);
  await seite.click('.vl-naechstes');
  await warteAufSaetze(seite, z.anzahl + 2);
  z = await vlZustand(seite);
  pruefe('„Nächstes Thema“ springt ins nächste Kapitel', z.text === 'KI und Claude' && z.kapitel === 'Kapitel 3 von 4' && z.naechstes[1] === 'Börse und Wirtschaft', JSON.stringify(z));
  await seite.click('.vl-schliessen');
  await warte(100);
  const jahr = await liesGanz(seite, J2025);
  pruefe('Satzgrenzen: Ordnungszahlen und Abkürzungen, zwei Videos, Verweis nicht gelesen', JSON.stringify(jahr) === JSON.stringify(JAHR_2025_SAETZE), JSON.stringify(jahr));

  // Wake Lock abgelehnt: Hinweis, Vorlesen läuft trotzdem
  await seite.evaluate(() => { window.__sprache.sperreVerweigern = true; });
  z = await vlZustand(seite);
  await seite.click(J2025);
  await warteAufSaetze(seite, z.anzahl + 1);
  await seite.waitForSelector('#vorlesen .vl-hinweis:not([hidden])');
  z = await vlZustand(seite);
  pruefe('Ohne Wake Lock: Hinweis, Vorlesen läuft trotzdem', z.hinweis.startsWith('Der Bildschirm kann nicht wach gehalten werden.') && z.haupt === 'Pause' && !z.wach, JSON.stringify(z));
  await seite.keyboard.press('Escape');
  z = await vlZustand(seite);
  pruefe('Escape schließt', !z.offen);
  pruefe('Nie pause() aufgerufen, nie zwei Äußerungen gleichzeitig', z.pausen === 0 && z.doppelt === 0, JSON.stringify(z));
}

// Gleiche Satztrennung wie die App für einfache Texte ohne Abkürzungen (nur für erwartete Werte).
function teileZumTest(text) {
  return text.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ])/);
}

// ------------------------------------------------------------ Ablauf

(async () => {
  const server = await starteServer();
  const basis = `http://127.0.0.1:${server.address().port}`;
  const ordner = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mein-feed-test-'));
  const browser = await chromium.launch();
  try {
    const nurBeispiel = { dateien: new Set(BEISPIEL), youtube: 'gesperrt', index: 'normal' };
    await szenario(browser, basis, 'Beispieldaten (1.11.2026)', nurBeispiel,
      (seite, ctx) => beispieldaten(seite, ctx, `${basis}/`, nurBeispiel, ordner));
    const alle = { dateien: new Set(alleAusgaben().map((a) => a.datei)), youtube: 'attrappe', index: 'normal' };
    await szenario(browser, basis, 'Sonderfälle (3.11.2026)', alle, (seite, ctx) => sonderfaelle(seite, ctx, `${basis}/`));
    const vorleseDaten = {
      dateien: new Set([...BEISPIEL, 'data/monatlich/2026-10.json', 'data/jaehrlich/2026.json', 'data/jaehrlich/2025.json']),
      zusatz: { 'data/jaehrlich/2025.json': JAHR_2025 },
      youtube: 'gesperrt',
      index: 'normal',
      vorbereitung: sprachAttrappe,
    };
    await szenario(browser, basis, 'Vorlesen (Attrappen für Sprachausgabe und Wake Lock)', vorleseDaten, (seite, ctx) => vorlesenTests(seite, ctx, `${basis}/`));
    await szenario(browser, basis, 'Noch kein Daten-Branch', { dateien: new Set(), index: '404' }, (seite, ctx) => ohneDaten(seite, ctx, `${basis}/`));
    await szenario(browser, basis, 'Offline', { dateien: new Set(), index: 'offline' }, (seite, ctx) => offline(seite, ctx, `${basis}/`));
    const pwaDaten = {
      dateien: new Set(BEISPIEL),
      youtube: 'attrappe',
      index: 'normal',
      serviceWorker: true,
      offline: false,
      anfragen: [],
    };
    await szenario(browser, basis, 'PWA (unter /mein-feed/, mit Service Worker)', pwaDaten, (seite, ctx) => pwa(seite, ctx, basis, pwaDaten));
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(ordner, { recursive: true, force: true });
  }
  console.log(`\n${bestanden} bestanden, ${fehlgeschlagen.length} fehlgeschlagen`);
  process.exit(fehlgeschlagen.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
