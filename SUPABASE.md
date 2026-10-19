# ☁️ Familien-Sync einrichten (einmalig, ca. 10 Minuten)

Damit alle Handys dieselben Daten sehen, braucht Wisch-Wanda einen kleinen Online-Speicher.
Dafür nutzen wir **Supabase** – für eine Familie kostenlos.

## 1. Konto anlegen

1. Öffne <https://supabase.com> und klicke auf **„Start your project“**.
2. Melde dich am einfachsten mit **„Continue with GitHub“** an.

## 2. Projekt erstellen

1. Klicke auf **„New project“**.
2. Trage ein:
   - **Name:** `wisch-wanda`
   - **Database Password:** auf **„Generate a password“** klicken und das Passwort irgendwo sicher notieren
     (wird für die App nicht gebraucht, aber gut aufzuheben).
   - **Region:** **Central EU (Frankfurt)**
3. **„Create new project“** – das dauert 1–2 Minuten.

## 3. Datenbank anlegen

1. Links im Menü auf **„SQL Editor“** klicken.
2. Die Datei [`supabase/schema.sql`](supabase/schema.sql) hier auf GitHub öffnen, oben rechts auf
   **„Copy raw file“** (Symbol mit zwei Kästchen) klicken.
3. Im SQL Editor alles einfügen und unten rechts auf **„Run“** klicken.
   Es sollte **„Success. No rows returned“** erscheinen.

## 4. Anonyme Anmeldung erlauben

Damit niemand in der Familie ein Passwort braucht:

1. Links auf **„Authentication“** → **„Sign In / Providers“**.
2. **„Allow anonymous sign-ins“** einschalten → **„Save changes“**.

## 5. Zugangsdaten an Claude geben

1. Links unten auf **„Project Settings“** (Zahnrad) → **„Data API“**: dort die **Project URL** kopieren
   (sieht aus wie `https://abcdefgh.supabase.co`).
2. Dann **„API Keys“**: den **Publishable key** kopieren (beginnt mit `sb_publishable_…`;
   bei älteren Projekten heißt er **„anon public“**).
3. Beide Werte an Claude schicken – sie kommen in `js/config.js`.

> ⚠️ **Niemals** den **Secret key** bzw. **„service_role“**-Schlüssel weitergeben – der hebelt alle
> Schutzregeln aus. Die Project URL und der Publishable key dagegen sind dafür gedacht, in der App zu
> stehen: Geschützt sind eure Daten durch die Zugriffsregeln und euren Einladungscode.

## Nachtrag: Abfallkalender (nur falls die Datenbank schon vorher angelegt wurde)

Wurde Schritt 3 vor dem Oktober-Update mit dem Abfallkalender ausgeführt, fehlt der Datenbank ein Feld.
Im **SQL Editor** einmal den Inhalt von [`supabase/002_abfallkalender.sql`](supabase/002_abfallkalender.sql)
einfügen und **„Run“** klicken. Mehrfaches Ausführen schadet nicht.

## Push-Benachrichtigungen einrichten (ca. 5 Minuten)

Damit Wanda auch bei geschlossener App Bescheid gibt (neue Aufgabe, erledigt, Müll am Vorabend,
tägliche Erinnerung), braucht es einen kleinen Push-Dienst auf Supabase. Geheimschlüssel musst du
dafür **nicht** kopieren – die erzeugt der Dienst selbst.

### A. Datenbank vorbereiten

1. Die Datei [`supabase/003_push.sql`](supabase/003_push.sql) öffnen → **„Copy raw file“**.
2. Im Supabase **SQL Editor** eine neue Abfrage öffnen, einfügen, **„Run“**.
   Falls Supabase nachfragt, ob die Abfrage ausgeführt werden soll: bestätigen.

### B. Push-Dienst anlegen

1. Die Datei [`supabase/functions/wanda-push/index.ts`](supabase/functions/wanda-push/index.ts) öffnen → **„Copy raw file“**.
2. In Supabase links auf **„Edge Functions“** klicken → **„Deploy a new function“** → **„Via Editor“**.
3. Den vorhandenen Beispiel-Code komplett löschen und den kopierten Code einfügen.
4. Unten den Namen auf **`wanda-push`** setzen (genau so, klein und mit Bindestrich).
5. **„Deploy function“** klicken und kurz warten.
6. Die neue Funktion öffnen → **„Details“** (bzw. Einstellungen) → **„Verify JWT“ / „Enforce JWT Verification“ ausschalten** → speichern.
   Der Dienst prüft stattdessen selbst, ob ein Aufruf von eurer Datenbank kommt.

### C. Auf jedem Handy einschalten

In Wanda: **Einstellungen → 🔔 Benachrichtigungen → „Benachrichtigungen einschalten“**, erlauben,
dann **„Test senden“**. Kommt „🧽 Wanda sagt Hallo!“, ist alles richtig eingerichtet.

> 📱 **iPhone:** Benachrichtigungen gehen nur, wenn Wanda über Safari → Teilen → „Zum Home-Bildschirm“
> hinzugefügt wurde und von dort geöffnet wird (iOS 16.4 oder neuer).

## Gut zu wissen

- Kostenlose Supabase-Projekte schlafen ein, wenn eine Woche lang niemand die App benutzt.
  Dann im Supabase-Dashboard auf **„Restore project“** klicken.
- Jedes Handy meldet sich automatisch an. Geht die Anmeldung verloren (z. B. Browserdaten gelöscht),
  einfach in Wisch-Wanda erneut mit dem Einladungscode beitreten – es geht nichts verloren.
