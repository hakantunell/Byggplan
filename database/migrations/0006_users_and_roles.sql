CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','disabled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS global_user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, role_code)
);

CREATE TABLE IF NOT EXISTS project_memberships (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','disabled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS project_member_roles (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_code TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, user_id, role_code),
  FOREIGN KEY (project_id, user_id) REFERENCES project_memberships(project_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_memberships_user ON project_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_project_member_roles_user ON project_member_roles(user_id, project_id);

INSERT OR IGNORE INTO roles (code, name, description) VALUES
  ('worker', 'Arbetare', 'Kan läsa underlag och utföra samt dokumentera aktiviteter.'),
  ('supervisor', 'Arbetsledare', 'Har arbetarbehörighet och kan kontrollera, godkänna och avvisa moment.'),
  ('admin', 'Administratör', 'Kan administrera projekt, mallar, användare och arbetsflöden i administrationsappen.');

INSERT OR IGNORE INTO users (id, email, display_name, status)
VALUES ('user-hakan', 'hakan@byggplan.local', 'Håkan', 'active');

INSERT OR IGNORE INTO project_memberships (project_id, user_id, status)
VALUES ('project-vemdalen', 'user-hakan', 'active');

INSERT OR IGNORE INTO project_member_roles (project_id, user_id, role_code) VALUES
  ('project-vemdalen', 'user-hakan', 'worker'),
  ('project-vemdalen', 'user-hakan', 'supervisor');

INSERT OR IGNORE INTO global_user_roles (user_id, role_code)
VALUES ('user-hakan', 'admin');
