type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;post:(path:string,handler:(c:any)=>unknown)=>void};

type AttestationRow={governing_item_id:string;role_code:string;attestation_type:string};
type AvailableAttestation={roleCode:string;attestationType:'control'|'ka_review';label:string};

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

function controllerRoles(value:unknown){
  const upper=String(value||'').trim().toLocaleUpperCase('sv-SE');
  const hasKa=/(^|[^A-ZÅÄÖ])KA([^A-ZÅÄÖ]|$)|KONTROLLANSVARIG/.test(upper);
  const hasBh=/(^|[^A-ZÅÄÖ])BH([^A-ZÅÄÖ]|$)|BYGGHERRE/.test(upper);
  const hasEk=/(^|[^A-ZÅÄÖ])EK([^A-ZÅÄÖ]|$)|EGENKONTROLL/.test(upper);
  if((hasBh||hasEk)&&!hasKa)return['BH'];
  if(hasKa&&!hasBh&&!hasEk)return['KA'];
  if(hasBh||hasEk)return['BH'];
  if(hasKa)return['KA'];
  return['BH'];
}

function isControlPlan(documentTitle:unknown,documentType:unknown){
  return /kontrollplan/i.test(`${String(documentTitle||'')} ${String(documentType||'')}`);
}

function normalizedType(row:AttestationRow){
  const type=String(row.attestation_type||'').toLowerCase();
  return type==='ka_review'?'ka_review':'control';
}

async function itemInProject(db:D1Database,projectId:string,itemId:string){
  return db.prepare(`SELECT i.id,i.responsible_role,d.title document_title,d.document_type FROM governing_items i JOIN governing_documents d ON d.id=i.governing_document_id WHERE i.id=? AND d.project_id=?`).bind(itemId,projectId).first<any>();
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

function attestationProgress(itemId:string,controller:string[],requiresKaReview:boolean,attestations:AttestationRow[]){
  const rows=attestations.filter(row=>String(row.governing_item_id)===itemId);
  const controlRoles=[...new Set(rows.filter(row=>normalizedType(row)==='control').map(row=>String(row.role_code||'').toUpperCase()))];
  const controlMissing=controller.filter(role=>!controlRoles.includes(role));
  const controlComplete=controlMissing.length===0;
  const kaReviewDone=rows.some(row=>normalizedType(row)==='ka_review'&&String(row.role_code||'').toUpperCase()==='KA');
  return{controlRoles,controlMissing,controlComplete,kaReviewDone,requiresKaReview};
}

async function eligibilityForProject(db:D1Database,projectId:string,attestations:AttestationRow[],userRoles:string[]){
  const rows=await db.prepare(`
    SELECT i.id governing_item_id,i.responsible_role,d.title document_title,d.document_type,a.id activity_id,COALESCE(e.done,0) done,COALESCE(ac.applicability,'always') applicability
    FROM governing_items i
    JOIN governing_documents d ON d.id=i.governing_document_id
    LEFT JOIN governing_item_activity_links l ON l.governing_item_id=i.id
    LEFT JOIN activities a ON a.id=l.activity_id
    LEFT JOIN activity_entries e ON e.activity_id=a.id
    LEFT JOIN activity_contexts ac ON ac.activity_id=a.id
    WHERE d.project_id=?
  `).bind(projectId).all();
  const grouped=new Map<string,{activeCount:number;incompleteCount:number;responsibleRole:string;documentTitle:string;documentType:string}>();
  for(const row of rows.results as any[]){
    const id=String(row.governing_item_id);const state=grouped.get(id)||{activeCount:0,incompleteCount:0,responsibleRole:String(row.responsible_role||''),documentTitle:String(row.document_title||''),documentType:String(row.document_type||'')};
    if(row.activity_id&&String(row.applicability||'always')!=='deprecated'){
      state.activeCount+=1;if(!Boolean(row.done))state.incompleteCount+=1;
    }
    grouped.set(id,state);
  }
  return Object.fromEntries([...grouped.entries()].map(([id,state])=>{
    const controller=controllerRoles(state.responsibleRole);
    const requiresKaReview=isControlPlan(state.documentTitle,state.documentType);
    const progress=attestationProgress(id,controller,requiresKaReview,attestations);
    const performed=state.activeCount>0&&state.incompleteCount===0;
    const availableAttestations:AvailableAttestation[]=[];
    if(performed&&!progress.controlComplete){
      for(const role of userRoles.filter(role=>progress.controlMissing.includes(role)))availableAttestations.push({roleCode:role,attestationType:'control',label:`Kontrollintyg som ${role}`});
    }else if(performed&&progress.controlComplete&&requiresKaReview&&!progress.kaReviewDone&&userRoles.includes('KA')){
      availableAttestations.push({roleCode:'KA',attestationType:'ka_review',label:'KA-signering'});
    }
    const fullyAttested=performed&&progress.controlComplete&&(!requiresKaReview||progress.kaReviewDone);
    return[id,{...state,performed,controllerRoles:controller,controlAttestedRoles:progress.controlRoles,missingControllerRoles:progress.controlMissing,controlComplete:progress.controlComplete,requiresKaReview,kaReviewDone:progress.kaReviewDone,fullyAttested,canAttest:availableAttestations.length>0,availableAttestations}]
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
    if(completion.incompleteCount>0)return c.json({ok:false,error:'Kontrollen måste vara genomförd innan den kan signeras.'},409);
    const user=await currentUser(c);if(!user)return c.json({ok:false,error:'Ingen aktiv användare.'},401);
    const body=await c.req.json<{roleCode?:string;attestationType?:string}>().catch(()=>({}));
    const permittedRoles=await attestationRoles(c.env.DB,String(user.id),projectId);
    const roleCode=String(body.roleCode||'').trim().toUpperCase();
    const requestedType=String(body.attestationType||'control').trim().toLowerCase();
    const attestationType=requestedType==='ka_review'?'ka_review':'control';
    if(!permittedRoles.includes(roleCode))return c.json({ok:false,error:`Du är inte behörig att signera som ${roleCode||'den valda rollen'}.`},403);
    const existingRows=await c.env.DB.prepare(`SELECT governing_item_id,role_code,attestation_type FROM governing_item_attestations WHERE project_id=? AND governing_item_id=?`).bind(projectId,itemId).all();
    const existing=existingRows.results as AttestationRow[];
    const controller=controllerRoles(item.responsible_role);
    const requiresKaReview=isControlPlan(item.document_title,item.document_type);
    const progress=attestationProgress(itemId,controller,requiresKaReview,existing);
    if(attestationType==='control'){
      if(!controller.includes(roleCode))return c.json({ok:false,error:`Kontrollpunkten ska inte kontrollsigneras av ${roleCode}.`},403);
      if(!progress.controlMissing.includes(roleCode))return c.json({ok:false,error:`Kontrollintyget är redan signerat som ${roleCode}.`},409);
    }else{
      if(roleCode!=='KA'||!requiresKaReview)return c.json({ok:false,error:'Den här punkten har ingen separat KA-signering.'},403);
      if(!progress.controlComplete)return c.json({ok:false,error:'Kontrollintyget måste vara klart innan KA kan slutkvittera punkten.'},409);
      if(progress.kaReviewDone)return c.json({ok:false,error:'KA-signeringen är redan gjord.'},409);
    }
    const id=crypto.randomUUID();
    await c.env.DB.prepare(`INSERT INTO governing_item_attestations(id,project_id,governing_item_id,user_id,signer_name,signer_email,role_code,attestation_type,signing_method,signed_at,created_at) VALUES(?,?,?,?,?,?,?,?, 'byggplan_internal',datetime('now'),datetime('now'))`).bind(id,projectId,itemId,String(user.id),String(user.display_name||user.email),String(user.email||''),roleCode,attestationType).run();
    const created=await c.env.DB.prepare(`SELECT id,governing_item_id,user_id,signer_name,signer_email,role_code,attestation_type,signing_method,signed_at FROM governing_item_attestations WHERE id=?`).bind(id).first<any>();
    return c.json({ok:true,attestation:created},201);
  });
}
