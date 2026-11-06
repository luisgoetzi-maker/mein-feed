# Inhaltsregeln für „Mein Feed“

Diese Regeln gelten für alle vier Läufe (täglich, wöchentlich, monatlich, jährlich). Sie stimmen mit `BAUPLAN.md` überein; findest du trotzdem einen Widerspruch, gilt diese Datei. Die Themen, Quellen und YouTube-Kanäle stehen in `config/themen.json`.

Die Ausgabe ist für eine Person, die morgens in ein paar Minuten wissen will, was wirklich passiert ist. Sie ersetzt einen Social-Media-Feed, deshalb gilt vor allem anderen:

## 1. Lieber weglassen als auffüllen

- Die Zahlen in Abschnitt 3 sind Obergrenzen, keine Ziele. Ein Thema darf weniger Meldungen haben oder ganz ausfallen.
- Eine Meldung kommt nur hinein, wenn sie **neu** ist, **etwas Konkretes passiert** ist (eine Entscheidung, eine Zahl, ein Ereignis statt Gerücht, Meinung oder Ankündigung einer Ankündigung) und sie zu den **Schwerpunkten** des Themas passt.
- Pflichtfeld `warum_wichtig`: ein Satz, der erklärt, was sich dadurch ändert oder wen es betrifft. Gibt es keinen überzeugenden Satz, fliegt die Meldung raus.
- Leere Themen werden nicht aufgefüllt, sondern in `ruhig` aufgeführt.
- Kein Video ist der Normalfall, kein Fehler.

## 2. Überthemen

Sechs Überthemen in fester Reihenfolge; die Reihenfolge gilt in der App und beim Vorlesen.

| Nr. | Überthema | ID | Schwerpunkte |
| --- | --- | --- | --- |
| 1 | Weltpolitik | `weltpolitik` | USA, Nahost-Konflikt, dazu die wichtigsten anderen Meldungen weltweit |
| 2 | Politik in Österreich, Deutschland und der EU | `politik` | Regierungen, Gesetze, Wahlen |
| 3 | KI und Claude | `ki` | neue Modelle, Funktionen und Tools; Claude mit Vorrang |
| 4 | Börse und Wirtschaft | `wirtschaft` | Märkte und Unternehmen, vor allem KI-Infrastruktur und Chips weltweit, inklusive Energie für Rechenzentren, dazu ETFs |
| 5 | Tirol und Innsbruck | `tirol` | Lokales, Verkehr, Veranstaltungen |
| 6 | Startups | `startups` | KI-Startups, Finanzierungsrunden, gescheiterte Startups, Börsengänge, Szene in Österreich, Deutschland und Europa, Hardware und Robotik |

## 3. Obergrenzen und Ausnahme

| Format | Höchstens pro Überthema | Mit Ausnahme höchstens |
| --- | --- | --- |
| Täglich | 3 Meldungen | 5 |
| Wöchentlich | 5 Meldungen | 7 |
| Monatlich | 8 Meldungen | 10 |
| Jahresrückblick | 10 Meldungen | 12 |

- Gezählt werden die Meldungen mit diesem `hauptthema`. Verweise in anderen Themen zählen nicht.
- **Ausnahme:** Gibt es wirklich mehr wichtige Meldungen, darf ein Thema die Obergrenze um höchstens 2 überschreiten. Prüffrage für jede zusätzliche Meldung: *Ist sie so wichtig, dass sie eine der regulären Meldungen verdrängen könnte?* Ist sie nur interessant, fliegt sie raus.
- Wer die Ausnahme nutzt, trägt sie in `ausnahmen` ein: `{ "thema": "weltpolitik", "grund": "Ein Satz, warum es heute mehr sind." }`. Die App zeigt den Grund beim Thema an. Ohne Eintrag in `ausnahmen` gilt die normale Obergrenze.
- Die Ausnahme ist selten. Wird sie mehrmals pro Woche genutzt, ist die Auswahl zu großzügig.

## 4. Regeln je Thema

**Weltpolitik**
- Die Obergrenze gilt für das ganze Thema. USA und Nahost kommen nur bei einer echten neuen Entwicklung hinein; die übrigen Plätze gehen an die wichtigsten anderen Meldungen weltweit.

**Politik in Österreich, Deutschland und der EU**
- Regierungen, Gesetze, Wahlen: beschlossene oder eingebrachte Gesetze, Regierungsentscheidungen, Wahlergebnisse, Rücktritte und Ernennungen mit Gewicht. Keine Parteistreitereien ohne Entscheidung.

**KI und Claude**
- Neuerungen bei Claude, der Claude-App und Claude Code haben Vorrang, auch kleinere Funktionen, die man direkt nutzen kann. Reine Fehlerbehebungen und interne Änderungen kommen nicht hinein.
- Andere Anbieter kommen nur mit neuen Modellen oder wichtigen Funktionen hinein.
- Weil viele der größten Unternehmen eng mit der KI-Branche verbunden sind, gehören auch Wirtschaftsmeldungen hierher, wenn KI im Mittelpunkt steht: KI-Deals, KI-Investitionen, Rechenzentren, vom KI-Geschäft getriebene Quartalszahlen, Finanzierung und Börsengänge von KI-Firmen. Dann ist `ki` das Hauptthema und `wirtschaft` ein weiteres Thema. Geht es vor allem um Börsenkurs oder Markt, ist es umgekehrt.

**Börse und Wirtschaft**
- Zinsentscheidungen von EZB und Fed kommen immer hinein, auch wenn der Zins gleich bleibt.
- Indexbewegungen ab ±3 % an einem Tag (z. B. S&P 500, Nasdaq, DAX, ATX, MSCI World) kommen nur mit klarem Grund hinein.
- ETFs: Meldungen zu breiten ETFs (z. B. MSCI World, S&P 500, Halbleiter- und KI-ETFs) und Änderungen bei Steuern oder Regeln für ETF-Anleger in Österreich.
- Einen festen Marktstand mit Indexzahlen gibt es nicht.

**Tirol und Innsbruck**
- Verkehr heißt nur: Sperren, Großbaustellen, Blockabfertigung am Brenner, Streiks und größere Ausfälle bei ÖBB oder IVB. Normale Staus und Unfälle kommen nicht hinein.
- Offiziell angekündigte Veranstaltungen der nächsten 7 Tage dürfen hinein, obwohl sie nach dem Berichtszeitraum liegen. Sie zählen zur Obergrenze. Der Termin steht im Text, `datum` ist der Tag der Ankündigung.
- Blaulicht-Meldungen (Unfälle, Einbrüche, Brände) nur, wenn sie über den Einzelfall hinaus Folgen haben.

**Startups je Format**
- Täglich nur große Finanzierungsrunden (weltweit ab 100 Mio. $, in Europa ab 20 Mio. €, in Österreich ab 5 Mio. €), Börsengänge und Pleiten.
- Wöchentlich zusätzlich der Abschnitt „Finanzierungsrunden der Woche“: Runden aus KI, Hardware und Robotik ab 10 Mio. €, österreichische ab 1 Mio. €, höchstens 10 Einträge, größte zuerst.
- Monatlich der Abschnitt „Gescheitert und warum“, aber nur bei einem lehrreichen Fall; höchstens ein Fall.
- Beträge in anderen Währungen werden zum aktuellen Kurs grob umgerechnet, um die Schwelle zu prüfen; im Text steht der gemeldete Betrag.

## 5. Laufende Geschichten und Wiederholungen

- Laufende Geschichten (z. B. Nahost, US-Politik, Zollstreit) kommen nur bei einer echten neuen Entwicklung wieder und sind dann mit `update: true` markiert. Der Text sagt in einem Halbsatz, was vorher war, und dann, was neu ist.
- Der tägliche Lauf liest dafür die Tagesausgaben der letzten 7 Tage. Eine Meldung, die dort schon stand, kommt ohne neue Entwicklung nicht wieder.
- In Rückblicken bedeutet `update: true`: Die Geschichte stand schon im vorigen Rückblick desselben Formats.
- Rückblicke bündeln zusammengehörige Tagesmeldungen zu einer Entwicklung, mit `datum` (erster Tag) und `datum_bis` (letzter Tag). Sie wiederholen nicht jede Tagesmeldung, sondern sagen, was am Ende des Zeitraums gilt.

## 6. Hauptthema und weitere Themen

- Eine Meldung darf mehreren Überthemen angehören (`themen`), hat aber genau ein `hauptthema`, und das steht auch in `themen`. Beispiel: ein EU-Gesetz zu KI gehört zu `politik` (Hauptthema) und `ki`.
- Die App zeigt die Meldung vollständig im Hauptthema und in jedem weiteren Thema nur als Verweis. Vorgelesen wird sie nur einmal.
- Weitere Themen nur, wenn die Meldung dort wirklich interessiert, nicht aus Vorsicht.

## 7. Quellen

- Zuerst die festen Quellen des Themas aus `config/themen.json` lesen: die `feeds` mit `python3 routinen/feed.py schlagzeilen <thema>`, die `seiten` direkt. Die Websuche nur ergänzend nutzen, höchstens 2 Suchen pro Thema und Lauf.
- Jede Meldung hat mindestens eine Quelle mit Link auf den Artikel, nicht auf die Startseite.
- Themen 1 und 2 (`zwei_quellen_pflicht`): mindestens zwei voneinander unabhängige Quellen von verschiedenen Websites, bevorzugt Nachrichtenagenturen (APA, dpa, Reuters, AP) oder Medien, die sie übernehmen.
- Umstrittene Angaben wie Opferzahlen oder Schuldfragen stehen immer mit Quelle da („laut …“).
- reuters.com lässt sich nicht abrufen. Reuters-, APA- und dpa-Meldungen kommen über die Medien, die sie übernehmen; im Text steht dann „laut Reuters“ usw., verlinkt wird der Artikel, den du gelesen hast.
- Ist eine feste Quelle nicht erreichbar oder hinter einer Bezahlschranke, nimm die anderen festen Quellen oder die Websuche. Das ist kein Fehler und gehört nicht in `fehler`.
- Bezahlartikel nur verwenden, wenn der frei lesbare Teil die Aussage trägt.

## 8. Texte schreiben

- Sprache Deutsch, sachlich und ohne Wertung; österreichische Monatsnamen („Jänner“). Englische Quellen werden auf Deutsch zusammengefasst.
- `titel`: höchstens etwa 90 Zeichen, sagt, was passiert ist. Kein Clickbait, keine Fragen als Titel.
- `text`: 2 bis 4 Sätze. Wer hat was entschieden oder getan, mit konkreten Zahlen, Orten und Daten.
- `warum_wichtig`: genau ein Satz, ohne Floskeln wie „Das ist wichtig, weil“.
- Vorlesefreundlich schreiben, denn die App liest alles vor: keine Emojis, keine Klammerketten, Beträge ausgeschrieben („25 Millionen Euro“, „1,2 Milliarden Dollar“), Abkürzungen beim ersten Auftreten erklären, außer sehr bekannte wie EU, USA, KI.
- Videotitel bleiben in der Originalsprache.

## 9. YouTube-Videos

- Nur in Wochen- und Monatsrückblicken und im Jahresrückblick. Die Tagesausgabe hat nie Videos.
- Nur für die Überthemen Weltpolitik (`weltpolitik`), Politik (`politik`), KI und Claude (`ki`) sowie Börse und Wirtschaft (`wirtschaft`); in `themen.json` haben sie `"videos": true`. Tirol und Startups bekommen keine Videos.
- Wochenrückblick: höchstens 1 Video pro Überthema, höchstens 3 insgesamt.
- Monatsrückblick: höchstens 2 Videos pro Überthema, höchstens 5 insgesamt.
- Jahresrückblick: bis zu 5 „Videos des Jahres“, ausgewählt aus den Videos der Monatsrückblicke; mehrere dürfen dasselbe Überthema haben.
- Nur Kanäle der Positivliste (`youtube_kanaele` in `themen.json`, egal bei welchem Thema). Ein Kanal außerhalb nur mit Begründung im Feld `warum` und `neuer_kanal: true`, höchstens 1 solches Video pro Ausgabe.
- Keine Shorts (jedes Video mit `/shorts/` in der Adresse oder unter 3 Minuten Länge), keine Reaktionsvideos, keine Clickbait-Titel.
- Das Video ist im Berichtszeitraum erschienen. Ausnahme: ein zeitloses Erklärvideo zu einem gerade wichtigen Thema, dann `hintergrund: true`.
- Sprache Deutsch oder Englisch. Die Sprache spielt bei der Auswahl keine Rolle, entscheidend ist die Qualität.
- Du kannst Videos nicht ansehen, nur Titel, Kanal, Beschreibung, Länge und Datum prüfen. Deshalb ist die Positivliste Pflicht, und das Video muss zu einer Meldung oder Entwicklung des Zeitraums passen. `warum` sagt in einem Satz, was man aus dem Video mitnimmt.
- Kandidaten liefert `python3 routinen/feed.py videos --von <datum> --bis <datum>`.

## 10. Abschnitte

| `typ` | Format | `thema` | Einträge |
| --- | --- | --- | --- |
| `finanzierungsrunden` | nur wöchentlich | `startups` | `name`, `betrag`, `land`, `bereich`, `investoren` (oder `null`), `datum`, `quelle` |
| `gescheitert` | nur monatlich | `startups` | genau 1 Eintrag: `name`, `text` (was das Startup wollte, warum es gescheitert ist, was man daraus lernt; 3 bis 5 Sätze), `quelle` |
| `monatsueberblick` | nur jährlich | je Überthema ein Abschnitt | `monat` (`JJJJ-MM`), `text` (1 bis 2 Sätze) |
| `ausblick` | nur jährlich | je Überthema höchstens ein Abschnitt | `datum` (`JJJJ-MM-TT` oder `JJJJ-MM`), `text`, `quelle` |

- `quelle` ist immer `{ "name": "…", "url": "https://…" }`.
- `titel` des Abschnitts: „Finanzierungsrunden der Woche“, „Gescheitert und warum“, „Monatsüberblick“, „Ausblick auf <Jahr>“.
- Der Ausblick nennt nur bereits angekündigte Termine und Entscheidungen, keine Prognosen.

## 11. Felder einer Ausgabe

Die Datei `data/<format>/<zeitraum>.json` auf dem Branch `claude/feed-daten` hat genau diese Felder:

| Feld | Inhalt |
| --- | --- |
| `format` | `taeglich`, `woechentlich`, `monatlich` oder `jaehrlich` |
| `titel` | Vorschlag von `feed.py zeitraum`, z. B. „Donnerstag, 5. November 2026“, „Woche vom 1. bis 7. November 2026“, „November 2026“, „Jahresrückblick 2026“ oder „Kurzrückblick 2026“ |
| `zeitraum` | `{ "von": "JJJJ-MM-TT", "bis": "JJJJ-MM-TT" }` |
| `erschienen` | Zeitpunkt mit Wiener Zeitzone, z. B. `2026-11-06T03:12:00+01:00` (`feed.py zeitraum` liefert `jetzt`) |
| `status` | `ok`, `ruhig` (keine einzige Meldung) oder `fehler` |
| `fehler` | `null` oder ein kurzer Satz, was schiefging |
| `ruhig` | IDs der Themen ohne Meldung, Verweis, Video und Abschnitt, in der Reihenfolge aus `themen.json` |
| `luecken` | Tage (`JJJJ-MM-TT`), die ein Rückblick selbst nachrecherchieren musste; in Tagesausgaben immer leer |
| `ausnahmen` | siehe Abschnitt 3, sonst leer |
| `meldungen` | siehe unten |
| `videos` | siehe unten, in Tagesausgaben immer leer |
| `abschnitte` | siehe Abschnitt 10, in Tagesausgaben immer leer |

**Meldung:** `id`, `datum`, `datum_bis`, `titel`, `text`, `warum_wichtig`, `themen`, `hauptthema`, `update`, `quellen`.
- `id` = `<zeitraum>-<hauptthema>-<laufende Nummer>`, wobei `<zeitraum>` der Dateiname ohne `.json` ist: `2026-11-05-politik-1`, `2026-11-01_2026-11-07-ki-2`, `2026-11-wirtschaft-1`, `2026-tirol-3`.
- `datum` liegt im Berichtszeitraum. `datum_bis` ist `null` oder, nur in Rückblicken, ein späterer Tag im Zeitraum.
- `quellen` = Liste von `{ "name": "ORF", "url": "https://…" }`.
- Reihenfolge in `meldungen`: nach Thema wie in `themen.json`, innerhalb des Themas die wichtigste zuerst.

**Video:** `titel`, `kanal` (Name wie in der Positivliste), `dauer_min` (ganze Minuten), `datum`, `url` (`https://www.youtube.com/watch?v=…`), `thema`, `warum`, `hintergrund`, `neuer_kanal`.

**Fehlerausgabe:** Geht etwas schief, wird die Ausgabe trotzdem geschrieben, mit `"status": "fehler"`, einem kurzen Satz in `fehler` und allem, was schon fertig ist (oder leeren Listen). So sieht man in der App, dass etwas nicht stimmt.

## 12. Prüfung vor dem Speichern

`python3 routinen/feed.py pruefen <datei>` muss ohne Fehler durchlaufen. Es prüft unter anderem: gültiges JSON, alle Felder vorhanden, `hauptthema` steht in `themen`, Obergrenzen und Ausnahmen, Quellenpflicht für Themen 1 und 2, `ruhig` stimmt, Videoregeln und Abschnitte passen zum Format. Meldet es Fehler, korrigiere die Datei und prüfe erneut. Inhaltliche Regeln (Relevanz, Ton, Wahrheit) prüft das Skript nicht, die bleiben deine Aufgabe.
