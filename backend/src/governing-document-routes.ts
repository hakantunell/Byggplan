type RouteApp = {
  get: (path: string, handler: (c: any) => unknown) => void;
  post: (path: string, handler: (c: any) => unknown) => void;
  put: (path: string, handler: (c: any) => unknown) => void;
};

type ImportedItem = {
  code?: string;
  description?: string;
  sectionCode?: string;
  sectionTitle?: string;
  itemType?: string;
  responsibleRole?: string;
  evidenceRequired?: string;
  handlingStatus?: string;
  handlingComment?: string;
};

type ImportBody = {
  projectId?: string;
  documentType?: string;
  title?: string;
  issuer?: string;
  reference?: string;
  sourceFilename?: string;
  sourceMimeType?: string;
  sourceChecksum?: string;
  items?: ImportedItem[];
};

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function documentType(value: unknown) {
  const candidate = clean(value);
  return ['control_plan','authority_decision','building_permit','technical_consultation','work_environment','other'].includes(candidate)
    ? candidate
    : 'other';
}

function itemType(value: unknown) {
  const candidate = clean(value);
  return ['control','visit','documentation','measurement','condition','information','administration','other'].includes(candidate)
    ? candidate
    : 'other';
}

function handlingStatus(value: unknown) {
  const candidate = clean(value);
  return ['unhandled','in_progress','handled','not_applicable','cannot_verify','alternative_evidence'].includes(candidate)
    ? candidate
    : 'unhandled';
}

async function tableExists(db: D1Database, table: string) {
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
  return Boolean(row);
}

async function ensureGoverningDocumentSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS governing_documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      document_type TEXT NOT NULL DEFAULT 'other',
      title TEXT NOT NULL,
      issuer TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      source_filename TEXT NOT NULL,
      source_mime_type TEXT NOT NULL DEFAULT '',
      source_checksum TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS governing_items (
      id TEXT PRIMARY KEY,
      governing_document_id TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      section_code TEXT NOT NULL DEFAULT '',
      section_title TEXT NOT NULL DEFAULT '',
      item_type TEXT NOT NULL DEFAULT 'other',
      responsible_role TEXT NOT NULL DEFAULT '',
      evidence_required TEXT NOT NULL DEFAULT '',
      handling_status TEXT NOT NULL DEFAULT 'unhandled',
      handling_comment TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(governing_document_id) REFERENCES governing_documents(id) ON DELETE CASCADE
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS governing_item_activity_links (
      id TEXT PRIMARY KEY,
      governing_item_id TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      link_type TEXT NOT NULL DEFAULT 'supports',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(governing_item_id,activity_id),
      FOREIGN KEY(governing_item_id) REFERENCES governing_items(id) ON DELETE CASCADE,
      FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
    )
  `).run();

  await db.prepare('CREATE INDEX IF NOT EXISTS idx_governing_documents_project ON governing_documents(project_id,document_type)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_governing_items_document ON governing_items(governing_document_id,sort_order)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_governing_links_item ON governing_item_activity_links(governing_item_id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_governing_links_activity ON governing_item_activity_links(activity_id)').run();

  // One-time compatible migration: the already imported control plan becomes a governing document.
  if (await tableExists(db, 'control_plan_documents') && await tableExists(db, 'control_plan_points')) {
    await db.prepare(`
      INSERT OR IGNORE INTO governing_documents
        (id,project_id,document_type,title,issuer,reference,source_filename,source_mime_type,source_checksum,status,imported_at,updated_at)
      SELECT id,project_id,'control_plan',title,'Kontrollansvarig','',source_filename,source_mime_type,source_checksum,status,imported_at,updated_at
      FROM control_plan_documents
    `).run();

    await db.prepare(`
      INSERT OR IGNORE INTO governing_items
        (id,governing_document_id,code,description,section_code,section_title,item_type,responsible_role,evidence_required,handling_status,handling_comment,sort_order,updated_at)
      SELECT id,control_plan_id,code,description,category_code,category_title,
        CASE point_type
          WHEN 'control' THEN 'control'
          WHEN 'visit' THEN 'visit'
          WHEN 'document' THEN 'documentation'
          WHEN 'administration' THEN 'administration'
          ELSE 'other'
        END,
        responsible_role,evidence_required,
        CASE
          WHEN applicable=0 THEN 'not_applicable'
          WHEN completed=1 THEN 'handled'
          ELSE 'unhandled'
        END,
        result,sort_order,datetime('now')
      FROM control_plan_points
    `).run();
  }
}

export function registerGoverningDocumentRoutes(app: RouteApp) {
  app.get('/api/studio/projects/:projectId/governing-documents', async c => {
    await ensureGoverningDocumentSchema(c.env.DB);
    const projectId = c.req.param('projectId');
    const rows = await c.env.DB.prepare(`
      SELECT d.*,
        (SELECT COUNT(*) FROM governing_items i WHERE i.governing_document_id=d.id) AS item_count,
        (SELECT COUNT(*) FROM governing_items i WHERE i.governing_document_id=d.id AND i.handling_status IN ('handled','not_applicable','cannot_verify','alternative_evidence')) AS handled_count,
        (SELECT COUNT(DISTINCT l.governing_item_id)
           FROM governing_item_activity_links l
           JOIN governing_items i ON i.id=l.governing_item_id
          WHERE i.governing_document_id=d.id) AS linked_item_count
      FROM governing_documents d
      WHERE d.project_id=?
      ORDER BY CASE d.document_type WHEN 'control_plan' THEN 0 ELSE 1 END,d.imported_at DESC,d.title
    `).bind(projectId).all();
    return c.json({ ok: true, documents: rows.results });
  });

  app.get('/api/studio/governing-documents/:id', async c => {
    await ensureGoverningDocumentSchema(c.env.DB);
    const id = c.req.param('id');
    const document = await c.env.DB.prepare('SELECT * FROM governing_documents WHERE id=?').bind(id).first();
    if (!document) return c.json({ ok: false, error: 'Det styrande dokumentet hittades inte.' }, 404);
    const items = await c.env.DB.prepare(`
      SELECT i.*,
        (SELECT COUNT(*) FROM governing_item_activity_links l WHERE l.governing_item_id=i.id) AS linked_activity_count
      FROM governing_items i
      WHERE i.governing_document_id=?
      ORDER BY i.sort_order,i.id
    `).bind(id).all();
    return c.json({ ok: true, document, items: items.results });
  });

  app.post('/api/studio/governing-documents/import', async c => {
    await ensureGoverningDocumentSchema(c.env.DB);
    const body = await c.req.json<ImportBody>();
    const projectId = clean(body.projectId);
    const title = clean(body.title);
    const sourceFilename = clean(body.sourceFilename);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!projectId || !title || !sourceFilename) {
      return c.json({ ok: false, error: 'Projekt, titel och originalfilens namn krävs.' }, 400);
    }
    const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
    if (!project) return c.json({ ok: false, error: 'Projektet hittades inte.' }, 404);

    const documentId = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO governing_documents
        (id,project_id,document_type,title,issuer,reference,source_filename,source_mime_type,source_checksum,status)
      VALUES(?,?,?,?,?,?,?,?,?,'active')
    `).bind(
      documentId, projectId, documentType(body.documentType), title,
      clean(body.issuer), clean(body.reference), sourceFilename,
      clean(body.sourceMimeType), clean(body.sourceChecksum)
    ).run();

    let created = 0;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const description = clean(item.description);
      if (!description) continue;
      await c.env.DB.prepare(`
        INSERT INTO governing_items
          (id,governing_document_id,code,description,section_code,section_title,item_type,responsible_role,evidence_required,handling_status,handling_comment,sort_order)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        crypto.randomUUID(), documentId, clean(item.code), description,
        clean(item.sectionCode), clean(item.sectionTitle), itemType(item.itemType),
        clean(item.responsibleRole), clean(item.evidenceRequired),
        handlingStatus(item.handlingStatus), clean(item.handlingComment), (index + 1) * 10
      ).run();
      created += 1;
    }

    return c.json({ ok: true, id: documentId, createdItems: created }, 201);
  });

  app.put('/api/studio/governing-items/:id', async c => {
    await ensureGoverningDocumentSchema(c.env.DB);
    const id = c.req.param('id');
    const body = await c.req.json<Record<string, unknown>>();
    const existing = await c.env.DB.prepare('SELECT id FROM governing_items WHERE id=?').bind(id).first();
    if (!existing) return c.json({ ok: false, error: 'Den styrande posten hittades inte.' }, 404);
    await c.env.DB.prepare(`
      UPDATE governing_items
         SET handling_status=?,handling_comment=?,updated_at=datetime('now')
       WHERE id=?
    `).bind(handlingStatus(body.handlingStatus), clean(body.handlingComment), id).run();
    return c.json({ ok: true });
  });

  app.get('/api/studio/governing-items/:id/activity-links', async c => {
    await ensureGoverningDocumentSchema(c.env.DB);
    const id = c.req.param('id');
    const item = await c.env.DB.prepare(`
      SELECT i.id,d.project_id
      FROM governing_items i
      JOIN governing_documents d ON d.id=i.governing_document_id
      WHERE i.id=?
    `).bind(id).first<{ id: string; project_id: string }>();
    if (!item) return c.json({ ok: false, error: 'Den styrande posten hittades inte.' }, 404);

    const activities = await c.env.DB.prepare(`
      SELECT a.id,a.title,a.activity_type,t.title AS task_title,ws.name AS section_name,wa.name AS area_name,
        CASE WHEN l.id IS NULL THEN 0 ELSE 1 END AS linked
      FROM activities a
      JOIN tasks t ON t.id=a.task_id
      JOIN work_sections ws ON ws.id=t.work_section_id
      JOIN work_areas wa ON wa.id=ws.work_area_id
      LEFT JOIN governing_item_activity_links l ON l.activity_id=a.id AND l.governing_item_id=?
      WHERE wa.project_id=?
      ORDER BY wa.sort_order,ws.sort_order,t.sort_order,a.sort_order
    `).bind(id,item.project_id).all();
    return c.json({ ok: true, activities: activities.results });
  });

  app.put('/api/studio/governing-items/:id/activity-links', async c => {
    await ensureGoverningDocumentSchema(c.env.DB);
    const id = c.req.param('id');
    const body = await c.req.json<{ activityIds?: string[] }>();
    const item = await c.env.DB.prepare(`
      SELECT i.id,d.project_id
      FROM governing_items i
      JOIN governing_documents d ON d.id=i.governing_document_id
      WHERE i.id=?
    `).bind(id).first<{ id: string; project_id: string }>();
    if (!item) return c.json({ ok: false, error: 'Den styrande posten hittades inte.' }, 404);

    const requested = [...new Set((body.activityIds ?? []).map(clean).filter(Boolean))];
    await c.env.DB.prepare('DELETE FROM governing_item_activity_links WHERE governing_item_id=?').bind(id).run();
    for (const activityId of requested) {
      const activity = await c.env.DB.prepare(`
        SELECT a.id
        FROM activities a
        JOIN tasks t ON t.id=a.task_id
        JOIN work_sections ws ON ws.id=t.work_section_id
        JOIN work_areas wa ON wa.id=ws.work_area_id
        WHERE a.id=? AND wa.project_id=?
      `).bind(activityId,item.project_id).first();
      if (!activity) continue;
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO governing_item_activity_links(id,governing_item_id,activity_id,link_type)
        VALUES(?,?,?,'supports')
      `).bind(crypto.randomUUID(),id,activityId).run();
    }
    return c.json({ ok: true });
  });
}
