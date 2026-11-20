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
  supabaseUrl: "https://fcnxryjafhjxwqyycmhe.supabase.co",       // Project Settings → Data API → Project URL
  supabaseAnonKey: "sb_publishable_uAf6LV-gbRs-eTMfJhJ39g_qvTJthwa",   // Project Settings → API Keys → Publishable key
  gruppenEmail: "maendi@boulder.info"       // E-Mail des gemeinsamen Gruppen-Kontos
};
