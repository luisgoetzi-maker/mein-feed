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
 * Alle Szenarien bis auf „PWA“ und „Azure-Stimme mit Service Worker“ blockieren den Service Worker.
 * Das PWA-Szenario liefert die App wie GitHub Pages unter /mein-feed/ aus (nicht im
 * Wurzelverzeichnis), prüft Manifest und Icons und mit echtem Service Worker den Offline-Fall. Weil
 * Playwright Anfragen, die der Test selbst beantwortet, auch bei context.setOffline(true)
 * durchlässt, bricht der Test sie dann zusätzlich ab.
 *
 * Die Azure-Stimme wird mit einer Attrappe des Speech SDK geprüft (azureAttrappe): Sie liefert für
 * jedes Stück einen kurzen Ton (WAV mit Stille) und Marken-Ereignisse mit Zeitpunkten; die Token-
 * Anfrage an Azure beantwortet der Test selbst (azureNetz). Wie die echte Stimme klingt und ob sie
 * bei gesperrtem Bildschirm weiterläuft, lässt sich nur am Handy prüfen.
 *
 * Mit MEIN_FEED_SDK=<Pfad zu microsoft.cognitiveservices.speech.sdk.bundle-min.js> prüft der Test
 * zusätzlich, ob die SRI in app.js zur Datei passt, und lässt das echte SDK durch die App laufen;
 * den Sprachdienst auf der WebSocket-Verbindung spielt dann der Test. Die Datei steht im npm-Paket
 * microsoft-cognitiveservices-speech-sdk unter distrib/browser/.
 *
 * NUR=<Teil des Namens> führt nur passende Szenarien aus, etwa NUR=Azure.
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
  if (process.env.NUR && !name.includes(process.env.NUR)) return; // z. B. NUR=Azure node tests/app_test.js
  console.log(`\n${name}`);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'de-AT',
    acceptDownloads: true,
    // Ohne Block liefert der Service Worker alte Dateien aus seinem Cache; nur das PWA-Szenario lässt ihn zu.
    serviceWorkers: einstellungen.serviceWorker ? 'allow' : 'block',
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: basis });
  for (const skript of [].concat(einstellungen.vorbereitung || [])) await ctx.addInitScript(skript);
  await ctx.route('**/*', async (route) => {
    const url = route.request().url();
    if (einstellungen.anfragen) einstellungen.anfragen.push(url);
    if (einstellungen.mitschnitt) {
      const r = route.request();
      einstellungen.mitschnitt.push({ url, methode: r.method(), kopf: r.headers(), inhalt: r.postData() || '' });
    }
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
    if (einstellungen.azure) {
      if (AZ_TOKEN_URL.test(url)) return einstellungen.azure.token(route);
      if (url.startsWith('https://cdn.jsdelivr.net/')) return einstellungen.azure.cdn(route);
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

// ------------------------------------------------------------ Attrappen für die Azure-Stimme

const AZ_SCHLUESSEL = 'AzureTestSchluessel0123456789abcdefXYZ'; // erfunden
const AZ_TOKEN_URL = /^https:\/\/[a-z0-9]+\.api\.cognitive\.microsoft\.com\/sts\/v1\.0\/issueToken$/;
const AZ_SDK_URL = /^https:\/\/cdn\.jsdelivr\.net\/npm\/microsoft-cognitiveservices-speech-sdk@\d+\.\d+\.\d+\/distrib\/browser\/microsoft\.cognitiveservices\.speech\.sdk\.bundle-min\.js$/;

/*
 * Läuft vor app.js in der Seite. Fängt das <script> fürs Speech SDK ab, bevor der Browser es lädt
 * (die echte Datei gibt es im Test nicht, und eine andere bestünde die Integritätsprüfung nicht),
 * und setzt stattdessen eine Attrappe von window.SpeechSDK ein. Sie liefert für jedes Stück einen
 * Ton (WAV mit Stille, je Satz msProSatz Millisekunden) und Marken-Ereignisse mit den Zeitpunkten.
 * Steuerung über window.__azure:
 *   skripte[]      angehängte SDK-Skripte mit src, integrity, crossOrigin
 *   configs[]      SpeechConfig-Aufrufe (art: token oder schluessel)
 *   synthesen[]    jede speakSsmlAsync-Anfrage: ssml, marken (Satznummern), stimme, format, zeit
 *   modus          'ok', '401' oder '429' (Abbruch wie das SDK ihn meldet)
 *   scheitertAb    ab dieser Anfrage (1 = erste) gilt modus, davor 'ok'
 *   sdkFehler      das Skript lädt nicht (wie bei falscher Integrität oder ohne Netz)
 *   aktionen{}     Media-Session-Aktionen, wie sie Sperrbildschirm und Kopfhörer auslösen
 */
function azureAttrappe() {
  const log = {
    skripte: [], configs: [], synthesen: [], aktionen: {},
    modus: 'ok', scheitertAb: 1, sdkFehler: false, msProSatz: 100, verzoegerung: 30,
  };
  window.__azure = log;

  function wav(ms) {
    const rate = 8000;
    const n = Math.max(1, Math.round((rate * ms) / 1000));
    const d = new DataView(new ArrayBuffer(44 + n * 2));
    const text = (o, t) => [...t].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
    text(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
    d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, rate, true);
    d.setUint32(28, rate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); text(36, 'data'); d.setUint32(40, n * 2, true);
    return d.buffer;
  }

  const FORMATE = { Audio16Khz32KBitRateMonoMp3: 3, Audio24Khz48KBitRateMonoMp3: 8, Riff24Khz16BitMonoPcm: 9 };
  const sdk = {
    ResultReason: { Canceled: 1, SynthesizingAudioCompleted: 8 },
    CancellationErrorCode: { NoError: 0, AuthenticationFailure: 1, BadRequestParameters: 2, TooManyRequests: 3, ConnectionFailure: 4 },
    SpeechSynthesisOutputFormat: FORMATE,
    CancellationDetails: { fromResult: (r) => r.details },
    SpeechConfig: {
      fromAuthorizationToken(token, region) {
        const c = { art: 'token', wert: token, region, speechSynthesisOutputFormat: null };
        log.configs.push(c);
        return c;
      },
      fromSubscription(schluessel, region) {
        const c = { art: 'schluessel', wert: schluessel, region, speechSynthesisOutputFormat: null };
        log.configs.push(c);
        return c;
      },
    },
    SpeechSynthesizer: function SpeechSynthesizer(config, audioConfig) {
      this.bookmarkReached = null;
      this.close = () => {};
      this.speakSsmlAsync = (ssml, ok) => {
        const marken = [...ssml.matchAll(/<bookmark mark="s(\d+)"\/>/g)].map((m) => Number(m[1]));
        const format = Object.keys(FORMATE).find((k) => FORMATE[k] === config.speechSynthesisOutputFormat) || null;
        log.synthesen.push({
          ssml, marken, format, audioConfig, token: config.wert, region: config.region,
          stimme: (/<voice name="([^"]+)"/.exec(ssml) || [])[1], zeit: Date.now(), msProSatz: log.msProSatz,
        });
        const nr = log.synthesen.length;
        const ms = log.msProSatz;
        setTimeout(() => {
          const modus = nr >= log.scheitertAb ? log.modus : 'ok';
          const abbruch = (code, text) => ok({ reason: 1, errorDetails: text, details: { reason: 1, ErrorCode: code, errorDetails: text } });
          if (modus === '401') return abbruch(1, 'WebSocket upgrade failed: Authentication error (401). Please check subscription information and region name.');
          if (modus === '429') return abbruch(3, 'Status(StatusCode="ResourceExhausted", Detail="Too many requests") 429');
          marken.forEach((satz, k) => {
            if (this.bookmarkReached) this.bookmarkReached(this, { text: `s${satz}`, audioOffset: k * ms * 10000 }); // 100 ns
          });
          return ok({ reason: 8, audioData: wav(Math.max(1, marken.length) * ms), audioDuration: marken.length * ms * 10000 });
        }, log.verzoegerung);
      };
    },
  };

  const anhaengen = Element.prototype.append;
  Element.prototype.append = function append(...knoten) {
    const rest = knoten.filter((k) => {
      if (!(k instanceof HTMLScriptElement) || !String(k.src).includes('microsoft-cognitiveservices-speech-sdk')) return true;
      log.skripte.push({ src: k.src, integrity: k.integrity, crossOrigin: k.crossOrigin, zeit: Date.now() });
      setTimeout(() => {
        if (!log.sdkFehler) window.SpeechSDK = sdk;
        k.dispatchEvent(new Event(log.sdkFehler ? 'error' : 'load'));
      }, 20);
      return false;
    });
    return anhaengen.apply(this, rest);
  };

  if (navigator.mediaSession) {
    const setzen = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
    navigator.mediaSession.setActionHandler = (aktion, los) => {
      log.aktionen[aktion] = los;
      setzen(aktion, los);
    };
  }
}

// Gegenstück im Netz: issueToken bei Azure und (nur für den Service-Worker-Test) das CDN.
function azureNetz() {
  return {
    modus: 'ok', // 'ok', '401', '429'
    anfragen: [],
    token(route) {
      const r = route.request();
      const kopf = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' };
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: kopf });
      this.anfragen.push({ url: r.url(), methode: r.method(), schluessel: r.headers()['ocp-apim-subscription-key'] || null });
      if (this.modus === '401') return route.fulfill({ status: 401, body: '{"error":{"code":"401","message":"Access denied"}}', headers: kopf });
      if (this.modus === '429') return route.fulfill({ status: 429, body: '', headers: kopf });
      return route.fulfill({ status: 200, body: `TOKEN-${this.anfragen.length}`, contentType: 'text/plain', headers: kopf });
    },
    cdn(route) {
      return route.fulfill({ status: 200, body: '/* Attrappe */', contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
    },
  };
}

// Erfundener Jahresrückblick mit einem langen Thema, das in mehrere Stücke geteilt werden muss.
const JAHR_LANG = {
  beispiel: true,
  format: 'jaehrlich',
  titel: 'Jahresrückblick 2024',
  zeitraum: { von: '2024-01-01', bis: '2024-12-31' },
  erschienen: '2025-01-01T04:40:00+01:00',
  status: 'ok',
  fehler: null,
  ruhig: ['politik', 'tirol', 'startups'],
  luecken: [],
  ausnahmen: [],
  meldungen: [
    { id: '2024-weltpolitik-1', datum: '2024-02-01', datum_bis: null, titel: 'Erstes Kapitel', text: 'Ein kurzer Satz.', warum_wichtig: 'Zum Einstieg.', themen: ['weltpolitik'], hauptthema: 'weltpolitik', update: false, quellen: [{ name: 'Q', url: 'https://example.com/w' }] },
    ...Array.from({ length: 12 }, (_, i) => ({
      id: `2024-ki-${i + 1}`,
      datum: `2024-${String(i + 1).padStart(2, '0')}-10`,
      datum_bis: null,
      titel: `KI-Monat ${i + 1}: Ein neues Modell & ein „Werkzeug“ <für> alle`,
      text: `Im Monat ${i + 1} erschien ein neues Modell mit deutlich längerem Kontext und besseren Werkzeugen für Entwickler. Die Preise sanken um rund ein Drittel, und mehrere Anbieter zogen innerhalb weniger Wochen nach. Fachleute sprachen von einem großen Schritt für den Alltag in Büros und Schulen.`,
      warum_wichtig: 'Es verändert, wie viele Menschen täglich arbeiten und lernen.',
      themen: ['ki'],
      hauptthema: 'ki',
      update: false,
      quellen: [{ name: 'Q', url: `https://example.com/k${i}` }],
    })),
    { id: '2024-wirtschaft-1', datum: '2024-12-01', datum_bis: null, titel: 'Letztes Kapitel', text: 'Der Zins bleibt.', warum_wichtig: 'Kredite bleiben gleich teuer.', themen: ['wirtschaft'], hauptthema: 'wirtschaft', update: false, quellen: [{ name: 'Q', url: 'https://example.com/x' }] },
  ],
  videos: [],
  abschnitte: [],
};

// Zustand der Vorlese-Ansicht, des Audio-Elements und der Attrappen auf einen Blick. Hat das
// Audio-Element gerade ein neues Stück bekommen, erst warten, bis seine Länge bekannt ist.
async function azZustand(seite) {
  await seite.waitForFunction(() => {
    const a = document.querySelector('#vorlesen audio');
    return !a || !a.getAttribute('src') || a.readyState >= 1;
  }, null, { timeout: 3000 });
  return seite.evaluate(() => {
    const w = document.getElementById('vorlesen');
    const q = (sel) => (w ? w.querySelector(sel) : null);
    const text = (sel) => (q(sel) ? q(sel).textContent : null);
    const sichtbar = (sel) => (q(sel) && !q(sel).hidden ? q(sel).textContent : '');
    const audio = q('audio');
    const ms = navigator.mediaSession;
    const az = window.__azure || { aktionen: {}, synthesen: [], skripte: [] }; // ohne Attrappe: echtes SDK
    const sp = window.__sprache;
    const zaehler = text('.vl-zaehler') || '';
    return {
      offen: Boolean(w && !w.hidden),
      satz: text('.vl-satz'),
      nummer: Number((/Satz (\d+)/.exec(zaehler) || [])[1]),
      gesamt: Number((/von (\d+)/.exec(zaehler) || [])[1]),
      haupt: text('.vl-haupt'),
      thema: sichtbar('.vl-thema') ? text('.vl-thema-name') : '',
      kapitel: text('.vl-kapitel'),
      hinweis: sichtbar('.vl-hinweis'),
      quelle: text('.vl-quelle'),
      rueckfall: Boolean(q('.vl-quelle') && q('.vl-quelle').classList.contains('vl-quelle--rueckfall')),
      status: sichtbar('.vl-azure-status'),
      audio: audio ? { src: audio.getAttribute('src') || '', paused: audio.paused, t: audio.currentTime, d: audio.duration, rate: audio.playbackRate } : null,
      medien: ms ? { titel: ms.metadata ? ms.metadata.title : null, thema: ms.metadata ? ms.metadata.artist : null, zustand: ms.playbackState } : null,
      aktionen: Object.keys(az.aktionen).filter((k) => typeof az.aktionen[k] === 'function').sort(),
      synthesen: az.synthesen.length,
      skripte: az.skripte.length,
      gesprochen: sp.gesprochen.length,
      gesprochenText: (sp.gesprochen[sp.gesprochen.length - 1] || {}).text,
      wach: sp.wach(),
      anforderungen: sp.anforderungen,
      position: JSON.parse(localStorage.getItem('mein-feed.vorleseposition.v1')),
      einstellungen: JSON.parse(localStorage.getItem('mein-feed.vorlesen.v1')),
    };
  });
}

const azSynthesen = (seite) => seite.evaluate(() => window.__azure.synthesen.map((s) => ({ ...s, audioConfig: s.audioConfig === null ? null : 'gesetzt' })));

// Sätze eines Stücks aus seinem SSML: Satznummer -> gesprochener Text.
function ssmlSaetze(ssml) {
  const teile = ssml.split(/<bookmark mark="s(\d+)"\/>/);
  const saetze = new Map();
  for (let i = 1; i < teile.length; i += 2) {
    const roh = teile[i + 1].replace(/<\/voice><\/speak>$/, '');
    saetze.set(Number(teile[i]), {
      text: roh.replace(/<break[^>]*\/>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim(),
      pause: (/<break time="(\d+)ms"\/>/.exec(roh) || [])[1] || null,
    });
  }
  return saetze;
}

// Das zuletzt angeforderte Stück, das diesen Satz enthält.
function stueckMit(synthesen, satz) {
  for (let i = synthesen.length - 1; i >= 0; i -= 1) if (synthesen[i].marken.includes(satz)) return synthesen[i];
  return null;
}

// Steht das Audio-Element am Anfang dieses Satzes (Satznummer ab 0)?
function amSatzAnfang(z, synthesen, satz) {
  const st = stueckMit(synthesen, satz);
  if (!st || !z.audio) return false;
  const soll = ((satz - st.marken[0]) * st.msProSatz) / 1000;
  return z.audio.t >= soll - 0.02 && z.audio.t < soll + 0.25 && Math.abs(z.audio.d - (st.marken.length * st.msProSatz) / 1000) < 0.02;
}

// Zeichnet bei jedem timeupdate auf, welche Stelle im Ton läuft und welchen Satz die Ansicht zeigt.
const azProbenStarten = (seite) => seite.evaluate(() => {
  const a = document.querySelector('#vorlesen audio');
  window.__proben = [];
  if (a.__probe) return;
  a.__probe = true;
  a.addEventListener('timeupdate', () => {
    const z = document.querySelector('#vorlesen .vl-zaehler').textContent;
    if (document.querySelector('#vorlesen .vl-haupt').textContent !== 'Pause' || a.paused) return;
    window.__proben.push({ t: a.currentTime, d: a.duration, rate: a.playbackRate, satz: Number(/Satz (\d+)/.exec(z)[1]) - 1 });
  });
});

// Passt jede Probe zu den Marken? Erwartet: der letzte Satz, dessen Marke (k * msProSatz) erreicht ist.
// Die App liest die Zeit im selben Ereignis kurz vor der Probe; deshalb 10 ms Spielraum nach unten.
function probenStimmen(proben, synthesen) {
  const falsch = [];
  for (const p of proben) {
    const st = stueckMit(synthesen, p.satz);
    if (!st) {
      falsch.push({ ...p, grund: 'kein Stück' });
      continue;
    }
    const ms = st.msProSatz;
    const satzBei = (t) => st.marken[0] + Math.min(st.marken.length - 1, Math.floor((t * 1000 + 40) / ms));
    const soll = satzBei(p.t);
    if ((p.satz !== soll && p.satz !== satzBei(p.t - 0.01)) || Math.abs(p.d - (st.marken.length * ms) / 1000) > 0.02) falsch.push({ ...p, soll });
  }
  return falsch;
}

// Prüft die Stücke einer ganzen Sitzung: lückenlos, Themenanfang = Stückanfang, Längen.
function stueckePruefen(stuecke, gesamt, themenNamen, erstesMax = 500) {
  const fehler = [];
  let naechster = stuecke.length ? stuecke[0].marken[0] : 0;
  stuecke.forEach((st, i) => {
    if (st.marken[0] !== naechster) fehler.push(`Stück ${i} beginnt bei ${st.marken[0]} statt ${naechster}`);
    if (st.marken.some((m, k) => m !== st.marken[0] + k)) fehler.push(`Stück ${i} nicht lückenlos`);
    naechster = st.marken[st.marken.length - 1] + 1;
    const saetze = ssmlSaetze(st.ssml);
    const zeichen = [...saetze.values()].reduce((n, s) => n + s.text.length + 1, 0);
    const max = i === 0 ? erstesMax : 1500;
    if (zeichen > max && saetze.size > 1) fehler.push(`Stück ${i} hat ${zeichen} Zeichen (höchstens ${max})`);
    saetze.forEach((s, nr) => {
      const istThema = themenNamen.includes(s.text);
      if (istThema && nr !== st.marken[0]) fehler.push(`Thema „${s.text}“ (Satz ${nr}) mitten in Stück ${i}`);
      if (istThema && s.pause !== '700') fehler.push(`nach „${s.text}“ fehlt die Pause`);
    });
  });
  if (naechster !== gesamt) fehler.push(`endet bei ${naechster} statt ${gesamt}`);
  return fehler;
}

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

// ------------------------------------------------------------ Azure-Stimme

// Vor jedem Abschnitt: Der Takt (höchstens 15 Anfragen pro Minute) gilt sonst über den ganzen Test.
const taktLeeren = (seite) => seite.evaluate(() => localStorage.removeItem('mein-feed.azure-takt.v1'));
const warteAufTon = (seite) => seite.waitForFunction(() => {
  const a = document.querySelector('#vorlesen audio');
  return a && !a.paused && a.getAttribute('src');
}, null, { timeout: 5000 });
const warteAufStatus = (seite) => seite.waitForFunction(() => {
  const p = document.querySelector('#vorlesen .vl-azure-status');
  return p && !p.hidden && !p.textContent.startsWith('Teste');
}, null, { timeout: 5000 });
const tonDa = (seite, url) => seite.evaluate((u) => fetch(u).then(() => 'da', () => 'weg'), url);

async function azureTests(seite, ctx, basis, einstellungen, ordner) {
  const netz = einstellungen.azure;
  const konsole = [];
  seite.on('console', (m) => konsole.push(m.text()));
  await seite.clock.setSystemTime(new Date('2026-11-01T08:00:00+01:00')); // Uhr läuft weiter
  await seite.goto(`${basis}#heute`);
  await seite.waitForSelector('.aktionen--kopf .knopf--vorlesen');
  const KOPF = '.ausgabe:first-of-type .aktionen--kopf .knopf--vorlesen';
  const THEMEN = ['Weltpolitik', 'Politik in Österreich, Deutschland und der EU', 'KI und Claude', 'Börse und Wirtschaft'];
  const KEIN_SCHLUESSEL = 'Stimme des Handys – kein Azure-Schlüssel eingetragen (unter „Stimme und Tempo“).';

  // Für die Prüfung von Export und Feedback: eine Meldung merken, eine als unnötig markieren.
  await seite.click('[data-meldung="2026-10-31-wirtschaft-1"] .knopf--merk');
  await seite.click('[data-meldung="2026-10-31-weltpolitik-4"] .knopf--unnoetig');

  // Ohne Schlüssel
  await seite.click(KOPF);
  await warteAufSaetze(seite, 1);
  await warteAufWach(seite, true);
  let z = await azZustand(seite);
  pruefe('Ohne Schlüssel: Stimme des Handys, mit Hinweis warum', z.gesprochenText === 'Weltpolitik' && z.wach && z.rueckfall && z.quelle === KEIN_SCHLUESSEL, JSON.stringify(z));
  pruefe('Ohne Schlüssel: Speech SDK nicht geladen, keine Anfrage an Azure', z.skripte === 0 && netz.anfragen.length === 0
    && !(await seite.evaluate(() => 'SpeechSDK' in window)), JSON.stringify([z.skripte, netz.anfragen]));
  pruefe('Ohne Schlüssel: Media Session bleibt leer', z.medien && z.medien.titel === null && z.aktionen.length === 0, JSON.stringify([z.medien, z.aktionen]));

  // Schlüssel und Region eintragen, testen
  await seite.click('.vl-einstellungen summary');
  const feld = await seite.$eval('#vl-azure-schluessel', (f) => ({ typ: f.type, auto: f.autocomplete, wert: f.value }));
  pruefe('Schlüsselfeld zeigt verdeckt', feld.typ === 'password' && feld.wert === '' && feld.auto === 'off', JSON.stringify(feld));
  await taktLeeren(seite);
  await seite.fill('#vl-azure-schluessel', `  ${AZ_SCHLUESSEL} `);
  await seite.fill('#vl-azure-region', 'westeurope');
  await seite.click('.vl-azure .vl-knopf--primaer');
  await warteAufStatus(seite);
  z = await azZustand(seite);
  let syn = await azSynthesen(seite);
  const skript = await seite.evaluate(() => window.__azure.skripte[0]);
  const configs = await seite.evaluate(() => window.__azure.configs);
  pruefe('Testen: SDK erst jetzt geladen, feste Version vom CDN mit Integritätsprüfung', z.skripte === 1 && AZ_SDK_URL.test(skript.src)
    && /^sha384-[A-Za-z0-9+/]{64}$/.test(skript.integrity) && skript.crossOrigin === 'anonymous', JSON.stringify(skript));
  pruefe('Testen: Schlüssel nur im Kopf der Token-Anfrage an Azure', netz.anfragen.length === 1 && netz.anfragen[0].methode === 'POST'
    && netz.anfragen[0].url === 'https://westeurope.api.cognitive.microsoft.com/sts/v1.0/issueToken' && netz.anfragen[0].schluessel === AZ_SCHLUESSEL, JSON.stringify(netz.anfragen));
  pruefe('Testen: das SDK bekommt nur das Token; MP3, mono, 48 kbit/s; Ton nur als Daten', configs.length === 1 && configs[0].art === 'token'
    && configs[0].wert === 'TOKEN-1' && configs[0].region === 'westeurope' && syn[0].format === 'Audio24Khz48KBitRateMonoMp3' && syn[0].audioConfig === null,
  JSON.stringify([configs, syn[0] && syn[0].format, syn[0] && syn[0].audioConfig]));
  const gespeichert = await seite.evaluate(() => JSON.parse(localStorage.getItem('mein-feed.azure.v1')));
  pruefe('Testen: Erfolg gemeldet, Schlüssel und Region gespeichert, Feld wieder leer', z.status.startsWith('Die Azure-Stimme funktioniert.')
    && (await seite.$eval('#vl-azure-schluessel', (f) => f.value)) === '' && gespeichert.schluessel === AZ_SCHLUESSEL && gespeichert.region === 'westeurope', JSON.stringify([z.status, gespeichert && gespeichert.region]));
  const stimmen = await seite.$$eval('#vl-stimme option', (o) => o.map((x) => [x.value, x.textContent]));
  pruefe('Azure-Stimmen: Ingrid und Jonas zuerst, dann deutsche', stimmen[0][0] === 'de-AT-IngridNeural' && stimmen[1][0] === 'de-AT-JonasNeural'
    && stimmen.length > 3 && stimmen.slice(2).every(([id]) => id.startsWith('de-DE-')) && (await seite.$eval('#vl-stimme', (s) => s.value)) === 'de-AT-IngridNeural', JSON.stringify(stimmen));
  pruefe('Testen hält das Vorlesen an, danach liest Azure', z.haupt === 'Weiter' && z.quelle === 'Azure-Stimme' && !z.rueckfall && !z.wach
    && syn[0].stimme === 'de-AT-IngridNeural' && syn[0].marken.length === 0, JSON.stringify(z));

  // Weiter: Azure liest
  await taktLeeren(seite);
  await seite.evaluate(() => { window.__azure.msProSatz = 400; });
  await seite.click('.vl-haupt');
  await warteAufTon(seite);
  z = await azZustand(seite);
  syn = await azSynthesen(seite);
  const gesamt = z.gesamt;
  pruefe('Weiter: Azure liest den gemerkten Satz, Ton als Blob im Arbeitsspeicher', z.nummer === 1 && z.satz === 'Weltpolitik' && z.haupt === 'Pause'
    && z.audio.src.startsWith('blob:') && syn[1].marken[0] === 0 && amSatzAnfang(z, syn, 0), JSON.stringify([z, syn[1] && syn[1].marken]));
  pruefe('Azure: kein Wake Lock', !z.wach && z.anforderungen === 1, JSON.stringify(z));
  pruefe('Media Session: Ausgabe und Thema, Pause/Weiter, Satz zurück/vor', z.medien.titel === 'Samstag, 31. Oktober 2026' && z.medien.thema === 'Weltpolitik'
    && z.medien.zustand === 'playing' && JSON.stringify(z.aktionen) === '["nexttrack","pause","play","previoustrack"]', JSON.stringify([z.medien, z.aktionen]));
  await seite.waitForFunction((n) => window.__azure.synthesen.slice(1).some((s) => s.marken.includes(n - 1)), gesamt, { timeout: 5000 });
  syn = await azSynthesen(seite);
  const sitzung = syn.slice(1);
  const stueckFehler = stueckePruefen(sitzung, gesamt, THEMEN);
  pruefe('Stücke: je Überthema, das erste kurz, lückenlos bis zum letzten Satz, im Hintergrund geladen', !stueckFehler.length && sitzung.length > THEMEN.length,
    JSON.stringify([stueckFehler, sitzung.map((s) => s.marken)]));
  const xmlOk = await seite.evaluate((liste) => liste.every((x) => !new DOMParser().parseFromString(x, 'application/xml').querySelector('parsererror')), syn.map((s) => s.ssml));
  const alleSaetze = new Map(sitzung.flatMap((s) => [...ssmlSaetze(s.ssml)]));
  const politik = [...alleSaetze].find(([, s]) => s.text === THEMEN[1])[0];
  pruefe('SSML: gültiges XML, eine Marke pro Satz, gleiche Sätze wie mit der Stimme des Handys', xmlOk && alleSaetze.size === gesamt
    && alleSaetze.get(0).text === 'Weltpolitik' && alleSaetze.get(gesamt - 1).text === 'Heute ruhig: Tirol und Innsbruck, Startups' && politik > 10, JSON.stringify([xmlOk, alleSaetze.size, gesamt]));

  // Satz vor und zurück, nächstes Thema
  await seite.click('.vl-vor');
  z = await azZustand(seite);
  pruefe('Satz vor: springt im Ton an den Anfang des nächsten Satzes', z.nummer === 2 && amSatzAnfang(z, syn, 1) && !z.audio.paused && z.synthesen === syn.length, JSON.stringify(z));
  await seite.click('.vl-vor');
  await seite.click('.vl-zurueck');
  z = await azZustand(seite);
  pruefe('Satz zurück: an den Anfang des vorigen Satzes', z.nummer === 2 && amSatzAnfang(z, syn, 1) && !z.audio.paused, JSON.stringify(z));
  await seite.click('.vl-naechstes');
  z = await azZustand(seite);
  pruefe('Nächstes Thema: an den Anfang des Stücks mit dem nächsten Thema', z.satz === THEMEN[1] && z.nummer === politik + 1 && amSatzAnfang(z, syn, politik)
    && z.medien.thema === THEMEN[1] && z.synthesen === syn.length, JSON.stringify(z));

  // Sperrbildschirm und Kopfhörer (Media Session)
  await seite.evaluate(() => window.__azure.aktionen.nexttrack());
  z = await azZustand(seite);
  pruefe('Media Session: Satz vor', z.nummer === politik + 2 && amSatzAnfang(z, syn, politik + 1), JSON.stringify(z));
  await seite.evaluate(() => window.__azure.aktionen.previoustrack());
  z = await azZustand(seite);
  pruefe('Media Session: Satz zurück', z.nummer === politik + 1 && amSatzAnfang(z, syn, politik), JSON.stringify(z));
  await seite.evaluate(() => window.__azure.aktionen.pause());
  z = await azZustand(seite);
  pruefe('Media Session: Pause, Stelle gemerkt', z.haupt === 'Weiter' && z.audio.paused && z.medien.zustand === 'paused' && z.position && z.position.satz === politik, JSON.stringify(z));
  await seite.evaluate(() => window.__azure.aktionen.play());
  z = await azZustand(seite);
  pruefe('Media Session: Weiter, derselbe Satz von vorn', z.haupt === 'Pause' && !z.audio.paused && amSatzAnfang(z, syn, politik) && z.medien.zustand === 'playing', JSON.stringify(z));

  // Tempo: nur die Abspielgeschwindigkeit
  const vorTempo = await azZustand(seite);
  await seite.selectOption('#vl-tempo', '1.2');
  z = await azZustand(seite);
  pruefe('Tempo: nur schneller abspielen, nichts neu laden', z.audio.rate === 1.2 && z.audio.src === vorTempo.audio.src && !z.audio.paused
    && z.synthesen === vorTempo.synthesen && z.audio.t >= vorTempo.audio.t && z.einstellungen.tempo === 1.2, JSON.stringify([vorTempo.audio, z.audio]));

  // Stimmwechsel: neu ab dem aktuellen Satz
  await taktLeeren(seite);
  await seite.click('.vl-vor'); // an einen Satzanfang, damit der Satz sicher noch läuft
  const vorStimme = await azZustand(seite);
  await seite.selectOption('#vl-stimme', 'de-AT-JonasNeural');
  await seite.waitForFunction((n) => window.__azure.synthesen.length > n, vorStimme.synthesen, { timeout: 5000 });
  await warteAufTon(seite);
  z = await azZustand(seite);
  syn = await azSynthesen(seite);
  const neu = syn[vorStimme.synthesen];
  pruefe('Stimmwechsel: lädt ab dem aktuellen Satz mit der neuen Stimme neu', neu.stimme === 'de-AT-JonasNeural' && neu.marken[0] === vorStimme.nummer - 1
    && z.nummer === vorStimme.nummer && amSatzAnfang(z, syn, vorStimme.nummer - 1) && z.audio.src !== vorStimme.audio.src
    && z.einstellungen.azureStimme === 'de-AT-JonasNeural' && z.audio.rate === 1.2, JSON.stringify([neu.marken, vorStimme.nummer, z]));
  pruefe('Stimmwechsel: der Ton der alten Stimme ist freigegeben', (await tonDa(seite, vorStimme.audio.src)) === 'weg');

  // Bildschirm aus oder App gewechselt: Azure liest weiter
  const vorSicht = await azZustand(seite);
  await seite.evaluate(() => window.__sprache.sichtbarkeit('hidden'));
  await warte(300);
  z = await azZustand(seite);
  pruefe('Bildschirm aus oder App gewechselt: Azure liest weiter, ohne Wake Lock', z.haupt === 'Pause' && !z.audio.paused && z.nummer >= vorSicht.nummer
    && z.anforderungen === vorSicht.anforderungen && !z.wach && z.hinweis === '', JSON.stringify(z));
  await seite.evaluate(() => window.__sprache.sichtbarkeit('visible'));
  await warte(100);
  z = await azZustand(seite);
  pruefe('Zurück in der App: liest weiter, kein Wake Lock angefordert', z.haupt === 'Pause' && !z.audio.paused && z.anforderungen === vorSicht.anforderungen, JSON.stringify(z));

  // Pause von außen (Anruf, andere App, Kopfhörer abgezogen)
  await seite.evaluate(() => document.querySelector('#vorlesen audio').pause());
  await seite.waitForFunction(() => document.querySelector('#vorlesen .vl-haupt').textContent.startsWith('Weiter ab Satz'), null, { timeout: 3000 });
  z = await azZustand(seite);
  const gemerkt = z.nummer;
  pruefe('Pause von außen: „Weiter ab Satz …“ mit gemerkter Stelle', z.haupt === `Weiter ab Satz ${gemerkt}` && z.hinweis === 'Das Vorlesen wurde unterbrochen.'
    && z.position.satz === gemerkt - 1 && z.medien.zustand === 'paused', JSON.stringify(z));
  await seite.click('.vl-haupt');
  z = await azZustand(seite);
  pruefe('„Weiter ab Satz …“ spielt den gemerkten Satz von vorn', z.haupt === 'Pause' && z.nummer === gemerkt && amSatzAnfang(z, syn, gemerkt - 1) && z.hinweis === '', JSON.stringify(z));

  // Schließen: Ton weg, Stelle gemerkt
  const vorSchliessen = await azZustand(seite);
  await seite.click('.vl-schliessen');
  await warte(100);
  z = await azZustand(seite);
  pruefe('Schließen: Ton freigegeben, Media Session leer', !z.offen && z.audio.src === '' && (await tonDa(seite, vorSchliessen.audio.src)) === 'weg'
    && z.medien.titel === null && z.medien.zustand === 'none' && z.aktionen.length === 0, JSON.stringify(z));
  const weiter = await seite.$$eval('.knopf--weiter', (b) => b.map((x) => x.textContent));
  pruefe('Kopf bietet „Weiter ab Satz …“ an, wie mit der Stimme des Handys', JSON.stringify(weiter) === JSON.stringify([`Weiter ab Satz ${vorSchliessen.nummer}`]), JSON.stringify(weiter));

  await taktLeeren(seite);
  const n0 = (await azSynthesen(seite)).length;
  await seite.click('.knopf--weiter');
  await warteAufTon(seite);
  z = await azZustand(seite);
  syn = await azSynthesen(seite);
  pruefe('„Weiter ab Satz …“ im Feed: Azure lädt ab diesem Satz, mit der gewählten Stimme', syn[n0].marken[0] === vorSchliessen.nummer - 1 && syn[n0].stimme === 'de-AT-JonasNeural'
    && z.nummer === vorSchliessen.nummer && amSatzAnfang(z, syn, vorSchliessen.nummer - 1) && z.quelle === 'Azure-Stimme', JSON.stringify([syn[n0].marken, z]));
  await seite.click('.vl-schliessen');
  await warte(100);

  // Die ganze Ausgabe am Stück: Satzgrenzen aus den Marken, Stücke schließen an
  await taktLeeren(seite);
  await seite.evaluate(() => { window.__azure.msProSatz = 60; });
  const n1 = (await azSynthesen(seite)).length;
  await seite.click(KOPF);
  await warteAufTon(seite);
  await azProbenStarten(seite);
  await warteAufHaupt(seite, 'Von vorn');
  z = await azZustand(seite);
  syn = await azSynthesen(seite);
  const lauf = syn.slice(n1);
  let proben = await seite.evaluate(() => window.__proben);
  let falsch = probenStimmen(proben, syn);
  pruefe('Ganze Ausgabe: angezeigter Satz passt immer zur Marke im Ton', proben.length >= 5 && !falsch.length, JSON.stringify([proben.length, falsch.slice(0, 4)]));
  const laufFehler = stueckePruefen(lauf, gesamt, THEMEN);
  pruefe('Ganze Ausgabe: alle Stücke lückenlos, Tempo gilt auch im nächsten Stück', !laufFehler.length && lauf.every((s) => s.stimme === 'de-AT-JonasNeural')
    && proben.every((p) => p.rate === 1.2) && new Set(proben.map((p) => p.d)).size > 1, JSON.stringify(laufFehler));
  pruefe('Ende: Ruhig-Zeile zuletzt, keine Position mehr', z.satz === 'Ausgabe fertig vorgelesen.' && z.nummer === gesamt && z.position === null
    && z.medien.zustand === 'paused', JSON.stringify(z));
  await seite.click('.vl-schliessen');
  await warte(100);

  // Jahresrückblick: langes Thema in mehreren Stücken, Kapitel
  await seite.click('.tabs a[data-tab="jahr"]');
  await seite.waitForSelector('.ausgabe .aktionen--kopf .knopf--vorlesen');
  await taktLeeren(seite);
  await seite.evaluate(() => { window.__azure.msProSatz = 50; }); // länger als die 40 ms Spielraum der App
  const n2 = (await azSynthesen(seite)).length;
  await seite.click(KOPF);
  await warteAufTon(seite);
  await seite.click('.vl-haupt');
  await seite.click('.vl-naechstes');
  z = await azZustand(seite);
  pruefe('Jahresrückblick: „Nächstes Thema“ springt ins nächste Kapitel', z.thema === 'KI und Claude' && z.kapitel === 'Kapitel 2 von 3' && z.haupt === 'Weiter', JSON.stringify(z));
  const kiStart = z.nummer - 1;
  await seite.click('.vl-haupt');
  await seite.waitForFunction((n) => window.__azure.synthesen.some((s) => s.marken[0] === n), kiStart, { timeout: 5000 });
  await warteAufTon(seite);
  syn = await azSynthesen(seite);
  z = await azZustand(seite);
  pruefe('Kapitel 2 beginnt mit seinem Stück', z.nummer === kiStart + 1 && amSatzAnfang(z, syn, kiStart),
    JSON.stringify([z.audio, syn.slice(n2).map((s) => [s.marken[0], s.marken.length, s.msProSatz])]));
  const jahrGesamt = z.gesamt;
  await azProbenStarten(seite);
  await warteAufHaupt(seite, 'Von vorn');
  syn = await azSynthesen(seite);
  const jahr = syn.slice(n2).sort((a, b) => a.marken[0] - b.marken[0]);
  const ki = jahr.filter((s) => [...ssmlSaetze(s.ssml).values()].some((x) => x.text.startsWith('KI-Monat')));
  const jahrFehler = stueckePruefen(jahr, jahrGesamt, ['Weltpolitik', 'KI und Claude', 'Börse und Wirtschaft']);
  const jahrSaetze = new Map(jahr.flatMap((s) => [...ssmlSaetze(s.ssml)]));
  pruefe('Langes Thema: in mehrere Stücke zu höchstens 1500 Zeichen geteilt, lückenlos', ki.length >= 3 && !jahrFehler.length && jahrSaetze.size === jahrGesamt, JSON.stringify([jahrFehler, jahr.map((s) => s.marken[0])]));
  pruefe('SSML: Sonderzeichen sicher, Text unverändert', [...jahrSaetze.values()].some((s) => s.text === 'KI-Monat 1: Ein neues Modell & ein „Werkzeug“ <für> alle')
    && jahr.every((s) => !s.ssml.includes('<für>')));
  proben = await seite.evaluate(() => window.__proben);
  falsch = probenStimmen(proben, syn);
  pruefe('Jahresrückblick: Satzgrenzen passen auch über geteilte Stücke', proben.length >= 3 && !falsch.length, JSON.stringify([proben.length, falsch.slice(0, 4)]));
  await seite.click('.vl-schliessen');
  await seite.click('.tabs a[data-tab="heute"]');
  await seite.waitForSelector(KOPF);

  // Rückfall: offline
  z = await azZustand(seite);
  const vorOffline = { synthesen: z.synthesen, token: netz.anfragen.length, gesprochen: z.gesprochen };
  await ctx.setOffline(true);
  await seite.click(KOPF);
  await warteAufSaetze(seite, vorOffline.gesprochen + 1);
  z = await azZustand(seite);
  pruefe('Offline: Stimme des Handys mit Hinweis, keine Anfrage an Azure', z.quelle === 'Stimme des Handys – offline, Azure ist nicht erreichbar.' && z.rueckfall
    && z.gesprochenText === 'Weltpolitik' && z.synthesen === vorOffline.synthesen && netz.anfragen.length === vorOffline.token, JSON.stringify(z));
  await seite.click('.vl-schliessen');
  await ctx.setOffline(false);

  // Rückfall: Schlüssel ungültig (401)
  netz.modus = '401';
  await seite.reload();
  await seite.waitForSelector(KOPF);
  await seite.click(KOPF);
  await warteAufSaetze(seite, 1);
  await warteAufWach(seite, true);
  z = await azZustand(seite);
  pruefe('Schlüssel ungültig (401): Stimme des Handys mit Hinweis', z.quelle === 'Stimme des Handys – Azure lehnt den Schlüssel ab (ungültig oder falsche Region).'
    && z.rueckfall && z.gesprochenText === 'Weltpolitik' && z.haupt === 'Pause' && z.wach && z.synthesen === 0
    && netz.anfragen[netz.anfragen.length - 1].schluessel === AZ_SCHLUESSEL, JSON.stringify(z));
  await seite.click('.vl-einstellungen summary');
  await seite.fill('#vl-azure-schluessel', 'FalscherSchluessel0123456789');
  await seite.click('.vl-azure .vl-knopf--primaer');
  await warteAufStatus(seite);
  z = await azZustand(seite);
  const nochDa = await seite.evaluate(() => JSON.parse(localStorage.getItem('mein-feed.azure.v1')).schluessel);
  pruefe('Testen mit falschem Schlüssel: Hinweis, der gespeicherte bleibt', z.status === 'Azure lehnt den Schlüssel ab. Prüfe „Schlüssel 1“ und die Region.' && nochDa === AZ_SCHLUESSEL, z.status);
  await seite.click('.vl-schliessen');
  netz.modus = 'ok';

  // Rückfall: Kontingent aufgebraucht (429), gleich beim ersten Stück
  await taktLeeren(seite);
  await seite.reload();
  await seite.waitForSelector(KOPF);
  await seite.evaluate(() => { window.__azure.modus = '429'; });
  await seite.click(KOPF);
  await warteAufSaetze(seite, 1);
  z = await azZustand(seite);
  pruefe('Kontingent aufgebraucht (429): Stimme des Handys mit Hinweis', z.quelle === 'Stimme des Handys – das Azure-Kontingent ist aufgebraucht (oder zu viele Anfragen).'
    && z.rueckfall && z.gesprochenText === 'Weltpolitik' && z.synthesen === 1, JSON.stringify(z));
  await seite.click('.vl-schliessen');

  // … und mitten in der Ausgabe: das geladene Stück zu Ende, dann die Stimme des Handys
  await taktLeeren(seite);
  await seite.reload();
  await seite.waitForSelector(KOPF);
  await seite.evaluate(() => { Object.assign(window.__azure, { modus: '429', scheitertAb: 2, msProSatz: 60 }); });
  await seite.click(KOPF);
  await warteAufSaetze(seite, 1);
  z = await azZustand(seite);
  syn = await azSynthesen(seite);
  const zweites = syn[1] && ssmlSaetze(syn[1].ssml).get(syn[1].marken[0]);
  pruefe('Kontingent mitten in der Ausgabe: erst das geladene Stück, dann weiter mit der Stimme des Handys', syn.length === 2 && zweites
    && z.gesprochenText === zweites.text && z.nummer === syn[1].marken[0] + 1 && z.quelle.includes('Kontingent') && z.audio.src === '', JSON.stringify([z, syn.map((s) => s.marken)]));
  await seite.click('.vl-schliessen');

  // Rückfall: Speech SDK lädt nicht
  await seite.reload();
  await seite.waitForSelector(KOPF);
  await seite.evaluate(() => { window.__azure.sdkFehler = true; });
  const vorSdk = netz.anfragen.length;
  await seite.click(KOPF);
  await warteAufSaetze(seite, 1);
  z = await azZustand(seite);
  pruefe('Speech SDK lädt nicht: Stimme des Handys mit Hinweis', z.quelle === 'Stimme des Handys – das Sprachpaket von Microsoft ließ sich nicht laden.'
    && z.skripte === 1 && netz.anfragen.length === vorSdk && z.gesprochenText === 'Weltpolitik', JSON.stringify(z));
  await seite.click('.vl-schliessen');

  // Takt: sind 15 Anfragen in der letzten Minute, wartet die nächste
  await seite.reload();
  await seite.waitForSelector(KOPF);
  const t0 = await seite.evaluate(() => {
    const jetzt = Date.now();
    localStorage.setItem('mein-feed.azure-takt.v1', JSON.stringify(Array.from({ length: 15 }, () => jetzt - 59300)));
    return jetzt;
  });
  await seite.click(KOPF);
  await seite.waitForFunction(() => window.__azure.synthesen.length > 0, null, { timeout: 5000 });
  const t1 = await seite.evaluate(() => window.__azure.synthesen[0].zeit);
  const takt = await seite.evaluate(() => JSON.parse(localStorage.getItem('mein-feed.azure-takt.v1')));
  pruefe('Höchstens 15 Anfragen pro Minute: die nächste wartet, bis eine alte herausfällt', t1 - t0 >= 600 && t1 - t0 < 3000
    && takt.every((t) => t > t0) && takt.some((t) => Math.abs(t - t1) < 100), `${t1 - t0} ms, ${JSON.stringify(takt.map((t) => t - t0))}`);
  await warteAufTon(seite);
  await seite.click('.vl-schliessen');

  // Der Schlüssel taucht nirgends auf
  await seite.click('.tabs a[data-tab="merkliste"]');
  await seite.waitForSelector('.merk-eintrag');
  const [download] = await Promise.all([seite.waitForEvent('download'), seite.click('.merk-kopf .knopf:has-text("Exportieren")')]);
  const exportPfad = path.join(ordner, `azure-${download.suggestedFilename()}`);
  await download.saveAs(exportPfad);
  const exportText = fs.readFileSync(exportPfad, 'utf8');
  await seite.click('#feedback .knopf--primaer');
  await warte(200);
  const feedback = await seite.evaluate(() => navigator.clipboard.readText());
  pruefe('Schlüssel nicht im Export der Merkliste und nicht im Feedback-Text', JSON.parse(exportText).eintraege.length === 1 && !exportText.includes(AZ_SCHLUESSEL)
    && feedback.includes('Als „Unnötig“ markiert (1)') && !feedback.includes(AZ_SCHLUESSEL), feedback);
  const mitSchluessel = einstellungen.mitschnitt.filter((a) => JSON.stringify(a).includes(AZ_SCHLUESSEL));
  pruefe('Schlüssel nur in Anfragen an Azure: im Kopf, nie in einer Adresse oder im Inhalt', mitSchluessel.length >= 3
    && mitSchluessel.every((a) => AZ_TOKEN_URL.test(a.url) && a.kopf['ocp-apim-subscription-key'] === AZ_SCHLUESSEL && !a.url.includes(AZ_SCHLUESSEL) && !a.inhalt.includes(AZ_SCHLUESSEL)),
  JSON.stringify(mitSchluessel.map((a) => a.url)));
  const spuren = await seite.evaluate((s) => ({
    dom: document.documentElement.outerHTML.includes(s) || [...document.querySelectorAll('input, textarea')].some((f) => f.value.includes(s)),
    speicher: Object.keys(localStorage).filter((k) => String(localStorage.getItem(k)).includes(s)),
    sdk: window.__azure.configs.some((c) => JSON.stringify(c).includes(s)) || window.__azure.synthesen.some((x) => x.ssml.includes(s)),
  }), AZ_SCHLUESSEL);
  pruefe('Schlüssel nur im lokalen Speicher: nicht im DOM, nicht beim SDK, nicht in der Konsole', !spuren.dom && JSON.stringify(spuren.speicher) === '["mein-feed.azure.v1"]'
    && !spuren.sdk && konsole.length >= 0 && !konsole.some((t) => t.includes(AZ_SCHLUESSEL)), JSON.stringify(spuren));

  // Löschen: zurück zur Stimme des Handys
  await seite.click('.tabs a[data-tab="heute"]');
  await seite.waitForSelector(KOPF);
  await taktLeeren(seite);
  await seite.click(KOPF);
  await warteAufTon(seite);
  z = await azZustand(seite);
  await seite.click('.vl-einstellungen summary');
  await seite.click('.vl-azure .vl-knopf:not(.vl-knopf--primaer)');
  await warteAufSaetze(seite, z.gesprochen + 1);
  z = await azZustand(seite);
  const nachLoeschen = await seite.evaluate(() => ({ zugang: localStorage.getItem('mein-feed.azure.v1'), region: document.querySelector('#vl-azure-region').value }));
  pruefe('Löschen: Schlüssel und Region weg, die Stimme des Handys liest weiter', nachLoeschen.zugang === null && nachLoeschen.region === '' && z.quelle === KEIN_SCHLUESSEL
    && z.status === 'Schlüssel und Region gelöscht. Es liest die Stimme des Handys.' && z.audio.src === '' && z.haupt === 'Pause', JSON.stringify([nachLoeschen, z]));
  await seite.click('.vl-schliessen');
}

// Mit echtem Service Worker: Er speichert nichts von Azure, vom CDN und keinen Ton.
async function azureMitServiceWorker(seite, ctx, basis, einstellungen) {
  const app = `${basis}${APP}`;
  await seite.clock.setSystemTime(new Date('2026-11-01T08:00:00+01:00'));
  await seite.goto(app);
  await seite.waitForSelector('.ausgabe .aktionen--kopf .knopf--vorlesen');
  await seite.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 10000 });
  await seite.evaluate((s) => localStorage.setItem('mein-feed.azure.v1', JSON.stringify({ schluessel: s, region: 'westeurope' })), AZ_SCHLUESSEL);
  await seite.click('.ausgabe:first-of-type .aktionen--kopf .knopf--vorlesen');
  await warteAufTon(seite);
  const gesamt = (await azZustand(seite)).gesamt;
  await seite.waitForFunction((n) => window.__azure.synthesen.some((s) => s.marken.includes(n - 1)), gesamt, { timeout: 5000 });
  // Gleiche Adressen auch direkt aus der Seite, damit sie sicher durch den Service Worker gehen.
  const durch = await seite.evaluate(async (s) => ({
    cdn: await fetch('https://cdn.jsdelivr.net/npm/microsoft-cognitiveservices-speech-sdk@1.53.0/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle-min.js').then((a) => a.status, () => 0),
    token: await fetch('https://westeurope.api.cognitive.microsoft.com/sts/v1.0/issueToken', { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': s } }).then((a) => a.status, () => 0),
    ton: await fetch(document.querySelector('#vorlesen audio').src).then((a) => a.status, () => 0),
  }), AZ_SCHLUESSEL);
  await warte(300);
  const c = await cacheInhalt(seite);
  const alle = Object.values(c).flat();
  const fremd = alle.filter((u) => !u.startsWith(app) && !u.startsWith(DATEN_URL));
  pruefe('Service Worker: nichts von Azure und vom CDN im Cache, kein Ton', durch.cdn === 200 && durch.token === 200 && durch.ton === 200
    && fremd.length === 0 && !alle.some((u) => /microsoft|jsdelivr|^blob:/.test(u)), JSON.stringify([durch, fremd]));
  pruefe('Anfragen an CDN und Azure gingen am Service Worker vorbei ins Netz', einstellungen.anfragen.some((u) => u.startsWith('https://cdn.jsdelivr.net/'))
    && einstellungen.anfragen.some((u) => AZ_TOKEN_URL.test(u)));
  const speicher = await seite.evaluate(async () => ({ caches: (await caches.keys()).sort(), dbs: (await indexedDB.databases()).map((d) => d.name).sort() }));
  pruefe('Kein Ton im Speicher des Handys: nur App- und Daten-Cache und die Merkliste', JSON.stringify(speicher.caches) === '["mein-feed-app","mein-feed-daten"]'
    && JSON.stringify(speicher.dbs) === '["mein-feed"]', JSON.stringify(speicher));
  const ton = await seite.evaluate(() => document.querySelector('#vorlesen audio').src);
  await seite.click('#vorlesen .vl-schliessen');
  await warte(100);
  pruefe('Nach dem Schließen ist der Ton auch im Arbeitsspeicher weg', (await tonDa(seite, ton)) === 'weg');
}

/*
 * Nur mit MEIN_FEED_SDK=<Pfad zur echten …bundle-min.js>: Das echte Speech SDK läuft durch die App.
 * Der Test liefert die Datei unter der CDN-Adresse aus (die App prüft sie per SRI) und spielt
 * selbst den Sprachdienst von Azure auf der WebSocket-Verbindung: turn.start, response, Marken
 * (audio.metadata, Zeitpunkte in 100 ns), Ton und turn.end, wie es das SDK erwartet.
 */
function wavPuffer(ms) {
  const rate = 8000;
  const n = Math.max(1, Math.round((rate * ms) / 1000));
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8, 'ascii'); b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36, 'ascii'); b.writeUInt32LE(n * 2, 40);
  return b;
}

async function echtesSdk(seite, ctx, basis, einstellungen) {
  const MS = 300;
  const dienst = { urls: [], nachrichten: [], synthesen: [] };
  await ctx.routeWebSocket(/^wss:\/\/[a-z0-9]+\.tts\.speech\.microsoft\.com\//, (ws) => {
    dienst.urls.push(ws.url());
    ws.onMessage((nachricht) => {
      if (typeof nachricht !== 'string') return;
      dienst.nachrichten.push(nachricht);
      const [kopfText, ...rest] = nachricht.split('\r\n\r\n');
      const kopf = Object.fromEntries(kopfText.split('\r\n').map((z) => [z.slice(0, z.indexOf(':')).trim().toLowerCase(), z.slice(z.indexOf(':') + 1).trim()]));
      if (kopf.path !== 'ssml') return;
      if (dienst.schliessen) {
        ws.close(dienst.schliessen);
        return;
      }
      const ssml = rest.join('\r\n\r\n');
      const marken = [...ssml.matchAll(/<bookmark mark="s(\d+)"\/>/g)].map((m) => Number(m[1]));
      dienst.synthesen.push({ ssml, marken, msProSatz: MS });
      const id = kopf['x-requestid'];
      const text = (pfad, inhalt) => ws.send(`Path:${pfad}\r\nX-RequestId:${id}\r\nContent-Type:application/json; charset=utf-8\r\n\r\n${inhalt}`);
      text('turn.start', '{"context":{"serviceTag":"test"}}');
      text('response', '{"context":{"serviceTag":"test"},"audio":{"type":"inline","streamId":"S1"}}');
      marken.forEach((satz, k) => text('audio.metadata', JSON.stringify({ Metadata: [{ Type: 'Bookmark', Data: { Offset: k * MS * 10000, Bookmark: `s${satz}` } }] })));
      const kopfTon = Buffer.from(`Path:audio\r\nX-RequestId:${id}\r\nX-StreamId:S1\r\n`, 'ascii');
      const laenge = Buffer.alloc(2);
      laenge.writeUInt16BE(kopfTon.length);
      ws.send(Buffer.concat([laenge, kopfTon, wavPuffer(Math.max(1, marken.length) * MS)]));
      text('turn.end', '{}');
    });
  });
  await seite.clock.setSystemTime(new Date('2026-11-01T08:00:00+01:00'));
  await seite.goto(`${basis}#heute`);
  await seite.waitForSelector('.aktionen--kopf .knopf--vorlesen');
  await seite.evaluate((s) => localStorage.setItem('mein-feed.azure.v1', JSON.stringify({ schluessel: s, region: 'westeurope' })), AZ_SCHLUESSEL);
  await seite.click('.ausgabe:first-of-type .aktionen--kopf .knopf--vorlesen');
  await warteAufTon(seite).catch(() => {});
  const sdk = await seite.evaluate(() => ({
    echt: Boolean(window.SpeechSDK && window.SpeechSDK.SpeechSynthesizer && !window.__azure),
    format: window.SpeechSDK && window.SpeechSDK.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3,
    quelle: document.querySelector('#vorlesen .vl-quelle').textContent,
  }));
  pruefe('Echtes SDK: lädt mit der SRI aus app.js, Azure liest', sdk.echt && Number.isInteger(sdk.format) && sdk.quelle === 'Azure-Stimme', JSON.stringify(sdk));
  const url = dienst.urls[0] || '';
  pruefe('Echtes SDK: WebSocket zur Region mit Token, ohne Schlüssel in der Adresse', /^wss:\/\/westeurope\.tts\.speech\.microsoft\.com\/(tts\/)?cognitiveservices\/websocket\/v1\?/.test(url)
    && /[?&]Authorization=Bearer(%20|\+)TOKEN-\d/.test(url) && !url.includes(AZ_SCHLUESSEL) && !url.includes('Ocp-Apim'), url.replace(/TOKEN-\d+/, 'TOKEN'));
  pruefe('Echtes SDK: verlangt MP3, mono, 48 kbit/s', dienst.nachrichten.some((n) => n.includes('audio-24khz-48kbitrate-mono-mp3')));
  await seite.click('#vorlesen .vl-vor');
  const z = await azZustand(seite);
  pruefe('Echtes SDK: Marken in 100 ns werden zu Satzgrenzen im Ton', z.nummer === 2 && amSatzAnfang(z, dienst.synthesen, 1), JSON.stringify([z.audio, dienst.synthesen.map((s) => s.marken)]));
  const geladen = () => dienst.synthesen.reduce((n, s) => Math.max(n, ...s.marken), 0);
  for (let i = 0; i < 50 && geladen() < z.gesamt - 1; i += 1) await warte(100);
  pruefe('Echtes SDK: alle Stücke im Hintergrund geladen', geladen() === z.gesamt - 1, `${geladen()} / ${z.gesamt}`);
  await seite.click('#vorlesen .vl-schliessen');

  // Der Dienst schließt die Verbindung mit 4429 (zu viele Anfragen): Rückfall mit dem richtigen Grund.
  dienst.schliessen = { code: 4429, reason: 'Too many requests' };
  await seite.reload();
  await seite.waitForSelector('.aktionen--kopf .knopf--vorlesen');
  await seite.click('.ausgabe:first-of-type .aktionen--kopf .knopf--vorlesen');
  await warteAufSaetze(seite, 1);
  const r = await azZustand(seite);
  pruefe('Echtes SDK: Abbruch mit 4429 führt zur Stimme des Handys mit Hinweis aufs Kontingent', r.quelle === 'Stimme des Handys – das Azure-Kontingent ist aufgebraucht (oder zu viele Anfragen).'
    && r.gesprochenText === 'Weltpolitik', JSON.stringify(r));
  await seite.click('#vorlesen .vl-schliessen');
}

// Keine Audiodateien im Repo (außer in .git).
function audioImRepo(ordner = WURZEL, gefunden = []) {
  for (const eintrag of fs.readdirSync(ordner, { withFileTypes: true })) {
    if (eintrag.name === '.git' || eintrag.name === 'node_modules') continue;
    const voll = path.join(ordner, eintrag.name);
    if (eintrag.isDirectory()) audioImRepo(voll, gefunden);
    else if (/\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|weba|webm)$/i.test(eintrag.name)) gefunden.push(path.relative(WURZEL, voll));
  }
  return gefunden;
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
    const azureDaten = {
      dateien: new Set([...BEISPIEL, 'data/jaehrlich/2024.json']),
      zusatz: { 'data/jaehrlich/2024.json': JAHR_LANG },
      youtube: 'gesperrt',
      index: 'normal',
      vorbereitung: [sprachAttrappe, azureAttrappe],
      azure: azureNetz(),
      mitschnitt: [],
    };
    await szenario(browser, basis, 'Azure-Stimme (Attrappe des Speech SDK)', azureDaten, (seite, ctx) => azureTests(seite, ctx, `${basis}/`, azureDaten, ordner));
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
    const azureSw = {
      dateien: new Set(BEISPIEL),
      youtube: 'gesperrt',
      index: 'normal',
      serviceWorker: true,
      offline: false,
      anfragen: [],
      vorbereitung: [sprachAttrappe, azureAttrappe],
      azure: azureNetz(),
    };
    await szenario(browser, basis, 'Azure-Stimme mit Service Worker', azureSw, (seite, ctx) => azureMitServiceWorker(seite, ctx, basis, azureSw));

    console.log('\nDateien');
    const audio = audioImRepo();
    pruefe('Keine Audiodateien im Repo', audio.length === 0, audio.join(', '));
    const sri = (/AZURE_SDK_SRI = '([^']+)'/.exec(fs.readFileSync(path.join(WURZEL, 'app.js'), 'utf8')) || [])[1];
    if (process.env.MEIN_FEED_SDK) {
      // Beim Wechsel der SDK-Version: MEIN_FEED_SDK=<Pfad zu …bundle-min.js> node tests/app_test.js
      const soll = `sha384-${require('crypto').createHash('sha384').update(fs.readFileSync(process.env.MEIN_FEED_SDK)).digest('base64')}`;
      pruefe('SRI in app.js passt zur SDK-Datei aus MEIN_FEED_SDK', sri === soll, `${sri} ≠ ${soll}`);
      const echt = {
        dateien: new Set(BEISPIEL),
        youtube: 'gesperrt',
        index: 'normal',
        vorbereitung: sprachAttrappe,
        azure: Object.assign(azureNetz(), {
          cdn: (route) => route.fulfill({ status: 200, body: fs.readFileSync(process.env.MEIN_FEED_SDK), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } }),
        }),
      };
      await szenario(browser, basis, 'Echtes Speech SDK (MEIN_FEED_SDK)', echt, (seite, ctx) => echtesSdk(seite, ctx, `${basis}/`, echt));
    } else {
      console.log('  – SRI und echtes SDK: übersprungen (MEIN_FEED_SDK nicht gesetzt)');
    }
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
