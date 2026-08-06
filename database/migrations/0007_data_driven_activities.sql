CREATE TABLE IF NOT EXISTS documentation_profiles (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  profile_type TEXT NOT NULL CHECK (profile_type IN ('work','relations','municipality','control','custom')),
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, code)
);

CREATE TABLE IF NOT EXISTS activity_documentation_profiles (
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  documentation_profile_id TEXT NOT NULL REFERENCES documentation_profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (activity_id, documentation_profile_id)
);

CREATE TABLE IF NOT EXISTS activity_documentation_fields (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  field_type TEXT NOT NULL CHECK (field_type IN ('photo','number','text','boolean','file','choice','signature')),
  label TEXT NOT NULL,
  help_text TEXT,
  unit TEXT,
  required INTEGER NOT NULL DEFAULT 1,
  minimum_items INTEGER,
  maximum_items INTEGER,
  minimum_value REAL,
  maximum_value REAL,
  options_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_documentation_entries (
  id TEXT PRIMARY KEY,
  field_id TEXT NOT NULL REFERENCES activity_documentation_fields(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  value_text TEXT,
  value_number REAL,
  value_boolean INTEGER,
  object_key TEXT,
  original_name TEXT,
  content_type TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_doc_fields_activity
  ON activity_documentation_fields(activity_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_activity_doc_entries_field
  ON activity_documentation_entries(field_id, created_at);

CREATE INDEX IF NOT EXISTS idx_activity_doc_profile_activity
  ON activity_documentation_profiles(activity_id);

INSERT OR IGNORE INTO documentation_profiles
  (id, project_id, code, name, description, profile_type, sort_order)
VALUES
  ('dp-work', 'project-vemdalen', 'work', 'Arbetsdokumentation', 'Information som främst används under byggtiden.', 'work', 10),
  ('dp-relations', 'project-vemdalen', 'relations', 'Relationsdokumentation', 'Dokumentation av hur byggdelar och installationer faktiskt utfördes.', 'relations', 20),
  ('dp-municipality-environment', 'project-vemdalen', 'municipality_environment', 'Miljökontoret', 'Underlag för avloppsanläggning och miljökontorets uppföljning.', 'municipality', 30),
  ('dp-municipality-build', 'project-vemdalen', 'municipality_build', 'Byggnadsnämnden', 'Underlag för kontrollplan, tekniskt samråd och slutbesked.', 'municipality', 40),
  ('dp-control', 'project-vemdalen', 'control', 'Kontroll och egenkontroll', 'Kontroller och verifieringar i byggprocessen.', 'control', 50);

INSERT OR IGNORE INTO activity_documentation_fields
  (id, activity_id, field_type, label, help_text, unit, required, minimum_items, sort_order)
VALUES
  ('adf-t1-photo-overview', 'act-t1-010', 'photo', 'Översiktsbilder av ursprunglig mark', 'Ta bilder från minst fyra tydliga riktningar innan marken påverkas.', NULL, 1, 4, 10),
  ('adf-t1-photo-comment', 'act-t1-010', 'text', 'Kommentar', 'Notera sådant som inte framgår tydligt av bilderna.', NULL, 0, NULL, 20),
  ('adf-t1-level', 'act-t1-040', 'number', 'Ursprunglig marknivå', 'Registrera nivån vid den aktuella mätpunkten.', 'mm', 1, NULL, 10),
  ('adf-t1-reference-photo', 'act-t1-050', 'photo', 'Referenspunkt och nivåmarkeringar', 'Fotografera så att punkterna går att återfinna senare.', NULL, 1, 2, 10),
  ('adf-t2-depth', 'act-t2-030', 'number', 'Förläggningsdjup', 'Registrera djup vid hus, riktningsändringar och brunn.', 'mm', 1, NULL, 10),
  ('adf-t2-trench-photo', 'act-t2-040', 'photo', 'Schakt före rörläggning', 'Dokumentera schaktbotten och hela ledningssträckningen.', NULL, 1, 3, 10),
  ('adf-t3-fall', 'act-t3-030', 'number', 'Uppmätt rörfall', 'Registrera uppmätt fall innan ledningen täcks.', 'mm/m', 1, NULL, 10),
  ('adf-t3-pipe-photo', 'act-t3-040', 'photo', 'Rör och anslutningar före återfyllning', 'Ta både översiktsbilder och detaljbilder av skarvar och anslutningar.', NULL, 1, 4, 10),
  ('adf-t3-pipe-comment', 'act-t3-040', 'text', 'Kommentar till utförandet', 'Beskriv eventuella avvikelser från planerad sträckning.', NULL, 0, NULL, 20);

INSERT OR IGNORE INTO activity_documentation_profiles
  (activity_id, documentation_profile_id)
VALUES
  ('act-t1-010', 'dp-municipality-build'),
  ('act-t1-010', 'dp-relations'),
  ('act-t1-040', 'dp-municipality-build'),
  ('act-t1-040', 'dp-relations'),
  ('act-t1-050', 'dp-relations'),
  ('act-t2-030', 'dp-municipality-environment'),
  ('act-t2-030', 'dp-relations'),
  ('act-t2-040', 'dp-municipality-environment'),
  ('act-t2-040', 'dp-relations'),
  ('act-t3-030', 'dp-municipality-environment'),
  ('act-t3-030', 'dp-relations'),
  ('act-t3-040', 'dp-municipality-environment'),
  ('act-t3-040', 'dp-relations'),
  ('act-t3-050', 'dp-control');
