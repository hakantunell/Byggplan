type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;post:(path:string,handler:(c:any)=>unknown)=>void};

type AttestationRow={governing_item_id:string;role_code:string};

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

function requiredRoles(value:unknown){
  const raw=String(value||'').trim();
  const upper=raw.toLocaleUpperCase('sv-SE');
  const roles:string[]=[];
  const hasKa=/(^|[^A-ZÅÄÖ])KA([^A-ZÅÄÖ]|$)|KONTROLLANSVARIG/.test(upper);
  const hasBh=/(^|[^A-ZÅÄÖ])BH([^A-ZÅÄÖ]|$)|BYGGHERRE/.test(upper);
  const hasEk=/(^|[^A-ZÅÄÖ])EK([^A-ZÅÄÖ]|$)|EGENKONTROLL/.test(upper);
  if(hasBh||hasEk)roles.push('BH');
  if(hasKa)roles.push('KA');
  return roles.length?[...new Set(roles)]:['BH'];
}

async function itemInProject(db:D1Database,projectId:string,itemId:string){
  return db.prepare(`SELECT i.id,i.responsible_role FROM governing_items i JOIN governing_documents d ON d.id=i.governing_document_id WHERE i.id=? AND d.project_id=?`).bind(itemId,projectId).first<any>();
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

async function eligibilityForProject(db:D1Database,projectId:string,attestations:AttestationRow[],userRoles:string[]){
  const rows=await db.prepare(`
    SELECT i.id governing_item_id,i.responsible_role,a.id activity_id,COALESCE(e.done,0) done,COALESCE(ac.applicability,'always') applicability
    FROM governing_items i
    JOIN governing_documents d ON d.id=i.governing_document_id
    LEFT JOIN governing_item_activity_links l ON l.governing_item_id=i.id
    LEFT JOIN activities a ON a.id=l.activity_id
    LEFT JOIN activity_entries e ON e.activity_id=a.id
    LEFT JOIN activity_contexts ac ON ac.activity_id=a.id
    WHERE d.project_id=?
  `).bind(projectId).all();
  const grouped=new Map<string,{activeCount:number;incompleteCount:number;responsibleRole:string}>();
  for(const row of rows.results as any[]){
    const id=String(row.governing_item_id);const state=grouped.get(id)||{activeCount:0,incompleteCount:0,responsibleRole:String(row.responsible_role||'')};
    if(row.activity_id&&String(row.applicability||'always')!=='deprecated'){
      state.activeCount+=1;if(!Boolean(row.done))state.incompleteCount+=1;
    }
    grouped.set(id,state);
  }
  const attestedByItem=new Map<string,Set<string>>();
  for(const row of attestations){const id=String(row.governing_item_id),set=attestedByItem.get(id)||new Set<string>();set.add(String(row.role_code||'').toUpperCase());attestedByItem.set(id,set)}
  return Object.fromEntries([...grouped.entries()].map(([id,state])=>{
    const required=requiredRoles(state.responsibleRole),attested=[...(attestedByItem.get(id)||new Set<string>())],missing=required.filter(role=>!attested.includes(role));
    const performed=state.activeCount>0&&state.incompleteCount===0;
    const availableRoles=performed?userRoles.filter(role=>required.includes(role)&&missing.includes(role)):[];
    return[id,{...state,performed,requiredRoles:required,attestedRoles:attested,missingRoles:missing,fullyAttested:performed&&missing.length===0,canAttest:availableRoles.length>0,availableRoles}]
  }));
}

export function registerGoverningAttestationRoutes(app:RouteApp){
  app.get('/api/studio/projects/:projectId/governing-attestations',async c=>{
    await ensureSchema(c.env.DB);
    const projectId=String(c.req.param('projectId'));
    const user=await currentUser(c);
    const userRoles=user?await attestationRoles(c.env.DB,String(user.id),projectId):[];
    const rows=await c.env.DB.prepare(`
      SELECT id,governing_item_id,user_id,signer_name,signer_email,role_code,attestation_type,signing_method,signed_at
      FROM governing_item_attestations
      WHERE project_id=?
      ORDER BY governing_item_id,signed_at,id
    `).bind(projectId).all();
    const attestations=rows.results as any[];
    return c.json({ok:true,attestations,eligibility:await eligibilityForProject(c.env.DB,projectId,attestations as AttestationRow[],userRoles),attestationRoles:userRoles});
  });

  app.post('/api/studio/projects/:projectId/governing-items/:itemId/attest',async c=>{
    await ensureSchema(c.env.DB);
    const projectId=String(c.req.param('projectId')),itemId=String(c.req.param('itemId'));
    const item=await itemInProject(c.env.DB,projectId,itemId);
    if(!item)return c.json({ok:false,error:'Styrpunkten hittades inte i projektet.'},404);
    const completion=await completionForItem(c.env.DB,itemId);
    if(completion.activeCount===0)return c.json({ok:false,error:'Kontrollen är inte genomförd eftersom punkten saknar en aktiv projektaktivitet.'},409);
    if(completion.incompleteCount>0)return c.json({ok:false,error:'Kontrollen måste vara genomförd innan den kan attesteras.'},409);
    const user=await currentUser(c);if(!user)return c.json({ok:false,error:'Ingen aktiv användare.'},401);
    const body=await c.req.json<{roleCode?:string;attestationType?:string}>().catch(()=>({}));
    const permittedRoles=await attestationRoles(c.env.DB,String(user.id),projectId);
    const required=requiredRoles(item.responsible_role);
    const roleCode=String(body.roleCode||permittedRoles.find(role=>required.includes(role))||'').trim().toUpperCase();
    const attestationType=String(body.attestationType||'approved').trim().toLowerCase();
    if(!permittedRoles.includes(roleCode))return c.json({ok:false,error:`Du är inte behörig att attestera som ${roleCode||'den valda rollen'}.`},403);
    if(!required.includes(roleCode))return c.json({ok:false,error:`Kontrollpunkten ska inte attesteras av ${roleCode}.`},403);
    if(!['approved','checked','performed'].includes(attestationType))return c.json({ok:false,error:'Ogiltig attesttyp.'},400);
    const existingRole=await c.env.DB.prepare(`SELECT id,signed_at,signer_name FROM governing_item_attestations WHERE project_id=? AND governing_item_id=? AND role_code=? ORDER BY signed_at DESC LIMIT 1`).bind(projectId,itemId,roleCode).first<any>();
    if(existingRole)return c.json({ok:false,error:`Kontrollpunkten är redan attesterad som ${roleCode}.`,existing:existingRole},409);
    const id=crypto.randomUUID();
    await c.env.DB.prepare(`INSERT INTO governing_item_attestations(id,project_id,governing_item_id,user_id,signer_name,signer_email,role_code,attestation_type,signing_method,signed_at,created_at) VALUES(?,?,?,?,?,?,?,?, 'byggplan_internal',datetime('now'),datetime('now'))`).bind(id,projectId,itemId,String(user.id),String(user.display_name||user.email),String(user.email||''),roleCode,attestationType).run();
    const created=await c.env.DB.prepare(`SELECT id,governing_item_id,user_id,signer_name,signer_email,role_code,attestation_type,signing_method,signed_at FROM governing_item_attestations WHERE id=?`).bind(id).first<any>();
    return c.json({ok:true,attestation:created},201);
  });
}
