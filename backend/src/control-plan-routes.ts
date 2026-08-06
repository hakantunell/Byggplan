type RouteApp = {
  get: (path: string, handler: (c: any) => unknown) => void;
  post: (path: string, handler: (c: any) => unknown) => void;
  put: (path: string, handler: (c: any) => unknown) => void;
};

type ImportedPoint = {
  code?: string;
  description?: string;
  method?: string;
  responsibleRole?: string;
  evidenceRequired?: string;
  categoryCode?: string;
  categoryTitle?: string;
  pointType?: string;
  applicable?: boolean | number;
};

type ImportBody = {
  projectId?: string;
  title?: string;
  sourceFilename?: string;
  sourceMimeType?: string;
  sourceChecksum?: string;
  points?: ImportedPoint[];
};

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function pointType(value: unknown) {
  const candidate = clean(value);
  return ['control', 'visit', 'document', 'administration', 'not_applicable'].includes(candidate)
    ? candidate
    : 'control';
}

async function addColumnIfMissing(db: D1Database, sql: string) {
  try { await db.prepare(sql).run(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes('duplicate column')) throw error;
  }
}

async function ensureControlPlanSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS control_plan_documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_filename TEXT NOT NULL,
      source_mime_type TEXT NOT NULL DEFAULT '',
      source_checksum TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'imported' CHECK(status IN ('imported','reviewed','active','completed','archived')),
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS control_plan_points (
      id TEXT PRIMARY KEY,
      control_plan_id TEXT NOT NULL,
      code TEXT NOT NULL,
      description TEXT NOT NULL,
      control_method TEXT NOT NULL DEFAULT '',
      responsible_role TEXT NOT NULL DEFAULT '',
      evidence_required TEXT NOT NULL DEFAULT '',
      category_code TEXT NOT NULL DEFAULT '',
      category_title TEXT NOT NULL DEFAULT '',
      point_type TEXT NOT NULL DEFAULT 'control',
      applicable INTEGER NOT NULL DEFAULT 1,
      result TEXT NOT NULL DEFAULT '',
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(control_plan_id) REFERENCES control_plan_documents(id) ON DELETE CASCADE
    )
  `).run();
  await addColumnIfMissing(db, "ALTER TABLE control_plan_points ADD COLUMN category_code TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db, "ALTER TABLE control_plan_points ADD COLUMN category_title TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db, "ALTER TABLE control_plan_points ADD COLUMN point_type TEXT NOT NULL DEFAULT 'control'");
  await addColumnIfMissing(db, 'ALTER TABLE control_plan_points ADD COLUMN applicable INTEGER NOT NULL DEFAULT 1');
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_control_plan_documents_project ON control_plan_documents(project_id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_control_plan_points_document ON control_plan_points(control_plan_id,sort_order)').run();
}

export function registerControlPlanRoutes(app: RouteApp) {
  app.get('/api/studio/projects/:projectId/control-plans', async c => {
    await ensureControlPlanSchema(c.env.DB);
    const projectId = c.req.param('projectId');
    const documents = await c.env.DB.prepare(`
      SELECT d.*,
        (SELECT COUNT(*) FROM control_plan_points p WHERE p.control_plan_id=d.id) AS point_count,
        (SELECT COUNT(*) FROM control_plan_points p WHERE p.control_plan_id=d.id AND p.completed=1) AS completed_count
      FROM control_plan_documents d
      WHERE d.project_id=?
      ORDER BY d.imported_at DESC
    `).bind(projectId).all();
    return c.json({ ok: true, controlPlans: documents.results });
  });

  app.get('/api/studio/control-plans/:id', async c => {
    await ensureControlPlanSchema(c.env.DB);
    const id = c.req.param('id');
    const document = await c.env.DB.prepare('SELECT * FROM control_plan_documents WHERE id=?').bind(id).first();
    if (!document) return c.json({ ok: false, error: 'Kontrollplanen hittades inte.' }, 404);
    const points = await c.env.DB.prepare(`
      SELECT * FROM control_plan_points WHERE control_plan_id=? ORDER BY sort_order,id
    `).bind(id).all();
    return c.json({ ok: true, controlPlan: document, points: points.results });
  });

  app.post('/api/studio/control-plans/import', async c => {
    await ensureControlPlanSchema(c.env.DB);
    const body = await c.req.json<ImportBody>();
    const projectId = clean(body.projectId);
    const title = clean(body.title);
    const sourceFilename = clean(body.sourceFilename);
    const points = Array.isArray(body.points) ? body.points : [];
    if (!projectId || !title || !sourceFilename) {
      return c.json({ ok: false, error: 'Projekt, titel och originalfilens namn krävs.' }, 400);
    }
    const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
    if (!project) return c.json({ ok: false, error: 'Projektet hittades inte.' }, 404);

    const controlPlanId = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO control_plan_documents
        (id,project_id,title,source_filename,source_mime_type,source_checksum,status)
      VALUES(?,?,?,?,?,?,'imported')
    `).bind(
      controlPlanId, projectId, title, sourceFilename,
      clean(body.sourceMimeType), clean(body.sourceChecksum)
    ).run();

    let created = 0;
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const description = clean(point.description);
      if (!description) continue;
      const applicable = point.applicable === false || point.applicable === 0 ? 0 : 1;
      await c.env.DB.prepare(`
        INSERT INTO control_plan_points
          (id,control_plan_id,code,description,control_method,responsible_role,evidence_required,
           category_code,category_title,point_type,applicable,sort_order)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        crypto.randomUUID(), controlPlanId, clean(point.code) || `KP-${index + 1}`,
        description, clean(point.method), clean(point.responsibleRole), clean(point.evidenceRequired),
        clean(point.categoryCode), clean(point.categoryTitle), pointType(point.pointType), applicable,
        (index + 1) * 10
      ).run();
      created += 1;
    }

    return c.json({ ok: true, id: controlPlanId, createdPoints: created, status: 'imported' }, 201);
  });

  app.put('/api/studio/control-plan-points/:id', async c => {
    await ensureControlPlanSchema(c.env.DB);
    const id = c.req.param('id');
    const body = await c.req.json<Record<string, unknown>>();
    const existing = await c.env.DB.prepare('SELECT id FROM control_plan_points WHERE id=?').bind(id).first();
    if (!existing) return c.json({ ok: false, error: 'Kontrollpunkten hittades inte.' }, 404);
    const completed = body.completed === true || body.completed === 1 ? 1 : 0;
    await c.env.DB.prepare(`
      UPDATE control_plan_points
      SET result=?, completed=?, completed_at=CASE WHEN ?=1 THEN COALESCE(completed_at,datetime('now')) ELSE NULL END
      WHERE id=?
    `).bind(clean(body.result), completed, completed, id).run();
    return c.json({ ok: true });
  });
}
