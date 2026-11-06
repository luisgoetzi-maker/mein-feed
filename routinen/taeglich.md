# Ablauf: täglicher Lauf

Die Tagesausgabe fasst den **Vortag** zusammen (Wiener Zeit) und erscheint um 3:07. Du hast vorher `BAUPLAN.md`, `config/regeln.md` und `config/themen.json` gelesen.

**Grundregeln für diesen Lauf**
- Du arbeitest in der Repo-Wurzel auf `main` und änderst dort nichts. Die Daten liegen nach Schritt 1 im Ordner `../feed-daten` (eigener Worktree des Branches `claude/feed-daten`). Geschrieben wird nur in `../feed-daten/data/`.
- Kein Pull Request, kein Push nach `main`. Gepusht wird nur über `python3 routinen/feed.py veroeffentlichen`, das nur nach `origin claude/feed-daten` pusht.
- Rufe `feed.py` immer aus der Repo-Wurzel auf und gib Bash-Aufrufen ein Timeout von 600000 ms.
- Geht etwas schief, schreibst du trotzdem eine Ausgabe mit `"status": "fehler"` (siehe Schritt 9).
- Sei sparsam: erst die Feed-Listen lesen, dann nur die Artikel öffnen, die du wahrscheinlich verwendest (meist 2 bis 5 pro Thema).

## 1. Vorbereiten

```bash
python3 routinen/feed.py vorbereiten
python3 routinen/feed.py zeitraum taeglich
```

`vorbereiten` holt den Branch `claude/feed-daten` nach `../feed-daten`. Gibt es ihn noch nicht, legt es ihn mit einer leeren `data/index.json` an.

`zeitraum` liefert unter anderem `datei` (z. B. `data/taeglich/2026-11-05.json`), `id_praefix`, `titel`, `jetzt` und `doppellauf`. Diese Werte übernimmst du unverändert.

## 2. Doppellauf vermeiden

Ist `doppellauf` gleich `true`, existiert die Ausgabe schon mit `ok` oder `ruhig`: Beende den Lauf sofort, ohne etwas zu ändern oder zu pushen. Steht `vorhanden_status` auf `fehler`, schreibst du die Ausgabe neu und überschreibst die alte.

## 3. Die letzten 7 Tage lesen

Lies die Tagesausgaben der 7 Tage vor dem Berichtstag in `../feed-daten/data/taeglich/`, soweit vorhanden. Notiere dir pro Thema, was dort schon stand. So vermeidest du Wiederholungen und erkennst Updates (`update: true`, siehe `regeln.md` Abschnitt 5).

## 4. Pro Überthema recherchieren

Gehe die Themen in der Reihenfolge aus `themen.json` durch:

1. Feeds lesen:
   ```bash
   python3 routinen/feed.py schlagzeilen <thema-id>
   ```
   Das listet alle Feed-Einträge des Berichtstags. Ist ein Feed „NICHT ERREICHBAR“, mach mit den anderen weiter.
2. Die `seiten` des Themas lesen (stehen am Ende der Ausgabe), etwa die Anthropic-News und das Änderungsprotokoll von Claude Code beim Thema `ki`.
3. Kandidaten wählen und die Artikel lesen, die du verwenden willst, um die Fakten zu prüfen.
4. Höchstens 2 Websuchen pro Thema, etwa um bei Weltpolitik und Politik eine zweite unabhängige Quelle zu finden oder eine Lücke in den Feeds zu schließen.
5. Jeden Kandidaten nach `regeln.md` prüfen (neu, konkret, passt zu den Schwerpunkten, überzeugender Satz für `warum_wichtig`). Höchstens 3 behalten, mit Ausnahme bis 5 und Eintrag in `ausnahmen`.

Hinweise je Thema:
- `weltpolitik` und `politik` nutzen teils dieselben Feeds (ORF). Jede Meldung kommt nur einmal vor; entscheide das passende `hauptthema`.
- `ki`: Claude-Neuerungen haben Vorrang. KI-getriebene Wirtschaftsmeldungen bekommen `ki` als Hauptthema und `wirtschaft` als weiteres Thema.
- `tirol`: Veranstaltungen der nächsten 7 Tage dürfen hinein; `datum` ist der Tag der Ankündigung.
- `startups`: täglich nur große Finanzierungsrunden, Börsengänge und Pleiten (Schwellen in `regeln.md`).

## 5. Ausgabe schreiben

Schreib `../feed-daten/<datei>` mit genau den Feldern aus `regeln.md` Abschnitt 11:
- `format` ist `taeglich`; `titel`, `zeitraum` und `erschienen` (= `jetzt`) kommen aus Schritt 1.
- `luecken`, `videos` und `abschnitte` sind leer.
- `meldungen` sind nach Thema geordnet, die wichtigste zuerst. Die IDs lauten `<id_praefix>-<hauptthema>-1`, `-2` usw.
- `ruhig` listet die Themen ohne Meldung und ohne Verweis.
- Bleibt keine einzige Meldung, gilt `"status": "ruhig"`, `meldungen` ist leer und `ruhig` enthält alle Themen.

## 6. Prüfen

```bash
python3 routinen/feed.py pruefen ../feed-daten/<datei>
```

Korrigiere jeden gemeldeten FEHLER und prüfe erneut, bis „OK“ kommt. HINWEISE solltest du lesen, sie blockieren aber nicht.

## 7. Aufräumen

```bash
python3 routinen/feed.py aufraeumen --ausfuehren
```

Das löscht nach den Löschregeln aus `BAUPLAN.md` und baut `data/index.json` neu. Lösch nie selbst Dateien, sonst kann etwas zu früh verschwinden.

## 8. Veröffentlichen

```bash
python3 routinen/feed.py veroeffentlichen "taeglich <Berichtstag>"
```

Das baut `index.json` neu, committet `data/` und pusht nach `origin claude/feed-daten`. Lehnt GitHub den Push ab, holt das Skript den neuen Stand und versucht es erneut.

Fertig ist der Lauf, wenn „Gepusht nach origin claude/feed-daten.“ erscheint und die Prüfung aus Schritt 6 „OK“ war. Nenne im Abschlussbericht kurz die Zahl der Meldungen pro Thema und nicht erreichbare Quellen.

## 9. Wenn etwas schiefgeht

- Eine einzelne Quelle oder ein Feed ist nicht erreichbar: Das ist kein Fehler. Nutze die anderen Quellen.
- Du kannst die Ausgabe nicht sinnvoll fertigstellen, weil zum Beispiel keine Quelle erreichbar ist oder ein Skript dauerhaft scheitert:
  1. Schreib die Ausgabe mit `"status": "fehler"`, einem kurzen Satz in `fehler` und allem, was schon fertig ist.
  2. Prüfe sie mit Schritt 6.
  3. Veröffentliche sie mit Schritt 8. Schritt 7 lässt du aus.
- Scheitert sogar das Veröffentlichen, nenne die genaue Fehlermeldung im Abschlussbericht.
