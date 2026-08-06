INSERT OR IGNORE INTO users (id, email, display_name, status)
VALUES
  ('user-demo-worker', 'worker@demo.byggplan.local', 'Håkan – Arbetare', 'active'),
  ('user-demo-supervisor', 'supervisor@demo.byggplan.local', 'Håkan – Arbetsledare', 'active');

INSERT OR IGNORE INTO project_memberships (project_id, user_id, status)
VALUES
  ('project-vemdalen', 'user-demo-worker', 'active'),
  ('project-vemdalen', 'user-demo-supervisor', 'active');

INSERT OR IGNORE INTO project_member_roles (project_id, user_id, role_code)
VALUES
  ('project-vemdalen', 'user-demo-worker', 'worker'),
  ('project-vemdalen', 'user-demo-supervisor', 'worker'),
  ('project-vemdalen', 'user-demo-supervisor', 'supervisor');
