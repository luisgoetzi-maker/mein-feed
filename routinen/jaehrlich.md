# Ablauf: Jahresrückblick

Der Jahresrückblick fasst das **Vorjahr** zusammen und erscheint am 1. Jänner um 4:37. Er ist die einzige Ausgabe, die nie gelöscht wird. Deshalb muss er für sich allein verständlich sein, auch Jahre später. Du hast vorher `BAUPLAN.md`, `config/regeln.md` und `config/themen.json` gelesen.

**Grundregeln für diesen Lauf**
- Du arbeitest in der Repo-Wurzel auf `main` und änderst dort nichts. Die Daten liegen in `../feed-daten`, geschrieben wird nur in `../feed-daten/data/`.
- Kein Pull Request, kein Push nach `main`. Gepusht wird nur mit `python3 routinen/feed.py veroeffentlichen`.
- Rufe `feed.py` immer aus der Repo-Wurzel auf und gib Bash-Aufrufen ein Timeout von 600000 ms.
- Der Jahresrückblick löscht **nie** etwas.
- Geht etwas schief, schreibst du trotzdem eine Ausgabe mit `"status": "fehler"` (wie in `taeglich.md`, Schritt 9).

## 1. Vorbereiten

```bash
python3 routinen/feed.py vorbereiten
python3 routinen/feed.py zeitraum jaehrlich
```

Ist `doppellauf` gleich `true`, beende den Lauf sofort ohne Änderung.

## 2. Auf den Dezember-Rückblick warten

```bash
python3 routinen/feed.py warten jaehrlich
```

- Jeder Aufruf wartet bis zu 9 Minuten.
- Endet er mit Exit-Code 3, rufst du ihn erneut auf, insgesamt höchstens 3 Mal.
- Liegt der Dezember-Rückblick danach immer noch nicht vor, machst du ohne ihn weiter.

## 3. Eingaben bestimmen

```bash
python3 routinen/feed.py zeitraum jaehrlich
```

Rufe es erneut auf.
- `eingaben` sind alle gültigen Monatsrückblicke des Jahres. Lies sie vollständig. Das ist die einzige Quelle; Monate ohne Rückblick werden nicht nachrecherchiert, und `luecken` bleibt leer.
- `titel` ist „Jahresrückblick <Jahr>“, wenn alle 12 Monate vorliegen, sonst „Kurzrückblick <Jahr>“. Den ersten Rückblick am 1.1.2027 gibt es nur für November und Dezember 2026.

## 4. Meldungen des Jahres

Pro Überthema höchstens 10 Meldungen, mit Ausnahme bis 12 und Eintrag in `ausnahmen`:
- Wähle die Entwicklungen, die das Jahr geprägt haben. `datum` ist der Beginn, `datum_bis` das Ende der Entwicklung.
- Schreib so, dass man den Text ohne Vorwissen versteht: kurz einordnen, wer beteiligt war und wann es geschah („Im März …“).
- Quellen übernimmst du aus den Monatsrückblicken.
- Die IDs lauten `<id_praefix>-<hauptthema>-<Nummer>`, z. B. `2026-weltpolitik-1`.

## 5. Monatsüberblick

Für jedes Überthema ein Abschnitt `monatsueberblick` mit `"titel": "Monatsüberblick"`:
- Ein Eintrag pro vorhandenem Monatsrückblick, mit `monat` (`JJJJ-MM`) und `text` (1 bis 2 Sätze).
- War das Thema in einem Monat ruhig, schreibst du „Keine größeren Entwicklungen.“
- In `ruhig` steht ein Thema deshalb nur, wenn es weder Meldungen noch einen Monatsüberblick hat.

## 6. Ausblick

Für jedes Überthema höchstens ein Abschnitt `ausblick` mit `"titel": "Ausblick auf <neues Jahr>"`:
- Nur bereits angekündigte Termine und Entscheidungen des neuen Jahres, etwa Wahlen, Gipfel, Inkrafttreten von Gesetzen, angekündigte Produkt- oder Börsentermine.
- Keine Prognosen.
- Einträge mit `datum` (`JJJJ-MM-TT` oder `JJJJ-MM`), `text` und `quelle`.
- Höchstens 2 Websuchen pro Thema.
- Ohne gesicherte Termine lässt du den Abschnitt für dieses Thema weg.

## 7. Videos des Jahres

- Bis zu 5 Videos, nur aus den `videos` der Monatsrückblicke.
- Mehrere dürfen dasselbe Überthema haben.
- Wähle die Videos, die eine prägende Entwicklung des Jahres am besten erklären.
- Die Felder übernimmst du unverändert, nur `warum` darfst du auf das Jahr beziehen.

## 8. Schreiben, prüfen, veröffentlichen

1. Schreib `../feed-daten/<datei>` mit den Feldern aus `regeln.md` Abschnitt 11. `titel`, `zeitraum` und `erschienen` (= `jetzt`) kommen aus Schritt 3.
2. Prüfe die Datei, bis „OK“ kommt:
   ```bash
   python3 routinen/feed.py pruefen ../feed-daten/<datei>
   ```
3. Veröffentliche sie:
   ```bash
   python3 routinen/feed.py veroeffentlichen "jaehrlich <Jahr>"
   ```

Fertig ist der Lauf, wenn „Gepusht nach origin claude/feed-daten.“ erscheint.
