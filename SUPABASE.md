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

## Gut zu wissen

- Kostenlose Supabase-Projekte schlafen ein, wenn eine Woche lang niemand die App benutzt.
  Dann im Supabase-Dashboard auf **„Restore project“** klicken.
- Jedes Handy meldet sich automatisch an. Geht die Anmeldung verloren (z. B. Browserdaten gelöscht),
  einfach in Wisch-Wanda erneut mit dem Einladungscode beitreten – es geht nichts verloren.
