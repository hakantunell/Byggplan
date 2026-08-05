PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  property_designation TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS work_areas (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS work_sections (
  id TEXT PRIMARY KEY,
  work_area_id TEXT NOT NULL REFERENCES work_areas(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE tasks ADD COLUMN work_section_id TEXT REFERENCES work_sections(id);

CREATE TABLE IF NOT EXISTS control_points (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('work_area','work_section','task')),
  entity_id TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('check','measurement','photo','document','approval','comment')),
  unit TEXT,
  minimum REAL,
  maximum REAL,
  required INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS technical_resources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('drawing','technical_data','material','image','document','link','note')),
  title TEXT NOT NULL,
  summary TEXT,
  revision TEXT,
  status TEXT NOT NULL DEFAULT 'current',
  object_key TEXT,
  external_url TEXT,
  content_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS technical_resource_links (
  id TEXT PRIMARY KEY,
  technical_resource_id TEXT NOT NULL REFERENCES technical_resources(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('project','work_area','work_section','task','control_point')),
  entity_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (technical_resource_id, entity_type, entity_id)
);

INSERT OR IGNORE INTO projects (id, name, property_designation, status, sort_order)
VALUES ('project-vemdalen', 'Vemdalens Kyrkby 44:10', 'Vemdalens Kyrkby 44:10', 'active', 10);

INSERT OR IGNORE INTO work_areas (id, project_id, name, description, status, sort_order) VALUES
('area-mark', 'project-vemdalen', 'Markarbete', 'Schakt, nivåer och markförberedelser.', 'active', 10),
('area-va', 'project-vemdalen', 'Avlopp', 'Trekammarbrunn, ledningar och anslutning till infiltration.', 'active', 20);

INSERT OR IGNORE INTO work_sections (id, work_area_id, name, description, status, sort_order) VALUES
('section-original-mark', 'area-mark', 'Ursprunglig mark och utsättning', 'Dokumentation före schakt och kontroll av referensnivåer.', 'active', 10),
('section-sewer-trench', 'area-va', 'Avloppsschakt och rörläggning', 'Schakt, bädd, ledningar och kontroller före återfyllning.', 'active', 10);

UPDATE tasks SET work_section_id = 'section-original-mark' WHERE id = 't1' AND work_section_id IS NULL;
UPDATE tasks SET work_section_id = 'section-sewer-trench' WHERE id IN ('t2','t3') AND work_section_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_areas_project ON work_areas(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_work_sections_area ON work_sections(work_area_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_tasks_section ON tasks(work_section_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_control_points_entity ON control_points(entity_type, entity_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_technical_links_entity ON technical_resource_links(entity_type, entity_id, sort_order);
