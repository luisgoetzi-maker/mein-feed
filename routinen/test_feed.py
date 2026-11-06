#!/usr/bin/env python3
"""Tests für routinen/feed.py und die Konfiguration. Ohne Netz, nur Standardbibliothek.

Aufruf aus der Repo-Wurzel:  python3 -m unittest discover -s routinen -v
"""

import argparse
import contextlib
import datetime as dt
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import feed  # noqa: E402

ECHTES_REPO = feed.REPO
WIEN = feed.WIEN or dt.timezone(dt.timedelta(hours=1))


def d(text):
    return dt.date.fromisoformat(text)


def ausgabe(fmt, von, bis, erschienen, status="ok", **extra):
    """Minimale Ausgabe für Lösch-, Index- und Zeitraumtests."""
    a = {"format": fmt, "titel": f"{fmt} {von}", "zeitraum": {"von": von, "bis": bis},
         "erschienen": erschienen, "status": status, "fehler": "x" if status == "fehler" else None,
         "ruhig": [], "luecken": [], "ausnahmen": [], "meldungen": [], "videos": [], "abschnitte": []}
    a.update(extra)
    return a


def meldung(praefix, thema, n, datum, themen=None, quellen=None, **extra):
    m = {"id": f"{praefix}-{thema}-{n}", "datum": datum, "datum_bis": None, "titel": "Titel",
         "text": "Erster Satz. Zweiter Satz.", "warum_wichtig": "Ein Satz.", "themen": themen or [thema],
         "hauptthema": thema, "update": False,
         "quellen": quellen or [{"name": "ORF", "url": "https://orf.at/stories/1/"},
                                {"name": "BBC", "url": "https://www.bbc.co.uk/news/1"}]}
    m.update(extra)
    return m


def tagesausgabe(tag="2026-11-05"):
    """Gültige Tagesausgabe: Meldung mit zwei Themen, zwei ruhige Themen."""
    p = tag
    return ausgabe("taeglich", tag, tag, "2026-11-06T03:12:00+01:00",
                   titel="Donnerstag, 5. November 2026", ruhig=["tirol", "startups"],
                   meldungen=[meldung(p, "weltpolitik", 1, tag),
                              meldung(p, "politik", 1, tag, themen=["politik", "ki"]),
                              meldung(p, "wirtschaft", 1, tag)])


def video(**extra):
    v = {"titel": "Video", "kanal": "CaspianReport", "dauer_min": 15, "datum": "2026-11-03",
         "url": "https://www.youtube.com/watch?v=abcdefghijk", "thema": "weltpolitik",
         "warum": "Erklärt die Lage.", "hintergrund": False, "neuer_kanal": False}
    v.update(extra)
    return v


class MitDatenordner(unittest.TestCase):
    """Legt einen leeren Datenordner an und biegt feed.WORKTREE/DATEN darauf um."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="feedtest-"))
        self.alt = (feed.REPO, feed.WORKTREE, feed.DATEN)
        feed.WORKTREE = self.tmp / "feed-daten"
        feed.DATEN = feed.WORKTREE / "data"
        feed.DATEN.mkdir(parents=True)

    def tearDown(self):
        feed.REPO, feed.WORKTREE, feed.DATEN = self.alt
        shutil.rmtree(self.tmp, ignore_errors=True)

    def schreib(self, inhalt, name=None):
        fmt = inhalt["format"]
        von, bis = d(inhalt["zeitraum"]["von"]), d(inhalt["zeitraum"]["bis"])
        pfad = feed.DATEN / fmt / (name or f"{feed.schluessel(fmt, von, bis)}.json")
        feed.schreib_json(pfad, inhalt)
        return pfad

    def setze_start(self, start):
        feed.schreib_json(feed.DATEN / "index.json", {"aktualisiert": "x", "start": start, "ausgaben": []})

    def pruefe(self, inhalt, name=None):
        return feed.pruefe_ausgabe(self.schreib(inhalt, name))[0]


# ------------------------------------------------------------------ Konfiguration

class TestKonfiguration(unittest.TestCase):
    def setUp(self):
        self.themen = json.loads((ECHTES_REPO / "config" / "themen.json").read_text(encoding="utf-8"))

    def test_themen_reihenfolge_und_ids(self):
        ids = [t["id"] for t in sorted(self.themen["themen"], key=lambda t: t["reihenfolge"])]
        self.assertEqual(ids, ["weltpolitik", "politik", "ki", "wirtschaft", "tirol", "startups"])
        self.assertEqual(self.themen["gueltig_ab"], "2026-11-09")

    def test_pflichtfelder_je_thema(self):
        for t in self.themen["themen"]:
            for feld in ("id", "name", "reihenfolge", "schwerpunkte", "quellen", "feeds", "seiten",
                         "zwei_quellen_pflicht", "videos", "youtube_kanaele"):
                self.assertIn(feld, t, f"{t['id']}: {feld}")
            for eintrag in t["feeds"] + t["seiten"]:
                self.assertTrue(eintrag["url"].startswith("https://"), eintrag)
                self.assertTrue(eintrag["name"])

    def test_zwei_quellen_nur_themen_1_und_2(self):
        pflicht = {t["id"] for t in self.themen["themen"] if t["zwei_quellen_pflicht"]}
        self.assertEqual(pflicht, {"weltpolitik", "politik"})

    def test_videos_nur_fuer_vier_themen(self):
        mit = {t["id"] for t in self.themen["themen"] if t["videos"]}
        self.assertEqual(mit, {"weltpolitik", "politik", "ki", "wirtschaft"})
        for t in self.themen["themen"]:
            if not t["videos"]:
                self.assertEqual(t["youtube_kanaele"], [], t["id"])
            else:
                self.assertTrue(3 <= len(t["youtube_kanaele"]) <= 5, t["id"])

    def test_kanaele(self):
        for t in self.themen["themen"]:
            for k in t["youtube_kanaele"]:
                self.assertTrue(k["handle"].startswith("@"), k)
                self.assertIn(k["sprache"], ("de", "en"))
                self.assertIs(k["vorschlag"], True)
                if k["kanal_id"] is not None:
                    self.assertRegex(k["kanal_id"], r"^UC[\w-]{22}$")

    def test_reuters_keine_feste_quelle(self):
        for t in self.themen["themen"]:
            self.assertNotIn("reuters.com", t["quellen"])

    def test_dateien_vorhanden(self):
        for pfad in ("BAUPLAN.md", "CLAUDE.md", "config/regeln.md", "routinen/taeglich.md",
                     "routinen/woechentlich.md", "routinen/monatlich.md", "routinen/jaehrlich.md"):
            self.assertTrue((ECHTES_REPO / pfad).is_file(), pfad)
        self.assertEqual((ECHTES_REPO / "CLAUDE.md").read_text(encoding="utf-8").strip(),
                         "Lies vor jeder Arbeit BAUPLAN.md.")

    def test_routinen_nutzen_nur_vorhandene_befehle(self):
        hilfe = subprocess.run([sys.executable, str(ECHTES_REPO / "routinen" / "feed.py"), "--help"],
                               capture_output=True, text=True).stdout
        befehle = set(re.search(r"\{([^}]+)\}", hilfe).group(1).split(","))
        for datei in (ECHTES_REPO / "routinen").glob("*.md"):
            for befehl in re.findall(r"feed\.py (\w+)", datei.read_text(encoding="utf-8")):
                self.assertIn(befehl, befehle, f"{datei.name}: feed.py {befehl}")
        for befehl in re.findall(r"feed\.py (\w+)", (ECHTES_REPO / "config" / "regeln.md").read_text(encoding="utf-8")):
            self.assertIn(befehl, befehle)


# ------------------------------------------------------------------ Zeitraum

class TestZeitraum(unittest.TestCase):
    def test_taeglich_ist_gestern(self):
        self.assertEqual(feed.berechne_zeitraum("taeglich", d("2026-11-06")), (d("2026-11-05"), d("2026-11-05")))
        self.assertEqual(feed.berechne_zeitraum("taeglich", d("2027-01-01")), (d("2026-12-31"), d("2026-12-31")))

    def test_woche_sonntag_bis_samstag(self):
        # Beispiel aus dem Bauplan: Der Rückblick vom 8.11.2026 umfasst den 1. bis 7.11.2026.
        self.assertEqual(feed.berechne_zeitraum("woechentlich", d("2026-11-08")), (d("2026-11-01"), d("2026-11-07")))
        # An anderen Tagen (z. B. Test mit „Run now“) die letzte abgeschlossene Woche
        self.assertEqual(feed.berechne_zeitraum("woechentlich", d("2026-11-14")), (d("2026-11-01"), d("2026-11-07")))
        self.assertEqual(feed.berechne_zeitraum("woechentlich", d("2026-11-15")), (d("2026-11-08"), d("2026-11-14")))
        for heute in ("2026-11-09", "2026-12-01", "2027-01-01", "2027-03-01"):
            von, bis = feed.berechne_zeitraum("woechentlich", d(heute))
            self.assertEqual(von.weekday(), 6)
            self.assertEqual(bis.weekday(), 5)
            self.assertEqual((bis - von).days, 6)
            self.assertLess(bis, d(heute))

    def test_monat_und_jahr(self):
        self.assertEqual(feed.berechne_zeitraum("monatlich", d("2026-12-01")), (d("2026-11-01"), d("2026-11-30")))
        self.assertEqual(feed.berechne_zeitraum("monatlich", d("2027-03-01")), (d("2027-02-01"), d("2027-02-28")))
        self.assertEqual(feed.berechne_zeitraum("jaehrlich", d("2027-01-01")), (d("2026-01-01"), d("2026-12-31")))

    def test_dateinamen(self):
        self.assertEqual(feed.relpfad("taeglich", d("2026-11-05"), d("2026-11-05")), "data/taeglich/2026-11-05.json")
        self.assertEqual(feed.relpfad("woechentlich", d("2026-11-01"), d("2026-11-07")),
                         "data/woechentlich/2026-11-01_2026-11-07.json")
        self.assertEqual(feed.relpfad("monatlich", d("2026-11-01"), d("2026-11-30")), "data/monatlich/2026-11.json")
        self.assertEqual(feed.relpfad("jaehrlich", d("2026-01-01"), d("2026-12-31")), "data/jaehrlich/2026.json")

    def test_titel(self):
        t = feed.titel_fuer
        self.assertEqual(t("taeglich", d("2026-11-05"), d("2026-11-05"), None), "Donnerstag, 5. November 2026")
        self.assertEqual(t("woechentlich", d("2026-11-01"), d("2026-11-07"), None), "Woche vom 1. bis 7. November 2026")
        self.assertEqual(t("woechentlich", d("2026-11-29"), d("2026-12-05"), None),
                         "Woche vom 29. November bis 5. Dezember 2026")
        self.assertEqual(t("woechentlich", d("2026-12-27"), d("2027-01-02"), None),
                         "Woche vom 27. Dezember 2026 bis 2. Jänner 2027")
        self.assertEqual(t("monatlich", d("2027-01-01"), d("2027-01-31"), None), "Jänner 2027")
        self.assertEqual(t("woechentlich", d("2026-11-08"), d("2026-11-14"), d("2026-11-09")),
                         "Woche vom 8. bis 14. November 2026 (ab 9. November)")
        self.assertEqual(t("monatlich", d("2026-11-01"), d("2026-11-30"), d("2026-11-09")), "November 2026 (ab 9. November)")
        self.assertEqual(t("jaehrlich", d("2026-01-01"), d("2026-12-31"), None, ["nov", "dez"]), "Kurzrückblick 2026")
        self.assertEqual(t("jaehrlich", d("2027-01-01"), d("2027-12-31"), None, list(range(12))), "Jahresrückblick 2027")

    def test_vorstufen(self):
        v = feed.vorstufen
        self.assertEqual(v("taeglich", d("2026-11-06"), *feed.berechne_zeitraum("taeglich", d("2026-11-06"))), [])
        self.assertEqual(v("woechentlich", d("2026-11-08"), d("2026-11-01"), d("2026-11-07")),
                         ["data/taeglich/2026-11-07.json"])
        # 1.11.2026 ist ein Sonntag: Monatsrückblick wartet auch auf den Wochenrückblick
        self.assertEqual(v("monatlich", d("2026-11-01"), d("2026-10-01"), d("2026-10-31")),
                         ["data/taeglich/2026-10-31.json", "data/woechentlich/2026-10-25_2026-10-31.json"])
        self.assertEqual(v("monatlich", d("2026-12-01"), d("2026-11-01"), d("2026-11-30")),
                         ["data/taeglich/2026-11-30.json"])
        self.assertEqual(v("jaehrlich", d("2027-01-01"), d("2026-01-01"), d("2026-12-31")),
                         ["data/monatlich/2026-12.json"])

    def test_wien_zeit_ersatz(self):
        winter = feed._wien_offset(dt.datetime(2026, 1, 15, 12, tzinfo=dt.timezone.utc))
        sommer = feed._wien_offset(dt.datetime(2026, 7, 15, 12, tzinfo=dt.timezone.utc))
        self.assertEqual(winter.utcoffset(None), dt.timedelta(hours=1))
        self.assertEqual(sommer.utcoffset(None), dt.timedelta(hours=2))
        # Umstellung 2026: 29. März und 25. Oktober, jeweils 1:00 UTC
        self.assertEqual(feed._wien_offset(dt.datetime(2026, 3, 29, 0, 59, tzinfo=dt.timezone.utc)).utcoffset(None),
                         dt.timedelta(hours=1))
        self.assertEqual(feed._wien_offset(dt.datetime(2026, 3, 29, 1, 0, tzinfo=dt.timezone.utc)).utcoffset(None),
                         dt.timedelta(hours=2))
        self.assertEqual(feed._wien_offset(dt.datetime(2026, 10, 25, 1, 0, tzinfo=dt.timezone.utc)).utcoffset(None),
                         dt.timedelta(hours=1))


class TestEingabenUndLuecken(MitDatenordner):
    def test_woche_mit_fehlender_und_fehlerhafter_tagesausgabe(self):
        for tag in ("2026-11-01", "2026-11-02", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"):
            status = "fehler" if tag == "2026-11-05" else "ok"
            self.schreib(ausgabe("taeglich", tag, tag, f"{tag}T23:00:00+01:00", status=status))
        alle = feed.ausgaben()
        eingaben, luecken = feed.eingaben_und_luecken("woechentlich", d("2026-11-01"), d("2026-11-07"), alle, None)
        self.assertEqual(len(eingaben), 6)
        self.assertEqual(luecken, [d("2026-11-03"), d("2026-11-05")])

    def test_tage_vor_dem_start_sind_keine_luecken(self):
        self.schreib(ausgabe("taeglich", "2026-11-09", "2026-11-09", "2026-11-10T03:10:00+01:00"))
        alle = feed.ausgaben()
        _, luecken = feed.eingaben_und_luecken("woechentlich", d("2026-11-08"), d("2026-11-14"), alle, d("2026-11-09"))
        self.assertEqual(luecken, [d(f"2026-11-{t}") for t in range(10, 15)])

    def test_monat_nimmt_tage_ohne_gueltigen_wochenrueckblick(self):
        self.schreib(ausgabe("woechentlich", "2026-11-01", "2026-11-07", "2026-11-08T03:40:00+01:00"))
        self.schreib(ausgabe("woechentlich", "2026-11-08", "2026-11-14", "2026-11-15T03:40:00+01:00", status="fehler"))
        self.schreib(ausgabe("woechentlich", "2026-11-29", "2026-12-05", "2026-12-06T03:40:00+01:00"))
        for t in range(1, 31):
            tag = f"2026-11-{t:02d}"
            if tag != "2026-11-10":
                self.schreib(ausgabe("taeglich", tag, tag, f"{tag}T23:00:00+01:00"))
        alle = feed.ausgaben()
        eingaben, luecken = feed.eingaben_und_luecken("monatlich", d("2026-11-01"), d("2026-11-30"), alle, d("2026-11-01"))
        dateien = [e["datei"] for e in eingaben]
        self.assertIn("data/woechentlich/2026-11-01_2026-11-07.json", dateien)
        self.assertIn("data/woechentlich/2026-11-29_2026-12-05.json", dateien)
        self.assertNotIn("data/woechentlich/2026-11-08_2026-11-14.json", dateien)  # fehler
        self.assertIn("data/taeglich/2026-11-08.json", dateien)        # Woche mit fehler: Tage selbst
        self.assertNotIn("data/taeglich/2026-11-03.json", dateien)     # steckt im Wochenrückblick
        self.assertNotIn("data/taeglich/2026-11-30.json", dateien)     # steckt im Wochenrückblick 29.11.–5.12.
        self.assertEqual(luecken, [d("2026-11-10")])

    def test_jahr_nimmt_nur_gueltige_monate(self):
        self.schreib(ausgabe("monatlich", "2026-11-01", "2026-11-30", "2026-12-01T04:10:00+01:00"))
        self.schreib(ausgabe("monatlich", "2026-12-01", "2026-12-31", "2027-01-01T04:10:00+01:00", status="fehler"))
        eingaben, luecken = feed.eingaben_und_luecken("jaehrlich", d("2026-01-01"), d("2026-12-31"), feed.ausgaben(), None)
        self.assertEqual([e["datei"] for e in eingaben], ["data/monatlich/2026-11.json"])
        self.assertEqual(luecken, [])

    def test_zeitraum_befehl_erkennt_doppellauf(self):
        self.schreib(tagesausgabe())
        aus = io.StringIO()
        with contextlib.redirect_stdout(aus):
            feed.cmd_zeitraum(argparse.Namespace(format="taeglich", heute="2026-11-06"))
        j = json.loads(aus.getvalue())
        self.assertTrue(j["doppellauf"])
        self.assertEqual(j["datei"], "data/taeglich/2026-11-05.json")
        self.assertEqual(j["id_praefix"], "2026-11-05")
        self.assertEqual(j["titel"], "Donnerstag, 5. November 2026")


# ------------------------------------------------------------------ Prüfung

class TestPruefen(MitDatenordner):
    def test_gueltige_tagesausgabe(self):
        self.assertEqual(self.pruefe(tagesausgabe()), [])

    def test_ruhiger_tag(self):
        a = ausgabe("taeglich", "2026-11-05", "2026-11-05", "2026-11-06T03:12:00+01:00", status="ruhig",
                    ruhig=["weltpolitik", "politik", "ki", "wirtschaft", "tirol", "startups"])
        self.assertEqual(self.pruefe(a), [])

    def test_fehlerausgabe(self):
        a = ausgabe("taeglich", "2026-11-05", "2026-11-05", "2026-11-06T03:12:00+01:00", status="fehler")
        self.assertEqual(self.pruefe(a), [])
        a["fehler"] = None
        self.assertTrue(any("fehler braucht" in f for f in self.pruefe(a)))

    def test_beispiel_feld_erlaubt_anderes_nicht(self):
        a = tagesausgabe()
        a["beispiel"] = True
        self.assertEqual(self.pruefe(a), [])
        a["quatsch"] = 1
        self.assertTrue(any("Unbekannte Felder" in f for f in self.pruefe(a)))

    def test_fehlendes_feld(self):
        a = tagesausgabe()
        del a["ausnahmen"]
        self.assertTrue(any("ausnahmen" in f for f in self.pruefe(a)))

    def test_falscher_dateiname(self):
        self.assertTrue(any("heißen" in f for f in self.pruefe(tagesausgabe(), name="falsch.json")))

    def test_obergrenze_und_ausnahme(self):
        a = tagesausgabe()
        a["meldungen"] += [meldung("2026-11-05", "weltpolitik", n, "2026-11-05") for n in (2, 3, 4)]
        self.assertTrue(any("4 Meldungen, erlaubt sind 3" in f for f in self.pruefe(a)))
        a["ausnahmen"] = [{"thema": "weltpolitik", "grund": "Waffenstillstand und Wahl am selben Tag."}]
        self.assertEqual(self.pruefe(a), [])
        a["meldungen"] += [meldung("2026-11-05", "weltpolitik", n, "2026-11-05") for n in (5, 6)]
        self.assertTrue(any("6 Meldungen, erlaubt sind 5" in f for f in self.pruefe(a)))

    def test_unnoetige_ausnahme(self):
        a = tagesausgabe()
        a["ausnahmen"] = [{"thema": "ki", "grund": "x"}]
        self.assertTrue(any("überschreitet die Obergrenze 3 aber nicht" in f for f in self.pruefe(a)))

    def test_verweise_zaehlen_nicht_zur_obergrenze(self):
        a = tagesausgabe()
        a["meldungen"] += [meldung("2026-11-05", "wirtschaft", n, "2026-11-05", themen=["wirtschaft", "ki"])
                           for n in (2, 3)]
        a["meldungen"] += [meldung("2026-11-05", "ki", n, "2026-11-05") for n in (1, 2, 3)]
        self.assertEqual(self.pruefe(a), [])

    def test_zwei_quellen_pflicht(self):
        a = tagesausgabe()
        a["meldungen"][0]["quellen"] = [{"name": "ORF", "url": "https://orf.at/1"},
                                        {"name": "ORF Tirol", "url": "https://tirol.orf.at/2"}]
        self.assertTrue(any("zwei unabhängige Quellen" in f for f in self.pruefe(a)))
        a["meldungen"][0]["quellen"] = [{"name": "ORF", "url": "https://orf.at/1"}]
        self.assertTrue(any("zwei unabhängige Quellen" in f for f in self.pruefe(a)))
        # Für andere Themen reicht eine Quelle
        a = tagesausgabe()
        a["meldungen"][2]["quellen"] = [{"name": "STANDARD", "url": "https://www.derstandard.at/story/1"}]
        self.assertEqual(self.pruefe(a), [])

    def test_hauptthema_muss_in_themen_stehen(self):
        a = tagesausgabe()
        a["meldungen"][1]["themen"] = ["ki"]
        self.assertTrue(any("steht nicht in themen" in f for f in self.pruefe(a)))

    def test_ruhig_muss_stimmen(self):
        a = tagesausgabe()
        a["ruhig"] = ["tirol"]
        self.assertTrue(any('ruhig sollte ["tirol", "startups"]' in f for f in self.pruefe(a)))

    def test_status_und_meldungen_passen(self):
        a = tagesausgabe()
        a["status"] = "ruhig"
        self.assertTrue(any("status ruhig, aber" in f for f in self.pruefe(a)))
        a = ausgabe("taeglich", "2026-11-05", "2026-11-05", "2026-11-06T03:12:00+01:00",
                    ruhig=["weltpolitik", "politik", "ki", "wirtschaft", "tirol", "startups"])
        self.assertTrue(any("status ok ohne Meldungen" in f for f in self.pruefe(a)))

    def test_id_und_datum(self):
        a = tagesausgabe()
        a["meldungen"][0]["id"] = "2026-11-05-politik-9"
        a["meldungen"][2]["datum"] = "2026-11-04"
        fehler = self.pruefe(a)
        self.assertTrue(any("id sollte 2026-11-05-weltpolitik" in f for f in fehler))
        self.assertTrue(any("nicht im Zeitraum" in f for f in fehler))

    def test_tagesausgabe_ohne_videos_abschnitte_luecken(self):
        a = tagesausgabe()
        a["videos"] = [video()]
        a["luecken"] = ["2026-11-05"]
        fehler = self.pruefe(a)
        self.assertTrue(any("keine videos" in f for f in fehler))
        self.assertTrue(any("keine luecken" in f for f in fehler))

    def woche(self, **extra):
        p = "2026-11-01_2026-11-07"
        return ausgabe("woechentlich", "2026-11-01", "2026-11-07", "2026-11-08T03:40:00+01:00",
                       titel="Woche vom 1. bis 7. November 2026", ruhig=["politik", "tirol", "startups"],
                       meldungen=[meldung(p, "weltpolitik", 1, "2026-11-02", datum_bis="2026-11-06"),
                                  meldung(p, "ki", 1, "2026-11-03", themen=["ki", "wirtschaft"])], **extra)

    def test_gueltige_woche_mit_video_und_runden(self):
        runden = {"typ": "finanzierungsrunden", "thema": "startups", "titel": "Finanzierungsrunden der Woche",
                  "eintraege": [{"name": "X", "betrag": "25 Millionen Euro", "land": "Österreich", "bereich": "KI",
                                 "investoren": None, "datum": "2026-11-04",
                                 "quelle": {"name": "brutkasten", "url": "https://brutkasten.com/artikel/x"}}]}
        a = self.woche(videos=[video()], abschnitte=[runden])
        a["ruhig"] = ["politik", "tirol"]
        self.assertEqual(self.pruefe(a), [])

    def test_videoregeln(self):
        a = self.woche(videos=[
            video(thema="tirol"),
            video(url="https://www.youtube.com/shorts/abc", titel="Short"),
            video(dauer_min=2, titel="Kurz"),
            video(kanal="Unbekannt TV", titel="Fremd"),
            video(datum="2026-10-01", titel="Alt"),
        ])
        fehler = self.pruefe(a)
        for erwartet in ("5 Videos, erlaubt sind 3", "bekommt keine Videos", "kein Short", "ab 3 sein",
                         "nicht in der Positivliste", "nicht im Zeitraum"):
            self.assertTrue(any(erwartet in f for f in fehler), erwartet)

    def test_video_regeln_pro_thema_und_neuer_kanal(self):
        a = self.woche(videos=[video(), video(titel="Zwei")])
        self.assertTrue(any("2 Videos, erlaubt sind 1" in f for f in self.pruefe(a)))
        a = self.woche(videos=[video(kanal="Neu A", neuer_kanal=True, thema="ki"),
                               video(kanal="Neu B", neuer_kanal=True, thema="weltpolitik")])
        self.assertTrue(any("neuer_kanal" in f for f in self.pruefe(a)))
        a = self.woche(videos=[video(datum="2025-05-01", hintergrund=True)])
        self.assertEqual(self.pruefe(a), [])
        a = self.woche(videos=[video(kanal="@CaspianReport")])
        self.assertEqual(self.pruefe(a), [])  # Handle zählt auch

    def test_monat_erlaubt_zwei_videos_pro_thema(self):
        p = "2026-11"
        a = ausgabe("monatlich", "2026-11-01", "2026-11-30", "2026-12-01T04:10:00+01:00", titel="November 2026",
                    ruhig=["politik", "ki", "wirtschaft", "tirol", "startups"],
                    meldungen=[meldung(p, "weltpolitik", 1, "2026-11-02")],
                    videos=[video(), video(titel="Zwei")])
        self.assertEqual(self.pruefe(a), [])
        a["videos"].append(video(titel="Drei"))
        self.assertTrue(any("3 Videos, erlaubt sind 2" in f for f in self.pruefe(a)))

    def test_abschnitte_im_falschen_format(self):
        gescheitert = {"typ": "gescheitert", "thema": "startups", "titel": "Gescheitert und warum",
                       "eintraege": [{"name": "X", "text": "Text.", "quelle": {"name": "Q", "url": "https://q.at/1"}}]}
        a = self.woche(abschnitte=[gescheitert])
        a["ruhig"] = ["politik", "tirol"]
        self.assertTrue(any("gehört nur in monatlich" in f for f in self.pruefe(a)))

    def test_luecken(self):
        self.setze_start("2026-11-03")
        a = self.woche(luecken=["2026-11-02", "2026-11-09"])
        fehler = self.pruefe(a)
        self.assertTrue(any("vor dem Start" in f for f in fehler))
        self.assertTrue(any("nicht im Zeitraum" in f for f in fehler))

    def test_jahresvideos_aus_monatsrueckblicken(self):
        self.schreib(ausgabe("monatlich", "2026-11-01", "2026-11-30", "2026-12-01T04:10:00+01:00",
                             videos=[video(datum="2026-11-03")]))
        p = "2026"
        ueberblick = [{"typ": "monatsueberblick", "thema": t, "titel": "Monatsüberblick",
                       "eintraege": [{"monat": "2026-11", "text": "Keine größeren Entwicklungen."}]}
                      for t in ("weltpolitik", "politik", "ki", "wirtschaft", "tirol", "startups")]
        a = ausgabe("jaehrlich", "2026-01-01", "2026-12-31", "2027-01-01T04:40:00+01:00", titel="Kurzrückblick 2026",
                    meldungen=[meldung(p, "weltpolitik", 1, "2026-11-02")], abschnitte=ueberblick,
                    videos=[video(datum="2026-11-03")])
        self.assertEqual(self.pruefe(a), [])
        a["videos"].append(video(url="https://www.youtube.com/watch?v=zzzzzzzzzzz", thema="ki", kanal="AI Explained"))
        self.assertTrue(any("aus den Monatsrückblicken" in f for f in self.pruefe(a)))

    def test_befehl_pruefen_exit_code(self):
        gut = self.schreib(tagesausgabe())
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as ende:
                feed.cmd_pruefen(argparse.Namespace(dateien=[str(gut)]))
        self.assertEqual(ende.exception.code, 0)
        schlecht = tagesausgabe()
        schlecht["ruhig"] = []  # falsch: tirol und startups sind ruhig
        pfad = self.schreib(schlecht)
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as ende:
                feed.cmd_pruefen(argparse.Namespace(dateien=[str(pfad)]))
        self.assertEqual(ende.exception.code, 1)


# ------------------------------------------------------------------ Löschregeln und Index

class TestAufraeumen(MitDatenordner):
    def setUp(self):
        super().setUp()
        start = d("2026-11-01")
        for i in range(35):
            tag = start + dt.timedelta(days=i)
            self.schreib(ausgabe("taeglich", tag.isoformat(), tag.isoformat(),
                                 f"{(tag + dt.timedelta(days=1)).isoformat()}T03:12:00+01:00"))
        self.schreib(ausgabe("woechentlich", "2026-11-01", "2026-11-07", "2026-11-08T03:40:00+01:00"))
        self.schreib(ausgabe("woechentlich", "2026-11-08", "2026-11-14", "2026-11-15T03:40:00+01:00", status="fehler"))
        self.schreib(ausgabe("woechentlich", "2026-11-29", "2026-12-05", "2026-12-06T03:40:00+01:00"))
        self.schreib(ausgabe("monatlich", "2026-11-01", "2026-11-30", "2026-12-01T04:10:00+01:00"))

    def weg(self, jetzt):
        return sorted(a["datei"] for a in feed.loeschbar(feed.ausgaben(), feed.zeitpunkt(jetzt)))

    def test_schonfrist_nach_wochenrueckblick(self):
        self.assertEqual(self.weg("2026-11-15T03:00:00+01:00"), [])
        self.assertEqual(self.weg("2026-11-15T04:00:00+01:00"),
                         [f"data/taeglich/2026-11-0{t}.json" for t in range(1, 8)])

    def test_monatsrueckblick_deckt_fehlende_woche_und_nichts_zu_frueh(self):
        weg = self.weg("2026-12-08T05:00:00+01:00")
        self.assertIn("data/taeglich/2026-11-10.json", weg)            # Woche mit fehler: über den Monat
        self.assertIn("data/taeglich/2026-11-30.json", weg)
        self.assertNotIn("data/taeglich/2026-12-01.json", weg)         # Dezember noch nicht abgedeckt …
        self.assertIn("data/woechentlich/2026-11-01_2026-11-07.json", weg)
        self.assertIn("data/woechentlich/2026-11-08_2026-11-14.json", weg)
        self.assertNotIn("data/woechentlich/2026-11-29_2026-12-05.json", weg)  # … braucht auch den Dezember
        self.assertNotIn("data/monatlich/2026-11.json", weg)
        # 10 Minuten vor Ablauf der Schonfrist des Monatsrückblicks: nur die Woche 1.–7.11. ist frei
        self.assertEqual(self.weg("2026-12-08T04:00:00+01:00"),
                         [f"data/taeglich/2026-11-0{t}.json" for t in range(1, 8)])

    def test_fehler_rueckblick_loescht_nichts(self):
        for a in list(feed.ausgaben()):
            if a["format"] == "monatlich":
                a["pfad"].unlink()
        weg = self.weg("2027-06-01T05:00:00+02:00")
        self.assertFalse(any("2026-11-1" in w for w in weg))  # 8.–14.11.: Woche hat fehler, kein Monat

    def test_jahresrueckblick_und_niemals_jahr(self):
        self.schreib(ausgabe("jaehrlich", "2026-01-01", "2026-12-31", "2027-01-01T04:40:00+01:00"))
        weg = self.weg("2027-01-08T05:00:00+01:00")
        self.assertIn("data/monatlich/2026-11.json", weg)
        self.assertNotIn("data/jaehrlich/2026.json", weg)
        self.assertNotIn("data/monatlich/2026-11.json", self.weg("2027-01-08T04:00:00+01:00"))

    def test_aufraeumen_loescht_und_baut_index(self):
        with contextlib.redirect_stdout(io.StringIO()):
            feed.cmd_aufraeumen(argparse.Namespace(ausfuehren=True, jetzt="2026-11-15T04:00:00+01:00"))
        self.assertFalse((feed.DATEN / "taeglich" / "2026-11-01.json").exists())
        self.assertTrue((feed.DATEN / "taeglich" / "2026-11-08.json").exists())
        index = feed.lies_json(feed.DATEN / "index.json")
        self.assertNotIn("data/taeglich/2026-11-01.json", [a["datei"] for a in index["ausgaben"]])


class TestIndex(MitDatenordner):
    def test_aufbau_reihenfolge_und_start(self):
        self.schreib(tagesausgabe("2026-11-05"))
        self.schreib(ausgabe("taeglich", "2026-11-06", "2026-11-06", "2026-11-07T03:12:00+01:00"))
        self.schreib(ausgabe("woechentlich", "2026-11-01", "2026-11-07", "2026-11-08T03:40:00+01:00"))
        self.assertTrue(feed.baue_index())
        index = feed.lies_json(feed.DATEN / "index.json")
        self.assertEqual(index["start"], "2026-11-05")
        self.assertEqual([a["datei"] for a in index["ausgaben"]],
                         ["data/taeglich/2026-11-06.json", "data/taeglich/2026-11-05.json",
                          "data/woechentlich/2026-11-01_2026-11-07.json"])
        for feld in ("format", "titel", "zeitraum", "datei", "status", "erschienen"):
            self.assertIn(feld, index["ausgaben"][0])
        self.assertFalse(feed.baue_index())  # unverändert

    def test_start_bleibt_wenn_gesetzt(self):
        self.setze_start("2026-11-01")
        self.schreib(tagesausgabe("2026-11-05"))
        feed.baue_index()
        self.assertEqual(feed.lies_json(feed.DATEN / "index.json")["start"], "2026-11-01")


# ------------------------------------------------------------------ Feeds und Videos

RSS = """<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>X</title>
<item><title>Erste &amp; Meldung</title><link>https://orf.at/stories/1/</link><pubDate>Thu, 05 Nov 2026 22:30:00 +0000</pubDate>
<description>&lt;p&gt;Text &lt;b&gt;fett&lt;/b&gt;&lt;/p&gt;</description></item>
<item><title>Zu spät</title><link>https://orf.at/stories/2/</link><pubDate>Thu, 05 Nov 2026 23:30:00 +0000</pubDate></item>
<item><title>Früher</title><link>https://orf.at/stories/3/</link><dc:date>2026-11-04T10:00:00+01:00</dc:date></item>
</channel></rss>"""

ATOM = """<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015"
 xmlns:media="http://search.yahoo.com/mrss/"><title>Kanal</title><link rel="self" href="https://www.youtube.com/feeds/x"/>
<entry><yt:videoId>abcdefghijk</yt:videoId><title>Langes Video</title>
<link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/><published>2026-11-03T15:00:00+00:00</published>
<media:group><media:description>Beschreibung hier</media:description></media:group></entry>
<entry><yt:videoId>shortshort1</yt:videoId><title>Ein Short</title>
<link rel="alternate" href="https://www.youtube.com/shorts/shortshort1"/><published>2026-11-04T15:00:00+00:00</published></entry>
<entry><yt:videoId>kurzkurzkur</yt:videoId><title>Kurzes Video</title>
<link rel="alternate" href="https://www.youtube.com/watch?v=kurzkurzkur"/><published>2026-11-05T15:00:00+00:00</published></entry>
<entry><yt:videoId>altaltaltal</yt:videoId><title>Altes Video</title>
<link rel="alternate" href="https://www.youtube.com/watch?v=altaltaltal"/><published>2026-10-01T15:00:00+00:00</published></entry>
</feed>"""


class TestFeeds(unittest.TestCase):
    def setUp(self):
        self.hole = feed.hole

    def tearDown(self):
        feed.hole = self.hole

    def test_rss_und_atom(self):
        rss = feed.lies_feed(RSS)
        self.assertEqual(rss[0]["titel"], "Erste & Meldung")
        self.assertEqual(rss[0]["text"], "Text fett")
        self.assertEqual(rss[2]["zeit"], dt.datetime(2026, 11, 4, 9, tzinfo=dt.timezone.utc))
        atom = feed.lies_feed(ATOM)
        self.assertEqual(len(atom), 4)
        self.assertEqual(atom[0]["video_id"], "abcdefghijk")
        self.assertEqual(atom[0]["link"], "https://www.youtube.com/watch?v=abcdefghijk")
        self.assertEqual(atom[0]["text"], "Beschreibung hier")

    def test_zeitraum_nach_wiener_zeit(self):
        tag = d("2026-11-05")
        rss = feed.lies_feed(RSS)
        self.assertTrue(feed.im_zeitraum(rss[0]["zeit"], tag, tag))   # 23:30 Wien
        self.assertFalse(feed.im_zeitraum(rss[1]["zeit"], tag, tag))  # 0:30 Wien am 6.11.
        self.assertFalse(feed.im_zeitraum(rss[2]["zeit"], tag, tag))

    def test_domain(self):
        self.assertEqual(feed.domain("https://www.bbc.co.uk/news/x"), "bbc.co.uk")
        self.assertEqual(feed.domain("https://tirol.orf.at/stories/1"), "orf.at")
        self.assertEqual(feed.domain("https://presse.innsbruck.gv.at/x"), "innsbruck.gv.at")

    def test_schlagzeilen_mit_ausgefallenem_feed(self):
        def hole(url, timeout=20):
            if "orf.at" in url:
                return RSS
            raise OSError("gesperrt")
        feed.hole = hole
        aus = io.StringIO()
        with contextlib.redirect_stdout(aus):
            feed.cmd_schlagzeilen(argparse.Namespace(thema="weltpolitik", von="2026-11-05", bis="2026-11-05",
                                                     max=40, format="taeglich", heute=None))
        text = aus.getvalue()
        self.assertIn("Erste & Meldung", text)
        self.assertNotIn("Zu spät", text)
        self.assertIn("NICHT ERREICHBAR", text)
        self.assertIn("AP World News", text)  # Seite ohne Feed wird genannt

    def test_videos(self):
        aufrufe = []

        def hole(url, timeout=20):
            aufrufe.append(url)
            if "/feeds/videos.xml" in url:
                return ATOM
            if "watch?v=abcdefghijk" in url:
                return '... "lengthSeconds":"754" ...'
            if "watch?v=kurzkurzkur" in url:
                return '<meta itemprop="duration" content="PT2M10S">'
            if "youtube.com/@" in url:
                return '<html>"externalId":"UCaaaaaaaaaaaaaaaaaaaaaa"</html>'
            raise AssertionError(url)
        feed.hole = hole
        aus, fehler = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(aus), contextlib.redirect_stderr(fehler):
            feed.cmd_videos(argparse.Namespace(themen="ki", alle=False, von="2026-11-01", bis="2026-11-07",
                                               format="woechentlich", heute=None))
        kandidaten = json.loads(aus.getvalue())
        kanaele = {k["kanal"] for k in kandidaten}
        self.assertEqual(len(kanaele), 5)  # alle 5 KI-Kanäle
        lang_ = [k for k in kandidaten if k["titel"] == "Langes Video"][0]
        self.assertEqual(lang_["dauer_min"], 13)
        self.assertTrue(lang_["erlaubt"])
        self.assertTrue(all(not k["erlaubt"] and k["grund"] == "Short" for k in kandidaten if k["titel"] == "Ein Short"))
        self.assertTrue(all(not k["erlaubt"] and k["grund"] == "unter 3 Minuten"
                            for k in kandidaten if k["titel"] == "Kurzes Video"))
        self.assertFalse(any(k["titel"] == "Altes Video" for k in kandidaten))
        self.assertFalse(any("shortshort1" in u and "watch" in u for u in aufrufe))  # Shorts nicht abgefragt
        self.assertIn("kanal_id UCaaaaaaaaaaaaaaaaaaaaaa", fehler.getvalue())


# ------------------------------------------------------------------ Git-Ablauf

@unittest.skipUnless(shutil.which("git"), "git fehlt")
class TestGitAblauf(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="feedgit-"))
        self.alt = (feed.REPO, feed.WORKTREE, feed.DATEN)
        self.env = {k: os.environ.get(k) for k in ("GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL",
                                                   "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL")}
        os.environ.update(GIT_AUTHOR_NAME="Test", GIT_AUTHOR_EMAIL="test@example.com",
                          GIT_COMMITTER_NAME="Test", GIT_COMMITTER_EMAIL="test@example.com")
        self.origin = self.tmp / "origin.git"
        self.lauf(["git", "init", "-q", "--bare", "-b", "main", str(self.origin)])
        quelle = self.tmp / "quelle"
        self.lauf(["git", "init", "-q", "-b", "main", str(quelle)])
        (quelle / "BAUPLAN.md").write_text("Bauplan\n", encoding="utf-8")
        self.lauf(["git", "add", "-A"], quelle)
        self.lauf(["git", "commit", "-q", "-m", "start"], quelle)
        self.lauf(["git", "remote", "add", "origin", str(self.origin)], quelle)
        self.lauf(["git", "push", "-q", "origin", "main"], quelle)

    def tearDown(self):
        feed.REPO, feed.WORKTREE, feed.DATEN = self.alt
        for k, v in self.env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.tmp, ignore_errors=True)

    def lauf(self, befehl, cwd=None):
        r = subprocess.run(befehl, cwd=cwd, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout

    def sitzung(self, name):
        """Wie eine neue Cloud-Sitzung: frischer Klon von main, eigener Daten-Worktree."""
        repo = self.tmp / name
        if not repo.exists():
            self.lauf(["git", "clone", "-q", str(self.origin), str(repo)])
        feed.REPO = repo
        feed.WORKTREE = self.tmp / f"{name}-daten"
        feed.DATEN = feed.WORKTREE / "data"

    def leise(self, func, *args):
        with contextlib.redirect_stdout(io.StringIO()) as aus:
            func(*args)
        return aus.getvalue()

    def dateien_auf_origin(self):
        return self.lauf(["git", "ls-tree", "-r", "--name-only", feed.BRANCH], self.origin).split()

    def test_erster_lauf_legt_branch_an_und_pusht(self):
        self.sitzung("a")
        self.assertIn("angelegt", self.leise(feed.cmd_vorbereiten))
        self.assertEqual(feed.lies_json(feed.DATEN / "index.json")["ausgaben"], [])
        feed.schreib_json(feed.DATEN / "taeglich" / "2026-11-05.json", tagesausgabe())
        self.assertIn("Gepusht", self.leise(feed.cmd_veroeffentlichen, argparse.Namespace(nachricht="taeglich 2026-11-05")))
        self.assertEqual(sorted(self.dateien_auf_origin()), ["data/index.json", "data/taeglich/2026-11-05.json"])
        # main bleibt unangetastet
        self.assertEqual(self.lauf(["git", "ls-tree", "-r", "--name-only", "main"], self.origin).split(), ["BAUPLAN.md"])
        nachricht = self.lauf(["git", "log", "-1", "--format=%s", feed.BRANCH], self.origin).strip()
        self.assertEqual(nachricht, "taeglich 2026-11-05")

    def test_gleichzeitige_laeufe_und_index_konflikt(self):
        self.sitzung("a")
        self.leise(feed.cmd_vorbereiten)
        feed.schreib_json(feed.DATEN / "taeglich" / "2026-11-05.json", tagesausgabe())
        self.leise(feed.cmd_veroeffentlichen, argparse.Namespace(nachricht="taeglich 2026-11-05"))
        # Sitzung b holt den Stand …
        self.sitzung("b")
        self.leise(feed.cmd_vorbereiten)
        # … währenddessen pusht Sitzung a noch eine Ausgabe
        self.sitzung("a")
        feed.schreib_json(feed.DATEN / "taeglich" / "2026-11-06.json",
                          ausgabe("taeglich", "2026-11-06", "2026-11-06", "2026-11-07T03:12:00+01:00",
                                  status="ruhig", ruhig=["weltpolitik", "politik", "ki", "wirtschaft", "tirol", "startups"]))
        self.leise(feed.cmd_veroeffentlichen, argparse.Namespace(nachricht="taeglich 2026-11-06"))
        # b pusht auf altem Stand: Konflikt in index.json wird gelöst
        self.sitzung("b")
        feed.schreib_json(feed.DATEN / "woechentlich" / "2026-11-01_2026-11-07.json",
                          ausgabe("woechentlich", "2026-11-01", "2026-11-07", "2026-11-08T03:40:00+01:00", status="ruhig",
                                  ruhig=["weltpolitik", "politik", "ki", "wirtschaft", "tirol", "startups"]))
        ausgabe_text = self.leise(feed.cmd_veroeffentlichen, argparse.Namespace(nachricht="woechentlich 2026-11-01_2026-11-07"))
        self.assertIn("Gepusht", ausgabe_text)
        self.assertEqual(len(self.dateien_auf_origin()), 4)
        index = json.loads(self.lauf(["git", "show", f"{feed.BRANCH}:data/index.json"], self.origin))
        self.assertEqual(len(index["ausgaben"]), 3)
        self.assertEqual(index["start"], "2026-11-05")

    def test_warten(self):
        self.sitzung("a")
        with self.assertRaises(SystemExit) as ende:
            self.leise(feed.cmd_warten, argparse.Namespace(format="woechentlich", minuten=0.001, heute="2026-11-06"))
        self.assertEqual(ende.exception.code, 3)  # Branch gibt es noch nicht
        self.leise(feed.cmd_vorbereiten)
        feed.schreib_json(feed.DATEN / "taeglich" / "2026-11-05.json", tagesausgabe())
        self.leise(feed.cmd_veroeffentlichen, argparse.Namespace(nachricht="taeglich 2026-11-05"))
        self.sitzung("b")
        self.leise(feed.cmd_vorbereiten)
        text = self.leise(feed.cmd_warten, argparse.Namespace(format="woechentlich", minuten=0.001, heute="2026-11-06"))
        self.assertIn("Vorstufe liegt vor", text)
        self.assertTrue((feed.DATEN / "taeglich" / "2026-11-05.json").exists())
        with self.assertRaises(SystemExit) as ende:
            self.leise(feed.cmd_warten, argparse.Namespace(format="woechentlich", minuten=0.001, heute="2026-11-08"))
        self.assertEqual(ende.exception.code, 3)


if __name__ == "__main__":
    unittest.main()
