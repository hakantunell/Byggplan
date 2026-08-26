type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;put:(path:string,handler:(c:any)=>unknown)=>void;post:(path:string,handler:(c:any)=>unknown)=>void;delete:(path:string,handler:(c:any)=>unknown)=>void};

function safeName(name:string){return name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^[-.]+|[-.]+$/g,'').slice(0,120)||'fil'}
function isFile(value:unknown):value is File{return Boolean(value&&typeof value==='object'&&typeof (value as any).stream==='function'&&typeof (value as any).size==='number')}

async function ensureSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS activity_own_documentation(
    activity_id TEXT PRIMARY KEY,
    note TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS activity_own_documentation_files(
    id TEXT PRIMARY KEY,
    activity_id TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_activity_own_files_activity ON activity_own_documentation_files(activity_id,created_at)').run();
}

async function activityInfo(db:D1Database,id:string){
  return db.prepare(`SELECT a.id,a.activity_type,wa.project_id FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE a.id=?`).bind(id).first<any>();
}

export function registerActivityOwnDocumentationRoutes(app:RouteApp){
  app.get('/api/activities/:id/own-documentation',async c=>{
    await ensureSchema(c.env.DB);
    const id=String(c.req.param('id'));
    const activity=await activityInfo(c.env.DB,id);
    if(!activity)return c.json({ok:false,error:'Aktiviteten hittades inte.'},404);
    const row=await c.env.DB.prepare('SELECT note,updated_at FROM activity_own_documentation WHERE activity_id=?').bind(id).first<any>();
    const files=await c.env.DB.prepare('SELECT id,original_name,content_type,size_bytes,created_at FROM activity_own_documentation_files WHERE activity_id=? ORDER BY created_at,id').bind(id).all();
    return c.json({ok:true,note:String(row?.note||''),updatedAt:row?.updated_at||null,files:(files.results as any[]).map(file=>({id:file.id,originalName:file.original_name,contentType:file.content_type,sizeBytes:Number(file.size_bytes||0),createdAt:file.created_at,url:`/api/activity-own-documentation-files/${encodeURIComponent(file.id)}`}))});
  });

  app.get('/api/projects/:projectId/activity-documentation-summary',async c=>{
    await ensureSchema(c.env.DB);
    const projectId=String(c.req.param('projectId'));
    const activities=await c.env.DB.prepare(`
      SELECT a.id,a.title,a.activity_type,
             t.id AS task_id,t.title AS task_title,t.sort_order AS task_sort,
             ws.id AS section_id,ws.name AS section_name,ws.sort_order AS section_sort,
             wa.id AS area_id,wa.name AS area_name,wa.sort_order AS area_sort
      FROM activities a
      JOIN tasks t ON t.id=a.task_id
      JOIN work_sections ws ON ws.id=t.work_section_id
      JOIN work_areas wa ON wa.id=ws.work_area_id
      WHERE wa.project_id=?
      ORDER BY wa.sort_order,ws.sort_order,t.sort_order,a.sort_order,a.id
    `).bind(projectId).all();
    if(!(activities.results as any[]).length)return c.json({ok:true,items:[]});
    const ownNotes=await c.env.DB.prepare(`
      SELECT d.activity_id,d.note,d.updated_at
      FROM activity_own_documentation d
      JOIN activities a ON a.id=d.activity_id
      JOIN tasks t ON t.id=a.task_id
      JOIN work_sections ws ON ws.id=t.work_section_id
      JOIN work_areas wa ON wa.id=ws.work_area_id
      WHERE wa.project_id=?
    `).bind(projectId).all();
    const ownFiles=await c.env.DB.prepare(`
      SELECT f.id,f.activity_id,f.original_name,f.content_type,f.size_bytes,f.created_at
      FROM activity_own_documentation_files f
      JOIN activities a ON a.id=f.activity_id
      JOIN tasks t ON t.id=a.task_id
      JOIN work_sections ws ON ws.id=t.work_section_id
      JOIN work_areas wa ON wa.id=ws.work_area_id
      WHERE wa.project_id=?
      ORDER BY f.activity_id,f.created_at,f.id
    `).bind(projectId).all();
    const fields=await c.env.DB.prepare(`
      SELECT f.id,f.activity_id,f.field_type,f.label,f.unit,f.required,
             e.id AS entry_id,e.value_text,e.value_number,e.value_boolean,
             e.original_name,e.content_type,e.created_at
      FROM activity_documentation_fields f
      JOIN activities a ON a.id=f.activity_id
      JOIN tasks t ON t.id=a.task_id
      JOIN work_sections ws ON ws.id=t.work_section_id
      JOIN work_areas wa ON wa.id=ws.work_area_id
      LEFT JOIN activity_documentation_entries e ON e.field_id=f.id
      WHERE wa.project_id=?
      ORDER BY f.activity_id,f.sort_order,e.created_at
    `).bind(projectId).all();
    const byActivity=new Map<string,any>();
    for(const row of activities.results as any[])byActivity.set(String(row.id),{
      activityId:String(row.id),activityTitle:String(row.title||''),activityType:String(row.activity_type||''),
      taskId:String(row.task_id||''),taskTitle:String(row.task_title||''),taskSort:Number(row.task_sort||0),
      sectionId:String(row.section_id||''),sectionName:String(row.section_name||''),sectionSort:Number(row.section_sort||0),
      areaId:String(row.area_id||''),areaName:String(row.area_name||''),areaSort:Number(row.area_sort||0),
      note:'',ownFiles:[],requiredFields:[]
    });
    for(const row of ownNotes.results as any[]){const item=byActivity.get(String(row.activity_id));if(item)item.note=String(row.note||'')}
    for(const row of ownFiles.results as any[]){const item=byActivity.get(String(row.activity_id));if(item)item.ownFiles.push({id:row.id,originalName:row.original_name,contentType:row.content_type,sizeBytes:Number(row.size_bytes||0),createdAt:row.created_at,url:`/api/activity-own-documentation-files/${encodeURIComponent(row.id)}`})}
    for(const row of fields.results as any[]){const item=byActivity.get(String(row.activity_id));if(!item)continue;let field=item.requiredFields.find((x:any)=>x.id===row.id);if(!field){field={id:row.id,type:row.field_type,label:row.label,unit:row.unit||'',required:Boolean(row.required),entries:[]};item.requiredFields.push(field)}if(row.entry_id)field.entries.push({id:row.entry_id,valueText:row.value_text??null,valueNumber:row.value_number??null,valueBoolean:row.value_boolean==null?null:Boolean(row.value_boolean),originalName:row.original_name??null,contentType:row.content_type??null,createdAt:row.created_at,url:row.original_name?`/api/activity-documentation-entries/${encodeURIComponent(row.entry_id)}`:null})}
    return c.json({ok:true,items:[...byActivity.values()].filter((item:any)=>item.note.trim()||item.ownFiles.length||item.requiredFields.some((field:any)=>field.entries.length))});
  });

  app.put('/api/activities/:id/own-documentation',async c=>{
    await ensureSchema(c.env.DB);
    const id=String(c.req.param('id'));
    if(!await activityInfo(c.env.DB,id))return c.json({ok:false,error:'Aktiviteten hittades inte.'},404);
    const body=await c.req.json<{note?:string}>().catch(()=>({}));
    const note=typeof body.note==='string'?body.note:'';
    await c.env.DB.prepare(`INSERT INTO activity_own_documentation(activity_id,note,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(activity_id) DO UPDATE SET note=excluded.note,updated_at=datetime('now')`).bind(id,note).run();
    return c.json({ok:true});
  });

  app.post('/api/activities/:id/own-documentation/files',async c=>{
    await ensureSchema(c.env.DB);
    const activityId=String(c.req.param('id'));
    const activity=await activityInfo(c.env.DB,activityId);
    if(!activity)return c.json({ok:false,error:'Aktiviteten hittades inte.'},404);
    if(!c.env.FILES)return c.json({ok:false,error:'Fillagringen är inte tillgänglig.'},503);
    let form:FormData;try{form=await c.req.raw.formData()}catch{return c.json({ok:false,error:'Kunde inte läsa filen.'},400)}
    const upload=form.get('file');
    if(!isFile(upload)||upload.size<=0)return c.json({ok:false,error:'Ingen giltig fil valdes.'},400);
    if(upload.size>20*1024*1024)return c.json({ok:false,error:'Filen får vara högst 20 MB.'},413);
    const type=(upload as any).type||'';
    if(!type.startsWith('image/')&&type!=='application/pdf')return c.json({ok:false,error:'Endast bilder och PDF stöds här.'},415);
    const id=crypto.randomUUID(),original=(upload as any).name||(type==='application/pdf'?'dokument.pdf':'bild.jpg');
    const key=`projects/${activity.project_id}/activity-own-documentation/${activityId}/${id}-${safeName(original)}`;
    await c.env.FILES.put(key,(upload as any).stream(),{httpMetadata:{contentType:type||'application/octet-stream'}});
    try{await c.env.DB.prepare('INSERT INTO activity_own_documentation_files(id,activity_id,object_key,original_name,content_type,size_bytes) VALUES(?,?,?,?,?,?)').bind(id,activityId,key,original,type,Number((upload as any).size||0)).run()}catch(error){await c.env.FILES.delete(key);throw error}
    return c.json({ok:true,id},201);
  });

  app.get('/api/activity-own-documentation-files/:id',async c=>{
    await ensureSchema(c.env.DB);
    const file=await c.env.DB.prepare('SELECT object_key,original_name,content_type FROM activity_own_documentation_files WHERE id=?').bind(c.req.param('id')).first<any>();
    if(!file)return c.json({ok:false,error:'Filen hittades inte.'},404);
    const object=await c.env.FILES.get(file.object_key);if(!object)return c.json({ok:false,error:'Filen saknas.'},404);
    const headers=new Headers();object.writeHttpMetadata(headers);headers.set('Content-Type',file.content_type||headers.get('Content-Type')||'application/octet-stream');headers.set('Content-Disposition',`inline; filename="${safeName(file.original_name)}"`);headers.set('Cache-Control','private, max-age=300');
    return new Response(object.body,{headers});
  });

  app.get('/api/activity-documentation-entries/:id',async c=>{
    const file=await c.env.DB.prepare('SELECT object_key,original_name,content_type FROM activity_documentation_entries WHERE id=? AND object_key IS NOT NULL').bind(c.req.param('id')).first<any>();
    if(!file)return c.json({ok:false,error:'Underlaget hittades inte.'},404);
    const object=await c.env.FILES.get(file.object_key);if(!object)return c.json({ok:false,error:'Underlagsfilen saknas.'},404);
    const headers=new Headers();object.writeHttpMetadata(headers);headers.set('Content-Type',file.content_type||headers.get('Content-Type')||'application/octet-stream');headers.set('Content-Disposition',`inline; filename="${safeName(file.original_name||'underlag')}"`);headers.set('Cache-Control','private, max-age=300');
    return new Response(object.body,{headers});
  });

  app.delete('/api/activity-own-documentation-files/:id',async c=>{
    await ensureSchema(c.env.DB);
    const file=await c.env.DB.prepare('SELECT object_key FROM activity_own_documentation_files WHERE id=?').bind(c.req.param('id')).first<any>();
    if(!file)return c.json({ok:false,error:'Filen hittades inte.'},404);
    if(c.env.FILES)await c.env.FILES.delete(String(file.object_key));
    await c.env.DB.prepare('DELETE FROM activity_own_documentation_files WHERE id=?').bind(c.req.param('id')).run();
    return c.json({ok:true});
  });
}
