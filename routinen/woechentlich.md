# Ablauf: Wochenrückblick

Der Wochenrückblick fasst die **Woche von Sonntag bis Samstag** vor dem Erscheinungstag zusammen und erscheint sonntags um 3:37. Ein Beispiel: Der Rückblick vom 8.11.2026 umfasst den 1. bis 7.11.2026. Du hast vorher `BAUPLAN.md`, `config/regeln.md` und `config/themen.json` gelesen.

**Grundregeln für diesen Lauf**
- Du arbeitest in der Repo-Wurzel auf `main` und änderst dort nichts. Die Daten liegen in `../feed-daten`, geschrieben wird nur in `../feed-daten/data/`.
- Kein Pull Request, kein Push nach `main`. Gepusht wird nur mit `python3 routinen/feed.py veroeffentlichen`.
- Rufe `feed.py` immer aus der Repo-Wurzel auf und gib Bash-Aufrufen ein Timeout von 600000 ms.
- Der Wochenrückblick räumt **nicht** auf. Das macht nur der tägliche Lauf.
- Geht etwas schief, schreibst du trotzdem eine Ausgabe mit `"status": "fehler"` (wie in `taeglich.md`, Schritt 9).

## 1. Vorbereiten

```bash
python3 routinen/feed.py vorbereiten
python3 routinen/feed.py zeitraum woechentlich
```

Ist `doppellauf` gleich `true`, beende den Lauf sofort ohne Änderung.

## 2. Auf die heutige Tagesausgabe warten

Die Tagesausgabe für Samstag erscheint um 3:07 und muss vorliegen, bevor du beginnst:

```bash
python3 routinen/feed.py warten woechentlich
```

Jeder Aufruf wartet bis zu 9 Minuten und prüft dabei jede Minute neu.
- Endet er mit „Vorstufe liegt vor“, geht es weiter.
- Endet er mit Exit-Code 3, rufst du ihn erneut auf, insgesamt höchstens 3 Mal.
- Liegt die Tagesausgabe danach immer noch nicht vor, machst du ohne sie weiter. Der Tag wird dann zur Lücke.

## 3. Eingaben und Lücken bestimmen

```bash
python3 routinen/feed.py zeitraum woechentlich
```

Rufe es erneut auf, denn jetzt ist der Stand aktuell.
- `eingaben` sind die Tagesausgaben der Woche mit ihrem Status. Lies alle mit `ok` oder `ruhig` vollständig.
- `luecken` sind die Tage ohne gültige Tagesausgabe. Tage vor dem Start des Feeds zählen nicht dazu.
- Recherchiere jede Lücke kurz selbst. Nimm dafür die Feeds (`python3 routinen/feed.py schlagzeilen <thema> --von <tag> --bis <tag>`, ältere Tage fehlen dort oft) und höchstens 2 Websuchen pro Thema für alle Lücken zusammen.
- Übernimm die Liste `luecken` unverändert in die Ausgabe, auch wenn du für einen Tag nichts gefunden hast.

## 4. Meldungen der Woche

Pro Überthema höchstens 5 Meldungen, mit Ausnahme bis 7 und Eintrag in `ausnahmen` (siehe `regeln.md` Abschnitt 3):
- Bündle zusammengehörige Tagesmeldungen zu einer Entwicklung. `datum` ist der erste Tag, `datum_bis` der letzte, und der Text sagt, was am Ende der Woche gilt.
- Wähle die wichtigsten Entwicklungen der Woche, nicht die Summe aller Tage.
- Lies den vorigen Wochenrückblick in `../feed-daten/data/woechentlich/`, falls vorhanden. Eine Geschichte, die dort schon stand, kommt nur mit neuer Entwicklung und mit `update: true` wieder.
- Quellen übernimmst du aus den Tagesmeldungen. Für Weltpolitik und Politik gilt weiter: zwei unabhängige Quellen.
- Die IDs lauten `<id_praefix>-<hauptthema>-<Nummer>`, z. B. `2026-11-01_2026-11-07-ki-1`.

## 5. Finanzierungsrunden der Woche

Ein Abschnitt `finanzierungsrunden` mit `"thema": "startups"` und `"titel": "Finanzierungsrunden der Woche"`:
- Dazu gehören Runden aus KI, Hardware und Robotik ab 10 Millionen Euro und österreichische Runden ab 1 Million Euro.
- Höchstens 10 Einträge, die größte zuerst.
- Quellen sind die Startup-Meldungen der Tagesausgaben, `python3 routinen/feed.py schlagzeilen startups --format woechentlich` und höchstens 2 Websuchen.
- Felder je Eintrag: `name`, `betrag` (ausgeschrieben, z. B. „25 Millionen Euro“), `land`, `bereich`, `investoren` (Hauptinvestoren oder `null`), `datum`, `quelle`.
- Gibt es keine passende Runde, lässt du den Abschnitt weg.

## 6. Videos

```bash
python3 routinen/feed.py videos --format woechentlich
```

Das listet die Videos der Positivliste aus dieser Woche, mit Länge und `erlaubt`.
- Wähle höchstens 1 Video pro Thema und höchstens 3 insgesamt, nur für `weltpolitik`, `politik`, `ki` und `wirtschaft`.
- Ein Video kommt nur hinein, wenn es zu einer Meldung oder Entwicklung der Woche passt und Titel und Beschreibung sachlich sind.
- Kein Video ist der Normalfall.
- Felder: `titel`, `kanal`, `dauer_min`, `datum`, `url`, `thema`, `warum`, `hintergrund`, `neuer_kanal`.
- Ist die Länge unbekannt, prüfe sie selbst auf der Videoseite. Ohne bekannte Länge nimmst du das Video nicht.

## 7. Schreiben, prüfen, veröffentlichen

1. Schreib `../feed-daten/<datei>` mit den Feldern aus `regeln.md` Abschnitt 11. `titel`, `zeitraum` und `erschienen` (= `jetzt`) kommen aus Schritt 3.
2. Prüfe die Datei, bis „OK“ kommt:
   ```bash
   python3 routinen/feed.py pruefen ../feed-daten/<datei>
   ```
3. Veröffentliche sie:
   ```bash
   python3 routinen/feed.py veroeffentlichen "woechentlich <von>_<bis>"
   ```

Fertig ist der Lauf, wenn „Gepusht nach origin claude/feed-daten.“ erscheint.
