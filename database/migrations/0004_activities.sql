CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('perform','document','measurement','check','approval','note','choice')),
  unit TEXT,
  required INTEGER NOT NULL DEFAULT 1,
  blocking INTEGER NOT NULL DEFAULT 0,
  irreversible INTEGER NOT NULL DEFAULT 0,
  technical_resource_id TEXT REFERENCES technical_resources(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_entries (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL UNIQUE REFERENCES activities(id) ON DELETE CASCADE,
  value TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  completed_by TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activities_task ON activities(task_id, sort_order);

UPDATE tasks
SET title = 'Fastställ och dokumentera ursprungliga marknivåer',
    description = 'Dokumentera utgångsläget, välj en beständig referenspunkt och registrera ursprungliga marknivåer innan schaktningen börjar.'
WHERE id = 't1';

INSERT OR IGNORE INTO activities
  (id, task_id, title, description, activity_type, unit, required, blocking, irreversible, technical_resource_id, sort_order)
VALUES
  ('act-t1-010', 't1', 'Ta översiktsbilder före arbete', 'Fotografera marken från flera tydliga riktningar innan något flyttas eller schaktas.', 'document', NULL, 1, 1, 1, 'tu-situationsplan', 10),
  ('act-t1-020', 't1', 'Välj och märk ut en fast referenspunkt', 'Välj en punkt som inte påverkas av schaktningen och märk den så att den kan återfinnas.', 'perform', NULL, 1, 1, 0, 'tu-referensnivaer', 20),
  ('act-t1-030', 't1', 'Sätt ut referensnivåer', 'För över referensnivån till profiler eller käppar vid de platser som ska mätas.', 'perform', NULL, 1, 1, 0, 'tu-referensnivaer', 30),
  ('act-t1-040', 't1', 'Mät och registrera ursprungliga nivåer', 'Registrera höjden vid varje relevant mätpunkt.', 'measurement', 'mm', 1, 1, 1, 'tu-referensnivaer', 40),
  ('act-t1-050', 't1', 'Fotografera referenspunkter och markeringar', 'Ta bilder som tydligt visar var referenspunkten och nivåmarkeringarna finns.', 'document', NULL, 1, 0, 1, 'tu-situationsplan', 50),
  ('act-t1-060', 't1', 'Kontrollera att underlaget är komplett', 'Kontrollera att bilder, mätvärden och referenspunkter är tydligt dokumenterade.', 'check', NULL, 1, 0, 0, NULL, 60),

  ('act-t2-010', 't2', 'Kontrollera planerad ledningssträckning', 'Jämför sträckningen med VA-planen innan schaktningen påbörjas.', 'check', NULL, 1, 1, 0, 'tu-va-plan', 10),
  ('act-t2-020', 't2', 'Schakta till projekterat djup', 'Utför schaktningen med utrymme för ledningsbädd och rätt fall.', 'perform', NULL, 1, 1, 0, 'tu-schakt-badd', 20),
  ('act-t2-030', 't2', 'Mät förläggningsdjup', 'Registrera djup vid hus, riktningsändringar och anslutning till brunn.', 'measurement', 'mm', 1, 1, 1, 'tu-schakt-badd', 30),
  ('act-t2-040', 't2', 'Fotografera schakt före rörläggning', 'Dokumentera schaktbotten och ledningssträckning innan rören läggs.', 'document', NULL, 1, 0, 1, 'tu-va-plan', 40),

  ('act-t3-010', 't3', 'Lägg ledningsbädd', 'Jämna av och packa bäddmaterial enligt tekniskt underlag.', 'perform', NULL, 1, 1, 0, 'tu-schakt-badd', 10),
  ('act-t3-020', 't3', 'Lägg och anslut avloppsrör', 'Montera rören med projekterat fall och anslut mot trekammarbrunnen.', 'perform', NULL, 1, 1, 0, 'tu-anslutning-brunn', 20),
  ('act-t3-030', 't3', 'Mät rörets fall', 'Registrera uppmätt fall innan ledningen täcks.', 'measurement', 'mm/m', 1, 1, 1, 'tu-avloppsdata', 30),
  ('act-t3-040', 't3', 'Fotografera rör och anslutningar före återfyllning', 'Ta översikts- och detaljbilder innan ledningen täcks.', 'document', NULL, 1, 1, 1, 'tu-va-plan', 40),
  ('act-t3-050', 't3', 'Kontrollera ledningen före återfyllning', 'Kontrollera fall, skarvar, anslutningar och dokumentation.', 'check', NULL, 1, 0, 0, NULL, 50);
