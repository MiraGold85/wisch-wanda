# 🧽 Wisch-Wanda

Motivierende Haushalts-App für die ganze Familie: eine Stunde am Tag, ein paar Minuten pro Raum,
jede Woche ein Raum gründlich – mit Punkten, Serien und einem gemeinsamen Familienziel.

## Das System

| Block | Dauer | Inhalt |
|---|---|---|
| ☀️ Grundroutine | ca. 10 Min | Spülmaschine, Arbeitsflächen, Wäsche, kurz aufräumen |
| 🐾 Terrasse & Hunde | 2 Min | täglicher Hunde-Check plus fällige Terrassenaufgaben |
| ⏱️ Raum-Runde | 4 × 7 Min | 4 Räume mit Timer, rotiert täglich |
| 🔍 Fokus der Woche | 15–20 Min | jede Woche ein anderer Raum gründlich |
| 🎯 Mission des Tages | 5 Min | die am längsten vergessene Aufgabe (Fußleisten, Lichtschalter, Backofen …) |

- **Aufgabenkatalog mit Intervallen:** Jede Aufgabe weiß, wann sie zuletzt erledigt wurde, und wird automatisch wieder eingeplant.
- **Punkte nach Unbeliebtheit:** Kleinigkeit 5 · Geht so 10 · Lästig 20 · Unbeliebt 35 · Endgegner 50.
- **Serie & Joker:** Alle 7 aktiven Tage gibt es einen Joker (max. 3), der einen verpassten Tag rettet.
- **„Nur 15 Minuten“:** gekürzter Plan für Tage mit wenig Energie.
- **Räume-Ampel**, **Familienziel**, **Level** und Verlauf.
- **Abfallkalender:** aus der Schichtplaner-Sicherung übernehmen oder .ics-Datei vom Entsorger laden. Am Vorabend erscheint „Gelbe Tonne rausstellen“ – mit Punkten und zum Zuschicken.

## Familie verbunden

- **Familie gründen / beitreten:** Eine Person gründet, alle anderen treten per Einladungslink oder Code bei – ohne Passwort.
- **Aufgaben zuschicken:** aus dem Katalog oder frei formuliert, mit Termin und Nachricht. Die Empfängerin sieht sie unter „Für dich“.
- **Live:** Erledigungen, neue Aufgaben und Einstellungen erscheinen sofort auf allen Handys.
- **Offline-fest:** Ohne Netz wird weiter abgehakt; Änderungen werden nachgereicht, sobald wieder Verbindung besteht.

Einrichtung: siehe [SUPABASE.md](SUPABASE.md). Ohne Einrichtung läuft die App rein lokal.

## Ausprobieren

```bash
npm start      # öffnet die App auf http://localhost:8080
npm test       # Tests der Planungs- und Datenlogik
```

Kein Build-Schritt – reines HTML, CSS und JavaScript. Die Supabase-Bibliothek liegt fertig gebündelt in `js/vendor/`.
Die App ist eine PWA und lässt sich auf Android („Zum Startbildschirm hinzufügen“)
und iPhone (Safari → Teilen → „Zum Home-Bildschirm“) installieren.

## Fahrplan

- [x] **Stufe 1:** Tagesplan, Rotation, Raum-Timer, Aufgabenkatalog, Punkte, Serien (Daten lokal auf dem Gerät)
- [x] **Stufe 2:** Familien-Sync (Einladungslink, Aufgaben zuschicken, Live-Aktualisierung)
- [ ] **Stufe 2b:** Push-Benachrichtigungen, auch wenn die App geschlossen ist
- [ ] **Stufe 3:** Belohnungsshop, Vorher/Nachher-Fotos, Wochenstatistik
