type RouteApp = {
  get: (path: string, handler: (c: any) => unknown) => void;
  put: (path: string, handler: (c: any) => unknown) => void;
};

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function addColumnIfMissing(db: D1Database, sql: string) {
  try { await db.prepare(sql).run(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes('duplicate column')) throw error;
  }
}

async function ensureVerificationSchema(db: D1Database) {
  await addColumnIfMissing(db, "ALTER TABLE governing_items ADD COLUMN source_basis TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db, "ALTER TABLE governing_items ADD COLUMN source_note TEXT NOT NULL DEFAULT ''");

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS governing_item_verifications (
      id TEXT PRIMARY KEY,
      governing_item_id TEXT NOT NULL,
      role_code TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected')),
      comment TEXT NOT NULL DEFAULT '',
      verified_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(governing_item_id,role_code),
      FOREIGN KEY(governing_item_id) REFERENCES governing_items(id) ON DELETE CASCADE
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_governing_verifications_item ON governing_item_verifications(governing_item_id)').run();

  await enrichVk4410ControlPlan(db);
  await syncVerificationSteps(db);
}

async function enrichVk4410ControlPlan(db: D1Database) {
  const rows: Array<[string,string,string,string]> = [
    ['Utstakning av byggnaden','PBL Kap10 §26','KA','Mätintyg'],
    ['Kontrollmätning/lägeskontroll av byggnadens placering','Kommunkrav','KA','Mätintyg'],
    ['Besök vid grundbotten inför gjutning','ÖK KA/BH','KA','Allmän okulärsyn'],
    ['Besök när stommen är rest','ÖK KA/BH','KA','Allmän okulärsyn'],
    ['Besök under pågående invändiga arbeten','ÖK KA/BH','KA','Allmän okulärsyn'],
    ['Byggnadsnämndens arbetsplatsbesök. Vid tätt hus innan allt är igen byggt','PBL 10 kap §27','KA','Enl beslut vid Tekniskt samråd'],
    ['Besök vid slutsamråd','PBL Kap 10 § 11+30-32','KA','Enl beslut vid Tekniskt samråd'],
    ['Överensstämmelse med bygglov','PBL Kap 10 § 5','KA','Byggherreintyg'],
    ['Arbetsmiljöplan upprättad','BBR 2:3; AFS 1999:3','BH','SE TE egenkontroll'],
    ['BAS-P utsedd av byggherren','AML § 6 AFS 1999:3','BH','Se arbetsmiljöplan'],
    ['Bas- U utsedd av byggherren','AML § 6 AFS 1999:3','BH','Se arbetsmiljöplan'],
    ['Startmöte med genomgång','BH+KA krav','KA','Se Protokoll'],
    ['Geoteknisk utredning utförd','EKS EN 1997','KA',''],
    ['Radonklass enligt kommunens uppgifter','BBR 6:23','KA','Se geoteknisk utredn'],
    ['Geotekniskt utlåtande beaktad i projekteringen','','EK','Se egenkontroller projektörer'],
    ['TE egenkontroll enligt upprättat förslag','','EK','Signerad kontrollplan'],
    ['Intyg sotare Rökkanaler Taksäkerhet','LSO Kap 3§4; BBR 5:4256; BBR 5:5332; BBR 8:24','KA','Intyg från sotare'],
    ['Brandskyddsbeskrivning upprättad','BBR 5:12','KA','Preliminärt utlåtande'],
    ['Brandskyddsdokumentation upprättad','BBR 5:12','KA','Slutlig'],
    ['Brandskyddsbeskrivning beaktad i projekteringen','','EK','Se egenkontroller projektörer'],
    ['Installationer för dagvatten','BBR 6:642','EK','Se TE Egenkontroll'],
    ['Behörighetskontroll, Byggkeramikrådet eller redovisning av utförd metod','','EK','Intyg'],
    ['Fuktsäkerhetsprojektering beaktad i projekteringen','','EK','Se egenkontroller projektörer'],
    ['Provtrycknings protokoll VA','','EK','Protokoll EK'],
    ['Elinstallationsföretaget registrerat hos Elsäkerhetsverket','ELSÄK-FS 2017:3','KA','Bevis från El entreprenör'],
    ['Isolationsprovning utförd','ELSÄK-FS 2017:2','EK','Bevis från El entreprenör'],
    ['Jordfelsbrytare','ELSÄK-FS 2017:2','EK','Bevis från El entreprenör'],
    ['Se arkitektens egenkontroll','BBR kap 3','EK',''],
    ['VA-inspektion före övertäckning','Kommunkrav','EK/KA','Intyg'],
    ['Relationshandlingar LOD + VA utvändigt','Kommunkrav','EK','Ritningar nr ………..'],
    ['Förberedelse för bredbandsanslutning','PBL kap 8 §4','EK','Se Egenkontroll Projektörer']
  ];

  for (const [description,basis,role,note] of rows) {
    await db.prepare(`
      UPDATE governing_items
         SET source_basis=CASE WHEN source_basis='' THEN ? ELSE source_basis END,
             responsible_role=CASE WHEN ?<>'' THEN ? ELSE responsible_role END,
             source_note=CASE WHEN source_note='' THEN ? ELSE source_note END
       WHERE description=?
         AND governing_document_id IN (SELECT id FROM governing_documents WHERE document_type='control_plan')
    `).bind(basis,role,role,note,description).run();
  }
}

function rolesFor(sourceRole: string) {
  const role = sourceRole.toUpperCase().replace(/\s+/g,'');
  const roles: string[] = [];
  if (role.includes('EK') || role.includes('BH') || role.includes('BYGGHERRE')) roles.push('builder');
  if (role.includes('KA')) roles.push('ka');
  return [...new Set(roles)];
}

async function syncVerificationSteps(db: D1Database) {
  const items = await db.prepare(`
    SELECT i.id,i.responsible_role,d.document_type
      FROM governing_items i
      JOIN governing_documents d ON d.id=i.governing_document_id
  `).all();

  for (const item of items.results as any[]) {
    let roles = rolesFor(String(item.responsible_role || ''));
    if (!roles.length && item.document_type !== 'control_plan') roles = ['builder'];
    for (const role of roles) {
      await db.prepare(`
        INSERT OR IGNORE INTO governing_item_verifications
          (id,governing_item_id,role_code,required,status)
        VALUES(?,?,?,1,'pending')
      `).bind(crypto.randomUUID(),item.id,role).run();
    }
  }
}

async function refreshHandlingStatus(db: D1Database, itemId: string) {
  const item = await db.prepare('SELECT handling_status FROM governing_items WHERE id=?').bind(itemId).first<{ handling_status: string }>();
  if (!item) return;
  if (['not_applicable','cannot_verify','alternative_evidence'].includes(item.handling_status)) return;
  const summary = await db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) AS verified,
           SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected
      FROM governing_item_verifications
     WHERE governing_item_id=? AND required=1
  `).bind(itemId).first<any>();
  const total = Number(summary?.total || 0);
  const verified = Number(summary?.verified || 0);
  const rejected = Number(summary?.rejected || 0);
  const status = total > 0 && verified === total ? 'handled' : (verified > 0 || rejected > 0 ? 'in_progress' : 'unhandled');
  await db.prepare("UPDATE governing_items SET handling_status=?,updated_at=datetime('now') WHERE id=?").bind(status,itemId).run();
}

export function registerGoverningVerificationRoutes(app: RouteApp) {
  app.get('/api/studio/governing-documents/:id/verification-map', async c => {
    await ensureVerificationSchema(c.env.DB);
    const documentId = c.req.param('id');
    const rows = await c.env.DB.prepare(`
      SELECT v.id,v.governing_item_id,v.role_code,v.required,v.status,v.comment,v.verified_at,
             i.source_basis,i.source_note
        FROM governing_item_verifications v
        JOIN governing_items i ON i.id=v.governing_item_id
       WHERE i.governing_document_id=?
       ORDER BY i.sort_order,CASE v.role_code WHEN 'builder' THEN 0 WHEN 'ka' THEN 1 ELSE 2 END
    `).bind(documentId).all();
    const source = await c.env.DB.prepare(`
      SELECT id,source_basis,source_note FROM governing_items WHERE governing_document_id=?
    `).bind(documentId).all();
    return c.json({ ok: true, verifications: rows.results, source: source.results });
  });

  app.put('/api/studio/governing-items/:id/verifications/:role', async c => {
    await ensureVerificationSchema(c.env.DB);
    const itemId = c.req.param('id');
    const role = clean(c.req.param('role')).toLowerCase();
    if (!['builder','ka','authority','external'].includes(role)) return c.json({ ok: false, error: 'Ogiltig verifieringsroll.' }, 400);
    const body = await c.req.json<Record<string, unknown>>();
    const status = ['pending','verified','rejected'].includes(clean(body.status)) ? clean(body.status) : 'pending';
    const existing = await c.env.DB.prepare(`
      SELECT id FROM governing_item_verifications WHERE governing_item_id=? AND role_code=?
    `).bind(itemId,role).first();
    if (!existing) return c.json({ ok: false, error: 'Verifieringssteget hittades inte.' }, 404);
    await c.env.DB.prepare(`
      UPDATE governing_item_verifications
         SET status=?,comment=?,verified_at=CASE WHEN ?='verified' THEN datetime('now') ELSE NULL END,
             updated_at=datetime('now')
       WHERE governing_item_id=? AND role_code=?
    `).bind(status,clean(body.comment),status,itemId,role).run();
    await refreshHandlingStatus(c.env.DB,itemId);
    return c.json({ ok: true });
  });
}
