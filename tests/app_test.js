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
 * Exit-Code 0, wenn alle Prüfungen bestehen.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const WURZEL = path.resolve(__dirname, '..');
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

function starteServer() {
  const server = http.createServer((anfrage, antwort) => {
    const pfad = decodeURIComponent(new URL(anfrage.url, 'http://x').pathname);
    const datei = path.join(WURZEL, pfad === '/' ? 'index.html' : pfad);
    if (!datei.startsWith(WURZEL + path.sep)) {
      antwort.writeHead(403);
      antwort.end();
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

/*
 * Ein Szenario bekommt einen frischen Browser-Kontext (leere Merkliste, leeres Feedback).
 * einstellungen.dateien: Set der Dateien, die index.json nennt (änderbar während des Laufs)
 * einstellungen.youtube: 'attrappe' oder 'gesperrt'
 * einstellungen.index: 'normal', '404' oder 'offline'
 */
async function szenario(browser, basis, name, einstellungen, ablauf) {
  console.log(`\n${name}`);
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'de-AT',
    acceptDownloads: true,
    serviceWorkers: 'block', // ab Sitzung 5: sonst liefert der Service Worker alte Dateien
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: basis });
  await ctx.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(basis)) return route.continue();
    const daten = url.split('/claude/feed-daten/')[1];
    if (url.startsWith('https://raw.githubusercontent.com/') && daten) {
      const kopf = { 'access-control-allow-origin': '*' };
      if (daten === 'data/index.json') {
        if (einstellungen.index === 'offline') return route.abort();
        if (einstellungen.index === '404') return route.fulfill({ status: 404, body: '404: Not Found', headers: kopf });
        const ausgaben = alleAusgaben().filter((a) => einstellungen.dateien.has(a.datei));
        return route.fulfill({ json: { aktualisiert: '2026-11-01T03:45:00+01:00', start: START, ausgaben }, headers: kopf });
      }
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
  } catch (e) {
    pruefe(`${name}: Ablauf ohne Abbruch`, false, e.stack || String(e));
  }
  pruefe('Keine Skriptfehler', fehler.length === 0, fehler.join(' | '));
  await ctx.close();
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const merkAnzahl = (seite) => seite.$$eval('.merk-eintrag', (e) => e.length);

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
    await szenario(browser, basis, 'Noch kein Daten-Branch', { dateien: new Set(), index: '404' }, (seite, ctx) => ohneDaten(seite, ctx, `${basis}/`));
    await szenario(browser, basis, 'Offline', { dateien: new Set(), index: 'offline' }, (seite, ctx) => offline(seite, ctx, `${basis}/`));
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
