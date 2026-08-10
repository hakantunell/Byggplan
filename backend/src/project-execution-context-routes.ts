type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;put:(path:string,handler:(c:any)=>unknown)=>void};

const ADMIN_TITLES=[
  'Kontrollera att startbesked finns',
  'Registrera BAS-P',
  'Registrera BAS-U',
  'Genomför startmöte med byggherre och KA',
  'Sätt upp arbetsmiljöplan där det krävs',
  'Kontrollera att elinstallationsföretaget är registrerat',
  'Registrera behörighet eller redovisa vald våtrumsmetod'
];

async function safeAlter(db:D1Database,sql:string){try{await db.prepare(sql).run()}catch(error){const message=String(error);if(!message.includes('duplicate column name'))throw error}}

async function tableExists(db:D1Database,table:string){
  const row=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
  return Boolean(row);
}

async function ensureSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS activity_execution_contexts(
    activity_id TEXT PRIMARY KEY,
    context TEXT NOT NULL CHECK(context IN ('field','administrative')),
    source TEXT NOT NULL DEFAULT 'system',
    executor_type TEXT NOT NULL DEFAULT 'self',
    executor_label TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
  )`).run();
  await safeAlter(db,`ALTER TABLE activity_execution_contexts ADD COLUMN executor_type TEXT NOT NULL DEFAULT 'self'`);
  await safeAlter(db,`ALTER TABLE activity_execution_contexts ADD COLUMN executor_label TEXT`);
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_activity_execution_context_context ON activity_execution_contexts(context)').run();
}

async function classifyProject(db:D1Database,projectId:string){
  const titlePlaceholders=ADMIN_TITLES.map(()=>'?').join(',');
  const params=[...ADMIN_TITLES,projectId];
  await db.prepare(`INSERT INTO activity_execution_contexts(activity_id,context,source,executor_type,updated_at)
    SELECT a.id,
      CASE WHEN a.title IN (${titlePlaceholders}) OR wa.name='Slutkontroll och slutbesked' THEN 'administrative' ELSE 'field' END,
      'system','self',datetime('now')
    FROM activities a
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=?
    ON CONFLICT(activity_id) DO UPDATE SET
      context=excluded.context,
      source='system',
      updated_at=datetime('now')
    WHERE activity_execution_contexts.source<>'manual'`).bind(...params).run();

  await db.prepare(`UPDATE activities SET required=0 WHERE id IN (
    SELECT ec.activity_id
    FROM activity_execution_contexts ec
    JOIN activities a ON a.id=ec.activity_id
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=? AND ec.context='administrative'
  )`).bind(projectId).run();
}

function isSelfRole(value:unknown){
  const role=String(value??'').trim().toLocaleLowerCase('sv');
  return role==='' || role==='ek' || role==='egenkontroll' || role.includes('egenkontroll') || role==='byggherre' || role.includes('byggherr');
}

function words(value:unknown){
  return String(value||'')
    .toLocaleLowerCase('sv-SE')
    .replace(/[^a-zåäö0-9 ]/g,' ')
    .split(/\s+/)
    .filter(word=>word.length>=4&&!['enligt','eller','samt','skall','ska','utförd','utföras','kontroll','kontrollera','dokumentation'].includes(word));
}

function similarity(item:any,activity:any){
  const source=new Set(words(`${item.item_description} ${item.section_title||''} ${item.source_note||''}`));
  const target=new Set(words(`${activity.title} ${activity.description||''} ${activity.task_title} ${activity.section_name} ${activity.area_name}`));
  if(!source.size||!target.size)return 0;
  let hits=0;
  for(const word of source)if(target.has(word))hits+=1;
  const ratio=hits/Math.max(2,Math.min(source.size,target.size));
  return Math.min(96,Math.round(ratio*100));
}

function appendGoverningRow(byActivity:Map<string,any[]>,row:any,source:'explicit'|'classification'|'inferred'){
  const activityId=String(row.activity_id);
  const list=byActivity.get(activityId)||[];
  if(list.some(entry=>String(entry.itemId)===String(row.item_id)))return;
  list.push({
    documentId:row.document_id,
    documentType:row.document_type,
    documentTitle:row.document_title,
    issuer:row.issuer,
    itemId:row.item_id,
    code:row.item_code,
    label:row.item_description,
    responsibleRole:row.responsible_role,
    mappingSource:source,
    confidence:row.confidence??null
  });
  byActivity.set(activityId,list);
}

async function addGoverningMetadata(db:D1Database,projectId:string,items:any[]){
  if(!(await tableExists(db,'governing_documents')) || !(await tableExists(db,'governing_items'))){
    return items.map(item=>({...item,governing_documents:[]}));
  }

  const byActivity=new Map<string,any[]>();
  const mappedItems=new Set<string>();

  if(await tableExists(db,'governing_item_activity_links')){
    const linked=await db.prepare(`SELECT l.activity_id,
        d.id AS document_id,d.document_type,d.title AS document_title,d.issuer,
        i.id AS item_id,i.code AS item_code,i.description AS item_description,i.responsible_role
      FROM governing_item_activity_links l
      JOIN governing_items i ON i.id=l.governing_item_id
      JOIN governing_documents d ON d.id=i.governing_document_id
      JOIN activities a ON a.id=l.activity_id
      JOIN tasks t ON t.id=a.task_id
      JOIN work_sections ws ON ws.id=t.work_section_id
      JOIN work_areas wa ON wa.id=ws.work_area_id
      WHERE wa.project_id=? AND d.status='active'
      ORDER BY l.activity_id,d.imported_at,i.sort_order`).bind(projectId).all();
    for(const row of linked.results as any[]){appendGoverningRow(byActivity,row,'explicit');mappedItems.add(String(row.item_id));}
  }

  if(await tableExists(db,'activity_classifications')){
    const inferred=await db.prepare(`SELECT ac.activity_id,
        d.id AS document_id,d.document_type,d.title AS document_title,d.issuer,
        i.id AS item_id,i.code AS item_code,i.description AS item_description,i.responsible_role
      FROM activity_classifications ac
      JOIN activities a ON a.id=ac.activity_id
      JOIN tasks t ON t.id=a.task_id
      JOIN work_sections ws ON ws.id=t.work_section_id
      JOIN work_areas wa ON wa.id=ws.work_area_id
      JOIN governing_documents d ON d.project_id=wa.project_id AND d.status='active'
      JOIN governing_items i ON i.governing_document_id=d.id
        AND lower(trim(i.code))=lower(trim(ac.code))
      WHERE wa.project_id=?
        AND trim(ac.code)<>''
        AND (
          (ac.category='control_plan' AND d.document_type='control_plan') OR
          (ac.category='requirement' AND d.document_type<>'control_plan')
        )
      ORDER BY ac.activity_id,d.imported_at,i.sort_order`).bind(projectId).all();
    for(const row of inferred.results as any[]){appendGoverningRow(byActivity,row,'classification');mappedItems.add(String(row.item_id));}
  }

  // Runtime fallback for older projects where the governing document was imported but its
  // rows were never explicitly linked to activities. Only high-confidence, unique matches
  // are exposed to the field app; nothing is persisted here.
  const governingRows=await db.prepare(`SELECT
      d.id AS document_id,d.document_type,d.title AS document_title,d.issuer,
      i.id AS item_id,i.code AS item_code,i.description AS item_description,
      i.section_title,i.responsible_role,
      COALESCE(i.source_note,'') AS source_note
    FROM governing_items i
    JOIN governing_documents d ON d.id=i.governing_document_id
    WHERE d.project_id=? AND d.status='active'
      AND COALESCE(i.handling_status,'unhandled') NOT IN ('not_applicable','cannot_verify','alternative_evidence')
    ORDER BY d.imported_at,i.sort_order`).bind(projectId).all();

  const activityRows=await db.prepare(`SELECT a.id AS activity_id,a.title,a.description,
      t.title AS task_title,ws.name AS section_name,wa.name AS area_name
    FROM activities a
    JOIN tasks t ON t.id=a.task_id
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=?
    ORDER BY wa.sort_order,ws.sort_order,t.sort_order,a.sort_order`).bind(projectId).all();

  for(const governing of governingRows.results as any[]){
    if(mappedItems.has(String(governing.item_id)))continue;
    const ranked=(activityRows.results as any[])
      .map(activity=>({activity,confidence:similarity(governing,activity)}))
      .sort((a,b)=>b.confidence-a.confidence);
    const best=ranked[0];
    const second=ranked[1];
    if(!best || best.confidence<50)continue;
    if(second && best.confidence-second.confidence<15)continue;
    appendGoverningRow(byActivity,{...governing,...best.activity,confidence:best.confidence},'inferred');
  }

  return items.map(item=>{
    const governingDocuments=byActivity.get(String(item.activity_id))||[];
    if(item.source==='manual' || governingDocuments.length===0){
      return {...item,governing_documents:governingDocuments};
    }

    const externalRoles=[...new Set(governingDocuments
      .map((entry:any)=>String(entry.responsibleRole??'').trim())
      .filter((role:string)=>role && !isSelfRole(role)))];

    return {
      ...item,
      executor_type:externalRoles.length?'third_party':'self',
      executor_label:externalRoles.length?externalRoles.join(' / '):null,
      governing_documents:governingDocuments
    };
  });
}

export function registerProjectExecutionContextRoutes(app:RouteApp){
  app.get('/api/project-execution-contexts',async c=>{
    await ensureSchema(c.env.DB);
    const projectId=c.req.query('projectId');
    if(!projectId)return c.json({ok:false,error:'projectId krävs.'},400);
    await classifyProject(c.env.DB,projectId);
    const rows=await c.env.DB.prepare(`SELECT ec.activity_id,ec.context,ec.source,ec.executor_type,ec.executor_label,a.title,a.description,a.activity_type,
      t.title AS task_title,ws.name AS section_name,wa.name AS work_area
      FROM activity_execution_contexts ec
      JOIN activities a ON a.id=ec.activity_id
      JOIN tasks t ON t.id=a.task_id
      JOIN work_sections ws ON ws.id=t.work_section_id
      JOIN work_areas wa ON wa.id=ws.work_area_id
      WHERE wa.project_id=? ORDER BY wa.sort_order,ws.sort_order,t.sort_order,a.sort_order`).bind(projectId).all();
    const enriched=await addGoverningMetadata(c.env.DB,projectId,rows.results as any[]);
    return c.json({ok:true,items:enriched});
  });

  app.get('/api/studio/activities/:id/execution-context',async c=>{
    await ensureSchema(c.env.DB);
    const id=c.req.param('id');
    const activity=await c.env.DB.prepare(`SELECT a.id,wa.project_id FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE a.id=?`).bind(id).first<any>();
    if(!activity)return c.json({ok:false,error:'Aktiviteten hittades inte.'},404);
    await classifyProject(c.env.DB,String(activity.project_id));
    const item=await c.env.DB.prepare('SELECT activity_id,context,source,executor_type,executor_label FROM activity_execution_contexts WHERE activity_id=?').bind(id).first<any>();
    const enriched=(await addGoverningMetadata(c.env.DB,String(activity.project_id),[item||{activity_id:id,context:'field',source:'system',executor_type:'self',executor_label:null}]))[0];
    return c.json({ok:true,item:enriched});
  });

  app.put('/api/studio/activities/:id/execution-context',async c=>{
    await ensureSchema(c.env.DB);
    const body=await c.req.json<{context?:string;executorType?:string;executorLabel?:string|null}>().catch(()=>({}));
    if(body.context!==undefined&&body.context!=='field'&&body.context!=='administrative')return c.json({ok:false,error:'Context måste vara field eller administrative.'},400);
    if(body.executorType!==undefined&&body.executorType!=='self'&&body.executorType!=='third_party')return c.json({ok:false,error:'Utförare måste vara self eller third_party.'},400);
    const activity=await c.env.DB.prepare('SELECT id FROM activities WHERE id=?').bind(c.req.param('id')).first();
    if(!activity)return c.json({ok:false,error:'Aktiviteten hittades inte.'},404);
    const existing=await c.env.DB.prepare('SELECT context,executor_type,executor_label FROM activity_execution_contexts WHERE activity_id=?').bind(c.req.param('id')).first<any>();
    const context=body.context??existing?.context??'field';
    const executorType=body.executorType??existing?.executor_type??'self';
    const executorLabel=executorType==='third_party'?(body.executorLabel??existing?.executor_label??null):null;
    await c.env.DB.prepare(`INSERT INTO activity_execution_contexts(activity_id,context,source,executor_type,executor_label,updated_at)
      VALUES(?,?,'manual',?,?,datetime('now'))
      ON CONFLICT(activity_id) DO UPDATE SET context=excluded.context,source='manual',executor_type=excluded.executor_type,executor_label=excluded.executor_label,updated_at=datetime('now')`)
      .bind(c.req.param('id'),context,executorType,executorLabel).run();
    if(context==='administrative')await c.env.DB.prepare('UPDATE activities SET required=0 WHERE id=?').bind(c.req.param('id')).run();
    return c.json({ok:true});
  });
}
