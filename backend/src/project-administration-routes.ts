type RouteApp = {
  get: (path: string, handler: (c: any) => unknown) => void;
  post: (path: string, handler: (c: any) => unknown) => void;
  put: (path: string, handler: (c: any) => unknown) => void;
  delete: (path: string, handler: (c: any) => unknown) => void;
};

type Body = { title?: string; completed?: boolean; valueText?: string; note?: string; code?: string; data?: Record<string,string> };

type DefaultItem={code:string;title:string};
const DEFAULT_ITEMS:DefaultItem[] = [
  {code:'startbesked',title:'Startbesked finns'},
  {code:'arbetsmiljoplan',title:'Arbetsmiljöplan är upprättad'},
  {code:'bas_p',title:'BAS-P är utsedd'},
  {code:'bas_u',title:'BAS-U är utsedd'}
];

const ADMIN_TITLE_MAP:Record<string,DefaultItem> = {
  'Kontrollera att startbesked finns':{code:'startbesked',title:'Startbesked finns'},
  'Registrera BAS-P':{code:'bas_p',title:'BAS-P är utsedd'},
  'Registrera BAS-U':{code:'bas_u',title:'BAS-U är utsedd'},
  'Sätt upp arbetsmiljöplan där det krävs':{code:'arbetsmiljoplan',title:'Arbetsmiljöplan är upprättad'}
};

const ADMIN_TITLES = new Set([
  'Kontrollera att startbesked finns',
  'Registrera BAS-P',
  'Registrera BAS-U',
  'Genomför startmöte med byggherre och KA',
  'Sätt upp arbetsmiljöplan där det krävs',
  'Kontrollera att elinstallationsföretaget är registrerat',
  'Registrera behörighet eller redovisa vald våtrumsmetod'
]);

function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
function codeFromTitle(title:string){return title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80)||'administrativ_punkt'}
function cleanData(value:unknown){const result:Record<string,string>={};if(!value||typeof value!=='object')return result;for(const [key,val] of Object.entries(value as Record<string,unknown>)){if(typeof val==='string')result[key]=val.trim()}return result}

async function ensureColumn(db:D1Database,name:string,definition:string){const info=await db.prepare('PRAGMA table_info(project_administration_items)').all();if(!(info.results as any[]).some(row=>row.name===name))await db.prepare(`ALTER TABLE project_administration_items ADD COLUMN ${name} ${definition}`).run()}

async function ensureSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS project_administration_items(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    value_text TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`).run();
  await ensureColumn(db,'code',"TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db,'data_json',"TEXT NOT NULL DEFAULT '{}'");
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_project_administration_project ON project_administration_items(project_id,sort_order,id)').run();
  await db.prepare("UPDATE project_administration_items SET code=CASE title WHEN 'Startbesked finns' THEN 'startbesked' WHEN 'Arbetsmiljöplan är upprättad' THEN 'arbetsmiljoplan' WHEN 'BAS-P är utsedd' THEN 'bas_p' WHEN 'BAS-U är utsedd' THEN 'bas_u' ELSE code END WHERE code='' OR code IS NULL").run();
}

async function insertMissing(db:D1Database,projectId:string,item:DefaultItem,sortOrder:number){
  const existing=await db.prepare('SELECT id FROM project_administration_items WHERE project_id=? AND (code=? OR title=?)').bind(projectId,item.code,item.title).first();
  if(existing)return false;
  await db.prepare("INSERT INTO project_administration_items(id,project_id,code,title,data_json,sort_order) VALUES(?,?,?,?, '{}',?)")
    .bind(crypto.randomUUID(),projectId,item.code,item.title,sortOrder).run();
  return true;
}

async function ensureDefaults(db: D1Database, projectId: string) {
  const orderRow=await db.prepare('SELECT COALESCE(MAX(sort_order),0) AS max_order FROM project_administration_items WHERE project_id=?').bind(projectId).first<{max_order:number}>();
  let sortOrder=Number(orderRow?.max_order||0);
  for(const item of DEFAULT_ITEMS){sortOrder+=10;await insertMissing(db,projectId,item,sortOrder)}
}

async function syncAdministrativeActivities(db:D1Database,projectId:string){
  const rows=await db.prepare(`SELECT a.title,wa.name AS work_area
    FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id
    WHERE wa.project_id=? ORDER BY wa.sort_order,ws.sort_order,t.sort_order,a.sort_order`).bind(projectId).all();
  const orderRow=await db.prepare('SELECT COALESCE(MAX(sort_order),0) AS max_order FROM project_administration_items WHERE project_id=?').bind(projectId).first<{max_order:number}>();
  let sortOrder=Number(orderRow?.max_order||0);
  for(const row of rows.results as any[]){
    const sourceTitle=String(row.title||'');
    const administrative=ADMIN_TITLES.has(sourceTitle)||String(row.work_area)==='Slutkontroll och slutbesked';
    if(!administrative)continue;
    const mapped=ADMIN_TITLE_MAP[sourceTitle]||{code:codeFromTitle(sourceTitle),title:sourceTitle};
    sortOrder+=10;await insertMissing(db,projectId,mapped,sortOrder)
  }
}

function decorate(row:any){let data:Record<string,string>={};try{data=JSON.parse(row.data_json||'{}')}catch{}return {...row,data}}

export function registerProjectAdministrationRoutes(app: RouteApp) {
  app.get('/api/studio/project-administration', async c => {
    const projectId = text(c.req.query('projectId'));
    if (!projectId) return c.json({ok:false,error:'Projekt krävs.'},400);
    await ensureSchema(c.env.DB);
    const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
    if (!project) return c.json({ok:false,error:'Projektet hittades inte.'},404);
    await ensureDefaults(c.env.DB,projectId);await syncAdministrativeActivities(c.env.DB,projectId);
    const result = await c.env.DB.prepare('SELECT id,code,title,completed,value_text,note,data_json,sort_order FROM project_administration_items WHERE project_id=? ORDER BY sort_order,id').bind(projectId).all();
    return c.json({ok:true,items:(result.results as any[]).map(decorate)});
  });

  app.post('/api/studio/project-administration', async c => {
    await ensureSchema(c.env.DB);
    const body = await c.req.json<Body & {projectId?:string}>().catch(()=>({}));
    const projectId=text(body.projectId), title=text(body.title);if(!projectId)return c.json({ok:false,error:'Projekt krävs.'},400);if(!title)return c.json({ok:false,error:'Rubrik krävs.'},400);
    const project=await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);
    const order=await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM project_administration_items WHERE project_id=?').bind(projectId).first<{next_order:number}>();
    const id=crypto.randomUUID(), code=text(body.code)||codeFromTitle(title), data=cleanData(body.data);
    await c.env.DB.prepare('INSERT INTO project_administration_items(id,project_id,code,title,completed,value_text,note,data_json,sort_order) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(id,projectId,code,title,body.completed?1:0,text(body.valueText),text(body.note),JSON.stringify(data),Number(order?.next_order??10)).run();
    return c.json({ok:true,id},201);
  });

  app.put('/api/studio/project-administration/:id', async c => {
    await ensureSchema(c.env.DB);
    const body=await c.req.json<Body>().catch(()=>({}));const title=text(body.title);if(!title)return c.json({ok:false,error:'Rubrik krävs.'},400);
    const existing=await c.env.DB.prepare('SELECT code,data_json FROM project_administration_items WHERE id=?').bind(c.req.param('id')).first<any>();if(!existing)return c.json({ok:false,error:'Den administrativa punkten hittades inte.'},404);
    const code=text(body.code)||String(existing.code||codeFromTitle(title));const data=body.data===undefined?(()=>{try{return JSON.parse(existing.data_json||'{}')}catch{return {}}})():cleanData(body.data);
    const result=await c.env.DB.prepare("UPDATE project_administration_items SET code=?,title=?,completed=?,value_text=?,note=?,data_json=?,updated_at=datetime('now') WHERE id=?")
      .bind(code,title,body.completed?1:0,text(body.valueText),text(body.note),JSON.stringify(data),c.req.param('id')).run();
    if(!result.meta.changes)return c.json({ok:false,error:'Den administrativa punkten hittades inte.'},404);return c.json({ok:true});
  });

  app.delete('/api/studio/project-administration/:id', async c => {
    await ensureSchema(c.env.DB);const result=await c.env.DB.prepare('DELETE FROM project_administration_items WHERE id=?').bind(c.req.param('id')).run();if(!result.meta.changes)return c.json({ok:false,error:'Den administrativa punkten hittades inte.'},404);return c.json({ok:true});
  });
}
