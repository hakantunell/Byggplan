PRAGMA foreign_keys = ON;

-- Första tekniska underlagen. Poster och länkar kan senare administreras från appen.
INSERT OR IGNORE INTO technical_resources
  (id, project_id, resource_type, title, summary, revision, status, content_text)
VALUES
  ('tu-situationsplan', 'project-vemdalen', 'drawing', 'Situationsplan',
   'Husets placering, tomtgränser och höjdpunkter.', 'Rev B', 'current', NULL),
  ('tu-referensnivaer', 'project-vemdalen', 'technical_data', 'Referensnivåer',
   'Projektets höjdsystem och fasta mätpunkter.', NULL, 'current',
   'Referenspunkt: nordvästra tomthörnet\nAlla nivåer anges i millimeter'),
  ('tu-va-plan', 'project-vemdalen', 'drawing', 'VA-plan',
   'Ledningsdragning från huset till trekammarbrunn och befintlig infiltration.', 'Gällande', 'current', NULL),
  ('tu-schakt-badd', 'project-vemdalen', 'material', 'Schakt och ledningsbädd',
   'Mått och material för schaktbotten och bädd.', NULL, 'current',
   'Rördimension: 110 mm\nBäddtjocklek: minst 100 mm\nBäddmaterial enligt projekterat underlag'),
  ('tu-avloppsdata', 'project-vemdalen', 'technical_data', 'Avloppsledning – tekniska data',
   'Dimensioner, fall och kontrolluppgifter.', NULL, 'current',
   'Rördimension: 110 mm\nMinsta fall: 10 mm/m\nRegistrera djup vid hus, riktningsändringar och brunn'),
  ('tu-anslutning-brunn', 'project-vemdalen', 'drawing', 'Detaljritning anslutning',
   'Principdetalj för anslutning mot trekammarbrunn.', 'Rev A', 'current', NULL);

INSERT OR IGNORE INTO technical_resource_links
  (id, technical_resource_id, entity_type, entity_id, sort_order)
VALUES
  ('tul-001', 'tu-situationsplan', 'work_section', 'section-original-mark', 10),
  ('tul-002', 'tu-referensnivaer', 'task', 't1', 20),
  ('tul-003', 'tu-va-plan', 'work_section', 'section-sewer-trench', 10),
  ('tul-004', 'tu-schakt-badd', 'task', 't2', 20),
  ('tul-005', 'tu-avloppsdata', 'task', 't3', 20),
  ('tul-006', 'tu-anslutning-brunn', 'task', 't3', 30);

-- Exempel på kontrollpunkter på olika nivåer. Befintliga task-krav ligger kvar
-- tills de stegvis migreras till den generella modellen.
INSERT OR IGNORE INTO control_points
  (id, entity_type, entity_id, label, description, kind, required, sort_order)
VALUES
  ('cp-area-va-photo', 'work_area', 'area-va', 'Dokumentera ledningar före återfyllning',
   'Minst ett översiktsfoto ska visa ledningssträckningen innan den täcks.', 'photo', 1, 10),
  ('cp-section-va-depth', 'work_section', 'section-sewer-trench', 'Registrera kritiska förläggningsdjup',
   'Djup registreras vid hus, riktningsändringar och anslutning till brunn.', 'measurement', 1, 20);
