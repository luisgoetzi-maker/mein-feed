'use strict';

/*
 * Mein Feed – App
 *
 * Reines JavaScript ohne Framework und ohne Build-Schritt. Die App liest zuerst
 * data/index.json vom Daten-Branch claude/feed-daten, dann die einzelnen Ausgaben.
 * Überthemen und ihre Reihenfolge kommen aus config/themen.json (Branch main).
 *
 * Lokal gespeichert: Merkliste (IndexedDB), Feedback, Vorlese-Position, Stimme und
 * Tempo (localStorage). Vorgelesen wird mit der Web Speech API, Satz für Satz; ein
 * Screen Wake Lock hält dabei den Bildschirm an.
 *
 * Als PWA hält der Service Worker (sw.js) die App und die zuletzt geladenen Ausgaben für den
 * Offline-Fall bereit. Kommen Daten aus seinem Cache, zeigt die App „Offline – Stand vom …“.
 */

(() => {
  // ------------------------------------------------------------ Einstellungen

  // Die Pfade in index.json („datei“) beginnen mit „data/“ und werden hier angehängt.
  const DATEN_BASIS = 'https://raw.githubusercontent.com/luisgoetzi-maker/mein-feed/refs/heads/claude/feed-daten/';
  const THEMEN_URL = 'config/themen.json';
  const YT_API = 'https://www.youtube.com/iframe_api';
  const YT_HOST = 'https://www.youtube-nocookie.com';

  const OBERGRENZE = { taeglich: 3, woechentlich: 5, monatlich: 8, jaehrlich: 10 };
  const FORMAT_NAME = {
    taeglich: 'Tagesausgabe',
    woechentlich: 'Wochenrückblick',
    monatlich: 'Monatsrückblick',
    jaehrlich: 'Jahresrückblick',
  };
  const RUHIG_TEXT = {
    taeglich: ['Heute ruhig', 'Heute nichts Wichtiges'],
    woechentlich: ['Diese Woche ruhig', 'Diese Woche nichts Wichtiges'],
    monatlich: ['Diesen Monat ruhig', 'Diesen Monat nichts Wichtiges'],
    jaehrlich: ['Dieses Jahr ruhig', 'Dieses Jahr nichts Wichtiges'],
  };
  const STATUS_TEXT = { ok: 'Vollständig', ruhig: 'Ruhig', fehler: 'Fehler' };
  const ABSCHNITT_TITEL = {
    finanzierungsrunden: 'Finanzierungsrunden der Woche',
    gescheitert: 'Gescheitert und warum',
    monatsueberblick: 'Monatsüberblick',
    ausblick: 'Ausblick',
  };
  const TABS = [
    { id: 'heute', format: 'taeglich' },
    { id: 'woche', format: 'woechentlich' },
    { id: 'monat', format: 'monatlich' },
    { id: 'jahr', format: 'jaehrlich' },
    { id: 'merkliste', format: null },
  ];
  // Kurze Beschriftung für die Themen-Chips; sonst gilt der Name aus themen.json.
  const KURZNAMEN = { politik: 'Politik', ki: 'KI', wirtschaft: 'Wirtschaft', tirol: 'Tirol' };
  const MONATE = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
    'August', 'September', 'Oktober', 'November', 'Dezember'];
  const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

  const FEEDBACK_SCHLUESSEL = 'mein-feed.feedback.v1';
  const VORLESE_SCHLUESSEL = 'mein-feed.vorlesen.v1'; // Stimme und Tempo
  const POSITION_SCHLUESSEL = 'mein-feed.vorleseposition.v1'; // Ausgabe und Satz
  const TEMPI = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5];
  const NACH_ABBRUCH_MS = 100; // Chrome verschluckt manchmal ein speak() direkt nach cancel()
  const AUTO_NEU_LADEN_MS = 30 * 60 * 1000;
  const DATEI_MUSTER = /^data\/[a-z]+\/[0-9A-Za-z_-]+\.json$/;
  const STAND_KOPF = 'X-Mein-Feed-Stand'; // setzt sw.js bei Daten aus seinem Cache

  // ------------------------------------------------------------ Zustand

  const zustand = {
    themen: [], // [{ id, name }] in der Reihenfolge aus themen.json
    namen: {}, // id -> Name
    farben: {}, // id -> 0..5
    index: null,
    ladefehler: null,
    offline: null, // Zeitpunkt (ISO) des letzten frischen Ladens, wenn index.json aus dem Cache kam
    geladen: 0,
    zeitstempel: '',
    cache: new Map(), // datei -> Promise<Ausgabe>
    tab: 'heute',
    filter: new Set(), // leer = alle Themen
    offen: new Set(), // aufgeklappte ältere Ausgaben
    scroll: {},
    merkliste: new Map(), // schluessel -> Eintrag
    merkFehler: null,
    persistiert: null,
    feedback: { unnoetig: {}, gefehlt: [] },
    renderNr: 0,
    video: null, // { karte, player }
  };
  const umschalter = new WeakMap(); // <article> -> Funktion zum Auf-/Zuklappen

  // ------------------------------------------------------------ Hilfen

  const $ = (sel, wurzel = document) => wurzel.querySelector(sel);
  const liste = (x) => (Array.isArray(x) ? x : []);
  const str = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));
  const istObjekt = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

  function el(tag, attrs, ...kinder) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'dataset') Object.assign(e.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kind of kinder.flat(Infinity)) {
      if (kind == null || kind === false) continue;
      e.append(kind instanceof Node ? kind : String(kind));
    }
    return e;
  }

  function zwischen(elemente, trenner) {
    return elemente.flatMap((x, i) => (i ? [trenner, x] : [x]));
  }

  function sichereUrl(url) {
    try {
      const u = new URL(str(url));
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
    } catch {
      return null;
    }
  }

  function neueId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function bewegungReduziert() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // stand: gesetzt, wenn die Antwort aus dem Cache des Service Workers kommt (offline).
  async function holeJson(url) {
    const antwort = await fetch(url, { cache: 'no-cache' });
    if (!antwort.ok) throw Object.assign(new Error(`HTTP ${antwort.status}`), { status: antwort.status });
    return { daten: await antwort.json(), stand: antwort.headers.get(STAND_KOPF) };
  }

  async function ladeJson(url) {
    return (await holeJson(url)).daten;
  }

  // ------------------------------------------------------------ Datum

  function teile(datum) {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(str(datum));
    return m ? { j: +m[1], m: +m[2], t: m[3] ? +m[3] : null } : null;
  }

  function datumKurz(d, mitJahr = true) {
    const p = teile(d);
    if (!p || !p.t) return str(d);
    return mitJahr ? `${p.t}.${p.m}.${p.j}` : `${p.t}.${p.m}.`;
  }

  function datumLang(d, mitJahr = true) {
    const p = teile(d);
    if (!p || p.m < 1 || p.m > 12) return str(d);
    if (!p.t) return `${MONATE[p.m - 1]} ${p.j}`;
    return `${p.t}. ${MONATE[p.m - 1]}${mitJahr ? ` ${p.j}` : ''}`;
  }

  function monatName(jjjjmm) {
    const p = teile(jjjjmm);
    return p && p.m >= 1 && p.m <= 12 ? MONATE[p.m - 1] : str(jjjjmm);
  }

  function wochentagName(d) {
    const p = teile(d);
    return p && p.t ? WOCHENTAGE[new Date(Date.UTC(p.j, p.m - 1, p.t)).getUTCDay()] : '';
  }

  function zeitraumText(z) {
    if (!z || !z.von) return '';
    const bis = z.bis || z.von;
    if (z.von === bis) return datumKurz(z.von);
    const a = teile(z.von);
    const b = teile(bis);
    if (a && b && a.j === b.j) return `${datumKurz(z.von, false)}–${datumKurz(bis)}`;
    return `${datumKurz(z.von)}–${datumKurz(bis)}`;
  }

  // „2026-11-06T03:12:00+01:00“ ist schon Wiener Zeit; die Uhrzeit wird so übernommen.
  function standText(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(str(iso));
    return m ? `${+m[3]}.${+m[2]}.${m[1]}, ${+m[4]}:${m[5]} Uhr` : str(iso);
  }

  // Beliebiger Zeitpunkt (etwa „2026-11-07T07:15:00.000Z“) in Wiener Zeit.
  function ortszeitText(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const t = {};
    const format = new Intl.DateTimeFormat('de-AT', {
      timeZone: 'Europe/Vienna', day: 'numeric', month: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hourCycle: 'h23',
    });
    for (const p of format.formatToParts(d)) t[p.type] = p.value;
    return `${t.day}.${t.month}.${t.year}, ${t.hour}:${t.minute} Uhr`;
  }

  function meldungsDatum(von, bis) {
    const a = teile(von);
    if (!a || !a.t) return '';
    const b = bis && bis !== von ? teile(bis) : null;
    if (!b || !b.t) return datumLang(von, false);
    if (a.m === b.m && a.j === b.j) return `${a.t}. bis ${datumLang(bis, false)}`;
    return `${datumLang(von, false)} bis ${datumLang(bis, false)}`;
  }

  function gespeichertAm(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('de-AT', {
      timeZone: 'Europe/Vienna', day: 'numeric', month: 'numeric', year: 'numeric',
    }).format(d);
  }

  function wienJetzt() {
    const t = {};
    const format = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hourCycle: 'h23',
    });
    for (const p of format.formatToParts(new Date())) t[p.type] = p.value;
    return { datum: `${t.year}-${t.month}-${t.day}`, stunde: Number(t.hour) % 24 };
  }

  function plusTage(d, n) {
    const p = teile(d);
    return new Date(Date.UTC(p.j, p.m - 1, p.t + n)).toISOString().slice(0, 10);
  }

  // Gleiche Rechnung wie routinen/feed.py: welcher Zeitraum heute erschienen sein sollte.
  function erwarteterZeitraum(format, heute) {
    if (format === 'taeglich') {
      const d = plusTage(heute, -1);
      return { von: d, bis: d };
    }
    if (format === 'woechentlich') {
      const p = teile(heute);
      const wochentag = new Date(Date.UTC(p.j, p.m - 1, p.t)).getUTCDay(); // 0 = Sonntag
      const bis = plusTage(heute, -(((wochentag + 1) % 7) || 7)); // letzter Samstag vor heute
      return { von: plusTage(bis, -6), bis };
    }
    if (format === 'monatlich') {
      const bis = plusTage(`${heute.slice(0, 8)}01`, -1);
      return { von: `${bis.slice(0, 8)}01`, bis };
    }
    const jahr = Number(heute.slice(0, 4)) - 1;
    return { von: `${jahr}-01-01`, bis: `${jahr}-12-31` };
  }

  function zeitStempel() {
    const j = wienJetzt();
    return `${j.datum}/${j.stunde >= 6}`;
  }

  // ------------------------------------------------------------ Themen

  function themaName(id, namen) {
    return (namen && namen[id]) || zustand.namen[id] || str(id);
  }

  function farbe(id) {
    return id in zustand.farben ? String(zustand.farben[id]) : 'x';
  }

  function istSichtbar(id) {
    return zustand.filter.size === 0 || zustand.filter.has(id);
  }

  // Themen in der Reihenfolge aus themen.json; Themen alter Ausgaben, die es nicht mehr gibt, kommen ans Ende.
  function themenReihenfolge(ausgabe) {
    const ids = zustand.themen.map((t) => t.id);
    const extra = [];
    const merke = (id) => {
      if (typeof id === 'string' && id && !ids.includes(id) && !extra.includes(id)) extra.push(id);
    };
    for (const m of liste(ausgabe.meldungen)) {
      merke(m && m.hauptthema);
      liste(m && m.themen).forEach(merke);
    }
    liste(ausgabe.videos).forEach((v) => merke(v && v.thema));
    liste(ausgabe.abschnitte).forEach((a) => merke(a && a.thema));
    liste(ausgabe.ruhig).forEach(merke);
    return ids.concat(extra);
  }

  // Ordnet eine Ausgabe nach Überthemen: Meldungen nur im Hauptthema, sonst als Verweis.
  function gruppiere(ausgabe) {
    const meldungen = liste(ausgabe.meldungen).filter(istObjekt);
    const videos = liste(ausgabe.videos).filter(istObjekt);
    const abschnitte = liste(ausgabe.abschnitte).filter(istObjekt);
    return themenReihenfolge(ausgabe).map((id) => {
      const g = {
        id,
        meldungen: meldungen.filter((m) => m.hauptthema === id),
        verweise: meldungen.filter((m) => m.hauptthema !== id && liste(m.themen).includes(id)),
        videos: videos.filter((v) => v.thema === id),
        abschnitte: abschnitte.filter((a) => a.thema === id),
        ausnahme: liste(ausgabe.ausnahmen).find((a) => a && a.thema === id) || null,
      };
      g.leer = !g.meldungen.length && !g.verweise.length && !g.videos.length && !g.abschnitte.length;
      return g;
    });
  }

  async function ladeThemen() {
    try {
      const daten = await ladeJson(THEMEN_URL);
      zustand.themen = liste(daten.themen)
        .filter((t) => istObjekt(t) && typeof t.id === 'string')
        .sort((a, b) => (a.reihenfolge ?? 99) - (b.reihenfolge ?? 99))
        .map((t) => ({ id: t.id, name: str(t.name) || t.id }));
    } catch (fehler) {
      console.warn('config/themen.json nicht geladen:', fehler);
      zustand.themen = [];
    }
    zustand.namen = Object.fromEntries(zustand.themen.map((t) => [t.id, t.name]));
    zustand.farben = Object.fromEntries(zustand.themen.map((t, i) => [t.id, i % 6]));
  }

  // ------------------------------------------------------------ Daten laden

  function ladeAusgabe(datei) {
    if (!zustand.cache.has(datei)) {
      const p = ladeJson(DATEN_BASIS + datei).then((a) => {
        if (!istObjekt(a)) throw new Error('Unerwarteter Inhalt');
        return a;
      });
      p.catch(() => {
        if (zustand.cache.get(datei) === p) zustand.cache.delete(datei);
      });
      zustand.cache.set(datei, p);
    }
    return zustand.cache.get(datei);
  }

  function ausgabenVon(format) {
    return liste(zustand.index && zustand.index.ausgaben)
      .filter((a) => istObjekt(a) && a.format === format && DATEI_MUSTER.test(str(a.datei)))
      .sort((a, b) => str(b.zeitraum && b.zeitraum.von).localeCompare(str(a.zeitraum && a.zeitraum.von)));
  }

  async function aktualisiere({ manuell = false } = {}) {
    const knopf = $('#neu-laden');
    knopf.disabled = true;
    knopf.classList.add('dreht');
    try {
      let neu;
      let stand = null;
      try {
        ({ daten: neu, stand } = await holeJson(`${DATEN_BASIS}data/index.json`));
      } catch (fehler) {
        // Noch kein Daten-Branch (vor dem ersten Lauf): keine Ausgaben statt Fehlermeldung.
        if (fehler.status !== 404) throw fehler;
        neu = { start: null, ausgaben: [] };
      }
      if (!istObjekt(neu) || !Array.isArray(neu.ausgaben)) throw new Error('index.json hat ein unerwartetes Format');
      const alt = zustand.index;
      const vorher = new Map(liste(alt && alt.ausgaben).map((a) => [a && a.datei, JSON.stringify(a)]));
      let geaendert = !alt || alt.start !== neu.start || vorher.size !== neu.ausgaben.length;
      for (const a of neu.ausgaben) {
        if (vorher.get(a && a.datei) !== JSON.stringify(a)) {
          geaendert = true;
          if (a) zustand.cache.delete(a.datei);
        }
      }
      // Wieder online nach Daten aus dem Cache: auch die Ausgaben frisch laden.
      if (manuell || (zustand.offline && !stand)) zustand.cache.clear();
      const warFehler = Boolean(zustand.ladefehler);
      const offlineGeaendert = zustand.offline !== stand;
      zustand.index = neu;
      zustand.ladefehler = null;
      zustand.offline = stand;
      zustand.geladen = Date.now();
      const neuZeichnen = geaendert || warFehler || manuell || offlineGeaendert || zeitStempel() !== zustand.zeitstempel;
      if (neuZeichnen && (zustand.tab !== 'merkliste' || !zustand.renderNr)) {
        await zeigeAnsicht({ scrollBehalten: !geaendert });
      }
      if (manuell) {
        toast(stand ? 'Keine Verbindung. Du siehst den zuletzt geladenen Stand.'
          : geaendert ? 'Neue Ausgaben geladen.' : 'Alles aktuell.');
      }
    } catch (fehler) {
      console.warn('index.json nicht geladen:', fehler);
      if (!zustand.index) {
        zustand.ladefehler = fehler;
        await zeigeAnsicht();
      } else if (manuell) {
        toast('Keine Verbindung. Du siehst den zuletzt geladenen Stand.');
      }
    } finally {
      knopf.disabled = false;
      knopf.classList.remove('dreht');
    }
  }

  // ------------------------------------------------------------ Ansichten

  async function zeigeAnsicht({ scrollBehalten = false, ladeAnzeige = false } = {}) {
    const nr = ++zustand.renderNr;
    const y = window.scrollY;
    const main = $('#inhalt');
    const warten = ladeAnzeige
      ? setTimeout(() => {
        if (nr === zustand.renderNr) main.replaceChildren(el('p', { class: 'laden', text: 'Lädt …' }));
      }, 150)
      : 0;
    let inhalt;
    try {
      const tab = TABS.find((t) => t.id === zustand.tab) || TABS[0];
      inhalt = tab.format ? await baueFormat(tab.format) : await baueMerkliste();
    } catch (fehler) {
      console.error(fehler);
      inhalt = el('div', { class: 'hinweis hinweis--fehler' },
        el('p', { class: 'hinweis-titel', text: 'Die Ansicht konnte nicht aufgebaut werden.' }),
        el('p', { class: 'klein', text: str(fehler && fehler.message) || str(fehler) }));
    }
    clearTimeout(warten);
    if (nr !== zustand.renderNr) return false;
    schliesseVideo();
    main.replaceChildren(inhalt);
    zustand.zeitstempel = zeitStempel();
    if (scrollBehalten) window.scrollTo(0, y);
    return true;
  }

  async function baueFormat(format) {
    const box = el('div', { class: 'ansicht' });
    if (!zustand.index) {
      box.append(zustand.ladefehler ? ladefehlerBox() : el('p', { class: 'laden', text: 'Lädt …' }));
      return box;
    }
    if (zustand.offline) box.append(offlineHinweis());
    const eintraege = ausgabenVon(format);
    const fehlt = fehlendeAusgabe(format, eintraege);
    if (fehlt) box.append(fehltHinweis(format, fehlt));
    if (!eintraege.length) {
      if (!fehlt) box.append(el('p', { class: 'leer', text: leerText(format) }));
      return box;
    }
    const [neueste, ...aeltere] = eintraege;
    box.append(await ausgabeArtikel(neueste, { kontext: 'feed' }));
    if (aeltere.length) {
      box.append(el('h2', { class: 'aeltere-titel', text: 'Ältere Ausgaben' }));
      for (const meta of aeltere) box.append(await ausgabeArtikel(meta, { kontext: 'feed', klappbar: true }));
    }
    return box;
  }

  // Daten aus dem Cache des Service Workers: alte Daten sollen nicht wie frische aussehen.
  function offlineHinweis() {
    return el('p', { class: 'offline-hinweis' },
      el('span', null, el('strong', { text: 'Offline' }), ` – Stand vom ${ortszeitText(zustand.offline)}`));
  }

  // Fehlt die Ausgabe, die nach 6:00 Uhr schon da sein müsste? Offline lässt sich das nicht sagen.
  function fehlendeAusgabe(format, eintraege) {
    const start = zustand.index && zustand.index.start;
    if (!start || zustand.offline) return null;
    const jetzt = wienJetzt();
    if (jetzt.stunde < 6) return null;
    const z = erwarteterZeitraum(format, jetzt.datum);
    if (z.bis < start) return null;
    if (eintraege.some((a) => str(a.zeitraum && a.zeitraum.bis) >= z.bis)) return null;
    return z;
  }

  function fehltHinweis(format, z) {
    let titel;
    let zusatz;
    if (format === 'taeglich') {
      titel = 'Heute noch keine Ausgabe';
      zusatz = `Die Ausgabe für ${wochentagName(z.von)}, ${datumLang(z.von)} ist bis jetzt nicht erschienen.`;
    } else if (format === 'woechentlich') {
      titel = 'Noch kein Wochenrückblick';
      zusatz = `Der Rückblick auf die Woche ${zeitraumText(z)} ist bis jetzt nicht erschienen.`;
    } else if (format === 'monatlich') {
      titel = 'Noch kein Monatsrückblick';
      zusatz = `Der Rückblick auf ${datumLang(z.von.slice(0, 7))} ist bis jetzt nicht erschienen.`;
    } else {
      titel = 'Noch kein Jahresrückblick';
      zusatz = `Der Rückblick auf ${z.von.slice(0, 4)} ist bis jetzt nicht erschienen.`;
    }
    return el('div', { class: 'hinweis hinweis--warnung' },
      el('p', { class: 'hinweis-titel', text: titel }),
      el('p', { class: 'klein', text: zusatz }));
  }

  function leerText(format) {
    if (format === 'taeglich') return 'Noch keine Tagesausgabe vorhanden.';
    if (format === 'woechentlich') return 'Noch kein Wochenrückblick vorhanden. Er erscheint jeden Sonntag.';
    if (format === 'monatlich') return 'Noch kein Monatsrückblick vorhanden. Er erscheint am Monatsersten.';
    const jahr = Number(wienJetzt().datum.slice(0, 4)) + 1;
    return `Noch kein Jahresrückblick vorhanden. Der nächste erscheint am 1. Jänner ${jahr}.`;
  }

  function ladefehlerBox() {
    return el('div', { class: 'hinweis hinweis--fehler' },
      el('p', { class: 'hinweis-titel', text: 'Die Ausgaben konnten nicht geladen werden.' }),
      el('p', { class: 'klein', text: `Vielleicht bist du offline (${str(zustand.ladefehler && zustand.ladefehler.message)}). Die Merkliste funktioniert trotzdem.` }),
      el('button', { type: 'button', class: 'knopf', onclick: () => aktualisiere({ manuell: true }) }, 'Erneut versuchen'));
  }

  // ------------------------------------------------------------ Ausgabe

  async function ausgabeArtikel(meta, opt) {
    const offenSchluessel = (opt.kontext === 'merkliste' ? 'merk:' : '') + meta.datei;
    const offen = !opt.klappbar || zustand.offen.has(offenSchluessel);
    const art = el('article', {
      class: `ausgabe${offen ? '' : ' ausgabe--zu'}`,
      dataset: { datei: meta.datei },
    });
    let schalter = null;
    if (opt.klappbar) {
      schalter = async () => {
        if (zustand.offen.has(offenSchluessel)) zustand.offen.delete(offenSchluessel);
        else zustand.offen.add(offenSchluessel);
        const neu = await ausgabeArtikel(meta, opt);
        if (art.isConnected) art.replaceWith(neu);
        const knopf = $('.ausgabe-umschalter', neu);
        if (knopf) knopf.focus({ preventScroll: true });
        return neu;
      };
      umschalter.set(art, schalter);
    }
    if (!offen) {
      art.append(ausgabeKopf(meta, null, opt, schalter, false));
      return art;
    }
    let ausgabe;
    try {
      ausgabe = opt.daten || (await ladeAusgabe(meta.datei));
    } catch (fehler) {
      art.append(
        ausgabeKopf(meta, null, opt, schalter, true),
        el('div', { class: 'hinweis hinweis--fehler' },
          el('p', { text: `Diese Ausgabe konnte nicht geladen werden (${str(fehler && fehler.message)}).` }),
          el('button', {
            type: 'button',
            class: 'knopf',
            onclick: async () => { if (art.isConnected) art.replaceWith(await ausgabeArtikel(meta, opt)); },
          }, 'Erneut versuchen')),
      );
      return art;
    }
    // Satzliste fürs Vorlesen, einmal pro Ausgabe; Kopf und Themen nutzen dieselbe.
    const plan = kannVorlesen() ? vorleseplan(ausgabe, opt.namen || null) : null;
    art.append(ausgabeKopf(meta, ausgabe, opt, schalter, true, plan), ausgabeKoerper(ausgabe, meta, opt, plan));
    return art;
  }

  function ausgabeKopf(meta, ausgabe, opt, schalter, offen, plan = null) {
    const a = ausgabe || {};
    const titel = str(a.titel || meta.titel) || 'Ausgabe';
    const status = a.status || meta.status;
    const format = a.format || meta.format;
    const kopf = el('header', { class: 'ausgabe-kopf' });

    kopf.append(schalter
      ? el('h2', { class: 'ausgabe-titel' },
        el('button', { type: 'button', class: 'ausgabe-umschalter', 'aria-expanded': String(offen), onclick: schalter }, titel))
      : el('h2', { class: 'ausgabe-titel', text: titel }));

    const angaben = [];
    if (opt.kontext === 'merkliste' && FORMAT_NAME[format]) angaben.push(FORMAT_NAME[format]);
    const zeitraum = zeitraumText(a.zeitraum || meta.zeitraum);
    if (zeitraum) angaben.push(`Zeitraum: ${zeitraum}`);
    const erschienen = a.erschienen || meta.erschienen;
    if (erschienen) angaben.push(`Stand: ${standText(erschienen)}`);
    kopf.append(el('p', { class: 'ausgabe-meta', text: angaben.join(' · ') }));

    const pills = [];
    if (a.beispiel === true) pills.push(el('span', { class: 'pill pill--beispiel', text: 'Beispiel' }));
    if (status) pills.push(el('span', { class: `pill pill--${str(status).replace(/[^a-z]/g, '')}`, text: STATUS_TEXT[status] || str(status) }));
    if (pills.length) kopf.append(el('p', { class: 'pills' }, pills));

    const knoepfe = [];
    if (ausgabe && plan && plan.saetze.length) {
      knoepfe.push(vorleseKnoepfe({ ausgabe, meta, namen: opt.namen || null, plan, thema: null }));
    }
    if (ausgabe && hatInhalt(ausgabe)) {
      const schluessel = `ausgabe:${meta.datei}`;
      knoepfe.push(merkKnopf(schluessel, 'ausgabe', () => neuerEintrag('ausgabe', schluessel, ausgabe,
        herkunftVon(ausgabe, meta), namenFuer(themenReihenfolge(ausgabe), opt.namen))));
    }
    if (knoepfe.length) kopf.append(el('div', { class: 'aktionen aktionen--kopf' }, knoepfe));
    return kopf;
  }

  function herkunftVon(ausgabe, meta) {
    return {
      format: str(ausgabe.format || meta.format),
      titel: str(ausgabe.titel || meta.titel),
      datei: str(meta.datei),
      zeitraum: ausgabe.zeitraum || meta.zeitraum || null,
      beispiel: ausgabe.beispiel === true,
    };
  }

  function ausgabeKoerper(ausgabe, meta, opt, plan = null) {
    const format = ausgabe.format || meta.format;
    const ctx = {
      meta,
      format,
      namen: opt.namen || null,
      herkunft: herkunftVon(ausgabe, meta),
      kontext: opt.kontext,
      ausgabe,
      plan,
    };
    const koerper = el('div', { class: 'ausgabe-koerper' });
    if (ausgabe.status === 'fehler') koerper.append(fehlerHinweis(ausgabe, meta, ctx));

    const gruppen = gruppiere(ausgabe).filter((g) => !g.leer && istSichtbar(g.id));
    for (const g of gruppen) koerper.append(themaSektion(g, ctx));

    const [ruhigLabel, nichtsLabel] = RUHIG_TEXT[format] || ['Ruhig', 'Nichts Wichtiges'];
    let ruhigZeile = null;
    if (ausgabe.status === 'ruhig') {
      ruhigZeile = el('p', { class: 'ruhig ruhig--alles', text: nichtsLabel });
    } else {
      const ruhige = liste(ausgabe.ruhig).filter((id) => typeof id === 'string' && istSichtbar(id));
      if (ruhige.length) {
        ruhigZeile = el('p', { class: 'ruhig' },
          el('span', { class: 'ruhig-label', text: `${ruhigLabel}:` }), ' ',
          ruhige.map((id) => themaName(id, ctx.namen)).join(', '));
      }
    }
    if (!gruppen.length && !ruhigZeile && zustand.filter.size && ausgabe.status !== 'fehler') {
      koerper.append(el('p', { class: 'leer', text: 'Zu den gewählten Themen steht in dieser Ausgabe nichts.' }));
    }
    if (ruhigZeile) koerper.append(ruhigZeile);
    if (hatInhalt(ausgabe)) koerper.append(gefehltBereich(ctx));
    return koerper;
  }

  // Eine leere Fehlerausgabe kann man weder speichern noch bewerten.
  function hatInhalt(ausgabe) {
    return ausgabe.status !== 'fehler'
      || [ausgabe.meldungen, ausgabe.videos, ausgabe.abschnitte].some((x) => liste(x).length > 0);
  }

  function fehlerHinweis(ausgabe, meta, ctx) {
    const box = el('div', { class: 'hinweis hinweis--fehler' },
      el('p', { class: 'hinweis-titel', text: 'Bei dieser Ausgabe ist etwas schiefgegangen.' }));
    if (ausgabe.fehler) box.append(el('p', { text: str(ausgabe.fehler) }));
    if (ctx.kontext === 'feed') {
      const letzte = letzteErfolgreiche(meta);
      box.append(letzte
        ? el('p', null, 'Letzte erfolgreiche Ausgabe: ',
          el('button', { type: 'button', class: 'link-knopf', onclick: () => oeffneUndSpringe(letzte.datei) },
            str(letzte.titel) || zeitraumText(letzte.zeitraum)),
          letzte.erschienen ? ` (Stand: ${standText(letzte.erschienen)})` : '')
        : el('p', { text: 'Davor gibt es noch keine erfolgreiche Ausgabe.' }));
    }
    if (ctx.format !== 'jaehrlich') {
      box.append(el('p', { class: 'klein', text: 'Fehlende Tage recherchiert der nächste Rückblick selbst nach.' }));
    }
    return box;
  }

  function letzteErfolgreiche(meta) {
    const von = str(meta.zeitraum && meta.zeitraum.von);
    return ausgabenVon(meta.format)
      .find((a) => (a.status === 'ok' || a.status === 'ruhig') && str(a.zeitraum && a.zeitraum.bis) < von) || null;
  }

  function findeArtikel(datei) {
    return [...document.querySelectorAll('#inhalt .ausgabe')].find((a) => a.dataset.datei === datei) || null;
  }

  async function oeffneUndSpringe(datei) {
    let art = findeArtikel(datei);
    if (!art) return;
    if (art.classList.contains('ausgabe--zu') && umschalter.has(art)) art = await umschalter.get(art)();
    springeZuElement(art);
  }

  function springeZuElement(ziel) {
    ziel.scrollIntoView({ behavior: bewegungReduziert() ? 'auto' : 'smooth', block: 'start' });
    ziel.classList.remove('ziel');
    void ziel.offsetWidth; // Animation neu starten
    ziel.classList.add('ziel');
    if (!ziel.hasAttribute('tabindex')) ziel.setAttribute('tabindex', '-1');
    ziel.focus({ preventScroll: true });
  }

  async function springeZuMeldung(datei, id, hauptthema) {
    if (!istSichtbar(hauptthema)) {
      zustand.filter.add(hauptthema);
      zeigeChips();
      await zeigeAnsicht({ scrollBehalten: true });
    }
    const art = findeArtikel(datei);
    const ziel = art && [...art.querySelectorAll('.meldung')].find((k) => k.dataset.meldung === id);
    if (ziel) springeZuElement(ziel);
  }

  // ------------------------------------------------------------ Thema, Meldung, Verweis

  function themaSektion(g, ctx) {
    const titel = el('h3', { class: 'thema-titel', text: themaName(g.id, ctx.namen) });
    // Ein Thema nur mit Verweisen hat nichts zum Vorlesen und bekommt keinen Knopf.
    const vorlesbar = ctx.plan && ctx.plan.themen.some((t) => t.id === g.id);
    const s = el('section', { class: 'thema', dataset: { thema: g.id, farbe: farbe(g.id) } },
      vorlesbar
        ? el('div', { class: 'thema-kopf' }, titel,
          vorleseKnoepfe({ ausgabe: ctx.ausgabe, meta: ctx.meta, namen: ctx.namen, plan: ctx.plan, thema: g.id }))
        : titel);
    if (g.ausnahme) s.append(ausnahmeHinweis(g, ctx));
    for (const m of g.meldungen) s.append(meldungKarte(m, ctx));
    if (g.verweise.length) {
      s.append(el('ul', { class: 'verweise' }, g.verweise.map((m) => el('li', null, verweisKnopf(m, ctx)))));
    }
    for (const v of g.videos) s.append(videoKarte(v, ctx));
    for (const a of g.abschnitte) s.append(abschnittBlock(a));
    return s;
  }

  function ausnahmeHinweis(g, ctx) {
    const grenze = OBERGRENZE[ctx.format];
    const anzahl = g.meldungen.length;
    const grund = str(g.ausnahme.grund);
    const vorne = grenze && anzahl > grenze ? `${anzahl} statt ${grenze} Meldungen` : 'Mehr Meldungen als üblich';
    return el('p', { class: 'ausnahme' }, el('strong', { text: vorne }), grund ? `: ${grund}` : '');
  }

  function meldungKarte(m, ctx, extra = {}) {
    const id = str(m.id) || str(m.titel);
    const karte = el('article', { class: 'meldung', dataset: { meldung: id, farbe: farbe(m.hauptthema) }, tabindex: '-1' });

    const marken = [];
    if (extra.zeigeThema) marken.push(el('span', { class: 'marke marke--thema', text: themaName(m.hauptthema, ctx.namen) }));
    if (m.update === true) marken.push(el('span', { class: 'marke marke--update', text: 'Update' }));
    if (ctx.format && ctx.format !== 'taeglich' && m.datum) {
      marken.push(el('span', { class: 'meldung-datum', text: meldungsDatum(m.datum, m.datum_bis) }));
    }
    if (marken.length) karte.append(el('p', { class: 'meldung-marken' }, marken));

    karte.append(el('h4', { class: 'meldung-titel', text: str(m.titel) }));
    if (m.text) karte.append(el('p', { class: 'meldung-text', text: str(m.text) }));
    if (m.warum_wichtig) {
      karte.append(el('p', { class: 'warum' }, el('strong', { class: 'warum-label', text: 'Warum wichtig: ' }), str(m.warum_wichtig)));
    }
    const quellen = liste(m.quellen).map(quelleLink).filter(Boolean);
    if (quellen.length) {
      karte.append(el('p', { class: 'quellen' },
        el('span', { class: 'quellen-label', text: quellen.length > 1 ? 'Quellen: ' : 'Quelle: ' }),
        zwischen(quellen, ' · ')));
    }
    const schluessel = `meldung:${id}`;
    karte.append(el('div', { class: 'aktionen' },
      merkKnopf(schluessel, 'meldung', () => neuerEintrag('meldung', schluessel, m, ctx.herkunft,
        namenFuer([m.hauptthema, ...liste(m.themen)], ctx.namen))),
      unnoetigKnopf(m, ctx)));
    return karte;
  }

  function quelleLink(q) {
    if (!istObjekt(q)) return null;
    const name = str(q.name) || 'Quelle';
    const url = sichereUrl(q.url);
    return url ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, name) : el('span', { text: name });
  }

  function verweisKnopf(m, ctx) {
    return el('button', {
      type: 'button',
      class: 'verweis',
      dataset: { farbe: farbe(m.hauptthema) },
      onclick: () => springeZuMeldung(ctx.meta.datei, str(m.id) || str(m.titel), m.hauptthema),
    },
    el('span', { class: 'verweis-titel', text: str(m.titel) }),
    el('span', { class: 'verweis-ziel', text: `→ siehe ${themaName(m.hauptthema, ctx.namen)}` }));
  }

  // ------------------------------------------------------------ Abschnitte

  function abschnittBlock(a) {
    const typ = str(a.typ);
    const s = el('section', { class: `abschnitt abschnitt--${typ.replace(/[^a-z]/g, '')}` },
      el('h4', { class: 'abschnitt-titel', text: str(a.titel) || ABSCHNITT_TITEL[typ] || 'Weitere Einträge' }));
    const eintraege = liste(a.eintraege).filter(istObjekt);
    const quelleAnhang = (e) => (istObjekt(e.quelle) ? [' · ', quelleLink(e.quelle)] : null);

    if (typ === 'finanzierungsrunden') {
      s.append(el('ol', { class: 'kompakt' }, eintraege.map((e) => el('li', null,
        el('div', { class: 'kompakt-zeile' },
          el('strong', { text: str(e.name) }),
          e.betrag ? el('span', { class: 'betrag', text: str(e.betrag) }) : null),
        el('div', { class: 'kompakt-details' },
          [e.land, e.bereich, e.investoren ? `Investoren: ${str(e.investoren)}` : null, e.datum ? datumLang(e.datum, false) : null]
            .filter(Boolean).map(str).join(' · '),
          quelleAnhang(e))))));
    } else if (typ === 'gescheitert') {
      for (const e of eintraege) {
        s.append(el('div', { class: 'gescheitert' },
          el('p', { class: 'gescheitert-name' }, el('strong', { text: str(e.name) })),
          e.text ? el('p', { text: str(e.text) }) : null,
          istObjekt(e.quelle) ? el('p', { class: 'quellen' }, 'Quelle: ', quelleLink(e.quelle)) : null));
      }
    } else if (typ === 'monatsueberblick') {
      s.append(el('dl', { class: 'kompakt kompakt--monate' },
        eintraege.map((e) => [el('dt', { text: monatName(e.monat) }), el('dd', { text: str(e.text) })])));
    } else if (typ === 'ausblick') {
      s.append(el('ul', { class: 'kompakt' }, eintraege.map((e) => el('li', null,
        el('strong', { text: datumLang(e.datum) }), e.text ? ` – ${str(e.text)}` : '', quelleAnhang(e)))));
    } else {
      s.append(el('ul', { class: 'kompakt' }, eintraege.map((e) => el('li', null,
        e.name || e.titel ? el('strong', { text: str(e.name || e.titel) }) : null,
        e.text ? ` ${str(e.text)}` : '', quelleAnhang(e)))));
    }
    return s;
  }

  // ------------------------------------------------------------ Videos

  function videoId(url) {
    const m = /(?:[?&]v=|youtu\.be\/|\/embed\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/.exec(str(url));
    return m ? m[1] : null;
  }

  function videoKarte(v, ctx, extra = {}) {
    const karte = el('article', { class: 'video', dataset: { farbe: farbe(v.thema) } });
    const marken = [el('span', { class: 'marke marke--video', text: 'Video-Empfehlung' })];
    if (extra.zeigeThema) marken.unshift(el('span', { class: 'marke marke--thema', text: themaName(v.thema, ctx.namen) }));
    if (v.hintergrund === true) marken.push(el('span', { class: 'marke', text: 'Hintergrund' }));
    if (v.neuer_kanal === true) marken.push(el('span', { class: 'marke', text: 'Neuer Kanal' }));

    const angaben = [
      str(v.kanal),
      Number.isFinite(v.dauer_min) ? `${v.dauer_min} Min.` : '',
      v.datum ? datumLang(v.datum, false) : '',
    ].filter(Boolean).join(' · ');

    const knopf = el('button', { type: 'button', class: 'video-start', 'aria-expanded': 'false' },
      el('span', { class: 'video-symbol', 'aria-hidden': 'true' }),
      el('span', { class: 'video-kopf' },
        el('span', { class: 'video-titel', text: str(v.titel) }),
        el('span', { class: 'video-meta', text: angaben })));
    knopf.addEventListener('click', () => {
      if (zustand.video && zustand.video.karte === karte) schliesseVideo();
      else spieleVideo(karte, v);
    });

    karte.append(el('p', { class: 'meldung-marken' }, marken), knopf, el('div', { class: 'video-player', hidden: true }));
    if (v.warum) karte.append(el('p', { class: 'video-warum', text: str(v.warum) }));
    const schluessel = `video:${videoId(v.url) || str(v.url) || str(v.titel)}`;
    karte.append(el('div', { class: 'aktionen' },
      merkKnopf(schluessel, 'video', () => neuerEintrag('video', schluessel, v, ctx.herkunft, namenFuer([v.thema], ctx.namen)))));
    return karte;
  }

  let ytVersprechen = null;
  function ladeYouTubeApi() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (!ytVersprechen) {
      ytVersprechen = new Promise((resolve, reject) => {
        const vorher = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          if (typeof vorher === 'function') vorher();
          resolve(window.YT);
        };
        const skript = el('script', { src: YT_API, async: true });
        skript.onerror = () => {
          skript.remove();
          reject(new Error('YouTube nicht erreichbar'));
        };
        document.head.append(skript);
        setTimeout(() => reject(new Error('YouTube antwortet nicht')), 8000);
      }).catch((fehler) => {
        ytVersprechen = null;
        throw fehler;
      });
    }
    return ytVersprechen;
  }

  async function spieleVideo(karte, v) {
    schliesseVideo();
    const box = $('.video-player', karte);
    const id = videoId(v.url);
    const eintrag = { karte, player: null };
    zustand.video = eintrag;
    karte.classList.remove('video--weg');
    $('.video-start', karte).setAttribute('aria-expanded', 'true');
    box.className = 'video-player';
    box.hidden = false;
    if (!id) {
      videoFehler(karte, 0, null);
      return;
    }
    const ziel = el('div');
    box.replaceChildren(ziel);
    try {
      const YT = await ladeYouTubeApi();
      if (zustand.video !== eintrag) return;
      const playerVars = { autoplay: 1, playsinline: 1, rel: 0, hl: 'de' };
      if (location.origin && location.origin !== 'null') playerVars.origin = location.origin;
      eintrag.player = new YT.Player(ziel, {
        host: YT_HOST,
        videoId: id,
        width: '100%',
        height: '100%',
        playerVars,
        events: {
          onError: (e) => {
            if (zustand.video === eintrag) videoFehler(karte, e && e.data, id);
          },
        },
      });
    } catch {
      // Ohne YouTube-API: einfach einbetten. Ob das Video noch existiert, zeigt dann der Player selbst.
      if (zustand.video !== eintrag) return;
      ziel.replaceWith(el('iframe', {
        src: `${YT_HOST}/embed/${id}?autoplay=1&playsinline=1&rel=0&hl=de`,
        title: str(v.titel),
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
        allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin',
      }));
    }
  }

  function videoFehler(karte, code, id) {
    const v = zustand.video;
    if (v && v.karte === karte) {
      if (v.player) {
        try { v.player.destroy(); } catch { /* egal */ }
      }
      zustand.video = null;
    }
    karte.classList.add('video--weg');
    $('.video-start', karte).setAttribute('aria-expanded', 'false');
    const box = $('.video-player', karte);
    box.className = 'video-player video-player--fehler';
    box.hidden = false;
    const kinder = [el('p', { class: 'video-fehler', text: 'Video nicht mehr verfügbar.' })];
    if ((code === 101 || code === 150) && id) {
      kinder.push(el('p', { class: 'klein' }, 'Vielleicht darf es nur nicht eingebettet werden: ',
        el('a', { href: `https://www.youtube.com/watch?v=${id}`, target: '_blank', rel: 'noopener noreferrer' }, 'auf YouTube öffnen')));
    }
    box.replaceChildren(...kinder);
  }

  function schliesseVideo() {
    const v = zustand.video;
    if (!v) return;
    zustand.video = null;
    if (v.player) {
      try { v.player.destroy(); } catch { /* egal */ }
    }
    const box = $('.video-player', v.karte);
    if (box) {
      box.replaceChildren();
      box.hidden = true;
      box.className = 'video-player';
    }
    const knopf = $('.video-start', v.karte);
    if (knopf) knopf.setAttribute('aria-expanded', 'false');
  }

  // ------------------------------------------------------------ Merkliste (IndexedDB)

  const merkDb = {
    verbindung: null,
    oeffnen() {
      if (!this.verbindung) {
        this.verbindung = new Promise((resolve, reject) => {
          if (!('indexedDB' in window)) {
            reject(new Error('IndexedDB fehlt in diesem Browser'));
            return;
          }
          const anfrage = indexedDB.open('mein-feed', 1);
          anfrage.onupgradeneeded = () => anfrage.result.createObjectStore('merkliste', { keyPath: 'schluessel' });
          anfrage.onsuccess = () => resolve(anfrage.result);
          anfrage.onerror = () => reject(anfrage.error);
        });
      }
      return this.verbindung;
    },
    async tx(modus, arbeit) {
      const db = await this.oeffnen();
      return new Promise((resolve, reject) => {
        const t = db.transaction('merkliste', modus);
        const anfrage = arbeit(t.objectStore('merkliste'));
        t.oncomplete = () => resolve(anfrage ? anfrage.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Speichern abgebrochen'));
      });
    },
    alle() { return this.tx('readonly', (s) => s.getAll()); },
    speichern(e) { return this.tx('readwrite', (s) => { s.put(e); }); },
    alleSpeichern(eintraege) { return this.tx('readwrite', (s) => { eintraege.forEach((e) => s.put(e)); }); },
    loeschen(schluessel) { return this.tx('readwrite', (s) => { s.delete(schluessel); }); },
  };

  async function ladeMerkliste() {
    try {
      const alle = await merkDb.alle();
      zustand.merkliste = new Map(liste(alle).filter(gueltigerEintrag).map((e) => [e.schluessel, e]));
      if (zustand.merkliste.size) dauerhaftSpeichern();
    } catch (fehler) {
      zustand.merkFehler = str(fehler && fehler.message) || str(fehler);
    }
  }

  async function dauerhaftSpeichern() {
    try {
      if (!navigator.storage || !navigator.storage.persist) return;
      zustand.persistiert = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    } catch {
      /* Der Browser entscheidet selbst; die Merkliste funktioniert trotzdem. */
    }
  }

  function namenFuer(ids, namen) {
    const ergebnis = {};
    for (const id of ids) if (typeof id === 'string' && id) ergebnis[id] = themaName(id, namen);
    return ergebnis;
  }

  function neuerEintrag(art, schluessel, daten, herkunft, themenNamen) {
    return {
      schluessel,
      art,
      gespeichert: new Date().toISOString(),
      herkunft,
      themenNamen,
      daten: JSON.parse(JSON.stringify(daten)),
    };
  }

  function gueltigerEintrag(e) {
    return istObjekt(e)
      && ['meldung', 'video', 'ausgabe'].includes(e.art)
      && typeof e.schluessel === 'string'
      && e.schluessel.startsWith(`${e.art}:`)
      && istObjekt(e.daten);
  }

  function merkKnopf(schluessel, art, baueEintrag) {
    const knopf = el('button', { type: 'button', class: 'knopf knopf--merk', dataset: { merk: schluessel, art } });
    setzeMerkKnopf(knopf);
    knopf.addEventListener('click', () => umschaltenMerk(schluessel, baueEintrag));
    return knopf;
  }

  function setzeMerkKnopf(knopf) {
    const an = zustand.merkliste.has(knopf.dataset.merk);
    const ausgabe = knopf.dataset.art === 'ausgabe';
    knopf.setAttribute('aria-pressed', String(an));
    knopf.textContent = an
      ? (ausgabe ? 'Ausgabe gespeichert ✓' : 'Gespeichert ✓')
      : (ausgabe ? 'Ausgabe speichern' : 'Speichern');
  }

  function merkGeaendert(schluessel) {
    document.querySelectorAll('.knopf--merk').forEach((k) => {
      if (k.dataset.merk === schluessel) setzeMerkKnopf(k);
    });
    if (zustand.tab === 'merkliste') zeigeAnsicht({ scrollBehalten: true });
  }

  async function umschaltenMerk(schluessel, baueEintrag) {
    if (zustand.merkFehler) {
      toast('Die Merkliste ist in diesem Browser nicht verfügbar.');
      return;
    }
    try {
      const alt = zustand.merkliste.get(schluessel);
      if (alt) {
        await merkDb.loeschen(schluessel);
        zustand.merkliste.delete(schluessel);
        merkGeaendert(schluessel);
        toast('Aus der Merkliste entfernt.', {
          text: 'Rückgängig',
          los: async () => {
            await merkDb.speichern(alt);
            zustand.merkliste.set(schluessel, alt);
            merkGeaendert(schluessel);
          },
        });
      } else {
        const eintrag = baueEintrag();
        await merkDb.speichern(eintrag);
        zustand.merkliste.set(schluessel, eintrag);
        merkGeaendert(schluessel);
        toast('In der Merkliste gespeichert.');
        dauerhaftSpeichern();
      }
    } catch (fehler) {
      toast(`Speichern fehlgeschlagen: ${str(fehler && fehler.message) || str(fehler)}`);
    }
  }

  function merkSichtbar(e) {
    if (!zustand.filter.size || e.art === 'ausgabe') return true;
    const d = e.daten;
    const ids = e.art === 'video' ? [d.thema] : [d.hauptthema, ...liste(d.themen)];
    return ids.some((id) => zustand.filter.has(id));
  }

  async function baueMerkliste() {
    const box = el('div', { class: 'ansicht merkliste' });
    const kopf = el('header', { class: 'merk-kopf' }, el('h2', { class: 'ansicht-titel', text: 'Merkliste' }));
    box.append(kopf);
    if (zustand.merkFehler) {
      box.append(el('div', { class: 'hinweis hinweis--fehler' },
        el('p', { class: 'hinweis-titel', text: 'Die Merkliste ist in diesem Browser nicht verfügbar.' }),
        el('p', { class: 'klein', text: zustand.merkFehler })));
      box.append(feedbackBereich());
      return box;
    }

    const alle = [...zustand.merkliste.values()]
      .reverse() // bei gleichem Zeitpunkt: zuletzt hinzugefügt zuerst
      .sort((a, b) => str(b.gespeichert).localeCompare(str(a.gespeichert)));
    const dateiFeld = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    dateiFeld.addEventListener('change', () => {
      const datei = dateiFeld.files && dateiFeld.files[0];
      dateiFeld.value = '';
      if (datei) importiere(datei);
    });
    const anzahl = alle.length === 1 ? '1 Eintrag' : `${alle.length} Einträge`;
    kopf.append(
      el('p', { class: 'klein', text: `${anzahl}, nur auf diesem Gerät gespeichert. Bleibt auch, wenn eine Ausgabe im Repo gelöscht wird.` }),
      el('div', { class: 'knopfreihe' },
        el('button', { type: 'button', class: 'knopf', onclick: exportiere, disabled: !alle.length }, 'Exportieren'),
        el('button', { type: 'button', class: 'knopf', onclick: () => dateiFeld.click() }, 'Importieren'),
        dateiFeld));
    if (alle.length && zustand.persistiert === false) {
      box.append(el('p', { class: 'hinweis hinweis--leise klein', text: 'Der Browser hat die dauerhafte Speicherung nicht bestätigt. Sichere die Merkliste ab und zu mit „Exportieren“.' }));
    }

    const sichtbar = alle.filter(merkSichtbar);
    if (!alle.length) {
      box.append(el('p', { class: 'leer', text: 'Noch nichts gespeichert. Tippe bei einer Meldung, einem Video oder einer Ausgabe auf „Speichern“.' }));
    } else if (!sichtbar.length) {
      box.append(el('p', { class: 'leer', text: 'Keine gespeicherten Einträge zu den gewählten Themen.' }));
    }
    for (const e of sichtbar) box.append(await merkEintrag(e));
    box.append(feedbackBereich());
    return box;
  }

  async function merkEintrag(e) {
    const h = istObjekt(e.herkunft) ? e.herkunft : {};
    const namen = istObjekt(e.themenNamen) ? e.themenNamen : null;
    const wrap = el('div', { class: 'merk-eintrag' });
    const zeile = el('p', { class: 'merk-herkunft' });
    const am = gespeichertAm(e.gespeichert);
    zeile.append(am ? `Gespeichert am ${am}` : 'Gespeichert');
    if (h.titel && e.art !== 'ausgabe') zeile.append(` · aus „${str(h.titel)}“`);
    if (h.beispiel) zeile.append(' ', el('span', { class: 'pill pill--beispiel', text: 'Beispiel' }));
    wrap.append(zeile);

    const ctx = { meta: { datei: str(h.datei) }, format: h.format, namen, herkunft: h, kontext: 'merkliste' };
    if (e.art === 'meldung') {
      wrap.append(meldungKarte(e.daten, ctx, { zeigeThema: true }));
    } else if (e.art === 'video') {
      wrap.append(videoKarte(e.daten, ctx, { zeigeThema: true }));
    } else {
      const d = e.daten;
      const meta = {
        datei: str(h.datei) || e.schluessel.slice('ausgabe:'.length),
        format: d.format || h.format,
        titel: d.titel || h.titel,
        zeitraum: d.zeitraum || h.zeitraum,
        status: d.status,
        erschienen: d.erschienen,
      };
      wrap.append(await ausgabeArtikel(meta, { klappbar: true, daten: d, namen, kontext: 'merkliste' }));
    }
    return wrap;
  }

  function exportiere() {
    const daten = {
      app: 'mein-feed',
      art: 'merkliste',
      version: 1,
      exportiert: new Date().toISOString(),
      eintraege: [...zustand.merkliste.values()],
    };
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(daten, null, 2)}\n`], { type: 'application/json' }));
    const link = el('a', { href: url, download: `mein-feed-merkliste-${wienJetzt().datum}.json`, hidden: true });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Merkliste exportiert.');
  }

  async function importiere(datei) {
    let daten;
    try {
      daten = JSON.parse(await datei.text());
    } catch {
      toast('Die Datei ist kein gültiges JSON.');
      return;
    }
    const roh = Array.isArray(daten) ? daten
      : istObjekt(daten) && daten.app === 'mein-feed' && Array.isArray(daten.eintraege) ? daten.eintraege
        : null;
    if (!roh) {
      toast('Das ist keine Merkliste von „Mein Feed“.');
      return;
    }
    const gueltig = roh.filter(gueltigerEintrag).map((e) => ({
      schluessel: e.schluessel,
      art: e.art,
      gespeichert: typeof e.gespeichert === 'string' ? e.gespeichert : new Date().toISOString(),
      herkunft: istObjekt(e.herkunft) ? e.herkunft : {},
      themenNamen: istObjekt(e.themenNamen) ? e.themenNamen : {},
      daten: e.daten,
    }));
    const neu = gueltig.filter((e, i) => !zustand.merkliste.has(e.schluessel)
      && gueltig.findIndex((x) => x.schluessel === e.schluessel) === i);
    try {
      await merkDb.alleSpeichern(neu);
    } catch (fehler) {
      toast(`Import fehlgeschlagen: ${str(fehler && fehler.message)}`);
      return;
    }
    neu.forEach((e) => zustand.merkliste.set(e.schluessel, e));
    const teileText = [`${neu.length} ${neu.length === 1 ? 'Eintrag' : 'Einträge'} importiert`];
    const doppelt = gueltig.length - neu.length;
    const ungueltig = roh.length - gueltig.length;
    if (doppelt) teileText.push(`${doppelt} schon vorhanden`);
    if (ungueltig) teileText.push(`${ungueltig} ungültig`);
    toast(`${teileText.join(', ')}.`);
    if (neu.length) dauerhaftSpeichern();
    await zeigeAnsicht({ scrollBehalten: true });
  }

  // ------------------------------------------------------------ Feedback (localStorage)

  function ladeFeedback() {
    try {
      const f = JSON.parse(localStorage.getItem(FEEDBACK_SCHLUESSEL));
      if (istObjekt(f)) {
        return { unnoetig: istObjekt(f.unnoetig) ? f.unnoetig : {}, gefehlt: liste(f.gefehlt).filter(istObjekt) };
      }
    } catch { /* leer anfangen */ }
    return { unnoetig: {}, gefehlt: [] };
  }

  function speichereFeedback() {
    try {
      localStorage.setItem(FEEDBACK_SCHLUESSEL, JSON.stringify(zustand.feedback));
      return true;
    } catch {
      toast('Feedback konnte nicht gespeichert werden.');
      return false;
    }
  }

  function unnoetigKnopf(m, ctx) {
    const id = str(m.id) || str(m.titel);
    const knopf = el('button', { type: 'button', class: 'knopf knopf--unnoetig', dataset: { unnoetig: id } });
    setzeUnnoetigKnopf(knopf, Boolean(zustand.feedback.unnoetig[id]));
    knopf.addEventListener('click', () => {
      const an = !zustand.feedback.unnoetig[id];
      if (an) {
        zustand.feedback.unnoetig[id] = {
          id,
          titel: str(m.titel),
          warum_wichtig: str(m.warum_wichtig),
          hauptthema: str(m.hauptthema),
          hauptthemaName: themaName(m.hauptthema, ctx.namen),
          weitereThemen: liste(m.themen).filter((t) => t !== m.hauptthema).map((t) => themaName(t, ctx.namen)),
          update: m.update === true,
          quellen: liste(m.quellen).map((q) => str(q && q.name)).filter(Boolean),
          ausgabe: ctx.herkunft,
          markiert: new Date().toISOString(),
        };
      } else {
        delete zustand.feedback.unnoetig[id];
      }
      if (!speichereFeedback()) return;
      document.querySelectorAll('.knopf--unnoetig').forEach((k) => {
        if (k.dataset.unnoetig === id) setzeUnnoetigKnopf(k, an);
      });
      toast(an ? 'Als unnötig vermerkt.' : 'Markierung „Unnötig“ entfernt.');
      feedbackGeaendert();
    });
    return knopf;
  }

  function setzeUnnoetigKnopf(knopf, an) {
    knopf.setAttribute('aria-pressed', String(an));
    knopf.textContent = an ? 'Unnötig ✓' : 'Unnötig';
  }

  function feedbackGeaendert() {
    const alt = $('#feedback');
    if (alt) alt.replaceWith(feedbackBereich());
  }

  function gefehltBereich(ctx) {
    const datei = ctx.meta.datei;
    const eigene = () => zustand.feedback.gefehlt.filter((g) => istObjekt(g.ausgabe) && g.ausgabe.datei === datei);
    const zusammenfassung = el('summary');
    const eintraege = el('ul', { class: 'gefehlt-liste' });
    const feld = el('textarea', {
      rows: 3,
      maxlength: 2000,
      placeholder: 'Was hätte in diese Ausgabe gehört?',
      'aria-label': 'Was hat in dieser Ausgabe gefehlt?',
    });
    const zeichne = () => {
      const meine = eigene();
      zusammenfassung.textContent = meine.length ? `Hat etwas gefehlt? (${meine.length} notiert)` : 'Hat etwas gefehlt?';
      eintraege.replaceChildren(...meine.map((g) => el('li', null,
        el('span', { text: str(g.text) }),
        el('button', {
          type: 'button',
          class: 'knopf knopf--klein',
          onclick: () => {
            zustand.feedback.gefehlt = zustand.feedback.gefehlt.filter((x) => x !== g);
            if (speichereFeedback()) {
              zeichne();
              feedbackGeaendert();
            }
          },
        }, 'Löschen'))));
    };
    const formular = el('form', { class: 'gefehlt-form' }, feld,
      el('button', { type: 'submit', class: 'knopf knopf--primaer' }, 'Notieren'));
    formular.addEventListener('submit', (ereignis) => {
      ereignis.preventDefault();
      const wert = feld.value.trim();
      if (!wert) {
        feld.focus();
        return;
      }
      zustand.feedback.gefehlt.push({ id: neueId(), text: wert, ausgabe: ctx.herkunft, erstellt: new Date().toISOString() });
      if (speichereFeedback()) {
        feld.value = '';
        zeichne();
        feedbackGeaendert();
        toast('Notiert.');
      }
    });
    zeichne();
    return el('details', { class: 'gefehlt' }, zusammenfassung,
      el('p', { class: 'klein', text: 'Wird nur auf diesem Gerät gesammelt. „Feedback kopieren“ in der Merkliste macht daraus einen Text für Claude Code.' }),
      formular, eintraege);
  }

  function ausgabeBeschreibung(h) {
    if (!istObjekt(h)) return 'unbekannte Ausgabe';
    const art = FORMAT_NAME[h.format] || 'Ausgabe';
    return `${art} „${str(h.titel)}“${h.datei ? ` (${h.datei})` : ''}${h.beispiel ? ', Beispieldaten' : ''}`;
  }

  function feedbackText() {
    const unnoetig = Object.values(zustand.feedback.unnoetig).filter(istObjekt)
      .sort((a, b) => str(a.markiert).localeCompare(str(b.markiert)));
    const gefehlt = [...zustand.feedback.gefehlt].sort((a, b) => str(a.erstellt).localeCompare(str(b.erstellt)));
    const z = [
      `Feedback aus der App „Mein Feed“, Stand ${datumLang(wienJetzt().datum)}.`,
      'Bitte schärfe damit config/regeln.md nach (wenn nötig auch config/themen.json). Leite aus den Beispielen allgemeine Regeln ab, statt einzelne Meldungen zu verbieten, und sag kurz, welche Regel du warum änderst.',
      '',
      `Als „Unnötig“ markiert (${unnoetig.length}):`,
    ];
    if (!unnoetig.length) z.push('– nichts');
    unnoetig.forEach((u, i) => {
      z.push(`${i + 1}. ${u.titel}${u.update ? ' [Update]' : ''}`);
      z.push(`   Ausgabe: ${ausgabeBeschreibung(u.ausgabe)}, Meldung ${u.id}`);
      const weitere = liste(u.weitereThemen);
      z.push(`   Thema: ${u.hauptthemaName || u.hauptthema}${weitere.length ? `, auch bei ${weitere.join(', ')}` : ''}`);
      if (u.warum_wichtig) z.push(`   „Warum wichtig“ im Feed: ${u.warum_wichtig}`);
      if (liste(u.quellen).length) z.push(`   Quellen: ${u.quellen.join(', ')}`);
    });
    z.push('', `„Hat gefehlt“ (${gefehlt.length}):`);
    if (!gefehlt.length) z.push('– nichts');
    gefehlt.forEach((g, i) => {
      z.push(`${i + 1}. ${str(g.text).replace(/\s*\n\s*/g, ' / ')}`);
      z.push(`   Ausgabe: ${ausgabeBeschreibung(g.ausgabe)}`);
    });
    return z.join('\n');
  }

  async function kopiereFeedback(bereich) {
    const textInhalt = feedbackText();
    try {
      await navigator.clipboard.writeText(textInhalt);
      toast('Feedback kopiert. Füge es bei Claude Code ein.');
    } catch {
      // Ohne Zwischenablage: Text zum selbst Kopieren anzeigen.
      const feld = el('textarea', { class: 'feedback-text', readonly: true, rows: 10, 'aria-label': 'Feedback-Text' });
      feld.value = textInhalt;
      const alt = $('.feedback-text', bereich);
      if (alt) alt.replaceWith(feld); else bereich.append(feld);
      feld.focus();
      feld.select();
      toast('Kopieren ging nicht automatisch. Markiere den Text und kopiere ihn selbst.');
    }
  }

  function feedbackBereich() {
    const unnoetig = Object.values(zustand.feedback.unnoetig).filter(istObjekt);
    const gefehlt = zustand.feedback.gefehlt;
    const bereich = el('section', { class: 'feedback', id: 'feedback' }, el('h2', { class: 'ansicht-titel', text: 'Feedback' }));
    const leer = !unnoetig.length && !gefehlt.length;
    bereich.append(el('p', {
      class: 'klein',
      text: leer
        ? 'Noch kein Feedback. Markiere Meldungen mit „Unnötig“ oder notiere am Ende einer Ausgabe, was gefehlt hat.'
        : `Gesammelt: ${unnoetig.length} × „Unnötig“, ${gefehlt.length} × „Hat gefehlt“. „Feedback kopieren“ erzeugt einen Text, mit dem Claude Code config/regeln.md nachschärft.`,
    }));
    bereich.append(el('div', { class: 'knopfreihe' },
      el('button', { type: 'button', class: 'knopf knopf--primaer', disabled: leer, onclick: () => kopiereFeedback(bereich) }, 'Feedback kopieren'),
      el('button', {
        type: 'button',
        class: 'knopf',
        disabled: leer,
        onclick: () => {
          if (!window.confirm('Das gesammelte Feedback löschen?')) return;
          zustand.feedback = { unnoetig: {}, gefehlt: [] };
          if (speichereFeedback()) {
            document.querySelectorAll('.knopf--unnoetig').forEach((k) => setzeUnnoetigKnopf(k, false));
            feedbackGeaendert();
            toast('Feedback gelöscht.');
          }
        },
      }, 'Feedback löschen')));
    if (!leer) {
      const punkte = [
        ...unnoetig.map((u) => ({ text: `Unnötig: ${str(u.titel)}`, weg: () => { delete zustand.feedback.unnoetig[u.id]; } , id: u.id })),
        ...gefehlt.map((g) => ({ text: `Hat gefehlt: ${str(g.text)}`, weg: () => { zustand.feedback.gefehlt = zustand.feedback.gefehlt.filter((x) => x !== g); } })),
      ];
      bereich.append(el('details', { class: 'feedback-details' },
        el('summary', null, 'Gesammeltes Feedback ansehen'),
        el('ul', { class: 'gefehlt-liste' }, punkte.map((p) => el('li', null,
          el('span', { text: p.text }),
          el('button', {
            type: 'button',
            class: 'knopf knopf--klein',
            onclick: () => {
              p.weg();
              if (!speichereFeedback()) return;
              if (p.id) {
                document.querySelectorAll('.knopf--unnoetig').forEach((k) => {
                  if (k.dataset.unnoetig === p.id) setzeUnnoetigKnopf(k, false);
                });
              }
              feedbackGeaendert();
              const neu = $('#feedback .feedback-details');
              if (neu) neu.open = true;
            },
          }, 'Entfernen'))))));
    }
    return bereich;
  }

  // ------------------------------------------------------------ Vorlesen: Satzliste

  function kannVorlesen() {
    return 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
  }

  // Nach diesen Abkürzungen (klein, ohne Punkt) endet kein Satz.
  const ABKUERZUNGEN = new Set([
    'abb', 'abg', 'abs', 'allg', 'anm', 'apr', 'art', 'aug', 'bd', 'bgm', 'bsp', 'bspw', 'bzgl', 'bzw',
    'ca', 'chr', 'co', 'corp', 'dez', 'dipl', 'dkfm', 'dr', 'ehem', 'engl', 'etc', 'evtl', 'exkl', 'feb',
    'ff', 'fr', 'geb', 'gem', 'gest', 'ggf', 'hl', 'hr', 'hrsg', 'inc', 'ing', 'inkl', 'insb', 'jan',
    'jh', 'jhd', 'jr', 'jul', 'jun', 'kap', 'lt', 'ltd', 'mag', 'max', 'min', 'mind', 'mio', 'mr', 'mrd',
    'mrs', 'ms', 'mär', 'no', 'nov', 'nr', 'okt', 'pkt', 'präs', 'prof', 'rd', 'sen', 'sep', 'sept', 'sog',
    'sr', 'st', 'std', 'str', 'tel', 'tsd', 'univ', 'usw', 'vgl', 'vs', 'wr', 'zit', 'zzgl',
  ]);
  // Mögliches Satzende: Satzzeichen (auch vor schließenden Anführungszeichen), dann Leerzeichen
  // und ein Großbuchstabe, eine Ziffer oder ein öffnendes Anführungszeichen.
  const SATZ_ENDE = /[.!?…]+["'“”»«’)\]]*(?= +["'„“‚»«(\[]?[\p{Lu}\d])/gu;

  function keineSatzgrenze(davor, zeichen) {
    if (zeichen !== '.') return false; // „!“, „?“ und „…“ beenden den Satz immer
    const wort = (/(\S+)$/.exec(davor) || ['', ''])[1].replace(/^[^\p{L}\d]+/u, '');
    if (!wort) return false;
    if (/^\d{1,3}$/.test(wort)) return true; // Ordnungszahl: „17. Dezember“, „2. Lesung“
    if (/^\p{L}$/u.test(wort)) return true; // „z. B.“, „u. a.“, Initialen wie „J. Muster“
    if (/^[\p{L}\d]{1,4}(\.[\p{L}\d]{1,4})+$/u.test(wort)) return true; // „z.B.“, „1.1.“
    return ABKUERZUNGEN.has(wort.toLowerCase());
  }

  function teileSaetze(text) {
    const t = str(text).replace(/\s+/g, ' ').trim();
    if (!t) return [];
    const saetze = [];
    let anfang = 0;
    for (const m of t.matchAll(SATZ_ENDE)) {
      const zeichen = m[0].replace(/["'“”»«’)\]]+$/u, '');
      if (keineSatzgrenze(t.slice(anfang, m.index), zeichen)) continue;
      const ende = m.index + m[0].length;
      saetze.push(t.slice(anfang, ende).trim());
      anfang = ende;
    }
    saetze.push(t.slice(anfang).trim());
    return saetze.filter(Boolean);
  }

  function zahlwort(n) {
    return { 2: 'zwei', 3: 'drei', 4: 'vier', 5: 'fünf' }[n] || String(n);
  }

  function abschnittSaetze(a) {
    const typ = str(a.typ);
    const ergebnis = [];
    const mitVorne = (text, vorne) => teileSaetze(text).map((t, i) => (i === 0 && vorne ? `${vorne}: ${t}` : t));
    for (const e of liste(a.eintraege).filter(istObjekt)) {
      if (typ === 'finanzierungsrunden') {
        // Ein kurzer Satz pro Runde: Name, Betrag, Land.
        if (str(e.name).trim()) ergebnis.push([e.name, e.betrag, e.land].map((x) => str(x).trim()).filter(Boolean).join(', '));
      } else if (typ === 'monatsueberblick') {
        ergebnis.push(...mitVorne(e.text, monatName(e.monat)));
      } else if (typ === 'ausblick') {
        ergebnis.push(...mitVorne(e.text, datumLang(e.datum)));
      } else {
        const name = str(e.name || e.titel).trim();
        if (name) ergebnis.push(name);
        ergebnis.push(...teileSaetze(e.text));
      }
    }
    return ergebnis;
  }

  /*
   * Satzliste einer Ausgabe, immer mit allen Themen (unabhängig vom Filter), damit die gemerkte
   * Satznummer stimmt. Gebaut aus gruppiere() wie die Anzeige: Themenname, pro Meldung Titel, Text
   * und „Warum wichtig“, dann ein Satz zu Videos und die Abschnitte. Verweise werden nicht gelesen.
   * themen[]: { id, start, ende } je Überthema mit Inhalt (im Jahresrückblick die Kapitel).
   */
  function vorleseplan(ausgabe, namen) {
    const saetze = [];
    const themen = [];
    const satz = (text, thema, art) => ({ text, thema, art });
    if (ausgabe.status === 'fehler') {
      const fehler = teileSaetze(ausgabe.fehler);
      for (const t of fehler.length ? fehler : ['Bei dieser Ausgabe ist etwas schiefgegangen.']) saetze.push(satz(t, null, 'fehler'));
    }
    for (const g of gruppiere(ausgabe)) {
      const teil = [];
      const dazu = (text, art, vorne = '') => {
        teileSaetze(text).forEach((t, i) => teil.push(satz(i === 0 ? vorne + t : t, g.id, art)));
      };
      for (const m of g.meldungen) {
        dazu(m.titel, 'titel');
        dazu(m.text, 'text');
        dazu(m.warum_wichtig, 'warum', 'Warum wichtig: ');
      }
      if (g.videos.length) {
        const n = g.videos.length;
        teil.push(satz(n === 1 ? 'Dazu gibt es eine Video-Empfehlung.' : `Dazu gibt es ${zahlwort(n)} Video-Empfehlungen.`, g.id, 'video'));
      }
      for (const a of g.abschnitte) {
        const eintraege = abschnittSaetze(a);
        if (!eintraege.length) continue;
        teil.push(satz(str(a.titel) || ABSCHNITT_TITEL[str(a.typ)] || 'Weitere Einträge', g.id, 'abschnitt'));
        eintraege.forEach((t) => teil.push(satz(t, g.id, 'abschnitt')));
      }
      if (!teil.length) continue; // nur Verweise
      themen.push({ id: g.id, start: saetze.length, ende: saetze.length + 1 + teil.length });
      saetze.push(satz(themaName(g.id, namen), g.id, 'thema'), ...teil);
    }
    const [ruhigLabel, nichtsLabel] = RUHIG_TEXT[ausgabe.format] || ['Ruhig', 'Nichts Wichtiges'];
    if (ausgabe.status === 'ruhig') {
      saetze.push(satz(nichtsLabel, null, 'ruhig'));
    } else {
      const ruhige = liste(ausgabe.ruhig).filter((id) => typeof id === 'string');
      if (ruhige.length) saetze.push(satz(`${ruhigLabel}: ${ruhige.map((id) => themaName(id, namen)).join(', ')}`, null, 'ruhig'));
    }
    return { saetze, themen };
  }

  function vorleseBereich(plan, thema) {
    if (!thema) return { start: 0, ende: plan.saetze.length };
    return plan.themen.find((t) => t.id === thema) || null;
  }

  // ------------------------------------------------------------ Vorlesen: Zustand und Speicher

  const vorlesen = {
    status: 'aus', // aus | liest | pausiert | unterbrochen | fertig
    plan: null,
    datei: '',
    erschienen: '',
    titel: '',
    format: '',
    namen: null,
    thema: null, // null = ganze Ausgabe, sonst nur dieses Überthema
    start: 0,
    ende: 0,
    i: 0, // aktueller Satz (Index in plan.saetze)
    nr: 0, // zählt jeden Start und Abbruch; Meldungen alter Äußerungen werden daran erkannt
    aeusserung: null, // laufende Äußerung festhalten, sonst verliert Chrome manchmal onend
    sperre: null,
    sperreAnfrage: false,
    sperreFehler: false,
    hinweis: '',
    ort: null, // Knopfgruppe, von der aus gestartet wurde (Fokus beim Schließen)
    ansicht: null,
    farben: null,
    einstellungen: { stimme: null, tempo: 1 },
  };
  const vorleseOrte = new WeakMap(); // .vorlese-knoepfe -> { ausgabe, meta, namen, plan, thema }

  function ladeEinstellungen() {
    try {
      const e = JSON.parse(localStorage.getItem(VORLESE_SCHLUESSEL));
      if (istObjekt(e)) {
        return { stimme: typeof e.stimme === 'string' ? e.stimme : null, tempo: TEMPI.includes(e.tempo) ? e.tempo : 1 };
      }
    } catch { /* Standard */ }
    return { stimme: null, tempo: 1 };
  }

  function speichereEinstellungen() {
    try {
      localStorage.setItem(VORLESE_SCHLUESSEL, JSON.stringify(vorlesen.einstellungen));
    } catch { /* gilt dann nur bis zum Neuladen */ }
  }

  // Gemerkt wird nur das Vorlesen der ganzen Ausgabe; ein einzelnes Thema überschreibt die Position nicht.
  function merkePosition() {
    const v = vorlesen;
    if (v.thema || !v.plan || v.i >= v.ende) return;
    try {
      localStorage.setItem(POSITION_SCHLUESSEL, JSON.stringify({
        datei: v.datei, erschienen: v.erschienen, gesamt: v.plan.saetze.length, satz: v.i, zeit: new Date().toISOString(),
      }));
    } catch { /* ohne Speicher kein „Weiter ab Satz …“ */ }
  }

  function loeschePosition() {
    if (vorlesen.thema) return;
    try {
      localStorage.removeItem(POSITION_SCHLUESSEL);
    } catch { /* egal */ }
  }

  // Die gemerkte Position passt nur, wenn Ausgabe, Erscheinungszeit und Satzzahl gleich sind.
  function gemerktePosition(info) {
    if (info.thema) return null;
    let p = null;
    try {
      p = JSON.parse(localStorage.getItem(POSITION_SCHLUESSEL));
    } catch { /* keine */ }
    if (!istObjekt(p) || p.datei !== str(info.meta.datei) || p.erschienen !== str(info.ausgabe.erschienen)) return null;
    if (p.gesamt !== info.plan.saetze.length || !Number.isInteger(p.satz)) return null;
    return p.satz > 0 && p.satz < p.gesamt ? p : null;
  }

  // ------------------------------------------------------------ Vorlesen: Stimmen

  function stimmenId(s) {
    return s ? str(s.voiceURI) || str(s.name) : '';
  }

  function stimmenName(s) {
    const name = str(s.name) || 'Stimme';
    const sprache = str(s.lang).replace('_', '-');
    return sprache && !name.includes(sprache) ? `${name} (${sprache})` : name;
  }

  // Nur deutsche Stimmen; österreichische vor deutschen, Stimmen auf dem Gerät vor Online-Stimmen.
  function deutscheStimmen() {
    const rang = (s) => ({ 'de-at': 0, 'de-de': 1 }[str(s.lang).replace('_', '-').toLowerCase()] ?? 2);
    return liste(window.speechSynthesis.getVoices())
      .filter((s) => s && /^de(?:[-_]|$)/i.test(str(s.lang)))
      .sort((a, b) => rang(a) - rang(b) || Number(b.localService === true) - Number(a.localService === true));
  }

  function gewaehlteStimme() {
    const alle = deutscheStimmen();
    return alle.find((s) => stimmenId(s) === vorlesen.einstellungen.stimme) || alle[0] || null;
  }

  // Die Stimmen kommen oft erst nach dem Start (voiceschanged); dann wird die Auswahl neu gefüllt.
  function zeichneStimmen() {
    const a = vorlesen.ansicht;
    if (!a) return;
    const deutsche = deutscheStimmen();
    if (deutsche.length) {
      a.stimme.replaceChildren(...deutsche.map((s) => el('option', { value: stimmenId(s) }, stimmenName(s))));
      a.stimme.value = stimmenId(gewaehlteStimme());
      a.stimme.disabled = false;
    } else {
      a.stimme.replaceChildren(el('option', { value: '' }, 'Standardstimme des Geräts'));
      a.stimme.disabled = true;
    }
    const keineDeutsche = !deutsche.length && liste(window.speechSynthesis.getVoices()).length > 0;
    a.stimmeHinweis.textContent = keineDeutsche
      ? 'Auf diesem Gerät ist keine deutsche Stimme installiert. Du findest sie in den Einstellungen des Handys unter „Sprachausgabe“.'
      : '';
    a.stimmeHinweis.hidden = !keineDeutsche;
  }

  // ------------------------------------------------------------ Vorlesen: Sprechen

  function stoppeSprache() {
    vorlesen.aeusserung = null;
    try {
      window.speechSynthesis.cancel();
    } catch { /* egal */ }
  }

  // Spricht den aktuellen Satz von vorn. Pause ist cancel() und später ein Neustart hier,
  // weil pause() und resume() auf Android unzuverlässig sind.
  function sprich() {
    const v = vorlesen;
    const nr = ++v.nr;
    const satz = v.plan.saetze[v.i];
    merkePosition();
    pruefeSperre();
    zeichneVorlesen();

    const synth = window.speechSynthesis;
    const u = new window.SpeechSynthesisUtterance(satz.text);
    const stimme = gewaehlteStimme();
    if (stimme) u.voice = stimme;
    u.lang = stimme ? str(stimme.lang).replace('_', '-') : 'de-DE';
    u.rate = v.einstellungen.tempo;
    u.onend = () => {
      if (nr === v.nr && v.status === 'liest') naechsterSatz();
    };
    u.onerror = (e) => {
      if (nr !== v.nr || v.status !== 'liest') return;
      const art = str(e && e.error);
      // Eigene Abbrüche erhöhen vorher nr; ein Abbruch hier kam von außen (etwa Anruf, andere App).
      if (art === 'interrupted' || art === 'canceled') {
        pausiere('unterbrochen');
        return;
      }
      v.hinweis = art === 'not-allowed'
        ? 'Tippe auf „Weiter“, um das Vorlesen zu starten.'
        : `Vorlesen ging nicht (${art || 'unbekannter Fehler'}). Tippe auf „Weiter“, um es noch einmal zu versuchen.`;
      pausiere('pausiert');
    };
    v.aeusserung = u;
    const los = () => {
      if (nr !== v.nr) return;
      try {
        if (synth.paused) synth.resume();
        synth.speak(u);
      } catch (fehler) {
        v.hinweis = `Vorlesen ging nicht (${str(fehler && fehler.message) || 'unbekannter Fehler'}).`;
        pausiere('pausiert');
      }
    };
    if (synth.speaking || synth.pending) {
      synth.cancel();
      setTimeout(los, NACH_ABBRUCH_MS);
    } else {
      los();
    }
  }

  function lies() {
    vorlesen.status = 'liest';
    vorlesen.hinweis = '';
    sprich();
  }

  function naechsterSatz() {
    if (vorlesen.i + 1 < vorlesen.ende) {
      vorlesen.i += 1;
      sprich();
    } else {
      beendeVorlesen();
    }
  }

  function pausiere(status) {
    const v = vorlesen;
    v.nr += 1;
    v.status = status;
    stoppeSprache();
    merkePosition();
    pruefeSperre();
    zeichneVorlesen();
  }

  function beendeVorlesen() {
    const v = vorlesen;
    v.nr += 1;
    v.status = 'fertig';
    v.i = v.ende;
    stoppeSprache();
    loeschePosition();
    pruefeSperre();
    zeichneVorlesen();
  }

  // Beim Lesen sofort den neuen Satz sprechen, sonst nur hinspringen.
  function springe(ziel) {
    const v = vorlesen;
    if (v.status === 'aus') return;
    if (ziel >= v.ende) {
      beendeVorlesen();
      return;
    }
    v.i = Math.max(v.start, ziel);
    v.hinweis = '';
    if (v.status === 'liest') {
      sprich();
    } else {
      v.status = 'pausiert';
      merkePosition();
      pruefeSperre();
      zeichneVorlesen();
    }
  }

  function naechstesThema() {
    const v = vorlesen;
    return v.plan.themen.find((t) => t.start > v.i && t.start < v.ende) || null;
  }

  function hauptAktion() {
    const v = vorlesen;
    if (v.status === 'liest') {
      pausiere('pausiert');
    } else {
      if (v.status === 'fertig') v.i = v.start;
      lies(); // nach Pause oder Unterbrechung: der aktuelle Satz von vorn
    }
  }

  // ------------------------------------------------------------ Vorlesen: Bildschirm wach halten

  function sollWachBleiben() {
    const s = vorlesen.status;
    return (s === 'liest' || s === 'unterbrochen') && document.visibilityState === 'visible';
  }

  // Beim Lesen anfordern, bei Pause und Ende freigeben. Beim Verstecken gibt der Browser die
  // Sperre selbst frei; kommt die App zurück, wird sie neu angefordert.
  function pruefeSperre() {
    if (sollWachBleiben()) halteWach();
    else gibBildschirmFrei();
  }

  async function halteWach() {
    const v = vorlesen;
    if (v.sperre || v.sperreAnfrage) return;
    if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') {
      v.sperreFehler = true;
      zeichneVorlesen();
      return;
    }
    v.sperreAnfrage = true;
    try {
      const sperre = await navigator.wakeLock.request('screen');
      v.sperreAnfrage = false;
      if (!sollWachBleiben()) {
        sperre.release().catch(() => {});
        return;
      }
      v.sperre = sperre;
      v.sperreFehler = false;
      sperre.addEventListener('release', () => {
        if (v.sperre === sperre) v.sperre = null;
      });
    } catch (fehler) {
      v.sperreAnfrage = false;
      v.sperreFehler = true;
      console.warn('Bildschirm kann nicht wach gehalten werden:', fehler);
    }
    zeichneVorlesen();
  }

  function gibBildschirmFrei() {
    const sperre = vorlesen.sperre;
    vorlesen.sperre = null;
    if (sperre && !sperre.released) sperre.release().catch(() => {});
  }

  // ------------------------------------------------------------ Vorlesen: Ansicht

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const LINIE = { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' };
  const SYMBOL = {
    lautsprecher: [{ d: 'M3 9.5v5h4l5 4.5v-14L7 9.5z', fill: 'currentColor' }, { d: 'M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11', ...LINIE }],
    zurueck: [{ d: 'M6 5h2.5v14H6zM19 5.5v13L9.5 12z', fill: 'currentColor' }],
    vor: [{ d: 'M15.5 5H18v14h-2.5zM5 5.5v13l9.5-6.5z', fill: 'currentColor' }],
    pause: [{ d: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z', fill: 'currentColor' }],
    start: [{ d: 'M8 5.5v13l10.5-6.5z', fill: 'currentColor' }],
    schliessen: [{ d: 'M6 6l12 12M18 6L6 18', ...LINIE, 'stroke-width': '2.2' }],
    weiter: [{ d: 'M9 6l6 6-6 6', ...LINIE }],
  };

  function symbol(pfade) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    for (const p of pfade) {
      const pfad = document.createElementNS(SVG_NS, 'path');
      for (const [k, wert] of Object.entries(p)) pfad.setAttribute(k, wert);
      svg.append(pfad);
    }
    return svg;
  }

  function tempoText(t) {
    return t === 1 ? '1× (normal)' : `${String(t).replace('.', ',')}×`;
  }

  function baueVorleseAnsicht() {
    const a = {};
    a.titel = el('p', { class: 'vl-ausgabe', id: 'vl-titel' });
    a.themaName = el('span', { class: 'vl-thema-name' });
    a.kapitel = el('span', { class: 'vl-kapitel' });
    a.thema = el('p', { class: 'vl-thema' }, a.themaName, a.kapitel);
    a.satz = el('p', { class: 'vl-satz' });
    a.fuellung = el('div', { class: 'vl-fuellung' });
    a.balken = el('div', { class: 'vl-balken', role: 'progressbar', 'aria-label': 'Fortschritt', 'aria-valuemin': '1' }, a.fuellung);
    a.zaehler = el('p', { class: 'vl-zaehler' });
    a.hinweis = el('p', { class: 'vl-hinweis', hidden: true });
    a.zurueck = el('button', { type: 'button', class: 'vl-rund vl-zurueck', 'aria-label': 'Satz zurück', title: 'Satz zurück', onclick: () => springe(vorlesen.i - 1) }, symbol(SYMBOL.zurueck));
    a.haupt = el('button', { type: 'button', class: 'vl-haupt', onclick: hauptAktion });
    a.vor = el('button', { type: 'button', class: 'vl-rund vl-vor', 'aria-label': 'Satz vor', title: 'Satz vor', onclick: () => springe(vorlesen.i + 1) }, symbol(SYMBOL.vor));
    a.naechstesName = el('span', { class: 'vl-naechstes-name' });
    a.naechstes = el('button', {
      type: 'button',
      class: 'vl-naechstes',
      onclick: () => {
        const t = naechstesThema();
        if (t) springe(t.start);
      },
    }, el('span', { class: 'vl-naechstes-label', text: 'Nächstes Thema' }), a.naechstesName, symbol(SYMBOL.weiter));
    a.stimme = el('select', {
      id: 'vl-stimme',
      onchange: () => {
        vorlesen.einstellungen.stimme = a.stimme.value || null;
        speichereEinstellungen();
        if (vorlesen.status === 'liest') sprich();
      },
    });
    a.stimmeHinweis = el('p', { class: 'vl-stimme-hinweis', hidden: true });
    a.tempo = el('select', {
      id: 'vl-tempo',
      onchange: () => {
        const t = Number(a.tempo.value);
        if (!TEMPI.includes(t)) return;
        vorlesen.einstellungen.tempo = t;
        speichereEinstellungen();
        if (vorlesen.status === 'liest') sprich();
      },
    }, TEMPI.map((t) => el('option', { value: String(t) }, tempoText(t))));
    a.wurzel = el('div', { id: 'vorlesen', class: 'vorlesen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'vl-titel', hidden: true },
      el('div', { class: 'vl-innen' },
        el('header', { class: 'vl-kopf' },
          el('div', { class: 'vl-kopf-text' }, a.titel, a.thema),
          el('button', { type: 'button', class: 'vl-rund vl-schliessen', 'aria-label': 'Vorlesen schließen', title: 'Schließen', onclick: () => schliesseVorlesen() }, symbol(SYMBOL.schliessen))),
        el('div', { class: 'vl-satz-box' }, a.satz),
        el('div', { class: 'vl-fortschritt' }, a.balken, a.zaehler),
        a.hinweis,
        el('div', { class: 'vl-steuerung' }, a.zurueck, a.haupt, a.vor),
        a.naechstes,
        el('details', { class: 'vl-einstellungen' },
          el('summary', null, 'Stimme und Tempo'),
          el('label', { class: 'vl-feld' }, el('span', { text: 'Stimme' }), a.stimme),
          a.stimmeHinweis,
          el('label', { class: 'vl-feld' }, el('span', { text: 'Tempo' }), a.tempo))));
    a.wurzel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') schliesseVorlesen();
    });
    document.body.append(a.wurzel);
    return a;
  }

  function zeichneVorlesen() {
    const v = vorlesen;
    const a = v.ansicht;
    if (!a || v.status === 'aus') return;
    const fertig = v.status === 'fertig';
    const n = v.ende - v.start;
    const satz = fertig ? null : v.plan.saetze[v.i];
    const nummer = fertig ? n : v.i - v.start + 1;

    a.wurzel.dataset.zustand = v.status;
    a.titel.textContent = v.titel;
    const thema = satz && satz.thema;
    a.thema.dataset.farbe = thema ? farbe(thema) : 'x';
    a.themaName.textContent = thema ? themaName(thema, v.namen) : satz && satz.art === 'fehler' ? 'Hinweis' : '';
    // Jahresrückblick kapitelweise: jedes Überthema ist ein Kapitel.
    const kapitel = v.format === 'jaehrlich' && !v.thema && thema ? v.plan.themen.findIndex((t) => t.id === thema) : -1;
    a.kapitel.textContent = kapitel >= 0 ? `Kapitel ${kapitel + 1} von ${v.plan.themen.length}` : '';
    a.thema.hidden = !a.themaName.textContent;

    a.satz.textContent = satz ? satz.text : v.thema ? 'Thema fertig vorgelesen.' : 'Ausgabe fertig vorgelesen.';
    a.satz.classList.toggle('vl-satz--ende', fertig);
    a.fuellung.style.width = `${n ? (nummer / n) * 100 : 0}%`;
    a.balken.setAttribute('aria-valuemax', String(n));
    a.balken.setAttribute('aria-valuenow', String(nummer));
    a.balken.setAttribute('aria-valuetext', `Satz ${nummer} von ${n}`);
    a.zaehler.textContent = `Satz ${nummer} von ${n}`;

    const [sym, text] = {
      liest: ['pause', 'Pause'],
      pausiert: ['start', 'Weiter'],
      unterbrochen: ['start', `Weiter ab Satz ${nummer}`],
      fertig: ['start', 'Von vorn'],
    }[v.status];
    a.haupt.replaceChildren(symbol(SYMBOL[sym]), el('span', { text }));
    a.zurueck.disabled = !fertig && v.i <= v.start;
    a.vor.disabled = fertig;
    const naechstes = fertig ? null : naechstesThema();
    a.naechstes.disabled = !naechstes;
    a.naechstesName.textContent = naechstes ? themaName(naechstes.id, v.namen) : '';

    const hinweis = v.hinweis
      || (v.status === 'unterbrochen' ? 'Das Vorlesen wurde unterbrochen.' : '')
      || (v.sperreFehler && v.status === 'liest' ? 'Der Bildschirm kann nicht wach gehalten werden. Lass ihn selbst an, sonst stoppt das Vorlesen.' : '');
    a.hinweis.textContent = hinweis;
    a.hinweis.hidden = !hinweis;
  }

  function hintergrund() {
    return [$('.app-kopf'), $('#inhalt'), $('.tabs')].filter(Boolean);
  }

  function oeffneVorleseAnsicht() {
    const a = vorlesen.ansicht || (vorlesen.ansicht = baueVorleseAnsicht());
    zeichneStimmen();
    a.tempo.value = String(vorlesen.einstellungen.tempo);
    if (!a.wurzel.hidden) return;
    a.wurzel.hidden = false;
    document.body.classList.add('vorlesen-offen');
    for (const e of hintergrund()) e.inert = true;
    vorlesen.farben = [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => [m, m.content]);
    vorlesen.farben.forEach(([m]) => { m.content = '#0c0e11'; });
    // Eigener Verlaufseintrag: Die Zurück-Taste am Handy schließt die Vorlese-Ansicht.
    if (!(history.state && history.state.vorlesen)) history.pushState({ vorlesen: true }, '');
    a.haupt.focus({ preventScroll: true });
  }

  function starteVorlesen(info, ab) {
    if (!kannVorlesen()) {
      toast('Dieser Browser kann nicht vorlesen.');
      return;
    }
    const bereich = vorleseBereich(info.plan, info.thema);
    if (!bereich || bereich.ende <= bereich.start) return;
    schliesseVideo();
    const v = vorlesen;
    if (v.status !== 'aus') {
      v.nr += 1;
      stoppeSprache();
    }
    Object.assign(v, {
      plan: info.plan,
      datei: str(info.meta.datei),
      erschienen: str(info.ausgabe.erschienen),
      titel: str(info.ausgabe.titel || info.meta.titel) || 'Ausgabe',
      format: str(info.ausgabe.format || info.meta.format),
      namen: info.namen || null,
      thema: info.thema || null,
      start: bereich.start,
      ende: bereich.ende,
      i: Math.max(bereich.start, Math.min(Number.isInteger(ab) ? ab : bereich.start, bereich.ende - 1)),
      ort: info.box || null,
    });
    oeffneVorleseAnsicht();
    lies();
  }

  function schliesseVorlesen({ ausVerlauf = false } = {}) {
    const v = vorlesen;
    if (v.status === 'aus') return;
    v.nr += 1;
    stoppeSprache();
    if (v.status !== 'fertig') merkePosition();
    v.status = 'aus';
    pruefeSperre();
    const a = v.ansicht;
    a.wurzel.hidden = true;
    document.body.classList.remove('vorlesen-offen');
    for (const e of hintergrund()) e.inert = false;
    (v.farben || []).forEach(([m, farbwert]) => { m.content = farbwert; });
    if (!ausVerlauf && history.state && history.state.vorlesen) history.back();
    aktualisiereVorleseKnoepfe();
    const knopf = v.ort && v.ort.isConnected ? v.ort.querySelector('button') : null;
    if (knopf) knopf.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ Vorlesen: Knöpfe im Feed

  function vorleseKnoepfe(info) {
    const box = el('span', { class: 'vorlese-knoepfe' });
    vorleseOrte.set(box, info);
    fuelleVorleseKnoepfe(box);
    return box;
  }

  function fuelleVorleseKnoepfe(box) {
    const info = vorleseOrte.get(box);
    const bereich = vorleseBereich(info.plan, info.thema);
    const knoepfe = [el('button', {
      type: 'button',
      class: `knopf knopf--vorlesen ${info.thema ? 'knopf--klein' : 'knopf--primaer'}`,
      'aria-label': info.thema ? `${themaName(info.thema, info.namen)} vorlesen` : 'Ausgabe vorlesen',
      onclick: () => starteVorlesen({ ...info, box }, bereich.start),
    }, symbol(SYMBOL.lautsprecher), 'Vorlesen')];
    const p = gemerktePosition(info);
    if (p) {
      knoepfe.push(el('button', {
        type: 'button',
        class: 'knopf knopf--weiter',
        onclick: () => starteVorlesen({ ...info, box }, p.satz),
      }, `Weiter ab Satz ${p.satz + 1}`));
    }
    box.replaceChildren(...knoepfe);
  }

  function aktualisiereVorleseKnoepfe() {
    document.querySelectorAll('.vorlese-knoepfe').forEach((box) => {
      if (vorleseOrte.has(box)) fuelleVorleseKnoepfe(box);
    });
  }

  function richteVorlesenEin() {
    if (!kannVorlesen()) return;
    vorlesen.einstellungen = ladeEinstellungen();
    window.speechSynthesis.addEventListener('voiceschanged', zeichneStimmen);
    window.speechSynthesis.getVoices(); // stößt in Chrome das Laden der Stimmen an
    if (history.state && history.state.vorlesen) history.replaceState(null, '');
    window.addEventListener('popstate', () => {
      if (vorlesen.status !== 'aus') schliesseVorlesen({ ausVerlauf: true });
    });
    // Bildschirm aus oder App gewechselt: anhalten und die Stelle merken. Bei der Rückkehr
    // den Bildschirm wieder wach halten und „Weiter ab Satz …“ anbieten.
    document.addEventListener('visibilitychange', () => {
      if (vorlesen.status === 'aus') return;
      if (document.visibilityState !== 'visible' && vorlesen.status === 'liest') pausiere('unterbrochen');
      else pruefeSperre();
      zeichneVorlesen();
    });
    window.addEventListener('pagehide', () => {
      if (vorlesen.status === 'liest') pausiere('unterbrochen');
    });
  }

  // ------------------------------------------------------------ Chips, Tabs, Toast

  function zeigeChips() {
    const box = $('#chips');
    const chips = [el('button', {
      type: 'button',
      class: 'chip',
      'aria-pressed': String(zustand.filter.size === 0),
      onclick: () => setzeFilter(null),
    }, 'Alle')];
    for (const t of zustand.themen) {
      chips.push(el('button', {
        type: 'button',
        class: 'chip',
        title: t.name,
        dataset: { farbe: farbe(t.id), thema: t.id },
        'aria-pressed': String(zustand.filter.has(t.id)),
        onclick: () => setzeFilter(t.id),
      }, KURZNAMEN[t.id] || t.name));
    }
    box.replaceChildren(...chips);
  }

  async function setzeFilter(id) {
    if (id === null) zustand.filter.clear();
    else if (zustand.filter.has(id)) zustand.filter.delete(id);
    else zustand.filter.add(id);
    if (zustand.themen.length && zustand.filter.size >= zustand.themen.length) zustand.filter.clear();
    zeigeChips();
    if (await zeigeAnsicht()) window.scrollTo(0, 0);
  }

  function tabAusHash() {
    const h = location.hash.slice(1);
    return TABS.some((t) => t.id === h) ? h : null;
  }

  function markiereTabs() {
    document.querySelectorAll('.tabs a').forEach((a) => {
      if (a.dataset.tab === zustand.tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  async function wechsleTab(tab) {
    if (!tab || tab === zustand.tab) return;
    zustand.scroll[zustand.tab] = window.scrollY;
    zustand.tab = tab;
    markiereTabs();
    if (await zeigeAnsicht({ ladeAnzeige: true })) window.scrollTo(0, zustand.scroll[tab] || 0);
  }

  let toastUhr = 0;
  function toast(nachricht, aktion) {
    const box = $('#toast');
    box.replaceChildren(el('span', { text: nachricht }));
    if (aktion) {
      box.append(el('button', {
        type: 'button',
        class: 'toast-aktion',
        onclick: () => {
          box.hidden = true;
          Promise.resolve(aktion.los()).catch((fehler) => toast(`Fehlgeschlagen: ${str(fehler && fehler.message)}`));
        },
      }, aktion.text));
    }
    box.hidden = false;
    clearTimeout(toastUhr);
    toastUhr = setTimeout(() => { box.hidden = true; }, aktion ? 6000 : 2800);
  }

  // ------------------------------------------------------------ Offline (Service Worker)

  function richteOfflineEin() {
    window.addEventListener('online', () => {
      if (zustand.offline || zustand.ladefehler) aktualisiere();
    });
    if (!('serviceWorker' in navigator)) return;
    const sw = navigator.serviceWorker;
    // Beim ersten Besuch kommen die Daten noch ohne Service Worker. Sobald er übernimmt, einmal
    // durch ihn laden, damit index.json und die gezeigten Ausgaben auch offline da sind.
    if (!sw.controller) sw.addEventListener('controllerchange', fuerOfflineMerken, { once: true });
    const anmelden = () => sw.register('sw.js', { scope: './', updateViaCache: 'none' })
      .catch((fehler) => console.warn('Service Worker nicht angemeldet:', fehler));
    if (document.readyState === 'complete') anmelden();
    else window.addEventListener('load', anmelden, { once: true });
  }

  function fuerOfflineMerken() {
    const dateien = ['data/index.json', ...zustand.cache.keys()];
    return Promise.all(dateien.map((datei) => fetch(DATEN_BASIS + datei, { cache: 'no-cache' }).catch(() => null)));
  }

  // ------------------------------------------------------------ Start

  async function start() {
    const kopf = $('.app-kopf');
    const setzeKopfHoehe = () => document.documentElement.style.setProperty('--kopf-h', `${kopf.offsetHeight}px`);
    if ('ResizeObserver' in window) new ResizeObserver(setzeKopfHoehe).observe(kopf);
    setzeKopfHoehe();

    zustand.tab = tabAusHash() || 'heute';
    markiereTabs();
    window.addEventListener('hashchange', () => wechsleTab(tabAusHash()));
    document.querySelectorAll('.tabs a').forEach((link) => link.addEventListener('click', (ereignis) => {
      if (link.dataset.tab !== zustand.tab) return;
      ereignis.preventDefault(); // Tippen auf den aktiven Tab: nach oben
      window.scrollTo({ top: 0, behavior: bewegungReduziert() ? 'auto' : 'smooth' });
    }));
    $('#neu-laden').addEventListener('click', () => aktualisiere({ manuell: true }));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (zustand.offline || Date.now() - zustand.geladen > AUTO_NEU_LADEN_MS) aktualisiere();
      else if (zustand.tab !== 'merkliste' && zeitStempel() !== zustand.zeitstempel) zeigeAnsicht({ scrollBehalten: true });
    });

    zustand.feedback = ladeFeedback();
    richteVorlesenEin();
    richteOfflineEin();
    await Promise.all([ladeThemen(), ladeMerkliste()]);
    zeigeChips();
    await aktualisiere();
    if (!zustand.renderNr) await zeigeAnsicht();
  }

  start();
})();
