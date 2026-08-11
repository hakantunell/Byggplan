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
    const lower = message.toLowerCase();
    if (!lower.includes('duplicate column') && !lower.includes('already exists')) throw error;
  }
}

async function ensureSchema(db: D1Database) {
  await addColumnIfMissing(db, "ALTER TABLE governing_items ADD COLUMN source_basis TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db, "ALTER TABLE governing_items ADD COLUMN source_note TEXT NOT NULL DEFAULT ''");
  await db.prepare(`CREATE TABLE IF NOT EXISTS governing_item_verifications (
    id TEXT PRIMARY KEY,
    governing_item_id TEXT NOT NULL,
    role_code TEXT NOT NULL,
    required INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected')),
    comment TEXT NOT NULL DEFAULT '',
    verified_by TEXT,
    verified_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(governing_item_id,role_code),
    FOREIGN KEY(governing_item_id) REFERENCES governing_items(id) ON DELETE CASCADE
  )`).run();
  await addColumnIfMissing(db, 'ALTER TABLE governing_item_verifications ADD COLUMN verified_by TEXT');
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_governing_verifications_item ON governing_item_verifications(governing_item_id)').run();
}

function rolesFor(sourceRole: string, documentType: string) {
  const role = sourceRole.toUpperCase().replace(/\s+/g,'');
  const roles: string[] = [];
  if (role.includes('EK') || role.includes('BH') || role.includes('BYGGHERRE')) roles.push('builder');
  if (role.includes('KA')) roles.push('ka');
  if (role.includes('KOMMUN') || role.includes('MYNDIGHET')) roles.push('authority');
  if (!roles.length && documentType !== 'control_plan') roles.push('builder');
  return [...new Set(roles)];
}

async function syncDocumentVerificationSteps(db: D1Database, documentId: string) {
  const items = await db.prepare(`
    SELECT i.id,i.responsible_role,d.document_type
      FROM governing_items i
      JOIN governing_documents d ON d.id=i.governing_document_id
     WHERE i.governing_document_id=?
     ORDER BY i.sort_order,i.id
  `).bind(documentId).all();
  for (const item of items.results as any[]) {
    for (const role of rolesFor(String(item.responsible_role || ''), String(item.document_type || ''))) {
      await db.prepare(`INSERT OR IGNORE INTO governing_item_verifications
        (id,governing_item_id,role_code,required,status) VALUES(?,?,?,1,'pending')`
      ).bind(crypto.randomUUID(),String(item.id),role).run();
    }
  }
  return items.results as any[];
}

async function syncItemVerificationSteps(db: D1Database, itemId: string) {
  const item = await db.prepare(`
    SELECT i.id,i.responsible_role,d.document_type
      FROM governing_items i JOIN governing_documents d ON d.id=i.governing_document_id
     WHERE i.id=?
  `).bind(itemId).first<any>();
  if (!item) return false;
  for (const role of rolesFor(String(item.responsible_role || ''), String(item.document_type || ''))) {
    await db.prepare(`INSERT OR IGNORE INTO governing_item_verifications
      (id,governing_item_id,role_code,required,status) VALUES(?,?,?,1,'pending')`
    ).bind(crypto.randomUUID(),itemId,role).run();
  }
  return true;
}

async function syncBuilderVerification(db: D1Database, itemId: string) {
  const builder = await db.prepare(`SELECT id FROM governing_item_verifications
    WHERE governing_item_id=? AND role_code='builder' AND required=1`).bind(itemId).first<any>();
  if (!builder) return;
  const linked = await db.prepare(`
    SELECT a.id,COALESCE(e.done,0) AS done,e.completed_by,e.completed_at,e.updated_at
      FROM governing_item_activity_links l
      JOIN activities a ON a.id=l.activity_id
      LEFT JOIN activity_entries e ON e.activity_id=a.id
     WHERE l.governing_item_id=?
  `).bind(itemId).all();
  const rows = linked.results as any[];
  if (!rows.length || !rows.every(row => Number(row.done) === 1)) {
    await db.prepare(`UPDATE governing_item_verifications
      SET status='pending',verified_by=NULL,verified_at=NULL,comment='',updated_at=datetime('now') WHERE id=?`
    ).bind(builder.id).run();
    return;
  }
  const completed = rows.filter(row => row.completed_at).sort((a,b) => String(a.completed_at).localeCompare(String(b.completed_at)));
  const last = completed[completed.length - 1];
  await db.prepare(`UPDATE governing_item_verifications
    SET status='verified',verified_by=?,verified_at=?,comment='Egenkontroll via färdigställda aktiviteter',updated_at=datetime('now') WHERE id=?`
  ).bind(last?.completed_by || null,last?.completed_at || null,builder.id).run();
}

async function activitiesReady(db: D1Database, itemId: string) {
  const summary = await db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN COALESCE(e.done,0)=1 THEN 1 ELSE 0 END) AS done
    FROM governing_item_activity_links l JOIN activities a ON a.id=l.activity_id
    LEFT JOIN activity_entries e ON e.activity_id=a.id WHERE l.governing_item_id=?`
  ).bind(itemId).first<any>();
  const total=Number(summary?.total||0),done=Number(summary?.done||0);
  return total>0 && total===done;
}

async function derivedStatus(db: D1Database, itemId: string) {
  const item=await db.prepare('SELECT handling_status FROM governing_items WHERE id=?').bind(itemId).first<any>();
  if(!item)return 'waiting_activity';
  if(['not_applicable','cannot_verify','alternative_evidence'].includes(String(item.handling_status)))return String(item.handling_status);
  const activity=await db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN COALESCE(e.done,0)=1 THEN 1 ELSE 0 END) AS done,
    SUM(CASE WHEN e.activity_id IS NOT NULL THEN 1 ELSE 0 END) AS started
    FROM governing_item_activity_links l JOIN activities a ON a.id=l.activity_id
    LEFT JOIN activity_entries e ON e.activity_id=a.id WHERE l.governing_item_id=?`
  ).bind(itemId).first<any>();
  const total=Number(activity?.total||0),done=Number(activity?.done||0),started=Number(activity?.started||0);
  if(!total)return 'waiting_activity';
  if(done<total)return started>0?'in_progress':'waiting_activity';
  const verification=await db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) AS verified,
    SUM(CASE WHEN role_code='ka' AND status<>'verified' THEN 1 ELSE 0 END) AS ka_pending,
    SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected
    FROM governing_item_verifications WHERE governing_item_id=? AND required=1`
  ).bind(itemId).first<any>();
  if(Number(verification?.rejected||0)>0)return 'rejected';
  if(Number(verification?.ka_pending||0)>0)return 'waiting_ka';
  const count=Number(verification?.total||0),verified=Number(verification?.verified||0);
  return count===0||count===verified?'verified':'ready_for_verification';
}

export function registerGoverningVerificationRoutesV2(app: RouteApp) {
  app.get('/api/studio/governing-documents/:id/verification-map', async c => {
    try {
      await ensureSchema(c.env.DB);
      const documentId=c.req.param('id');
      const document=await c.env.DB.prepare('SELECT id FROM governing_documents WHERE id=?').bind(documentId).first();
      if(!document)return c.json({ok:false,error:'Styrdokumentet hittades inte.'},404);
      const items=await syncDocumentVerificationSteps(c.env.DB,documentId);
      for(const item of items)await syncBuilderVerification(c.env.DB,String(item.id));
      const rows=await c.env.DB.prepare(`SELECT v.id,v.governing_item_id,v.role_code,v.required,v.status,v.comment,v.verified_by,v.verified_at,
        u.display_name AS verified_by_name,i.source_basis,i.source_note
        FROM governing_item_verifications v JOIN governing_items i ON i.id=v.governing_item_id
        LEFT JOIN users u ON u.id=v.verified_by WHERE i.governing_document_id=?
        ORDER BY i.sort_order,CASE v.role_code WHEN 'builder' THEN 0 WHEN 'ka' THEN 1 WHEN 'authority' THEN 2 ELSE 3 END`
      ).bind(documentId).all();
      const source=await c.env.DB.prepare('SELECT id,source_basis,source_note FROM governing_items WHERE governing_document_id=? ORDER BY sort_order,id').bind(documentId).all();
      const status:Record<string,string>={};
      for(const item of items)status[String(item.id)]=await derivedStatus(c.env.DB,String(item.id));
      return c.json({ok:true,verifications:rows.results,source:source.results,status});
    } catch(error) {
      console.error('Verification map failed',error);
      return c.json({ok:false,error:`Verifieringsflöde: ${error instanceof Error?error.message:String(error)}`},500);
    }
  });

  app.get('/api/studio/governing-items/:id/history', async c => {
    try {
      await ensureSchema(c.env.DB);const itemId=c.req.param('id');
      if(!(await syncItemVerificationSteps(c.env.DB,itemId)))return c.json({ok:false,error:'Den styrande posten hittades inte.'},404);
      await syncBuilderVerification(c.env.DB,itemId);
      const activities=await c.env.DB.prepare(`SELECT a.id,a.title,e.done,e.completed_at,e.updated_at,u.display_name AS completed_by_name
        FROM governing_item_activity_links l JOIN activities a ON a.id=l.activity_id
        LEFT JOIN activity_entries e ON e.activity_id=a.id LEFT JOIN users u ON u.id=e.completed_by
        WHERE l.governing_item_id=? ORDER BY COALESCE(e.completed_at,e.updated_at),a.title`).bind(itemId).all();
      const verifications=await c.env.DB.prepare(`SELECT v.role_code,v.status,v.comment,v.verified_at,u.display_name AS verified_by_name
        FROM governing_item_verifications v LEFT JOIN users u ON u.id=v.verified_by
        WHERE v.governing_item_id=? ORDER BY v.updated_at`).bind(itemId).all();
      return c.json({ok:true,activities:activities.results,verifications:verifications.results,status:await derivedStatus(c.env.DB,itemId)});
    }catch(error){console.error('Verification history failed',error);return c.json({ok:false,error:`Verifieringshistorik: ${error instanceof Error?error.message:String(error)}`},500)}
  });

  app.put('/api/studio/governing-items/:id/verifications/:role', async c => {
    try {
      await ensureSchema(c.env.DB);const itemId=c.req.param('id');
      if(!(await syncItemVerificationSteps(c.env.DB,itemId)))return c.json({ok:false,error:'Den styrande posten hittades inte.'},404);
      const role=clean(c.req.param('role')).toLowerCase();
      if(!['builder','ka','authority','external'].includes(role))return c.json({ok:false,error:'Ogiltig verifieringsroll.'},400);
      if(role==='builder')return c.json({ok:false,error:'Egenkontrollen styrs av de kopplade aktiviteterna.'},409);
      const body=await c.req.json<Record<string,unknown>>();
      const status=['pending','verified','rejected'].includes(clean(body.status))?clean(body.status):'pending';
      const existing=await c.env.DB.prepare('SELECT id FROM governing_item_verifications WHERE governing_item_id=? AND role_code=?').bind(itemId,role).first();
      if(!existing)return c.json({ok:false,error:'Verifieringssteget hittades inte.'},404);
      if(status==='verified'&&!(await activitiesReady(c.env.DB,itemId)))return c.json({ok:false,error:'Verifiering kan inte göras innan alla kopplade aktiviteter är klara.'},409);
      await c.env.DB.prepare(`UPDATE governing_item_verifications SET status=?,comment=?,
        verified_by=CASE WHEN ?='verified' THEN COALESCE(verified_by,'ka-manual') ELSE NULL END,
        verified_at=CASE WHEN ?='verified' THEN datetime('now') ELSE NULL END,updated_at=datetime('now')
        WHERE governing_item_id=? AND role_code=?`).bind(status,clean(body.comment),status,status,itemId,role).run();
      return c.json({ok:true,status:await derivedStatus(c.env.DB,itemId)});
    }catch(error){console.error('Verification update failed',error);return c.json({ok:false,error:`Verifieringsuppdatering: ${error instanceof Error?error.message:String(error)}`},500)}
  });
}
