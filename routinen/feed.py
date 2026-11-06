#!/usr/bin/env python3
"""Hilfsskript für die geplanten Läufe von „Mein Feed“.

Nur Python-Standardbibliothek. Aufruf aus der Repo-Wurzel (Branch main):

  python3 routinen/feed.py zeitraum <format>        Berichtszeitraum, Datei, Titel, Eingaben, Lücken
  python3 routinen/feed.py vorbereiten               Daten-Branch als Worktree ../feed-daten holen/anlegen
  python3 routinen/feed.py warten <format>           bis zu 9 Minuten auf die Vorstufe warten
  python3 routinen/feed.py schlagzeilen <thema>      Feed-Einträge des Zeitraums auflisten
  python3 routinen/feed.py videos                    Video-Kandidaten der Positivliste auflisten
  python3 routinen/feed.py pruefen <datei>           Ausgabe gegen die Regeln prüfen
  python3 routinen/feed.py index                     data/index.json aus den Dateien neu bauen
  python3 routinen/feed.py aufraeumen [--ausfuehren] Löschregeln anwenden (nur täglicher Lauf)
  python3 routinen/feed.py veroeffentlichen "<msg>"  committen und nach origin claude/feed-daten pushen

Formate: taeglich, woechentlich, monatlich, jaehrlich.
"""

import argparse
import datetime as dt
import email.utils
import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
THEMEN_DATEI = REPO / "config" / "themen.json"
WORKTREE = Path(os.environ.get("MEIN_FEED_DATEN", REPO.parent / "feed-daten"))
DATEN = WORKTREE / "data"
BRANCH = "claude/feed-daten"
REMOTE_REF = f"refs/remotes/origin/{BRANCH}"
REFSPEC = f"+refs/heads/{BRANCH}:{REMOTE_REF}"

FORMATE = ["taeglich", "woechentlich", "monatlich", "jaehrlich"]
OBERGRENZE = {"taeglich": 3, "woechentlich": 5, "monatlich": 8, "jaehrlich": 10}
AUSNAHME_PLUS = 2
VIDEOS_GESAMT = {"taeglich": 0, "woechentlich": 3, "monatlich": 5, "jaehrlich": 5}
VIDEOS_PRO_THEMA = {"taeglich": 0, "woechentlich": 1, "monatlich": 2, "jaehrlich": None}
ABSCHNITT_FORMAT = {
    "finanzierungsrunden": "woechentlich",
    "gescheitert": "monatlich",
    "monatsueberblick": "jaehrlich",
    "ausblick": "jaehrlich",
}
ABSCHNITT_FELDER = {
    "finanzierungsrunden": ["name", "betrag", "land", "bereich", "investoren", "datum", "quelle"],
    "gescheitert": ["name", "text", "quelle"],
    "monatsueberblick": ["monat", "text"],
    "ausblick": ["datum", "text", "quelle"],
}
SCHONFRIST = dt.timedelta(days=7)
GUELTIG = ("ok", "ruhig")

MONATE = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli",
          "August", "September", "Oktober", "November", "Dezember"]
WOCHENTAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
USER_AGENT = "Mozilla/5.0 (compatible; MeinFeed/1.0; +https://github.com)"


# ---------------------------------------------------------------- Zeit

def _wien_tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo("Europe/Vienna")
    except Exception:
        return None


WIEN = _wien_tz()


def _wien_offset(utc):
    """Ersatz ohne tzdata: MEZ/MESZ nach EU-Regel (letzter Sonntag im März/Oktober, 1:00 UTC)."""
    def letzter_sonntag(jahr, monat):
        d = dt.date(jahr, monat + 1, 1) - dt.timedelta(days=1)
        return d - dt.timedelta(days=(d.weekday() - 6) % 7)
    beginn = dt.datetime.combine(letzter_sonntag(utc.year, 3), dt.time(1), dt.timezone.utc)
    ende = dt.datetime.combine(letzter_sonntag(utc.year, 10), dt.time(1), dt.timezone.utc)
    return dt.timezone(dt.timedelta(hours=2 if beginn <= utc < ende else 1))


def jetzt_wien():
    utc = dt.datetime.now(dt.timezone.utc)
    if WIEN is not None:
        return utc.astimezone(WIEN).replace(microsecond=0)
    return utc.astimezone(_wien_offset(utc)).replace(microsecond=0)


def als_wien(zeit):
    if zeit.tzinfo is None:
        zeit = zeit.replace(tzinfo=dt.timezone.utc)
    if WIEN is not None:
        return zeit.astimezone(WIEN)
    utc = zeit.astimezone(dt.timezone.utc)
    return utc.astimezone(_wien_offset(utc))


def datum(text):
    return dt.date.fromisoformat(text)


def zeitpunkt(text):
    return dt.datetime.fromisoformat(text.replace("Z", "+00:00"))


def tage(von, bis):
    d = von
    while d <= bis:
        yield d
        d += dt.timedelta(days=1)


def lang(d, jahr=True):
    s = f"{d.day}. {MONATE[d.month - 1]}"
    return f"{s} {d.year}" if jahr else s


# ---------------------------------------------------------------- Dateien

def lies_json(pfad):
    with open(pfad, encoding="utf-8") as f:
        return json.load(f)


def schreib_json(pfad, daten):
    pfad.parent.mkdir(parents=True, exist_ok=True)
    with open(pfad, "w", encoding="utf-8") as f:
        json.dump(daten, f, ensure_ascii=False, indent=2)
        f.write("\n")


def themen():
    return sorted(lies_json(THEMEN_DATEI)["themen"], key=lambda t: t["reihenfolge"])


def schluessel(fmt, von, bis):
    if fmt == "taeglich":
        return von.isoformat()
    if fmt == "woechentlich":
        return f"{von.isoformat()}_{bis.isoformat()}"
    if fmt == "monatlich":
        return f"{von.year:04d}-{von.month:02d}"
    return f"{von.year:04d}"


def relpfad(fmt, von, bis):
    return f"data/{fmt}/{schluessel(fmt, von, bis)}.json"


def ausgaben(daten=None):
    """Alle vorhandenen Ausgaben als Liste von dicts (ohne index.json)."""
    daten = daten or DATEN
    liste = []
    for fmt in FORMATE:
        ordner = daten / fmt
        if not ordner.is_dir():
            continue
        for datei in sorted(ordner.glob("*.json")):
            try:
                inhalt = lies_json(datei)
                von = datum(inhalt["zeitraum"]["von"])
                bis = datum(inhalt["zeitraum"]["bis"])
                erschienen = zeitpunkt(inhalt["erschienen"])
            except Exception as fehler:  # kaputte Datei: sichtbar machen, nicht löschen
                print(f"HINWEIS: {datei} nicht lesbar: {fehler}", file=sys.stderr)
                continue
            liste.append({
                "format": fmt, "von": von, "bis": bis, "status": inhalt.get("status"),
                "erschienen": erschienen, "titel": inhalt.get("titel"),
                "datei": f"data/{fmt}/{datei.name}", "pfad": datei, "inhalt": inhalt,
            })
    return liste


def feed_start(daten=None):
    daten = daten or DATEN
    index = daten / "index.json"
    if index.exists():
        try:
            start = lies_json(index).get("start")
            if start:
                return datum(start)
        except Exception:
            pass
    tageweise = [a["von"] for a in ausgaben(daten) if a["format"] == "taeglich"]
    return min(tageweise) if tageweise else None


# ---------------------------------------------------------------- zeitraum

def berechne_zeitraum(fmt, heute):
    if fmt == "taeglich":
        von = bis = heute - dt.timedelta(days=1)
    elif fmt == "woechentlich":
        abstand = (heute.weekday() - 5) % 7 or 7  # letzter Samstag vor heute
        bis = heute - dt.timedelta(days=abstand)
        von = bis - dt.timedelta(days=6)
    elif fmt == "monatlich":
        bis = heute.replace(day=1) - dt.timedelta(days=1)
        von = bis.replace(day=1)
    elif fmt == "jaehrlich":
        von, bis = dt.date(heute.year - 1, 1, 1), dt.date(heute.year - 1, 12, 31)
    else:
        raise SystemExit(f"Unbekanntes Format: {fmt}")
    return von, bis


def titel_fuer(fmt, von, bis, start, vorhandene_monate=None):
    ab = ""
    if start and von < start <= bis and fmt in ("woechentlich", "monatlich"):
        ab = f" (ab {lang(start, jahr=False)})"
    if fmt == "taeglich":
        return f"{WOCHENTAGE[von.weekday()]}, {lang(von)}"
    if fmt == "woechentlich":
        if von.year != bis.year:
            return f"Woche vom {lang(von)} bis {lang(bis)}{ab}"
        if von.month != bis.month:
            return f"Woche vom {lang(von, jahr=False)} bis {lang(bis)}{ab}"
        return f"Woche vom {von.day}. bis {lang(bis)}{ab}"
    if fmt == "monatlich":
        return f"{MONATE[von.month - 1]} {von.year}{ab}"
    voll = vorhandene_monate is not None and len(vorhandene_monate) == 12
    return f"{'Jahresrückblick' if voll else 'Kurzrückblick'} {von.year}"


def eingaben_und_luecken(fmt, von, bis, alle, start):
    """Welche vorhandenen Ausgaben ein Rückblick liest und welche Tage er selbst nachrecherchiert."""
    def gueltig(a):
        return a["status"] in GUELTIG

    def ueberlappt(a):
        return a["von"] <= bis and a["bis"] >= von

    if fmt == "taeglich":
        return [], []
    if fmt == "jaehrlich":
        monate = [a for a in alle if a["format"] == "monatlich" and ueberlappt(a) and gueltig(a)]
        return sorted(monate, key=lambda a: a["von"]), []
    if fmt == "woechentlich":
        tagesausgaben = [a for a in alle if a["format"] == "taeglich" and ueberlappt(a)]
        gedeckt = {a["von"] for a in tagesausgaben if gueltig(a)}
        eingaben = sorted(tagesausgaben, key=lambda a: a["von"])
    else:  # monatlich
        wochen = [a for a in alle if a["format"] == "woechentlich" and ueberlappt(a) and gueltig(a)]
        in_wochen = {d for w in wochen for d in tage(w["von"], w["bis"])}
        tagesausgaben = [a for a in alle if a["format"] == "taeglich" and ueberlappt(a)
                         and a["von"] not in in_wochen]
        gedeckt = in_wochen | {a["von"] for a in tagesausgaben if gueltig(a)}
        eingaben = sorted(wochen + tagesausgaben, key=lambda a: (a["von"], a["format"]))
    luecken = [d for d in tage(von, bis) if d not in gedeckt and (start is None or d >= start)]
    return eingaben, luecken


def vorstufen(fmt, heute, von, bis):
    """Dateien, die heute vor diesem Lauf erscheinen sollen (Reihenfolge der Sonderfall-Tabelle)."""
    gestern = heute - dt.timedelta(days=1)
    liste = []
    if fmt in ("woechentlich", "monatlich"):
        liste.append(relpfad("taeglich", gestern, gestern))
    if fmt == "monatlich" and heute.weekday() == 6:
        w_von, w_bis = berechne_zeitraum("woechentlich", heute)
        liste.append(relpfad("woechentlich", w_von, w_bis))
    if fmt == "jaehrlich":
        dez = dt.date(von.year, 12, 1)
        liste.append(relpfad("monatlich", dez, bis))
    return liste


def cmd_zeitraum(args):
    heute = datum(args.heute) if args.heute else jetzt_wien().date()
    von, bis = berechne_zeitraum(args.format, heute)
    alle = ausgaben()
    start = feed_start()
    datei = relpfad(args.format, von, bis)
    vorhanden = next((a for a in alle if a["datei"] == datei), None)
    eingaben, luecken = eingaben_und_luecken(args.format, von, bis, alle, start)
    monate = [a for a in eingaben if a["format"] == "monatlich"] if args.format == "jaehrlich" else None
    ergebnis = {
        "format": args.format,
        "heute": heute.isoformat(),
        "jetzt": jetzt_wien().isoformat(),
        "zeitraum": {"von": von.isoformat(), "bis": bis.isoformat()},
        "datei": datei,
        "id_praefix": schluessel(args.format, von, bis),
        "titel": titel_fuer(args.format, von, bis, start, monate),
        "start": start.isoformat() if start else None,
        "vorhanden_status": vorhanden["status"] if vorhanden else None,
        "doppellauf": bool(vorhanden and vorhanden["status"] in GUELTIG),
        "vorstufen": vorstufen(args.format, heute, von, bis),
        "eingaben": [{"datei": a["datei"], "status": a["status"]} for a in eingaben],
        "luecken": [d.isoformat() for d in luecken],
    }
    print(json.dumps(ergebnis, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------- git

def git(*befehl, cwd=None, pruefen=True, leise=False):
    r = subprocess.run(["git", *befehl], cwd=cwd or REPO, text=True, capture_output=True)
    if pruefen and r.returncode != 0:
        raise SystemExit(f"git {' '.join(befehl)} fehlgeschlagen:\n{r.stdout}{r.stderr}")
    if not leise and r.stdout.strip():
        print(r.stdout.strip())
    return r


def remote_hat_branch():
    r = git("ls-remote", "--heads", "origin", BRANCH, pruefen=False, leise=True)
    if r.returncode != 0:
        raise SystemExit(f"Remote nicht erreichbar:\n{r.stderr}")
    return bool(r.stdout.strip())


def worktree_sauber():
    if not WORKTREE.exists():
        return True
    status = git("status", "--porcelain", cwd=WORKTREE, leise=True).stdout.strip()
    voraus = git("rev-list", "--count", f"{REMOTE_REF}..HEAD", cwd=WORKTREE, pruefen=False, leise=True)
    return not status and voraus.stdout.strip() in ("0", "")


def leerer_index():
    return {"aktualisiert": jetzt_wien().isoformat(), "start": None, "ausgaben": []}


def cmd_vorbereiten(args=None):
    if remote_hat_branch():
        git("fetch", "--quiet", "origin", REFSPEC)
        if WORKTREE.exists():
            if worktree_sauber():
                git("reset", "--quiet", "--hard", REMOTE_REF, cwd=WORKTREE)
            else:
                print(f"HINWEIS: {WORKTREE} hat lokale Änderungen, nicht zurückgesetzt.")
        else:
            git("worktree", "add", "--quiet", "-B", BRANCH, str(WORKTREE), REMOTE_REF)
        print(f"Daten-Branch {BRANCH} liegt in {WORKTREE}")
    else:
        if WORKTREE.exists():
            print(f"{WORKTREE} existiert schon; Branch {BRANCH} ist noch nicht auf origin.")
            return
        git("worktree", "add", "--quiet", "--detach", str(WORKTREE), "HEAD")
        git("checkout", "--quiet", "--orphan", BRANCH, cwd=WORKTREE)
        git("rm", "-r", "-f", "--quiet", ".", cwd=WORKTREE)
        schreib_json(DATEN / "index.json", leerer_index())
        print(f"Neuer Branch {BRANCH} mit leerer data/index.json in {WORKTREE} angelegt (noch nicht gepusht).")


def cmd_warten(args):
    heute = datum(args.heute) if args.heute else jetzt_wien().date()
    von, bis = berechne_zeitraum(args.format, heute)
    benoetigt = vorstufen(args.format, heute, von, bis)
    if not benoetigt:
        print("Keine Vorstufe nötig.")
        return
    ende = time.monotonic() + args.minuten * 60
    while True:
        fehlend = []
        if remote_hat_branch():
            git("fetch", "--quiet", "origin", REFSPEC)
            for pfad in benoetigt:
                r = git("cat-file", "-e", f"{REMOTE_REF}:{pfad}", pruefen=False, leise=True)
                if r.returncode != 0:
                    fehlend.append(pfad)
        else:
            fehlend = benoetigt
        if not fehlend:
            print("Vorstufe liegt vor: " + ", ".join(benoetigt))
            cmd_vorbereiten()
            return
        rest = ende - time.monotonic()
        if rest <= 0:
            print("Noch nicht da: " + ", ".join(fehlend))
            sys.exit(3)
        time.sleep(min(60, rest))


def cmd_veroeffentlichen(args):
    if not WORKTREE.exists():
        raise SystemExit("Kein Worktree. Zuerst: python3 routinen/feed.py vorbereiten")
    baue_index()
    name = git("config", "user.name", cwd=WORKTREE, pruefen=False, leise=True).stdout.strip()
    identitaet = [] if name else ["-c", "user.name=Mein Feed", "-c", "user.email=mein-feed@users.noreply.github.com"]
    git("add", "-A", "data", cwd=WORKTREE)
    if git("diff", "--cached", "--quiet", cwd=WORKTREE, pruefen=False).returncode != 0:
        git(*identitaet, "commit", "--quiet", "-m", args.nachricht, cwd=WORKTREE)
    else:
        print("Keine Änderungen zu committen.")
    for versuch in range(5):
        r = git("push", "--quiet", "-u", "origin", f"HEAD:refs/heads/{BRANCH}", cwd=WORKTREE, pruefen=False)
        if r.returncode == 0:
            print(f"Gepusht nach origin {BRANCH}.")
            return
        print(f"Push abgelehnt (Versuch {versuch + 1}): {r.stderr.strip()}")
        time.sleep(2 ** (versuch + 1))
        if git("fetch", "--quiet", "origin", REFSPEC, cwd=WORKTREE, pruefen=False).returncode != 0:
            # Branch noch nicht auf origin (erster Lauf) oder Netz kurz weg: nichts zu holen, neu pushen
            continue
        r = git("rebase", REMOTE_REF, cwd=WORKTREE, pruefen=False)
        if r.returncode != 0:
            konflikte = set(git("diff", "--name-only", "--diff-filter=U", cwd=WORKTREE,
                                leise=True).stdout.split())
            if konflikte <= {"data/index.json"}:
                try:
                    baue_index()
                    git("add", "data/index.json", cwd=WORKTREE)
                    env = dict(os.environ, GIT_EDITOR="true")
                    weiter = subprocess.run(["git", *identitaet, "rebase", "--continue"], cwd=WORKTREE,
                                            text=True, capture_output=True, env=env)
                    if weiter.returncode != 0:
                        raise RuntimeError(weiter.stdout + weiter.stderr)
                except (Exception, SystemExit) as fehler:
                    git("rebase", "--abort", cwd=WORKTREE, pruefen=False)
                    raise SystemExit(f"Rebase fehlgeschlagen:\n{fehler}")
            else:
                git("rebase", "--abort", cwd=WORKTREE, pruefen=False)
                raise SystemExit(f"Konflikt in {sorted(konflikte)}; bitte von Hand lösen.")
        if baue_index():
            git("add", "data/index.json", cwd=WORKTREE)
            git(*identitaet, "commit", "--quiet", "--amend", "--no-edit", cwd=WORKTREE)
    raise SystemExit("Push nach 5 Versuchen fehlgeschlagen.")


# ---------------------------------------------------------------- index

def baue_index(daten=None):
    """Baut index.json neu. Gibt True zurück, wenn sich der Inhalt geändert hat."""
    daten = daten or DATEN
    pfad = daten / "index.json"
    try:
        alt = lies_json(pfad) if pfad.exists() else leerer_index()
    except ValueError:  # z. B. Konfliktmarker nach einem Rebase: Stand von origin nehmen
        r = git("show", f"{REMOTE_REF}:data/index.json", cwd=WORKTREE, pruefen=False, leise=True)
        try:
            alt = json.loads(r.stdout) if r.returncode == 0 else leerer_index()
        except ValueError:
            alt = leerer_index()
    alle = ausgaben(daten)
    start = alt.get("start")
    if not start:
        tageweise = [a["von"] for a in alle if a["format"] == "taeglich"]
        start = min(tageweise).isoformat() if tageweise else None
    liste = sorted(alle, key=lambda a: (FORMATE.index(a["format"]), -a["von"].toordinal()))
    eintraege = [{
        "format": a["format"],
        "titel": a["titel"],
        "zeitraum": {"von": a["von"].isoformat(), "bis": a["bis"].isoformat()},
        "datei": a["datei"],
        "status": a["status"],
        "erschienen": a["inhalt"].get("erschienen"),
    } for a in liste]
    if alt.get("start") == start and alt.get("ausgaben") == eintraege:
        return False
    schreib_json(pfad, {"aktualisiert": jetzt_wien().isoformat(), "start": start, "ausgaben": eintraege})
    return True


def cmd_index(args):
    print("index.json aktualisiert." if baue_index() else "index.json war aktuell.")


# ---------------------------------------------------------------- aufraeumen

HOEHER = {
    "taeglich": ["woechentlich", "monatlich", "jaehrlich"],
    "woechentlich": ["monatlich", "jaehrlich"],
    "monatlich": ["jaehrlich"],
    "jaehrlich": [],
}


def loeschbar(alle, jetzt):
    """Eine Ausgabe verschwindet, wenn jeder ihrer Tage in einer erschienenen höheren Stufe steckt
    und seit dieser Abdeckung (und seit ihrem eigenen Erscheinen) mindestens 7 Tage vergangen sind."""
    ergebnis = []
    for a in alle:
        hoeher = [h for h in alle if h["format"] in HOEHER[a["format"]] and h["status"] in GUELTIG]
        if not hoeher:
            continue
        abgedeckt_seit = None
        for d in tage(a["von"], a["bis"]):
            deckend = [h["erschienen"] for h in hoeher if h["von"] <= d <= h["bis"]]
            if not deckend:
                abgedeckt_seit = None
                break
            seit = min(deckend)
            abgedeckt_seit = seit if abgedeckt_seit is None else max(abgedeckt_seit, seit)
        if abgedeckt_seit is None:
            continue
        if jetzt - abgedeckt_seit >= SCHONFRIST and jetzt - a["erschienen"] >= SCHONFRIST:
            ergebnis.append(a)
    return ergebnis


def cmd_aufraeumen(args):
    jetzt = zeitpunkt(args.jetzt) if args.jetzt else jetzt_wien()
    weg = loeschbar(ausgaben(), jetzt)
    if not weg:
        print("Nichts zu löschen.")
    for a in weg:
        print(("Lösche " if args.ausfuehren else "Würde löschen: ") + a["datei"])
        if args.ausfuehren:
            a["pfad"].unlink()
    if args.ausfuehren:
        baue_index()


# ---------------------------------------------------------------- abrufen

def hole(url, timeout=20):
    kopf = {"User-Agent": USER_AGENT, "Accept-Language": "de-AT,de;q=0.9,en;q=0.8"}
    if "youtube.com" in url:
        kopf["Cookie"] = "CONSENT=YES+1; SOCS=CAI"
    anfrage = urllib.request.Request(url, headers=kopf)
    with urllib.request.urlopen(anfrage, timeout=timeout) as antwort:
        return antwort.read().decode(antwort.headers.get_content_charset() or "utf-8", "replace")


def ohne_html(text, laenge=240):
    text = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= laenge else text[: laenge - 1].rstrip() + "…"


def lies_zeit(text):
    if not text:
        return None
    text = text.strip()
    try:
        return email.utils.parsedate_to_datetime(text)
    except (TypeError, ValueError):
        pass
    try:
        return zeitpunkt(text)
    except ValueError:
        return None


def _lokal(tag):
    return tag.rsplit("}", 1)[-1]


def lies_feed(xml_text):
    """RSS 2.0 und Atom. Liefert dicts mit titel, link, zeit, text, video_id."""
    wurzel = ET.fromstring(xml_text)
    eintraege = []
    for el in wurzel.iter():
        if _lokal(el.tag) not in ("item", "entry"):
            continue
        felder = {"titel": "", "link": "", "zeit": None, "text": "", "video_id": None}
        for kind in el:
            name = _lokal(kind.tag)
            if name == "title":
                felder["titel"] = ohne_html(kind.text, 300)
            elif name == "link":
                href = kind.get("href")
                if href and kind.get("rel", "alternate") == "alternate":
                    felder["link"] = href
                elif kind.text and kind.text.strip():
                    felder["link"] = kind.text.strip()
            elif name in ("pubDate", "published", "updated", "date") and felder["zeit"] is None:
                felder["zeit"] = lies_zeit(kind.text)
            elif name in ("description", "summary", "content") and not felder["text"]:
                felder["text"] = ohne_html(kind.text)
            elif name == "videoId":
                felder["video_id"] = (kind.text or "").strip()
            elif name == "group":
                for g in kind:
                    if _lokal(g.tag) == "description" and not felder["text"]:
                        felder["text"] = ohne_html(g.text)
        eintraege.append(felder)
    return eintraege


def zeitraum_aus_args(args, fmt="taeglich"):
    if args.von and args.bis:
        return datum(args.von), datum(args.bis)
    heute = datum(args.heute) if getattr(args, "heute", None) else jetzt_wien().date()
    return berechne_zeitraum(fmt, heute)


def im_zeitraum(zeit, von, bis):
    if zeit is None:
        return True  # ohne Datum lieber zeigen als verschlucken
    return von <= als_wien(zeit).date() <= bis


def cmd_schlagzeilen(args):
    von, bis = zeitraum_aus_args(args, args.format)
    thema = next((t for t in themen() if t["id"] == args.thema), None)
    if thema is None:
        raise SystemExit(f"Unbekanntes Thema {args.thema}; gültig: {', '.join(t['id'] for t in themen())}")
    print(f"# {thema['name']}: {von} bis {bis}")
    gesehen = set()
    for feed in thema.get("feeds", []):
        try:
            eintraege = lies_feed(hole(feed["url"]))
        except Exception as fehler:
            print(f"\n## {feed['name']}: NICHT ERREICHBAR ({fehler.__class__.__name__}: {fehler})")
            continue
        treffer = [e for e in eintraege if im_zeitraum(e["zeit"], von, bis)]
        print(f"\n## {feed['name']} ({len(treffer)} im Zeitraum)")
        for e in treffer[: args.max]:
            schluessel_ = (e["link"] or e["titel"]).split("?")[0]
            if schluessel_ in gesehen:
                continue
            gesehen.add(schluessel_)
            zeit = als_wien(e["zeit"]).strftime("%d.%m. %H:%M") if e["zeit"] else "ohne Datum"
            print(f"- [{zeit}] {e['titel']}\n  {e['link']}")
            if e["text"] and e["text"] != e["titel"]:
                print(f"  {e['text']}")
    if thema.get("seiten"):
        print("\nSeiten ohne Feed, bitte direkt lesen: "
              + ", ".join(f"{s['name']} {s['url']}" for s in thema["seiten"]))


def kanal_id(kanal):
    if kanal.get("kanal_id"):
        return kanal["kanal_id"]
    seite = hole(f"https://www.youtube.com/{kanal['handle']}")
    for muster in (r'"externalId":"(UC[\w-]{22})"',
                   r'<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]{22})"',
                   r'"browseId":"(UC[\w-]{22})"'):
        m = re.search(muster, seite)
        if m:
            return m.group(1)
    raise ValueError("Kanal-ID nicht gefunden")


def video_dauer(video_url):
    seite = hole(video_url)
    m = re.search(r'"lengthSeconds":"(\d+)"', seite)
    if m:
        return int(m.group(1))
    m = re.search(r'itemprop="duration" content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"', seite)
    if m:
        h, mi, s = (int(x or 0) for x in m.groups())
        return h * 3600 + mi * 60 + s
    return None


def cmd_videos(args):
    von, bis = zeitraum_aus_args(args, args.format)
    gewaehlt = set(args.themen.split(",")) if args.themen else None
    kandidaten = []
    for thema in themen():
        if not thema.get("videos") or (gewaehlt and thema["id"] not in gewaehlt):
            continue
        for kanal in thema.get("youtube_kanaele", []):
            try:
                kid = kanal_id(kanal)
                eintraege = lies_feed(hole(f"https://www.youtube.com/feeds/videos.xml?channel_id={kid}"))
            except Exception as fehler:
                print(f"HINWEIS: {kanal['name']} nicht abrufbar ({fehler})", file=sys.stderr)
                continue
            if not kanal.get("kanal_id"):
                print(f"HINWEIS: {kanal['name']} hat kanal_id {kid} (in themen.json eintragbar)", file=sys.stderr)
            for e in eintraege:
                if not im_zeitraum(e["zeit"], von, bis) and not args.alle:
                    continue
                url = e["link"] or f"https://www.youtube.com/watch?v={e['video_id']}"
                short = "/shorts/" in url
                if e["video_id"]:
                    url = f"https://www.youtube.com/watch?v={e['video_id']}"
                try:
                    sekunden = None if short else video_dauer(url)
                except Exception:
                    sekunden = None
                kandidaten.append({
                    "thema": thema["id"],
                    "kanal": kanal["name"],
                    "titel": e["titel"],
                    "datum": als_wien(e["zeit"]).date().isoformat() if e["zeit"] else None,
                    "url": url,
                    "dauer_min": round(sekunden / 60) if sekunden else None,
                    "erlaubt": not short and (sekunden is None or sekunden >= 180),
                    "grund": "Short" if short else ("unter 3 Minuten" if sekunden and sekunden < 180 else
                                                    ("Länge unbekannt, selbst prüfen" if sekunden is None else "")),
                    "beschreibung": e["text"],
                })
    print(json.dumps(kandidaten, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------- pruefen

def domain(url):
    teile = urllib.parse.urlparse(url).netloc.lower().split(":")[0].removeprefix("www.").split(".")
    if len(teile) >= 3 and len(teile[-1]) == 2 and teile[-2] in ("co", "com", "gv", "or", "ac", "org"):
        return ".".join(teile[-3:])
    return ".".join(teile[-2:])


def pruefe_ausgabe(pfad, daten=None):
    daten = daten or DATEN
    fehler, hinweise = [], []
    F, H = fehler.append, hinweise.append
    try:
        a = lies_json(pfad)
    except Exception as e:
        return [f"Kein gültiges JSON: {e}"], []
    alle_themen = themen()
    ids = [t["id"] for t in alle_themen]
    pflicht = {t["id"] for t in alle_themen if t.get("zwei_quellen_pflicht")}
    videothemen = {t["id"] for t in alle_themen if t.get("videos")}
    positiv = set()
    for t in alle_themen:
        for k in t.get("youtube_kanaele", []):
            positiv.add(k["name"].lower())
            positiv.add(k.get("handle", "").lower().lstrip("@"))

    felder = ["format", "titel", "zeitraum", "erschienen", "status", "fehler", "ruhig", "luecken",
              "ausnahmen", "meldungen", "videos", "abschnitte"]
    for f in felder:
        if f not in a:
            F(f"Feld „{f}“ fehlt")
    if fehler:
        return fehler, hinweise
    unbekannt = set(a) - set(felder) - {"beispiel"}
    if unbekannt:
        F(f"Unbekannte Felder: {sorted(unbekannt)}")

    fmt = a["format"]
    if fmt not in FORMATE:
        return [f"Unbekanntes format „{fmt}“"], hinweise
    try:
        von, bis = datum(a["zeitraum"]["von"]), datum(a["zeitraum"]["bis"])
    except Exception:
        return ["zeitraum braucht von und bis als JJJJ-MM-TT"], hinweise
    praefix = schluessel(fmt, von, bis)
    erwartet = f"{praefix}.json"
    if Path(pfad).name != erwartet or Path(pfad).parent.name != fmt:
        F(f"Datei sollte data/{fmt}/{erwartet} heißen")
    try:
        zeitpunkt(a["erschienen"])
    except Exception:
        F("erschienen ist kein Zeitpunkt wie 2026-11-06T03:12:00+01:00")
    if not isinstance(a["titel"], str) or not a["titel"].strip():
        F("titel ist leer")

    status = a["status"]
    if status not in ("ok", "ruhig", "fehler"):
        F(f"status „{status}“ ungültig")
    if status == "fehler" and not a["fehler"]:
        F("status fehler braucht einen Text in fehler")
    if status != "fehler" and a["fehler"] is not None:
        F("fehler muss null sein, wenn status nicht fehler ist")
    for liste in ("ruhig", "luecken", "ausnahmen", "meldungen", "videos", "abschnitte"):
        if not isinstance(a[liste], list):
            F(f"{liste} muss eine Liste sein")
    if fehler:
        return fehler, hinweise

    meldungen = a["meldungen"]
    if status == "ruhig" and meldungen:
        F("status ruhig, aber es gibt Meldungen")
    if status == "ok" and not meldungen and (fmt == "taeglich" or not (a["videos"] or a["abschnitte"])):
        F("status ok ohne Meldungen; dann ist es status ruhig")
    if fmt == "taeglich":
        for liste in ("luecken", "videos", "abschnitte"):
            if a[liste]:
                F(f"Tagesausgaben haben keine {liste}")

    # Meldungen
    gesehen_ids = set()
    pro_thema = {}
    for i, m in enumerate(meldungen, 1):
        wo = f"Meldung {i} ({m.get('id', 'ohne id')})"
        for f in ("id", "datum", "datum_bis", "titel", "text", "warum_wichtig", "themen", "hauptthema",
                  "update", "quellen"):
            if f not in m:
                F(f"{wo}: Feld „{f}“ fehlt")
        if any(f not in m for f in ("id", "datum", "themen", "hauptthema", "quellen")):
            continue
        haupt = m["hauptthema"]
        pro_thema[haupt] = pro_thema.get(haupt, 0) + 1
        if m["id"] in gesehen_ids:
            F(f"{wo}: id doppelt")
        gesehen_ids.add(m["id"])
        if not re.fullmatch(re.escape(praefix) + r"-[a-z]+-\d+", m["id"]) or f"-{haupt}-" not in m["id"]:
            F(f"{wo}: id sollte {praefix}-{haupt}-<Nummer> sein")
        try:
            d = datum(m["datum"])
            if not von <= d <= bis:
                F(f"{wo}: datum {d} liegt nicht im Zeitraum")
            if m.get("datum_bis") is not None:
                if fmt == "taeglich":
                    F(f"{wo}: datum_bis gibt es nur in Rückblicken")
                elif not d < datum(m["datum_bis"]) <= bis:
                    F(f"{wo}: datum_bis muss nach datum und im Zeitraum liegen")
        except (ValueError, TypeError):
            F(f"{wo}: datum oder datum_bis ist kein JJJJ-MM-TT")
        for f in ("titel", "text", "warum_wichtig"):
            if not isinstance(m.get(f), str) or not m.get(f, "").strip():
                F(f"{wo}: {f} ist leer")
        if len(m.get("titel", "")) > 110:
            H(f"{wo}: titel ist sehr lang ({len(m['titel'])} Zeichen)")
        if len(m.get("text", "")) > 700:
            H(f"{wo}: text ist sehr lang ({len(m['text'])} Zeichen), 2 bis 4 Sätze")
        if not isinstance(m["themen"], list) or not m["themen"]:
            F(f"{wo}: themen muss eine nicht leere Liste sein")
        else:
            for t in m["themen"]:
                if t not in ids:
                    F(f"{wo}: unbekanntes Thema „{t}“")
            if len(set(m["themen"])) != len(m["themen"]):
                F(f"{wo}: Thema doppelt in themen")
            if haupt not in m["themen"]:
                F(f"{wo}: hauptthema „{haupt}“ steht nicht in themen")
        if not isinstance(m.get("update"), bool):
            F(f"{wo}: update muss true oder false sein")
        quellen = m["quellen"] if isinstance(m["quellen"], list) else []
        if not quellen:
            F(f"{wo}: mindestens eine Quelle nötig")
        for q in quellen:
            if not isinstance(q, dict) or not q.get("name") or not re.match(r"https?://", q.get("url", "")):
                F(f"{wo}: Quelle braucht name und url (https://…)")
        if haupt in pflicht and len({domain(q.get("url", "")) for q in quellen if isinstance(q, dict)}) < 2:
            F(f"{wo}: Thema {haupt} braucht zwei unabhängige Quellen von verschiedenen Websites")

    # Obergrenzen und Ausnahmen
    grenze = OBERGRENZE[fmt]
    ausnahme_themen = []
    for e in a["ausnahmen"]:
        if not isinstance(e, dict) or e.get("thema") not in ids or not str(e.get("grund", "")).strip():
            F("Jede Ausnahme braucht thema (gültige ID) und grund")
            continue
        ausnahme_themen.append(e["thema"])
    if len(set(ausnahme_themen)) != len(ausnahme_themen):
        F("Ein Thema steht mehrfach in ausnahmen")
    for t in ids:
        n = pro_thema.get(t, 0)
        erlaubt = grenze + (AUSNAHME_PLUS if t in ausnahme_themen else 0)
        if n > erlaubt:
            F(f"Thema {t}: {n} Meldungen, erlaubt sind {erlaubt}"
              + ("" if t in ausnahme_themen else f" (mit Eintrag in ausnahmen bis {grenze + AUSNAHME_PLUS})"))
        if t in ausnahme_themen and n <= grenze:
            F(f"Thema {t} steht in ausnahmen, überschreitet die Obergrenze {grenze} aber nicht")

    # Videos
    videos = a["videos"]
    if len(videos) > VIDEOS_GESAMT[fmt]:
        F(f"{len(videos)} Videos, erlaubt sind {VIDEOS_GESAMT[fmt]}")
    pro_thema_v = {}
    neue = 0
    monats_urls = None
    if fmt == "jaehrlich":
        monats_urls = {v.get("url") for x in ausgaben(daten) if x["format"] == "monatlich"
                       and x["von"].year == von.year for v in x["inhalt"].get("videos", [])}
    for i, v in enumerate(videos, 1):
        wo = f"Video {i} ({v.get('titel', 'ohne Titel')})"
        for f in ("titel", "kanal", "dauer_min", "datum", "url", "thema", "warum", "hintergrund", "neuer_kanal"):
            if f not in v:
                F(f"{wo}: Feld „{f}“ fehlt")
        if v.get("thema") not in videothemen:
            F(f"{wo}: Thema {v.get('thema')} bekommt keine Videos")
        pro_thema_v[v.get("thema")] = pro_thema_v.get(v.get("thema"), 0) + 1
        url = str(v.get("url", ""))
        if "/shorts/" in url or not re.match(r"https://(www\.)?(youtube\.com/watch\?v=|youtu\.be/)", url):
            F(f"{wo}: url muss ein normales YouTube-Video sein (kein Short)")
        if not isinstance(v.get("dauer_min"), int) or v.get("dauer_min", 0) < 3:
            F(f"{wo}: dauer_min muss eine ganze Zahl ab 3 sein")
        if v.get("neuer_kanal") is True:
            neue += 1
        elif str(v.get("kanal", "")).lower().lstrip("@") not in positiv:
            F(f"{wo}: Kanal „{v.get('kanal')}“ steht nicht in der Positivliste (sonst neuer_kanal: true)")
        try:
            vd = datum(v.get("datum"))
            if not v.get("hintergrund") and not von <= vd <= bis:
                F(f"{wo}: erschien nicht im Zeitraum (sonst hintergrund: true)")
        except (ValueError, TypeError):
            F(f"{wo}: datum ist kein JJJJ-MM-TT")
        if not str(v.get("warum", "")).strip():
            F(f"{wo}: warum ist leer")
        if monats_urls and url not in monats_urls:
            F(f"{wo}: Videos des Jahres müssen aus den Monatsrückblicken stammen")
    if neue > 1:
        F("Höchstens 1 Video mit neuer_kanal: true pro Ausgabe")
    pro_max = VIDEOS_PRO_THEMA[fmt]
    if pro_max is not None:
        for t, n in pro_thema_v.items():
            if n > pro_max:
                F(f"Thema {t}: {n} Videos, erlaubt sind {pro_max}")

    # Abschnitte
    for i, ab in enumerate(a["abschnitte"], 1):
        typ = ab.get("typ")
        wo = f"Abschnitt {i} ({typ})"
        if typ not in ABSCHNITT_FORMAT:
            F(f"{wo}: unbekannter typ")
            continue
        if ABSCHNITT_FORMAT[typ] != fmt:
            F(f"{wo}: gehört nur in {ABSCHNITT_FORMAT[typ]}")
        if ab.get("thema") not in ids:
            F(f"{wo}: thema fehlt oder ist unbekannt")
        if typ in ("finanzierungsrunden", "gescheitert") and ab.get("thema") != "startups":
            F(f"{wo}: thema muss startups sein")
        if not str(ab.get("titel", "")).strip():
            F(f"{wo}: titel ist leer")
        eintraege = ab.get("eintraege")
        if not isinstance(eintraege, list) or not eintraege:
            F(f"{wo}: eintraege muss eine nicht leere Liste sein")
            continue
        if typ == "finanzierungsrunden" and len(eintraege) > 10:
            F(f"{wo}: höchstens 10 Einträge")
        if typ == "gescheitert" and len(eintraege) != 1:
            F(f"{wo}: genau 1 Eintrag")
        for e in eintraege:
            for f in ABSCHNITT_FELDER[typ]:
                if f not in e:
                    F(f"{wo}: Eintrag ohne „{f}“")
            q = e.get("quelle")
            if "quelle" in ABSCHNITT_FELDER[typ] and not (isinstance(q, dict) and q.get("name")
                                                          and re.match(r"https?://", q.get("url", ""))):
                F(f"{wo}: quelle braucht name und url")
    gescheitert = [ab for ab in a["abschnitte"] if ab.get("typ") == "gescheitert"]
    if len(gescheitert) > 1:
        F("Höchstens ein Abschnitt gescheitert")

    # Lücken
    start = feed_start(daten)
    for l in a["luecken"]:
        try:
            ld = datum(l)
        except (ValueError, TypeError):
            F(f"Lücke {l} ist kein JJJJ-MM-TT")
            continue
        if not von <= ld <= bis:
            F(f"Lücke {l} liegt nicht im Zeitraum")
        if start and ld < start:
            F(f"Lücke {l} liegt vor dem Start des Feeds ({start}); das ist keine Lücke")

    # ruhig
    if status != "fehler":
        praesent = set()
        for m in meldungen:
            praesent.update(m.get("themen", []))
        praesent.update(v.get("thema") for v in videos)
        praesent.update(ab.get("thema") for ab in a["abschnitte"])
        erwartet_ruhig = [t for t in ids if t not in praesent]
        if a["ruhig"] != erwartet_ruhig:
            F(f"ruhig sollte {json.dumps(erwartet_ruhig)} sein")
    return fehler, hinweise


def cmd_pruefen(args):
    gesamt = 0
    for pfad in args.dateien:
        fehler, hinweise = pruefe_ausgabe(Path(pfad))
        for h in hinweise:
            print(f"HINWEIS {pfad}: {h}")
        for f in fehler:
            print(f"FEHLER {pfad}: {f}")
        if not fehler:
            print(f"OK {pfad}")
        gesamt += len(fehler)
    index = DATEN / "index.json"
    if index.exists():
        try:
            lies_json(index)
        except Exception as e:
            print(f"FEHLER {index}: kein gültiges JSON: {e}")
            gesamt += 1
    sys.exit(1 if gesamt else 0)


# ---------------------------------------------------------------- main

def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="befehl", required=True)

    s = sub.add_parser("zeitraum")
    s.add_argument("format", choices=FORMATE)
    s.add_argument("--heute", help="JJJJ-MM-TT, zum Testen")
    s.set_defaults(func=cmd_zeitraum)

    s = sub.add_parser("vorbereiten")
    s.set_defaults(func=cmd_vorbereiten)

    s = sub.add_parser("warten")
    s.add_argument("format", choices=FORMATE)
    s.add_argument("--minuten", type=float, default=9)
    s.add_argument("--heute")
    s.set_defaults(func=cmd_warten)

    for name, func in (("schlagzeilen", cmd_schlagzeilen), ("videos", cmd_videos)):
        s = sub.add_parser(name)
        if name == "schlagzeilen":
            s.add_argument("thema")
            s.add_argument("--max", type=int, default=40, help="höchstens so viele Einträge pro Feed")
        else:
            s.add_argument("--themen", help="z. B. ki,wirtschaft; Standard: alle Videothemen")
            s.add_argument("--alle", action="store_true", help="auch Videos außerhalb des Zeitraums")
        s.add_argument("--format", choices=FORMATE, default="taeglich" if name == "schlagzeilen" else "woechentlich",
                       help="Zeitraum dieses Formats, falls --von/--bis fehlen")
        s.add_argument("--von")
        s.add_argument("--bis")
        s.add_argument("--heute")
        s.set_defaults(func=func)

    s = sub.add_parser("pruefen")
    s.add_argument("dateien", nargs="+")
    s.set_defaults(func=cmd_pruefen)

    s = sub.add_parser("index")
    s.set_defaults(func=cmd_index)

    s = sub.add_parser("aufraeumen")
    s.add_argument("--ausfuehren", action="store_true")
    s.add_argument("--jetzt", help="Zeitpunkt zum Testen")
    s.set_defaults(func=cmd_aufraeumen)

    s = sub.add_parser("veroeffentlichen")
    s.add_argument("nachricht")
    s.set_defaults(func=cmd_veroeffentlichen)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
