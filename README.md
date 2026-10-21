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
- **Persönliche Serie & Joker:** Jede Person hat ihre eigene Serie. Alle 7 aktiven Tage gibt es einen Joker (max. 3), der einen verpassten Tag rettet. Bonuspunkte bei 3, 7, 14, 30, 60, 100, 200 und 365 Tagen.
- **Abzeichen:** z. B. Endgegner besiegt, Hunde-Held, Tonnen-Profi, Ecken-Jäger – mit Fortschrittsanzeige.
- **🔒 Private Zimmer:** Kinderzimmer und Elternschlafzimmer gehören einer Person – sie sind nicht in der gemeinsamen Runde; die Besitzerin bekommt „Dein Zimmer“ auf ihrer eigenen Heute-Seite, die anderen sehen nur „privat“.
- **👑 Eltern-Rechte:** Nur Eltern ändern Personen, Aufgaben, Räume, Familienziel und Abfallkalender; jedes Handy ist fest an eine Person gebunden, neue Handys bekommen einen Einrichtungs-Code der Eltern. Durchgesetzt vom Server (`supabase/004_eltern.sql`).
- **🔴 Fällig & überfällig:** Was außerhalb des Tagesplans fällig oder überfällig ist, steht ebenfalls auf der Heute-Seite.
- **📷 Beweisfotos:** Beim Zuschicken ein Foto verlangen oder freiwillig eins anhängen; liegt privat im Familien-Speicher (`supabase/005_fotos.sql`).
- **🙋 Übernehme ich:** Der Tagesplan gilt für die ganze Familie; jede Person markiert, was sie übernimmt.
- **Rangliste zum Familienziel:** Wer hat wie viel beigetragen – wer am wenigsten hat, spendiert (abschaltbar).
- **„Nur 15 Minuten“:** gekürzter Plan für Tage mit wenig Energie.
- **Räume-Ampel**, **Familienziel**, **Level** und Verlauf.
- **Abfallkalender:** aus der Schichtplaner-Sicherung übernehmen oder .ics-Datei vom Entsorger laden. Am Vorabend erscheint „Gelbe Tonne rausstellen“ – mit Punkten und zum Zuschicken.

## Familie verbunden

- **Familie gründen / beitreten:** Eine Person gründet, alle anderen treten per Einladungslink oder Code bei – ohne Passwort.
- **Aufgaben zuschicken:** aus dem Katalog oder frei formuliert, mit Termin und Nachricht. Die Empfängerin sieht sie unter „Für dich“.
- **Live:** Erledigungen, neue Aufgaben und Einstellungen erscheinen sofort auf allen Handys.
- **Offline-fest:** Ohne Netz wird weiter abgehakt; Änderungen werden nachgereicht, sobald wieder Verbindung besteht.
- **Push-Benachrichtigungen:** neue und erledigte Aufgaben, Müll-Erinnerung um 18 Uhr am Vorabend und eine wählbare tägliche Erinnerung – auch bei geschlossener App (Push-Dienst in `supabase/functions/wanda-push`).

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
- [x] **Stufe 2b:** Push-Benachrichtigungen, auch wenn die App geschlossen ist
- [ ] **Stufe 3:** Belohnungsshop, Vorher/Nachher-Fotos, Wochenstatistik
