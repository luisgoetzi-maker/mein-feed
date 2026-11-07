'use strict';

/*
 * Mein Feed – Service Worker
 *
 * Liegt neben index.html; alle Pfade gelten relativ zu dieser Datei, damit die App auch unter
 * https://luisgoetzi-maker.github.io/mein-feed/ läuft und nicht nur im Wurzelverzeichnis.
 *
 * App-Dateien (index.html, app.js, styles.css, config/themen.json, Manifest, Icons): zuerst aus dem
 * Netz, am HTTP-Cache vorbei. Kommt nach etwa 4 Sekunden keine Antwort oder ist das Handy offline,
 * kommen sie aus dem Cache. So ist eine neue Version nach dem Merge sofort da, ohne Versionsnummer.
 *
 * Daten vom Daten-Branch auf raw.githubusercontent.com: immer zuerst frisch, der Cache nur, wenn
 * das Netz fehlt. Gespeichert werden index.json und jede geladene Ausgabe; was nicht mehr in
 * index.json steht, fliegt aus dem Cache. Gespeicherte Antworten tragen den Kopf „X-Mein-Feed-Stand“
 * (wann sie frisch geladen wurden); daran erkennt die App, dass sie alte Daten zeigt.
 *
 * Alles andere (YouTube, Quellenlinks, fremde Seiten) geht am Service Worker vorbei und wird nicht
 * gespeichert. Die Merkliste liegt in IndexedDB und hat mit diesen Caches nichts zu tun.
 *
 * Ein neuer Service Worker übernimmt sofort, ohne Rückfrage (skipWaiting, clients.claim).
 */

const APP_CACHE = 'mein-feed-app';
const DATEN_CACHE = 'mein-feed-daten';
const WARTEZEIT_MS = 4000;
const STAND_KOPF = 'X-Mein-Feed-Stand';

const adresse = (pfad) => new URL(pfad, self.location).href;
// „./“ ist index.html; jede Navigation zur App wird unter dieser Adresse gespeichert.
const START = adresse('./');
const INDEX_HTML = adresse('index.html');
const APP_DATEIEN = [
  './',
  'app.js',
  'styles.css',
  'config/themen.json',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
].map(adresse);

// ------------------------------------------------------------ Lebenszyklus

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // Die App einmal vollständig ablegen. Fehlt eine Datei, kommt sie beim nächsten Laden dazu.
  event.waitUntil(caches.open(APP_CACHE).then((cache) => Promise.all(APP_DATEIEN.map(async (url) => {
    try {
      const antwort = await fetch(url, { cache: 'no-cache' });
      if (antwort.ok) await cache.put(url, antwort);
    } catch { /* offline oder Fehler: später */ }
  }))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Caches früherer Fassungen entfernen; andere Seiten auf derselben github.io-Adresse nicht anfassen.
    for (const name of await caches.keys()) {
      if (name.startsWith('mein-feed-') && name !== APP_CACHE && name !== DATEN_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

// ------------------------------------------------------------ Anfragen

self.addEventListener('fetch', (event) => {
  const anfrage = event.request;
  if (anfrage.method !== 'GET') return;
  const url = new URL(anfrage.url);
  if (istDaten(url)) {
    event.respondWith(datenLaden(event, url.origin + url.pathname));
    return;
  }
  const schluessel = appSchluessel(url);
  if (schluessel) appDateiLaden(event, schluessel);
  // Alles andere lädt der Browser selbst, ohne Cache.
});

function istDaten(url) {
  return url.origin === 'https://raw.githubusercontent.com'
    && url.pathname.includes('/claude/feed-daten/data/')
    && url.pathname.endsWith('.json');
}

function appSchluessel(url) {
  if (url.origin !== self.location.origin) return null;
  const ohneSuche = url.origin + url.pathname;
  if (ohneSuche === INDEX_HTML) return START;
  return APP_DATEIEN.includes(ohneSuche) ? ohneSuche : null;
}

// ------------------------------------------------------------ App-Dateien: Netz zuerst, nach 4 s Cache

// no-cache: beim Server nachfragen statt bis zu 10 Minuten den HTTP-Cache von GitHub Pages zu nutzen.
function ohneHttpCache(anfrage) {
  try {
    return new Request(anfrage, { cache: 'no-cache' });
  } catch {
    return anfrage; // ältere Browser erlauben das bei Navigationen nicht
  }
}

function appDateiLaden(event, schluessel) {
  const netz = fetch(ohneHttpCache(event.request));
  // Die Kopie entsteht sofort beim Eintreffen, bevor die Seite den Inhalt liest.
  event.waitUntil(netz.then((antwort) => {
    if (!antwort.ok || antwort.type !== 'basic') return undefined;
    const kopie = antwort.clone();
    return caches.open(APP_CACHE).then((cache) => cache.put(schluessel, kopie));
  }).catch(() => {}));
  event.respondWith(mitFrist(netz, schluessel));
}

async function mitFrist(netz, schluessel) {
  let uhr = 0;
  const frist = new Promise((fertig) => { uhr = setTimeout(fertig, WARTEZEIT_MS); });
  const ausCache = async () => (await caches.open(APP_CACHE)).match(schluessel);
  try {
    const antwort = await Promise.race([netz, frist]);
    // Weiterleitungen gibt der Browser selbst weiter.
    if (antwort && (antwort.ok || antwort.type === 'opaqueredirect')) return antwort;
    // Frist abgelaufen oder Fehlerseite vom Server: lieber die gespeicherte Fassung.
    const alt = await ausCache();
    if (alt) return alt;
    return antwort || await netz;
  } catch {
    return (await ausCache()) || Response.error();
  } finally {
    clearTimeout(uhr);
  }
}

// ------------------------------------------------------------ Daten: immer frisch, Cache nur offline

async function datenLaden(event, schluessel) {
  let antwort;
  try {
    antwort = await fetch(event.request);
  } catch {
    const alt = await (await caches.open(DATEN_CACHE)).match(schluessel, { ignoreVary: true });
    return alt || Response.error();
  }
  event.waitUntil(merkeDaten(schluessel, antwort.clone()).catch(() => {}));
  return antwort;
}

async function merkeDaten(schluessel, antwort) {
  const cache = await caches.open(DATEN_CACHE);
  const istIndex = schluessel.endsWith('/data/index.json');
  if (antwort.status === 404) {
    // Datei gelöscht. Fehlt index.json, gibt es den Daten-Branch nicht mehr: dann alles weg.
    if (istIndex) {
      for (const alt of await cache.keys()) await cache.delete(alt);
    } else {
      await cache.delete(schluessel);
    }
    return;
  }
  if (!antwort.ok) return;
  const text = await antwort.text();
  let daten;
  try {
    daten = JSON.parse(text);
  } catch {
    return; // Kaputtes JSON nicht speichern; die alte Fassung bleibt.
  }
  await cache.put(schluessel, new Response(text, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': STAND_KOPF,
      [STAND_KOPF]: new Date().toISOString(),
    },
  }));
  if (istIndex && daten && Array.isArray(daten.ausgaben)) {
    // Nur index.json und die Ausgaben, die darin stehen, bleiben.
    const basis = schluessel.slice(0, -'data/index.json'.length);
    const behalten = new Set([schluessel]);
    for (const a of daten.ausgaben) if (a && typeof a.datei === 'string') behalten.add(basis + a.datei);
    for (const alt of await cache.keys()) if (!behalten.has(alt.url)) await cache.delete(alt);
  }
}
