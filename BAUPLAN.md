# Bauplan „Mein Feed“

Nov 6, 2026 · @Luis

## Überblick und Architektur

„Mein Feed“ ersetzt den Social-Media-Feed durch eine eigene App. Claude recherchiert nachts zu sechs Überthemen und schreibt die Ergebnisse als JSON in ein GitHub-Repo; die App am Handy zeigt sie an und liest sie vor.

- **App (PWA):** reines HTML, CSS und JavaScript ohne Build-Schritt, über GitHub Pages ausgeliefert und am Handy installiert.
- **Geplante Aufgaben:** vier Claude-Läufe in der Cloud (täglich, wöchentlich, monatlich, jährlich), Modell Sonnet 5.5.
- **Repo `mein-feed`, Branch `main`:** App, Konfiguration (`config/`) und die Ablaufbeschreibungen der Läufe (`routinen/`). Hier ändern nur du und Claude Code etwas.
- **Repo `mein-feed`, Branch `claude/feed-daten`:** nur die Daten (`data/`). Hier schreiben nur die geplanten Aufgaben.
- **Lokal am Handy:** Merkliste, Feedback, Vorlese-Position, Stimme und Tempo, der Azure-Schlüssel.
- **Azure-Stimme (ab Sitzung 6):** Vorgelesen wird mit einer natürlichen Stimme von Microsoft Azure. Der Ton entsteht erst beim Tippen auf „Vorlesen“ direkt am Handy und wird nirgends als Datei gespeichert. Ohne Schlüssel oder ohne Netz liest die Stimme des Handys.

&#91;embedded content: Aufbau · 4 Bausteine, 2 Branches\]

Die Läufe schreiben nur auf den Daten-Branch, die App liegt auf `main`; der gestrichelte Pfeil ist deine Arbeit mit Claude Code.

Die App lädt die Daten direkt vom Daten-Branch über `https://raw.githubusercontent.com/<dein-name>/mein-feed/refs/heads/claude/feed-daten/data/…`. So pushen die Läufe nie auf `main`, und die App bleibt unangetastet, selbst wenn ein Lauf Unsinn schreibt.

## Formate und Zeitplan

Vier Formate, jedes fasst einen abgeschlossenen Zeitraum zusammen und erscheint nachts, bevor du aufstehst. Alle Zeiten sind Wiener Zeit.

| Format | Erscheint | Berichtszeitraum | Höchstens pro Überthema | Extras | Vorlesen |
| --- | --- | --- | --- | --- | --- |
| Täglich | jeden Tag, 3:07 | der Vortag | 3 Meldungen | keine | ca. 3–5 min |
| Wöchentlich | Sonntag, 3:37 | Sonntag bis Samstag der Vorwoche | 5 Meldungen | Finanzierungsrunden der Woche, bis zu 3 Videos | ca. 6 min |
| Monatlich | am 1., 4:07 | der Vormonat | 8 Meldungen | „Gescheitert und warum“, bis zu 5 Videos | ca. 10 min |
| Jahresrückblick | 1.1., 4:37 | das Vorjahr | 10 Meldungen | Monatsüberblick, Ausblick, bis zu 5 Videos des Jahres | ca. 20 min, kapitelweise |

- Die Zahlen sind Obergrenzen, keine Ziele. Ein Thema darf weniger Meldungen haben oder ganz ausfallen.
- Ausnahme: Gibt es wirklich mehr wichtige Meldungen, darf ein Thema die Obergrenze um höchstens 2 überschreiten (täglich also 5, wöchentlich 7, monatlich 10, jährlich 12). Jede zusätzliche Meldung muss so wichtig sein, dass sie eine der regulären verdrängen könnte; die Begründung steht in `ausnahmen`, und die App zeigt sie beim Thema an.
- Die Woche zählt von Sonntag bis Samstag, damit der Sonntagsrückblick eine abgeschlossene Woche zusammenfasst. Beispiel: Der Rückblick vom 8.11.2026 umfasst den 1. bis 7.11.2026.
- Die Startzeiten liegen ein paar Minuten nach der vollen Stunde, weil Läufe genau zur vollen Stunde laut Doku oft verspätet starten.
- Läufe pro Tag: normal 1, sonntags 2, am Monatsersten 3 (an einem Sonntag 4), am 1.1. bis zu 4. Der jährliche Lauf startet an jedem Monatsersten, endet aber außer am 1.1. sofort (siehe Teil D). Jeder Lauf zählt gegen dein normales Abo-Kontingent. Laut aktueller Doku gibt es daneben nur noch ein Stundenlimit von 100 geplanten Läufen, die früher genannte Tagesgrenze von 5 gilt nicht mehr.
- Der erste Jahresrückblick am 1.1.2027 deckt nur November und Dezember 2026 ab und heißt deshalb „Kurzrückblick 2026“.

## Überthemen und Inhaltsregeln

Sechs Überthemen in fester Reihenfolge; die Reihenfolge gilt in der App und beim Vorlesen. Die Regeln stehen später wörtlich in `config/regeln.md` und gelten für alle vier Läufe.

| Nr. | Überthema | ID | Schwerpunkte |
| --- | --- | --- | --- |
| 1 | Weltpolitik | `weltpolitik` | USA, Nahost-Konflikt, dazu die 3 wichtigsten anderen Meldungen weltweit |
| 2 | Politik in Österreich, Deutschland und der EU | `politik` | Regierungen, Gesetze, Wahlen |
| 3 | KI und Claude | `ki` | neue Modelle, Funktionen und Tools |
| 4 | Börse und Wirtschaft | `wirtschaft` | Märkte und Unternehmen, vor allem KI-Infrastruktur und Chips weltweit, inklusive Energie für Rechenzentren, dazu ETFs |
| 5 | Tirol und Innsbruck | `tirol` | Lokales, Verkehr, Veranstaltungen |
| 6 | Startups | `startups` | KI-Startups, Finanzierungsrunden, gescheiterte Startups, Börsengänge, Szene in Deutschland und Europa, Hardware und Robotik |

**Regeln je Thema**

- Weltpolitik: Die Obergrenze gilt für das ganze Thema. USA und Nahost kommen nur bei einer echten neuen Entwicklung hinein; die übrigen Plätze gehen an die wichtigsten anderen Meldungen weltweit.
- KI und Claude: Neuerungen bei Claude, der Claude-App und Claude Code haben Vorrang, auch kleinere Funktionen, die man direkt nutzen kann, aber keine reinen Fehlerbehebungen. Andere Anbieter kommen nur mit neuen Modellen oder wichtigen Funktionen hinein. Weil viele der größten Unternehmen eng mit der KI-Branche verbunden sind, gehören auch Wirtschaftsmeldungen hierher, wenn KI im Mittelpunkt steht (KI-Deals, KI-Investitionen, Rechenzentren, vom KI-Geschäft getriebene Quartalszahlen): Dann ist `ki` Hauptthema und `wirtschaft` weiteres Thema. Geht es vor allem um Kurs oder Markt, ist es umgekehrt.
- Börse und Wirtschaft: Zinsentscheidungen von EZB und Fed kommen immer hinein, Indexbewegungen ab ±3 % an einem Tag nur mit klarem Grund. ETFs: Meldungen zu breiten ETFs (z. B. MSCI World, S&P 500, Halbleiter- und KI-ETFs) und Änderungen bei Steuern oder Regeln für ETF-Anleger in Österreich. Einen festen Marktstand mit Indexzahlen gibt es nicht.
- Tirol und Innsbruck: Verkehr heißt nur Sperren, Großbaustellen, Blockabfertigung am Brenner, Streiks und größere Ausfälle bei ÖBB oder IVB, keine normalen Staus und Unfälle. Offiziell angekündigte Veranstaltungen der nächsten 7 Tage dürfen hinein, obwohl sie nach dem Berichtszeitraum liegen. Sie zählen zur Obergrenze; der Termin steht im Text, `datum` ist der Tag der Ankündigung.
- Startups je Format: täglich nur große Finanzierungsrunden (weltweit ab 100 Mio. $, in Europa ab 20 Mio. €, in Österreich ab 5 Mio. €), Börsengänge und Pleiten; wöchentlich zusätzlich die Liste „Finanzierungsrunden der Woche“ (Runden aus KI, Hardware und Robotik ab 10 Mio. €, österreichische ab 1 Mio. €, höchstens 10 Einträge); monatlich „Gescheitert und warum“, aber nur bei einem lehrreichen Fall.

**Relevanz: lieber weglassen als auffüllen**

- Eine Meldung kommt nur hinein, wenn sie neu ist, etwas Konkretes passiert ist (Entscheidung, Zahl, Ereignis statt Gerücht oder Meinung) und sie zu den Schwerpunkten passt.
- Pflichtfeld `warum_wichtig`: ein Satz. Gibt es keinen überzeugenden Satz, fliegt die Meldung raus.
- Laufende Geschichten (z. B. Nahost, US-Politik) kommen nur bei einer echten neuen Entwicklung wieder, markiert mit `update: true`. Dafür liest der tägliche Lauf die Ausgaben der letzten 7 Tage mit.
- Eine Meldung darf mehreren Überthemen angehören (`themen`), hat aber genau ein `hauptthema`. Beispiel: ein EU-Gesetz zu KI gehört zu `politik` (Hauptthema) und `ki`.
- Die Obergrenze zählt die Meldungen mit diesem Hauptthema; Verweise in anderen Themen zählen nicht.
- Leere Themen (ohne Meldung, Verweis, Video oder Abschnitt) werden nicht aufgefüllt, sondern in `ruhig` aufgeführt.

**Quellen**

- Zuerst die festen Quellen des Themas aus `config/themen.json` lesen, die Websuche nur ergänzend nutzen, höchstens 2 Suchen pro Thema und Lauf.
- Jede Meldung hat mindestens eine Quelle mit Link.
- Themen 1 und 2: mindestens zwei voneinander unabhängige Quellen, bevorzugt Nachrichtenagenturen (APA, dpa, Reuters, AP). Umstrittene Angaben wie Opferzahlen oder Schuldfragen stehen immer mit Quelle da („laut …“).
- Die festen Quellen stehen in `config/themen.json`, als RSS-Feeds (`feeds`) und Einstiegsseiten (`seiten`). Feeds sind zuverlässiger und sparen Kontingent. Stand 6.11.2026: Weltpolitik apnews.com, bbc.com, tagesschau.de, orf.at, derstandard.at · Politik orf.at, derstandard.at, diepresse.com, tagesschau.de, faz.net, politico.eu · KI anthropic.com/news, Änderungsprotokoll von Claude Code, heise.de, the-decoder.de, techcrunch.com · Wirtschaft handelsblatt.com, derstandard.at, tagesschau.de, bbc.com · Tirol tirol.orf.at, tt.com, innsbruck.gv.at · Startups brutkasten.com, trendingtopics.eu, sifted.eu, techcrunch.com.
- reuters.com ist keine feste Quelle, weil Claude die Seite nicht abrufen kann. Meldungen von Reuters, APA und dpa kommen über die Medien, die sie übernehmen, und werden mit „laut Reuters“ usw. gekennzeichnet.
- Ist eine feste Quelle im Lauf nicht erreichbar, nutzt der Lauf die anderen oder die Websuche; das ist kein Fehler. Fällt eine Quelle dauerhaft aus, ersetzt Claude Code sie durch eine gleichwertige.

**YouTube-Empfehlungen**

- Nur für die Überthemen Weltpolitik (`weltpolitik`), Politik (`politik`), KI und Claude (`ki`) sowie Börse und Wirtschaft (`wirtschaft`). Die übrigen Themen bekommen keine Videos und keine Kanäle in der Positivliste.
- Nur in Wochen- und Monatsrückblicken (und bis zu 5 „Videos des Jahres“ im Jahresrückblick, ausgewählt aus den Monatsempfehlungen; dort dürfen mehrere Videos dasselbe Überthema haben).
- Im Wochenrückblick höchstens 1 Video pro Überthema, im Monatsrückblick höchstens 2; insgesamt höchstens 3 pro Woche und 5 pro Monat. Kein Video ist der Normalfall, kein Fehler.
- Nur Kanäle der Positivliste in `themen.json`. Ein Kanal außerhalb nur mit Begründung und `neuer_kanal: true`, höchstens 1 solches Video pro Ausgabe. Die Startliste schlägt Claude Code beim Bau vor, du streichst und ergänzt.
- Keine Shorts (jedes Video mit `/shorts/` in der Adresse oder unter 3 Minuten Länge), keine Reaktionsvideos, keine Clickbait-Titel. Das Video ist im Berichtszeitraum erschienen; Ausnahme sind zeitlose Erklärvideos zu einem gerade wichtigen Thema mit `hintergrund: true`.
- Sprache Deutsch oder Englisch. Die Sprache spielt bei der Auswahl keine Rolle, entscheidend ist die Qualität.
- Claude kann Videos nicht ansehen, nur Titel, Kanal, Beschreibung, Länge und Datum prüfen. Deshalb ist die Positivliste Pflicht.

## Datenformat und Dateien

Alle Ausgaben haben dasselbe JSON-Format; Dateinamen richten sich nach dem Berichtszeitraum, nicht nach dem Erscheinungstag.

```
main
├─ index.html, app.js, styles.css       App
├─ manifest.webmanifest, sw.js, icons/   PWA
├─ config/themen.json                    Überthemen, Quellen, YouTube-Kanäle
├─ config/regeln.md                      Inhaltsregeln für alle Läufe
├─ routinen/taeglich.md                  Ablauf je Lauf (auch woechentlich.md,
│                                        monatlich.md, jaehrlich.md)
├─ routinen/feed.py                      Hilfsskript der Läufe: Zeitraum, Quellen,
│                                        Prüfung, Index, Aufräumen, Pushen
├─ routinen/test_feed.py                 Tests: python3 -m unittest discover -s routinen
├─ BAUPLAN.md                            dieses Dokument als Markdown
└─ CLAUDE.md                             „Lies vor jeder Arbeit BAUPLAN.md.“

claude/feed-daten
└─ data/
   ├─ index.json                         Liste aller vorhandenen Ausgaben
   ├─ taeglich/2026-11-05.json           Berichtstag
   ├─ woechentlich/2026-11-01_2026-11-07.json
   ├─ monatlich/2026-11.json
   └─ jaehrlich/2026.json
```

**Eine Ausgabe** (hier täglich, gekürzt):

```json
{
  "format": "taeglich",
  "titel": "Donnerstag, 5. November 2026",
  "zeitraum": { "von": "2026-11-05", "bis": "2026-11-05" },
  "erschienen": "2026-11-06T03:12:00+01:00",
  "status": "ok",
  "fehler": null,
  "ruhig": ["tirol", "startups"],
  "luecken": [],
  "ausnahmen": [],
  "meldungen": [
    {
      "id": "2026-11-05-politik-1",
      "datum": "2026-11-05",
      "datum_bis": null,
      "titel": "…",
      "text": "2 bis 4 Sätze",
      "warum_wichtig": "1 Satz",
      "themen": ["politik", "ki"],
      "hauptthema": "politik",
      "update": false,
      "quellen": [{ "name": "ORF", "url": "https://…" }]
    }
  ],
  "videos": [],
  "abschnitte": []
}
```

- `beispiel`: nur in Beispieldaten, dann `true`; die App kennzeichnet solche Ausgaben als Beispiel.
- `titel`: lesbarer Name der Ausgabe, z. B. „Woche vom 1. bis 7. November 2026“ oder „Kurzrückblick 2026“.
- `status`: `ok`, `ruhig` (nichts Wichtiges) oder `fehler` (mit kurzem Text in `fehler`).
- `luecken`: Tage, die ein Rückblick selbst nachrecherchieren musste.
- `ausnahmen[]`: `thema` und `grund`, nur wenn ein Thema die Obergrenze überschreitet.
- `datum_bis`: nur in Rückblicken, wenn eine Meldung eine Entwicklung über mehrere Tage zusammenfasst.
- `videos[]`: `titel`, `kanal`, `dauer_min`, `datum`, `url`, `thema`, `warum`, `hintergrund`, `neuer_kanal`.
- `abschnitte[]`: Extras mit `typ` (`finanzierungsrunden`, `gescheitert`, `monatsueberblick`, `ausblick`), `thema`, `titel` und `eintraege`; die Felder der Einträge stehen in `config/regeln.md`.
- `index.json`: `aktualisiert`, `start` (Berichtstag der ersten Tagesausgabe) und `ausgaben[]` mit `format`, `titel`, `zeitraum`, `datei`, `status`, `erschienen`. Die App liest zuerst diese Datei; `routinen/feed.py` baut sie aus den vorhandenen Dateien neu auf.

**`config/themen.json`** (ein Thema gezeigt, die anderen fünf genauso):

```json
{
  "gueltig_ab": "2026-11-09",
  "themen": [
    {
      "id": "weltpolitik",
      "name": "Weltpolitik",
      "reihenfolge": 1,
      "schwerpunkte": ["USA", "Nahost-Konflikt", "3 wichtigste weitere Meldungen weltweit"],
      "quellen": ["apnews.com", "bbc.com", "tagesschau.de", "orf.at", "derstandard.at"],
      "feeds": [{ "name": "ORF News", "url": "https://rss.orf.at/news.xml" }],
      "seiten": [{ "name": "AP World News", "url": "https://apnews.com/world-news" }],
      "zwei_quellen_pflicht": true,
      "videos": true,
      "youtube_kanaele": [
        { "name": "CaspianReport", "handle": "@CaspianReport", "kanal_id": "UCwnKziETDbHJtx78nIkfYug", "sprache": "en", "vorschlag": true }
      ]
    }
  ]
}
```

## Speicherung und Löschung

Jede Stufe bleibt, bis die nächsthöhere sie vollständig abdeckt, und zusätzlich mindestens 7 Tage; der Jahresrückblick bleibt für immer.

| Ausgabe | Wird gelöscht, sobald | und |
| --- | --- | --- |
| Täglich | der Wochenrückblick mit ihrem Berichtstag erschienen ist | dieser Rückblick seit mindestens 7 Tagen erschienen ist |
| Wöchentlich | alle 7 Tage der Woche in erschienenen Monatsrückblicken stecken (eine Woche über einen Monatswechsel also erst nach dem zweiten Monat) | der letzte dieser Rückblicke seit mindestens 7 Tagen erschienen ist |
| Monatlich | der Jahresrückblick ihres Jahres erschienen ist | dieser Rückblick seit mindestens 7 Tagen erschienen ist |
| Jahresrückblick | nie |  |

- „Erschienen“ heißt: Die Datei existiert mit `status` `ok` oder `ruhig`. Ein Rückblick mit `fehler` löscht nichts.
- Fehlt eine Zwischenstufe dauerhaft, deckt die nächsthöhere ab: Hat etwa ein Wochenrückblick `fehler`, verschwinden seine Tagesausgaben 7 Tage nach dem Monatsrückblick.
- Was gelöscht wird, rechnet `routinen/feed.py` aus, nicht Claude selbst, damit nichts zu früh verschwindet.
- Aufgeräumt wird nur vom täglichen Lauf, als letzter Schritt: Datei auf `claude/feed-daten` löschen und aus `index.json` entfernen. Im Git-Verlauf bleibt alles erhalten; bei News ist das harmlos, Persönliches gehört deshalb nie ins Repo.
- Die 7-Tage-Schonfrist verhindert, dass etwa die Sonntags-Tagesausgabe oder der Dezember-Rückblick am selben Morgen verschwinden, an dem sie erscheinen.
- **Merkliste:** Der Speichern-Knopf kopiert eine Meldung, ein Video oder eine ganze Ausgabe in den Speicher des Handys (IndexedDB, mit `navigator.storage.persist()`). Sie bleibt dort, egal was im Repo gelöscht wird, ist privat und wird nicht zwischen Geräten abgeglichen. Export und Import als JSON-Datei sichern sie.
- **Jahresrückblick:** Weil er als Einziges dauerhaft bleibt, ist er für sich allein verständlich und enthält pro Überthema einen kurzen Monatsüberblick.

## App-Funktionen

Die App zeigt immer die neueste Ausgabe zuerst, gegliedert nach Überthemen, und liest sie bei eingeschaltetem Bildschirm vor.

**Ansichten und Anzeige**

- Tabs: Heute, Woche, Monat, Jahr, Merkliste. In jedem Tab die neueste Ausgabe oben, ältere noch vorhandene darunter.
- Kopf jeder Ausgabe: Titel, Zeitraum, Erscheinungszeit („Stand: …“) und Status. Bei `fehler` ein deutlicher Hinweis mit dem Datum der letzten erfolgreichen Ausgabe.
- Überthemen in der Reihenfolge aus `themen.json`. Eine Meldung steht vollständig in ihrem Hauptthema; in jedem weiteren Thema nur eine Verweiszeile („→ siehe KI und Claude“), die beim Antippen hinspringt.
- Leere Themen sind ausgeblendet. Ganz unten steht „Heute ruhig: Tirol und Innsbruck, Startups“; bei `status: ruhig` nur „Heute nichts Wichtiges“.
- Themen-Chips oben filtern die Ansicht.
- Überschreitet ein Thema die Obergrenze, steht beim Thema ein kleiner Hinweis „5 statt 3 Meldungen, weil …“ mit dem Grund aus `ausnahmen`.
- Meldung: Titel, Text, „Warum wichtig“, Kennzeichen „Update“, Quellenlinks, Knöpfe „Speichern“ und „Unnötig“.
- Videos: Karte mit Titel, Kanal, Länge und Begründung; Antippen spielt das Video eingebettet über youtube-nocookie.com in der App, ohne YouTube-Startseite.
- Abschnitte wie „Finanzierungsrunden der Woche“ als kompakte Liste am Ende ihres Themas.

**Vorlesen**

- Knopf „Vorlesen“ für die ganze Ausgabe und pro Überthema. Der Ton kommt von der Azure-Stimme (siehe unten), solange ein Schlüssel eingetragen ist und Netz da ist, sonst von der Stimme des Handys (Web Speech API, deutsche Stimme). Stimme und Tempo wählbar und gespeichert.
- Gelesen wird Satz für Satz: Themenname, dann pro Meldung Titel, Text und „Warum wichtig“. Verweise werden nicht gelesen, jede Meldung also nur einmal. Bei einem Video nur der Satz „Dazu gibt es eine Video-Empfehlung“. Am Ende die Ruhig-Zeile.
- Vorlese-Ansicht: dunkler Hintergrund, aktueller Satz groß, Knöpfe Pause/Weiter, Satz zurück/vor, nächstes Thema, Fortschrittsbalken.
- **Bildschirm wach halten** (nur mit der Stimme des Handys): Beim Start fordert die App einen Screen Wake Lock an, bei Pause oder Ende gibt sie ihn frei; kommt die App nach einem Wechsel zurück, fordert sie ihn neu an. Grund: Der Test am 6.11.2026 hat gezeigt, dass das Vorlesen bei gesperrtem Bildschirm in keiner Variante weiterläuft.
- **Weiterlesen:** Die Position (Ausgabe und Satz) wird laufend lokal gespeichert. Nach einer Unterbrechung bietet die App „Weiter ab Satz …“ an. Die Position gilt für beide Stimmen gleich.

**Azure-Stimme (Sitzung 6)**

Die Stimme des Handys klingt schlecht und stoppt bei gesperrtem Bildschirm. Azure liefert natürliche Stimmen, auch österreichische, und ein Audio-Element spielt bei gesperrtem Bildschirm weiter.

- **Live statt Dateien:** Der Ton entsteht beim Tippen auf „Vorlesen“ direkt am Handy, mit einer Anfrage an Azure. Keine Audiodateien im Repo, die geplanten Läufe ändern sich nicht, nichts im Download- oder Musikordner. Der Ton liegt nur im Arbeitsspeicher der App und wird beim Schließen der Vorlese-Ansicht verworfen; der Service Worker speichert nichts von Azure.
- **Schlüssel:** Azure-Schlüssel und Region trägt man einmal unter „Stimme und Tempo“ ein, mit „Testen“ und „Löschen“. Beides liegt nur im lokalen Speicher des Handys, nie im Repo, im Export der Merkliste, im Feedback-Text oder in Fehlermeldungen.
- **Technik:** das offizielle Speech SDK von Microsoft für JavaScript, erst geladen, wenn die Azure-Stimme gebraucht wird, in fester Version vom CDN mit Integritätsprüfung (SRI). Kein Build-Schritt, keine Datei im Repo. Ausgabe als MP3, mono, niedrige Bitrate.
- **Gleiche Sätze:** Gelesen wird dieselbe Satzliste wie mit der Stimme des Handys. Jeder Satz bekommt in SSML eine Marke; die Zeitpunkte im Ton kommen aus den Marken-Ereignissen des SDK. Satz zurück/vor, „Nächstes Thema“, Fortschrittsbalken, Kapitel und „Weiter ab Satz …“ funktionieren wie bisher.
- **Laden:** in Stücken je Überthema, weil die Gratis-Stufe die Anfragen pro Minute begrenzt. Das Vorlesen beginnt, sobald das erste Stück da ist; die übrigen kommen im Hintergrund nach und schließen nahtlos an. Sind alle geladen, läuft die Ausgabe auch im Funkloch zu Ende.
- **Wiedergabe:** Audio-Element mit Media Session: Titel der Ausgabe und Thema auf dem Sperrbildschirm, Pause/Weiter und Satz zurück/vor auch über Sperrbildschirm und Kopfhörer. Läuft bei gesperrtem Bildschirm und nach einem App-Wechsel weiter; kein Wake Lock.
- **Stimme und Tempo:** Auswahl aus den deutschen Azure-Stimmen, die österreichischen (Ingrid, Jonas) zuerst. Das Tempo ändert nur die Abspielgeschwindigkeit, ohne neu zu laden; ein Stimmwechsel lädt ab dem aktuellen Satz neu.
- **Rückfall:** Kein Schlüssel, offline, Schlüssel ungültig, Kontingent aufgebraucht oder Azure nicht erreichbar: Die App liest mit der Stimme des Handys weiter und sagt kurz, warum. Sie scheitert nie still.
- **Kosten:** Azure-Gratis-Stufe F0 mit 500.000 Zeichen im Monat. In F0 wird über der Grenze nur gebremst, nie abgerechnet. Eine Tagesausgabe hat rund 4.000 Zeichen. Das Claude-Kontingent wird nicht belastet.

**Feedback und Technik**

- „Unnötig“ an jeder Meldung und „Hat gefehlt“ (Freitext) am Ende jeder Ausgabe werden lokal gesammelt. „Feedback kopieren“ erzeugt einen Text, den du Claude Code gibst, um `config/regeln.md` nachzuschärfen.
- Reines HTML, CSS und JavaScript ohne Framework und ohne Build-Schritt; hell und dunkel; für Handybreite gebaut.
- PWA: `manifest.webmanifest` (Name „Mein Feed“, `display: standalone`, Icons) und ein Service Worker, der die App und die zuletzt geladenen Ausgaben für den Offline-Fall zwischenspeichert. Daten werden immer zuerst frisch geladen. Fremde Seiten (YouTube, Azure, CDN) speichert er nicht.

## Die vier geplanten Aufgaben

Alle vier Aufgaben bekommen denselben kurzen Prompt; nur die erste Zeile unterscheidet sich. Der genaue Ablauf steht im Repo unter `routinen/`, damit du ihn mit Claude Code ändern kannst, ohne die Aufgaben anzufassen. Datumsrechnung, Abruf der Feeds, Prüfung, `index.json`, Aufräumen und Pushen erledigt das Hilfsskript `routinen/feed.py`; Claude recherchiert, wählt aus und schreibt.

**Prompt zum Einfügen** (erste Zeile je Aufgabe: `taeglich`, `woechentlich`, `monatlich` oder `jaehrlich`):

```
Format: taeglich

Du erstellst eine Ausgabe von „Mein Feed“ im oben genannten Format.

1. Lies auf dem Branch main: BAUPLAN.md, config/regeln.md, config/themen.json und routinen/<Format>.md.
2. Arbeite routinen/<Format>.md Schritt für Schritt ab.
3. Schreib nur im Ordner data/ auf dem Branch claude/feed-daten. Ändere nichts auf main und öffne keinen Pull Request.
4. Committe mit der Nachricht „<Format> <Berichtszeitraum>“ und pushe nur nach origin claude/feed-daten.
5. Geht etwas schief, schreib die Ausgabe trotzdem mit "status": "fehler" und einer kurzen Beschreibung in "fehler", damit die App es anzeigt.

Fertig ist der Lauf, wenn die neue Ausgabe und data/index.json gültiges JSON sind und auf origin claude/feed-daten liegen.
```

**`routinen/taeglich.md`**

1. Berichtstag = gestern (Europe/Vienna). Branch `claude/feed-daten` holen und auschecken; gibt es ihn noch nicht, mit einer leeren `data/index.json` anlegen.
2. Existiert `data/taeglich/<Berichtstag>.json` schon mit `ok` oder `ruhig`, beenden (kein Doppellauf).
3. Die Tagesausgaben der letzten 7 Tage lesen, um Wiederholungen zu vermeiden und Updates zu erkennen.
4. Pro Überthema: feste Quellen lesen, höchstens 2 Websuchen, Kandidaten nach `regeln.md` prüfen, höchstens 3 behalten (Ausnahme bis 5).
5. Ausgabe schreiben; bleibt keine einzige Meldung, `status: ruhig`.
6. JSON prüfen: lässt sich parsen, Pflichtfelder vorhanden, jedes `hauptthema` steht in `themen`.
7. Aufräumen nach den Löschregeln.
8. `index.json` aktualisieren, committen, pushen.

**`routinen/woechentlich.md`**

1. Zeitraum = Sonntag bis Samstag der Vorwoche.
2. Warten, bis die heutige Tagesausgabe auf dem Branch liegt: alle 10 Minuten neu holen, höchstens 3 Mal. Liegt sie dann nicht vor, ohne sie weitermachen und den Tag als Lücke behandeln.
3. Die 7 Tagesausgaben lesen. Fehlt eine oder hat sie `fehler`, die Tage kurz selbst nachrecherchieren und in `luecken` eintragen.
4. Pro Überthema höchstens 5 Meldungen; zusammengehörige Tagesmeldungen zu einer Entwicklung bündeln (`datum` und `datum_bis`).
5. Abschnitt `finanzierungsrunden` für Startups; Videos nach den YouTube-Regeln.
6. Schreiben, prüfen, `index.json` aktualisieren, committen, pushen. Nicht aufräumen.

**`routinen/monatlich.md`**

1. Zeitraum = der Vormonat. Warten auf die heutige Tagesausgabe wie oben, an einem Sonntag auch auf den Wochenrückblick.
2. Quellen: alle Wochenrückblicke, die den Monat berühren (nur Meldungen mit Datum im Monat), dazu die Tagesausgaben der Tage, die noch in keinem Wochenrückblick stecken. Lücken wie oben.
3. Pro Überthema höchstens 8 Meldungen plus die größeren Entwicklungen des Monats.
4. Abschnitt `gescheitert` nur bei einem lehrreichen Fall; höchstens 5 Videos, höchstens 2 pro Überthema.
5. Schreiben, prüfen, `index.json` aktualisieren, committen, pushen. Nicht aufräumen.

**`routinen/jaehrlich.md`**

0. Ist heute in Wien nicht der 1. Jänner, sofort beenden, ohne etwas zu schreiben (die Aufgabe startet jeden Monatsersten, siehe Teil D).
1. Zeitraum = das Vorjahr. Warten, bis der Dezember-Rückblick auf dem Branch liegt, wie oben.
2. Quelle: alle Monatsrückblicke des Jahres. Fehlen Monate, nur die vorhandenen nutzen und `titel` auf „Kurzrückblick \<Jahr>“ setzen, sonst „Jahresrückblick \<Jahr>“.
3. Pro Überthema höchstens 10 Meldungen, dazu `monatsueberblick` (1 bis 2 Sätze pro Monat und Thema) und `ausblick` (nur bereits angekündigte Termine und Entscheidungen des neuen Jahres).
4. Bis zu 5 Videos des Jahres, ausgewählt aus den Monatsempfehlungen; mehrere dürfen dasselbe Überthema haben.
5. Schreiben, prüfen, `index.json` aktualisieren, committen, pushen. Nie etwas löschen.

## Sonderfälle

Jeder Fall hat eine feste Lösung, damit die Läufe ohne Rückfrage durchlaufen.

| Fall | Lösung |
| --- | --- |
| Der Sonntag ist noch nicht vorbei, wenn der Wochenrückblick erscheint | Woche = Sonntag bis Samstag der Vorwoche |
| Eine Woche reicht über einen Monatswechsel | Jede Meldung trägt ein Datum; der Monatsrückblick nimmt nur Meldungen aus seinem Monat. Gelöscht wird die Woche erst, wenn beide Monate ihren Rückblick haben |
| Der Monat endet mitten in der Woche | Der Monatsrückblick nimmt für diese Tage die noch gespeicherten Tagesausgaben |
| Mehrere Formate am selben Tag (am 1.1. bis zu 4) | Feste Reihenfolge, je 30 Minuten versetzt; jeder Lauf wartet auf seine Vorstufe (alle 10 Minuten neu holen, höchstens 3 Mal) |
| Ein Lauf fällt aus oder schreibt `fehler` | Der nächste Rückblick recherchiert die fehlenden Tage selbst nach und trägt sie in `luecken` ein |
| Ein Lauf startet doppelt | Existiert die Ausgabe schon mit `ok` oder `ruhig`, endet der Lauf ohne Änderung |
| Ruhiger Tag und abgestürzter Lauf dürfen nicht gleich aussehen | `status` `ruhig` gegenüber `fehler`; die App zeigt `fehler` deutlich an, und fehlt die Tagesausgabe nach 6:00 ganz, zeigt sie „Heute noch keine Ausgabe“ |
| Ausgabe würde am Tag ihres Erscheinens gelöscht | 7-Tage-Schonfrist |
| Der Branch `claude/feed-daten` fehlt beim ersten Lauf | Der tägliche Lauf legt ihn mit leerer `index.json` an |
| Start mitten im Jahr | Erster Jahresrückblick heißt „Kurzrückblick 2026“ (nur November und Dezember) |
| Überthemen ändern sich | Neue Liste mit neuem `gueltig_ab`; alte Ausgaben behalten ihre Themen, Rückblicke über den Wechsel führen beide zusammen |
| GitHub-Verbindung läuft ab | Die Aufgaben setzen laut Doku bis zu 72 Stunden aus und schalten sich danach ab: neu verbinden und wieder einschalten |
| Bildschirm geht während des Vorlesens aus oder App wird gewechselt | Stimme des Handys: Wake Lock neu anfordern, „Weiter ab Satz …“ anbieten. Azure-Stimme: läuft weiter, Steuerung über Sperrbildschirm und Kopfhörer |
| Azure nicht erreichbar, Schlüssel ungültig oder Gratis-Kontingent aufgebraucht | Weiter mit der Stimme des Handys, kurzer Hinweis in der Vorlese-Ansicht |
| Video wird später gelöscht oder privat | Die Karte zeigt „Video nicht mehr verfügbar“; in der Merkliste bleiben Titel und Begründung stehen |
| Feed startet mitten in einer Woche oder einem Monat | Tage vor der ersten Tagesausgabe (`start` in `index.json`) zählen nicht als Lücke; der Rückblick sagt im Titel, ab wann er gilt |
| Der Monatserste ist ein Sonntag | Der Monatsrückblick wartet auch auf den Wochenrückblick |
| Die Vorstufe liegt nach 3 Versuchen nicht vor | Ohne sie weitermachen und ihre Tage als Lücke selbst nachrecherchieren |
| Ein Wochenrückblick fehlt dauerhaft | Seine Tagesausgaben werden 7 Tage nach dem Monatsrückblick gelöscht |
| Eine feste Quelle ist nicht erreichbar | Andere feste Quellen oder Websuche nutzen; kein Fehler |

## Einrichtung Schritt für Schritt

Du stellst an drei Stellen etwas ein: GitHub, die geplanten Aufgaben bei Claude und einmal am Handy. Die Bezeichnungen in **fett** sind die Beschriftungen in der Oberfläche, die teils englisch sind.

**A. GitHub (einmalig, vor dem Bau)**

1. Auf github.com ein Konto anlegen, falls du noch keins hast.
2. Neues Repository: Name `mein-feed`, **Public** (GitHub Pages ist für öffentliche Repos kostenlos), Haken bei **Add a README file**, damit `main` existiert.
3. Auf claude.ai/code GitHub verbinden und dem Repo `mein-feed` Zugriff geben.

**B. GitHub Pages (nach dem ersten Bau)**

1. Im Repo **Settings** → **Pages**.
2. Unter **Build and deployment**: **Source** = **Deploy from a branch**, Branch `main`, Ordner `/ (root)`, **Save**.
3. Nach ein bis zwei Minuten läuft die App unter `https://<dein-name>.github.io/mein-feed/`.

**C. Cloud-Umgebung für die Aufgaben**

1. claude.ai/code/routines öffnen → **New task** (oder **New routine**) → **Set up manually**.
2. **Advanced settings** → **General** → **Repository**: `mein-feed`.
3. Darunter bei **Cloud environment** eine eigene Umgebung „Mein Feed“ anlegen, damit **Default** unverändert bleibt. **Network access** = **Full**. Grund: Die Standardstufe **Trusted** lässt nur Paketquellen und ähnliche Entwicklerseiten durch, Nachrichtenseiten würden mit Fehler 403 abgelehnt.
4. Enger ginge **Custom**: die Quellen-Domains aus `themen.json`, die Hosts ihrer `feeds` und `seiten` (z. B. `rss.orf.at`, `feeds.bbci.co.uk`, `raw.githubusercontent.com`) plus `youtube.com` unter **Allowed domains** eintragen und **Also include default list of common package managers** anhaken.

**D. Die vier Aufgaben anlegen**

Für jede Aufgabe gilt: Prompt aus dem Abschnitt oben einfügen und die erste Zeile anpassen, im Prompt-Feld **Sonnet 5.5** wählen, Repository `mein-feed`, Umgebung „Mein Feed“, im Tab **Connectors** alle Connectoren entfernen (die Läufe brauchen keinen).

| Name | Erste Prompt-Zeile | Trigger | Zeit |
| --- | --- | --- | --- |
| Mein Feed · täglich | `Format: taeglich` | **Schedule** → Daily | 3:07 |
| Mein Feed · wöchentlich | `Format: woechentlich` | **Schedule** → Weekly, Sonntag | 3:37 |
| Mein Feed · monatlich | `Format: monatlich` | **Custom**: `CRON_TZ=Europe/Vienna 7 4 1 * *` | am 1., 4:07 |
| Mein Feed · jährlich | `Format: jaehrlich` | **Custom**: `CRON_TZ=Europe/Vienna 37 4 1 * *` | am 1., 4:37; arbeitet nur am 1.1. |

- Bei den Voreinstellungen (Daily, Weekly) gibst du die Uhrzeit in deiner Ortszeit ein.
- Einen jährlichen Zeitplan (`37 4 1 1 *`) nimmt die Oberfläche nicht an. Die jährliche Aufgabe startet deshalb an jedem Monatsersten um 4:37; `routinen/jaehrlich.md` beendet den Lauf sofort, wenn nicht 1. Jänner ist. Das kostet elf kurze Läufe im Jahr.
- **Custom** gibt es erst nach dem Anlegen: Aufgabe mit einer beliebigen Voreinstellung erstellen, dann im Menü neben dem Namen **Edit** → im **Trigger**-Feld **Custom** wählen, den Ausdruck einfügen, **Save changes**. Der Teil `CRON_TZ=Europe/Vienna` sorgt dafür, dass die Stunden Wiener Zeit sind, auch nach der Zeitumstellung.

**E. Testen**

1. claude.ai/settings/usage öffnen und den Stand merken.
2. „Mein Feed · täglich“ öffnen → **Run now**.
3. Den Lauf unter **History** anklicken und lesen, was Claude gemacht hat. „Succeeded“ heißt nur, dass die Sitzung normal endete; ob die Datei wirklich auf `claude/feed-daten` liegt, siehst du im Repo.
4. Den Verbrauch unter claude.ai/settings/usage mit vorher vergleichen.

**F. Handy**

1. Die Pages-Adresse in Chrome öffnen → Menü ⋮ → **App installieren** bzw. **Zum Startbildschirm hinzufügen**.
2. In der App einmal Stimme und Tempo wählen.

**G. Azure-Stimme (nach Sitzung 6)**

Die Bezeichnungen im Azure-Portal können leicht abweichen.

1. portal.azure.com öffnen und ein kostenloses Azure-Konto anlegen bzw. sich anmelden. Microsoft verlangt meist eine Kreditkarte zur Prüfung; in der Gratis-Stufe wird nichts abgebucht.
2. **Ressource erstellen** → nach **Speech** suchen → den Speech-Dienst (Azure AI Speech) wählen → **Erstellen**.
3. **Ressourcengruppe** neu: `mein-feed`, **Region**: West Europe, **Name** z. B. `mein-feed-stimme`, **Tarif**: **Free F0** → **Überprüfen + erstellen** → **Erstellen**.
4. **Zur Ressource** → **Schlüssel und Endpunkt**: **Schlüssel 1** und **Standort/Region** (z. B. `westeurope`) kopieren.
5. In der App: **Vorlesen** → **Stimme und Tempo** → Schlüssel und Region eintragen → **Testen** → Stimme wählen.

Quelle für die Einstellungen der geplanten Aufgaben: [Claude-Code-Doku: Scheduled tasks](https://code.claude.com/docs/en/routines).

## Bau-Reihenfolge und Abnahme

Gebaut wird in fünf kleinen Claude-Code-Sitzungen, erst mit Beispieldaten, dann mit den echten Läufen. Sitzung 6 ist eine Erweiterung nach dem Start.

1. Diesen Bauplan als Markdown exportieren und auf github.com ins Repo laden (**Add file** → **Upload files**) als `BAUPLAN.md`. Dazu eine `CLAUDE.md` mit dem Satz „Lies vor jeder Arbeit BAUPLAN.md.“
2. In Claude Code (claude.ai/code, Repo `mein-feed`) je eine Sitzung:
   1. Konfiguration: `config/themen.json`, `config/regeln.md`, die vier `routinen/*.md` und `routinen/feed.py`.
   2. Beispieldaten auf `claude/feed-daten`: eine Tages- und eine Wochenausgabe, als Beispiel gekennzeichnet.
   3. App: Ansichten, Gruppierung, Verweise, Filter, Status, Merkliste, Feedback.
   4. Vorlesen: Vorlese-Ansicht, Wake Lock, Weiterlesen.
   5. PWA: Manifest, Service Worker, Icons.
   6. Azure-Stimme: Vorlesen mit Azure, live am Handy (Erweiterung nach dem Start; danach Einrichtung G).
3. Claude Code arbeitet auf eigenen `claude/`-Branches. Die App-Änderungen übernimmst du nach jeder Sitzung per Pull Request nach `main`. Ändert eine Sitzung `routinen/feed.py` oder die Konfiguration, müssen vorher die Tests laufen: `python3 -m unittest discover -s routinen`.
4. Pages einschalten (B) und am Handy installieren (F).
5. Beispieldaten löschen, am einfachsten den ganzen Branch `claude/feed-daten` (der erste tägliche Lauf legt ihn neu an, mit dem richtigen Startdatum). Dann die Aufgaben anlegen (C, D) und testen (E).
6. Nach einer Woche „Feedback kopieren“ und Claude Code damit `config/regeln.md` nachschärfen lassen.

Start-Prompt für die erste Sitzung:

```
Lies BAUPLAN.md. Erstelle config/themen.json, config/regeln.md und routinen/taeglich.md, woechentlich.md, monatlich.md und jaehrlich.md genau nach dem Bauplan. Schlag für Weltpolitik, Politik, KI und Claude sowie Börse und Wirtschaft je 3 bis 5 YouTube-Kanäle für die Positivliste vor und markiere sie als Vorschlag, damit ich sie prüfen kann.
```

**Abnahme**

- [ ] Die Tagesausgabe liegt morgens auf `claude/feed-daten` und ist gültiges JSON.
- [ ] Ein leeres Thema ist ausgeblendet und steht unter „Heute ruhig“.
- [ ] Eine Meldung mit zwei Themen steht einmal vollständig, einmal als Verweis und wird nur einmal vorgelesen.
- [ ] Eine Ausgabe mit `status: fehler` zeigt einen deutlichen Hinweis.
- [ ] Beim Vorlesen bleibt der Bildschirm an; bei Pause darf er wieder ausgehen.
- [ ] Nach einem App-Wechsel geht das Vorlesen ab dem gemerkten Satz weiter.
- [ ] Eine gespeicherte Meldung bleibt in der Merkliste, auch wenn sie im Repo gelöscht wurde.
- [ ] Export und Import der Merkliste funktionieren.
- [ ] Ein Video spielt eingebettet, ohne YouTube-Startseite.
- [ ] Eine Tagesausgabe verschwindet frühestens 7 Tage nach ihrem Wochenrückblick.
- [ ] Mit Azure-Schlüssel liest die App mit der Azure-Stimme, ohne Schlüssel oder offline mit der Stimme des Handys.
- [ ] Mit der Azure-Stimme läuft das Vorlesen bei gesperrtem Bildschirm weiter und lässt sich über den Sperrbildschirm steuern.
- [ ] Weder im Repo noch am Handy liegen Audiodateien.
