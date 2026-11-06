# Ablauf: Monatsrückblick

Der Monatsrückblick fasst den **Vormonat** zusammen und erscheint am 1. jedes Monats um 4:07. Du hast vorher `BAUPLAN.md`, `config/regeln.md` und `config/themen.json` gelesen.

**Grundregeln für diesen Lauf**
- Du arbeitest in der Repo-Wurzel auf `main` und änderst dort nichts. Die Daten liegen in `../feed-daten`, geschrieben wird nur in `../feed-daten/data/`.
- Kein Pull Request, kein Push nach `main`. Gepusht wird nur mit `python3 routinen/feed.py veroeffentlichen`.
- Rufe `feed.py` immer aus der Repo-Wurzel auf und gib Bash-Aufrufen ein Timeout von 600000 ms.
- Der Monatsrückblick räumt **nicht** auf. Das macht nur der tägliche Lauf.
- Geht etwas schief, schreibst du trotzdem eine Ausgabe mit `"status": "fehler"` (wie in `taeglich.md`, Schritt 9).

## 1. Vorbereiten

```bash
python3 routinen/feed.py vorbereiten
python3 routinen/feed.py zeitraum monatlich
```

Ist `doppellauf` gleich `true`, beende den Lauf sofort ohne Änderung.

## 2. Auf die Vorstufen warten

```bash
python3 routinen/feed.py warten monatlich
```

Das wartet auf die heutige Tagesausgabe. Ist der Monatserste ein Sonntag, wartet es zusätzlich auf den Wochenrückblick.
- Jeder Aufruf wartet bis zu 9 Minuten.
- Endet er mit Exit-Code 3, rufst du ihn erneut auf, insgesamt höchstens 3 Mal.
- Liegt die Vorstufe danach immer noch nicht vor, machst du ohne sie weiter. Ihre Tage werden zu Lücken.

## 3. Eingaben und Lücken bestimmen

```bash
python3 routinen/feed.py zeitraum monatlich
```

Rufe es erneut auf, denn jetzt ist der Stand aktuell.
- `eingaben` sind alle gültigen Wochenrückblicke, die den Monat berühren, und die Tagesausgaben der Tage, die in keinem dieser Wochenrückblicke stecken. Lies alle mit `ok` oder `ruhig`.
- Aus Wochenrückblicken, die über den Monatswechsel reichen, nimmst du nur Meldungen, deren `datum` oder `datum_bis` im Monat liegt. Den Text schreibst du so um, dass er nur den Teil im Monat beschreibt.
- `luecken` sind Tage ohne gültige Abdeckung. Recherchiere sie kurz selbst: mit den Feeds und höchstens 2 Websuchen pro Thema für alle Lücken zusammen.
- Übernimm `luecken` unverändert in die Ausgabe.

## 4. Meldungen des Monats

Pro Überthema höchstens 8 Meldungen, mit Ausnahme bis 10 und Eintrag in `ausnahmen`:
- Vorrang haben die größeren Entwicklungen des Monats. Bündle zusammengehörige Meldungen mit `datum` (erster Tag) und `datum_bis` (letzter Tag). Der Text sagt, wie der Stand am Monatsende ist.
- Lies den vorigen Monatsrückblick in `../feed-daten/data/monatlich/`, falls vorhanden. Eine Geschichte, die dort schon stand, kommt nur mit neuer Entwicklung und mit `update: true` wieder.
- Quellen übernimmst du aus den Eingaben. Für Weltpolitik und Politik gilt weiter: zwei unabhängige Quellen.
- Die IDs lauten `<id_praefix>-<hauptthema>-<Nummer>`, z. B. `2026-11-politik-3`.

## 5. Gescheitert und warum

Ein Abschnitt `gescheitert` mit `"thema": "startups"` und `"titel": "Gescheitert und warum"` kommt nur hinein, wenn es im Monat einen **lehrreichen** Fall gab: eine Pleite oder Einstellung, aus der man etwas lernen kann.
- Genau 1 Eintrag mit `name`, `text` und `quelle`. Der `text` hat 3 bis 5 Sätze: Was wollte das Startup, warum ist es gescheitert, was lernt man daraus.
- Für das Warum höchstens 2 Websuchen.
- Gibt es keinen lehrreichen Fall, lässt du den Abschnitt weg.

## 6. Videos

```bash
python3 routinen/feed.py videos --format monatlich
```

- Höchstens 2 Videos pro Thema und höchstens 5 insgesamt, nur für `weltpolitik`, `politik`, `ki` und `wirtschaft`.
- Gute Kandidaten sind auch die Videos der Wochenrückblicke dieses Monats; sie wurden schon einmal geprüft.
- Ein Video kommt nur hinein, wenn es zu einer Entwicklung des Monats passt.
- Kein Video ist der Normalfall.
- Ist die Länge unbekannt, prüfe sie selbst auf der Videoseite. Ohne bekannte Länge nimmst du das Video nicht.

## 7. Schreiben, prüfen, veröffentlichen

1. Schreib `../feed-daten/<datei>` mit den Feldern aus `regeln.md` Abschnitt 11. `titel`, `zeitraum` und `erschienen` (= `jetzt`) kommen aus Schritt 3.
2. Prüfe die Datei, bis „OK“ kommt:
   ```bash
   python3 routinen/feed.py pruefen ../feed-daten/<datei>
   ```
3. Veröffentliche sie:
   ```bash
   python3 routinen/feed.py veroeffentlichen "monatlich <JJJJ-MM>"
   ```

Fertig ist der Lauf, wenn „Gepusht nach origin claude/feed-daten.“ erscheint.
