type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;post:(path:string,handler:(c:any)=>unknown)=>void};

async function ensureSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS governing_item_attestations(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    governing_item_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    signer_name TEXT NOT NULL,
    signer_email TEXT NOT NULL DEFAULT '',
    role_code TEXT NOT NULL,
    attestation_type TEXT NOT NULL DEFAULT 'approved',
    signing_method TEXT NOT NULL DEFAULT 'byggplan_internal',
    signed_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(governing_item_id) REFERENCES governing_items(id) ON DELETE CASCADE
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_governing_attestations_project_item ON governing_item_attestations(project_id,governing_item_id,signed_at)').run();
}

async function currentUser(c:any){
  const requested=String(c.req.header('X-Demo-User')||'').trim();
  const email=requested||String(c.env.DEV_USER_EMAIL||'').trim();
  if(!email)return null;
  return c.env.DB.prepare("SELECT id,email,display_name,status FROM users WHERE email=? AND status='active'").bind(email).first<any>();
}

async function attestationRoles(db:D1Database,userId:string,projectId:string){
  const rows=await db.prepare('SELECT role_code FROM project_member_roles WHERE user_id=? AND project_id=?').bind(userId,projectId).all();
  const explicit=(rows.results as any[]).map(row=>String(row.role_code||'').trim().toUpperCase()).filter(role=>role==='BH'||role==='KA');
  return explicit.length?[...new Set(explicit)]:['BH'];
}

async function itemInProject(db:D1Database,projectId:string,itemId:string){
  return db.prepare(`SELECT i.id FROM governing_items i JOIN governing_documents d ON d.id=i.governing_document_id WHERE i.id=? AND d.project_id=?`).bind(itemId,projectId).first<any>();
}

async function completionForItem(db:D1Database,itemId:string){
  const rows=await db.prepare(`
    SELECT a.id,COALESCE(e.done,0) done,COALESCE(ac.applicability,'always') applicability
    FROM governing_item_activity_links l
    JOIN activities a ON a.id=l.activity_id
    LEFT JOIN activity_entries e ON e.activity_id=a.id
    LEFT JOIN activity_contexts ac ON ac.activity_id=a.id
    WHERE l.governing_item_id=?
  `).bind(itemId).all();
  const active=(rows.results as any[]).filter(row=>String(row.applicability||'always')!=='deprecated');
  return{activeCount:active.length,incompleteCount:active.filter(row=>!Boolean(row.done)).length};
}

async function eligibilityForProject(db:D1Database,projectId:string){
  const rows=await db.prepare(`
    SELECT i.id governing_item_id,a.id activity_id,COALESCE(e.done,0) done,COALESCE(ac.applicability,'always') applicability
    FROM governing_items i
    JOIN governing_documents d ON d.id=i.governing_document_id
    LEFT JOIN governing_item_activity_links l ON l.governing_item_id=i.id
    LEFT JOIN activities a ON a.id=l.activity_id
    LEFT JOIN activity_entries e ON e.activity_id=a.id
    LEFT JOIN activity_contexts ac ON ac.activity_id=a.id
    WHERE d.project_id=?
  `).bind(projectId).all();
  const grouped=new Map<string,{activeCount:number;incompleteCount:number}>();
  for(const row of rows.results as any[]){
    const id=String(row.governing_item_id);const state=grouped.get(id)||{activeCount:0,incompleteCount:0};
    if(row.activity_id&&String(row.applicability||'always')!=='deprecated'){
      state.activeCount+=1;if(!Boolean(row.done))state.incompleteCount+=1;
    }
    grouped.set(id,state);
  }
  return Object.fromEntries([...grouped.entries()].map(([id,state])=>[id,{...state,canAttest:state.activeCount>0&&state.incompleteCount===0}]));
}

export function registerGoverningAttestationRoutes(app:RouteApp){
  app.get('/api/studio/projects/:projectId/governing-attestations',async c=>{
    await ensureSchema(c.env.DB);
    const projectId=String(c.req.param('projectId'));
    const user=await currentUser(c);
    const rows=await c.env.DB.prepare(`
      SELECT id,governing_item_id,user_id,signer_name,signer_email,role_code,attestation_type,signing_method,signed_at
      FROM governing_item_attestations
      WHERE project_id=?
      ORDER BY governing_item_id,signed_at,id
    `).bind(projectId).all();
    return c.json({ok:true,attestations:rows.results,eligibility:await eligibilityForProject(c.env.DB,projectId),attestationRoles:user?await attestationRoles(c.env.DB,String(user.id),projectId):[]});
  });

  app.post('/api/studio/projects/:projectId/governing-items/:itemId/attest',async c=>{
    await ensureSchema(c.env.DB);
    const projectId=String(c.req.param('projectId')),itemId=String(c.req.param('itemId'));
    if(!await itemInProject(c.env.DB,projectId,itemId))return c.json({ok:false,error:'Styrpunkten hittades inte i projektet.'},404);
    const completion=await completionForItem(c.env.DB,itemId);
    if(completion.activeCount===0)return c.json({ok:false,error:'Punkten kan inte attesteras eftersom den saknar en aktiv projektaktivitet som kan klarmarkeras.'},409);
    if(completion.incompleteCount>0)return c.json({ok:false,error:'Punkten kan inte attesteras förrän alla kopplade aktiviteter är klarmarkerade.'},409);
    const user=await currentUser(c);if(!user)return c.json({ok:false,error:'Ingen aktiv användare.'},401);
    const body=await c.req.json<{roleCode?:string;attestationType?:string}>().catch(()=>({}));
    const permittedRoles=await attestationRoles(c.env.DB,String(user.id),projectId);
    const roleCode=String(body.roleCode||permittedRoles[0]||'').trim().toUpperCase();
    const attestationType=String(body.attestationType||'approved').trim().toLowerCase();
    if(!permittedRoles.includes(roleCode))return c.json({ok:false,error:`Du är inte behörig att attestera som ${roleCode||'den valda rollen'}.`},403);
    if(!['approved','checked','performed'].includes(attestationType))return c.json({ok:false,error:'Ogiltig attesttyp.'},400);
    const duplicate=await c.env.DB.prepare(`SELECT id,signed_at FROM governing_item_attestations WHERE project_id=? AND governing_item_id=? AND user_id=? AND role_code=? AND attestation_type=? ORDER BY signed_at DESC LIMIT 1`).bind(projectId,itemId,user.id,roleCode,attestationType).first<any>();
    if(duplicate)return c.json({ok:false,error:'Samma användare har redan attesterat punkten med denna roll och attesttyp.',existing:duplicate},409);
    const id=crypto.randomUUID();
    await c.env.DB.prepare(`INSERT INTO governing_item_attestations(id,project_id,governing_item_id,user_id,signer_name,signer_email,role_code,attestation_type,signing_method,signed_at,created_at) VALUES(?,?,?,?,?,?,?,?, 'byggplan_internal',datetime('now'),datetime('now'))`).bind(id,projectId,itemId,String(user.id),String(user.display_name||user.email),String(user.email||''),roleCode,attestationType).run();
    const created=await c.env.DB.prepare(`SELECT id,governing_item_id,user_id,signer_name,signer_email,role_code,attestation_type,signing_method,signed_at FROM governing_item_attestations WHERE id=?`).bind(id).first<any>();
    return c.json({ok:true,attestation:created},201);
  });
}
