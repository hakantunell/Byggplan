type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;put:(path:string,handler:(c:any)=>unknown)=>void};

async function ensureCategory(db:D1Database){
  try{await db.prepare("ALTER TABLE project_documents ADD COLUMN category TEXT NOT NULL DEFAULT 'unclassified'").run();}catch{}
}

export function registerProjectDocumentCategoryRoutes(app:RouteApp){
  app.get('/api/project-document-categories',async c=>{
    const projectId=String(c.req.query('projectId')||'').trim();
    if(!projectId)return c.json({ok:false,error:'projectId krävs.'},400);
    await ensureCategory(c.env.DB);
    const rows=await c.env.DB.prepare('SELECT id,category FROM project_documents WHERE project_id=? ORDER BY sort_order,id').bind(projectId).all();
    return c.json({ok:true,categories:(rows.results as any[]).map(row=>({id:String(row.id),category:row.category==='drawing'?'drawing':row.category==='other'?'other':'unclassified'}))});
  });

  app.put('/api/studio/project-documents/:id/category',async c=>{
    await ensureCategory(c.env.DB);
    const body=await c.req.json<{category?:string}>().catch(()=>({}));
    const category=body.category==='drawing'?'drawing':body.category==='other'?'other':body.category==='unclassified'?'unclassified':'';
    if(!category)return c.json({ok:false,error:'Kategori måste vara drawing, other eller unclassified.'},400);
    const result=await c.env.DB.prepare("UPDATE project_documents SET category=?,updated_at=datetime('now') WHERE id=?").bind(category,c.req.param('id')).run();
    if(!result.meta.changes)return c.json({ok:false,error:'Projektdokumentet hittades inte.'},404);
    return c.json({ok:true,category});
  });
}
