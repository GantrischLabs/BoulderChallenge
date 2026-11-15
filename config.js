/* ============================================================
   Datenbank-Anbindung (Supabase)
   Leer lassen = App läuft wie bisher nur mit data.json und
   JSON-Copy-Paste. Einrichtung: siehe supabase/README.md

   Der Publishable Key (sb_publishable_…) ist für den Browser gedacht und
   darf öffentlich im Repo stehen – geschützt wird über die
   Rechte in supabase/setup.sql. Den Secret Key (sb_secret_…)
   NIE hier eintragen.
   ============================================================ */

window.BOULDER_CONFIG = {
  supabaseUrl: "",       // Project Settings → Data API → Project URL
  supabaseAnonKey: "",   // Project Settings → API Keys → Publishable key
  gruppenEmail: ""       // E-Mail des gemeinsamen Gruppen-Kontos
};
