type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void};

export function registerProjectConditionRoutes(app:RouteApp){
  app.get('/api/studio/projects/:projectId/project-conditions',async c=>{
    const projectId=c.req.param('projectId');
    const project=await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
    if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);

    const tables=await c.env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('governing_documents','governing_items')").all();
    if((tables.results as any[]).length<2)return c.json({ok:true,conditions:[]});

    const result=await c.env.DB.prepare(`
      SELECT i.id,i.code,i.description,i.section_code,i.section_title,i.item_type,
             i.handling_status,i.handling_comment,
             d.id governing_document_id,d.title governing_document_title,d.document_type,d.issuer,d.reference,d.imported_at
      FROM governing_items i
      JOIN governing_documents d ON d.id=i.governing_document_id
      WHERE d.project_id=?
        AND i.handling_status='handled'
        AND COALESCE(i.handling_comment,'') LIKE 'Hanteras som ett bestående projektvillkor%'
      ORDER BY d.imported_at,i.sort_order,i.id
    `).bind(projectId).all();

    const conditions=(result.results as any[]).map(row=>({...row,condition_kind:'project_condition'}));
    return c.json({ok:true,conditions});
  });
}
