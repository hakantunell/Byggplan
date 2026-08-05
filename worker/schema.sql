PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  property_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('todo','active','review','done','blocked')),
  assignee TEXT,
  blocked_by TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('measurement','photo','check','text','choice')),
  unit TEXT,
  min_value REAL,
  max_value REAL,
  required INTEGER NOT NULL DEFAULT 1,
  done INTEGER NOT NULL DEFAULT 0,
  value TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_requirements_task ON requirements(task_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_notifications_project ON notifications(project_id, created_at DESC);

INSERT OR IGNORE INTO projects VALUES (
  'vemdalens-kyrkby-44-10','Timmerhusbygget','Vemdalens Kyrkby 44:10',datetime('now'),datetime('now')
);

INSERT OR IGNORE INTO tasks VALUES
('t1','vemdalens-kyrkby-44-10','Markarbete','Dokumentera ursprunglig mark','Ta översiktsbilder och notera befintliga nivåer innan schaktningen startar.','active','Håkan',NULL,10,datetime('now'),datetime('now')),
('t2','vemdalens-kyrkby-44-10','Avlopp','Kontrollera schakt före rörläggning','Kontrollera schaktbotten, ledningssträckning och anslutningspunkt innan bädden läggs.','todo',NULL,NULL,20,datetime('now'),datetime('now')),
('t3','vemdalens-kyrkby-44-10','Avlopp','Lägg och kontrollera avloppsrör','Registrera rördimension, fall och förläggningsdjup innan återfyllning.','blocked',NULL,'["t2"]',30,datetime('now'),datetime('now')),
('t4','vemdalens-kyrkby-44-10','Grund','Märk ut grundens hörn','Kontrollera mått och diagonaler innan schakt för sulor.','todo',NULL,NULL,40,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO requirements VALUES
('r1','vemdalens-kyrkby-44-10','t1','Översiktsbilder från fyra riktningar','photo',NULL,NULL,NULL,1,0,NULL,10,datetime('now'),datetime('now')),
('r2','vemdalens-kyrkby-44-10','t1','Referensnivå vid husets nordvästra hörn','measurement','mm',NULL,NULL,1,0,NULL,20,datetime('now'),datetime('now')),
('r3','vemdalens-kyrkby-44-10','t2','Schaktdjup vid huset','measurement','mm',800,NULL,1,0,NULL,10,datetime('now'),datetime('now')),
('r4','vemdalens-kyrkby-44-10','t2','Foto av hela ledningssträckan','photo',NULL,NULL,NULL,1,0,NULL,20,datetime('now'),datetime('now')),
('r5','vemdalens-kyrkby-44-10','t2','Schaktbotten fri från löst material','check',NULL,NULL,NULL,1,0,NULL,30,datetime('now'),datetime('now')),
('r6','vemdalens-kyrkby-44-10','t3','Förläggningsdjup vid huset','measurement','mm',800,NULL,1,0,NULL,10,datetime('now'),datetime('now')),
('r7','vemdalens-kyrkby-44-10','t3','Rörfall','measurement','mm/m',10,NULL,1,0,NULL,20,datetime('now'),datetime('now')),
('r8','vemdalens-kyrkby-44-10','t3','Foto av anslutningar och skarvar','photo',NULL,NULL,NULL,1,0,NULL,30,datetime('now'),datetime('now')),
('r9','vemdalens-kyrkby-44-10','t4','Diagonal A','measurement','mm',NULL,NULL,1,0,NULL,10,datetime('now'),datetime('now')),
('r10','vemdalens-kyrkby-44-10','t4','Diagonal B','measurement','mm',NULL,NULL,1,0,NULL,20,datetime('now'),datetime('now')),
('r11','vemdalens-kyrkby-44-10','t4','Hörnpunkter fotograferade','photo',NULL,NULL,NULL,1,0,NULL,30,datetime('now'),datetime('now'));
