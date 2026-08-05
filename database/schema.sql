CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  assignee TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  unit TEXT,
  minimum REAL,
  required INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  requirement_id TEXT NOT NULL UNIQUE REFERENCES requirements(id) ON DELETE CASCADE,
  value TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  task_id TEXT REFERENCES tasks(id),
  message TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  requirement_id TEXT REFERENCES requirements(id),
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO tasks VALUES
('t1','Markarbete','Dokumentera ursprunglig mark','Ta översiktsbilder och notera befintliga nivåer innan schaktningen startar.','active','Håkan',10,datetime('now')),
('t2','Avlopp','Kontrollera schakt före rörläggning','Kontrollera schaktbotten och anslutningspunkt innan bädden läggs.','todo',NULL,20,datetime('now')),
('t3','Avlopp','Lägg och kontrollera avloppsrör','Registrera fall och förläggningsdjup innan återfyllning.','blocked',NULL,30,datetime('now'));

INSERT OR IGNORE INTO requirements VALUES
('r1','t1','Översiktsbilder från fyra riktningar','photo',NULL,NULL,1,10),
('r2','t1','Referensnivå vid nordvästra hörnet','measurement','mm',NULL,1,20),
('r3','t2','Schaktdjup vid huset','measurement','mm',800,1,10),
('r4','t2','Foto av hela ledningssträckan','photo',NULL,NULL,1,20),
('r5','t2','Schaktbotten fri från löst material','check',NULL,NULL,1,30),
('r6','t3','Förläggningsdjup vid huset','measurement','mm',800,1,10),
('r7','t3','Rörfall','measurement','mm/m',10,1,20),
('r8','t3','Foto av anslutningar och skarvar','photo',NULL,NULL,1,30);
