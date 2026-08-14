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
    const allowed=type.startsWith('image/')||type==='application/pdf';
    if(!allowed)return c.json({ok:false,error:'Endast bilder och PDF-filer stöds här.'},415);
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

  app.delete('/api/activity-own-documentation-files/:id',async c=>{
    await ensureSchema(c.env.DB);
    const file=await c.env.DB.prepare('SELECT object_key FROM activity_own_documentation_files WHERE id=?').bind(c.req.param('id')).first<any>();
    if(!file)return c.json({ok:false,error:'Filen hittades inte.'},404);
    if(c.env.FILES)await c.env.FILES.delete(String(file.object_key));
    await c.env.DB.prepare('DELETE FROM activity_own_documentation_files WHERE id=?').bind(c.req.param('id')).run();
    return c.json({ok:true});
  });
}
