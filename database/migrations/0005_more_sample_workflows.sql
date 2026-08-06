INSERT OR IGNORE INTO work_areas
  (id, project_id, name, description, status, sort_order)
VALUES
  ('area-grund', 'project-vemdalen', 'Grund', 'Grundsula, murverk och förberedelser för bjälklag.', 'todo', 30);

INSERT OR IGNORE INTO work_sections
  (id, work_area_id, name, description, status, sort_order)
VALUES
  ('section-ground-excavation', 'area-mark', 'Grundschakt', 'Schakt och förberedelser inför grundläggning.', 'todo', 20),
  ('section-foundation-footing', 'area-grund', 'Grundsula', 'Form, armering och gjutning av grundsula.', 'todo', 10);

INSERT OR IGNORE INTO tasks
  (id, section, title, description, status, assignee, sort_order, updated_at, work_section_id)
VALUES
  ('t4', 'Markarbete', 'Schakta för grundens första nivå', 'Schakta till projekterad nivå och skapa en stabil, kontrollerad schaktbotten.', 'todo', NULL, 40, datetime('now'), 'section-ground-excavation'),
  ('t5', 'Markarbete', 'Lägg och packa bärlager', 'Lägg geotextil där det behövs och bygg upp ett jämnt, packat bärlager.', 'blocked', NULL, 50, datetime('now'), 'section-ground-excavation'),
  ('t6', 'Grund', 'Bygg form för grundsula', 'Sätt form i rätt läge, höjd och bredd innan armeringen monteras.', 'todo', NULL, 60, datetime('now'), 'section-foundation-footing'),
  ('t7', 'Grund', 'Armera grundsula', 'Montera längsgående armering, tvärarmering och distanser enligt konstruktionsunderlaget.', 'blocked', NULL, 70, datetime('now'), 'section-foundation-footing'),
  ('t8', 'Grund', 'Gjut och efterbehandla grundsula', 'Kontrollera formen, gjut sulan och skydda betongen under härdningen.', 'blocked', NULL, 80, datetime('now'), 'section-foundation-footing');

INSERT OR IGNORE INTO activities
  (id, task_id, title, description, activity_type, unit, required, blocking, irreversible, technical_resource_id, sort_order)
VALUES
  ('act-t4-010', 't4', 'Kontrollera utsättning och schaktgränser', 'Kontrollera husets läge och markera schaktens yttergränser.', 'check', NULL, 1, 1, 0, 'tu-situationsplan', 10),
  ('act-t4-020', 't4', 'Fotografera marken före schaktning', 'Ta översiktsbilder av området som ska schaktas.', 'document', NULL, 1, 1, 1, 'tu-situationsplan', 20),
  ('act-t4-030', 't4', 'Schakta till projekterad nivå', 'Schakta etappvis och lämna schaktbotten utan löst material.', 'perform', NULL, 1, 1, 0, NULL, 30),
  ('act-t4-040', 't4', 'Mät schaktbottnens nivå', 'Registrera nivån vid hörn och kritiska punkter.', 'measurement', 'mm', 1, 1, 1, 'tu-referensnivaer', 40),
  ('act-t4-050', 't4', 'Dokumentera färdig schaktbotten', 'Fotografera hela schaktbotten innan geotextil eller fyllning läggs.', 'document', NULL, 1, 0, 1, NULL, 50),
  ('act-t4-060', 't4', 'Kontrollera schaktbotten', 'Kontrollera nivå, fasthet och att organiskt material har tagits bort.', 'check', NULL, 1, 0, 0, NULL, 60),

  ('act-t5-010', 't5', 'Kontrollera att föregående schakt är godkänt', 'Bärlager får inte läggas innan schaktbotten är kontrollerad.', 'check', NULL, 1, 1, 0, NULL, 10),
  ('act-t5-020', 't5', 'Lägg geotextil där det krävs', 'Täck schaktbotten med rätt överlapp och utan veck.', 'perform', NULL, 1, 1, 1, NULL, 20),
  ('act-t5-030', 't5', 'Fotografera geotextilen', 'Dokumentera överlapp och anslutningar innan materialet täcks.', 'document', NULL, 1, 1, 1, NULL, 30),
  ('act-t5-040', 't5', 'Lägg bärlager i etapper', 'Fördela materialet i lager som kan packas ordentligt.', 'perform', NULL, 1, 1, 0, NULL, 40),
  ('act-t5-050', 't5', 'Packa bärlagret', 'Packa varje lager och kontrollera att ytan är stabil.', 'perform', NULL, 1, 1, 0, NULL, 50),
  ('act-t5-060', 't5', 'Mät färdig nivå', 'Registrera nivån där grundsulan ska placeras.', 'measurement', 'mm', 1, 0, 1, 'tu-referensnivaer', 60),

  ('act-t6-010', 't6', 'Märk ut sulans läge', 'För över mått och axlar till arbetsområdet.', 'perform', NULL, 1, 1, 0, NULL, 10),
  ('act-t6-020', 't6', 'Bygg och fixera formen', 'Bygg formen rak, stabil och med rätt invändiga mått.', 'perform', NULL, 1, 1, 0, NULL, 20),
  ('act-t6-030', 't6', 'Mät formens bredd', 'Registrera invändig bredd på representativa platser.', 'measurement', 'mm', 1, 1, 1, NULL, 30),
  ('act-t6-040', 't6', 'Mät formens överkant', 'Kontrollera och registrera höjden vid hörn och nivåbyten.', 'measurement', 'mm', 1, 1, 1, 'tu-referensnivaer', 40),
  ('act-t6-050', 't6', 'Fotografera färdig form', 'Ta översikts- och detaljbilder innan armeringen monteras.', 'document', NULL, 1, 0, 1, NULL, 50),

  ('act-t7-010', 't7', 'Placera distanser', 'Montera distanser så att rätt täckskikt erhålls.', 'perform', NULL, 1, 1, 0, NULL, 10),
  ('act-t7-020', 't7', 'Montera längsgående armering', 'Montera armeringsjärnen med rätt antal, dimension och skarvlängd.', 'perform', NULL, 1, 1, 0, NULL, 20),
  ('act-t7-030', 't7', 'Montera tvärarmering', 'Montera tvärjärn och naj fast armeringen.', 'perform', NULL, 1, 1, 0, NULL, 30),
  ('act-t7-040', 't7', 'Kontrollera täckskikt', 'Mät avståndet mellan armering och form/botten.', 'measurement', 'mm', 1, 1, 1, NULL, 40),
  ('act-t7-050', 't7', 'Fotografera armeringen före gjutning', 'Dokumentera hela armeringen, skarvar, hörn och nivåbyten.', 'document', NULL, 1, 1, 1, NULL, 50),
  ('act-t7-060', 't7', 'Slutkontroll före gjutning', 'Kontrollera form, armering, distanser och genomföringar.', 'check', NULL, 1, 0, 0, NULL, 60),

  ('act-t8-010', 't8', 'Kontrollera att formen är ren och stabil', 'Ta bort löst material och kontrollera stämpning.', 'check', NULL, 1, 1, 0, NULL, 10),
  ('act-t8-020', 't8', 'Dokumentera före gjutning', 'Ta sista bilderna av form och armering.', 'document', NULL, 1, 1, 1, NULL, 20),
  ('act-t8-030', 't8', 'Gjut grundsulan', 'Fyll formen jämnt och vibrera betongen utan att flytta armeringen.', 'perform', NULL, 1, 1, 0, NULL, 30),
  ('act-t8-040', 't8', 'Kontrollera och justera överkant', 'Kontrollera höjd och jämna av ytan.', 'check', NULL, 1, 1, 0, NULL, 40),
  ('act-t8-050', 't8', 'Fotografera färdig gjutning', 'Dokumentera sulan direkt efter avslutad gjutning.', 'document', NULL, 1, 0, 1, NULL, 50),
  ('act-t8-060', 't8', 'Skydda och efterbehandla betongen', 'Täck betongen och skydda mot uttorkning, frost och nederbörd.', 'perform', NULL, 1, 0, 0, NULL, 60);