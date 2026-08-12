type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void};
function norm(v:unknown){return String(v||'').toLocaleLowerCase('sv-SE').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim()}
function isProjectCondition(row:any){
  const type=String(row.item_type||'').toLowerCase(),t=norm(row.description);
  if(type==='condition')return true;
  if(type==='information'&&/får inte|ska |bör |endast|om /.test(t))return true;
  return /får inte|ska vara|ska bestå|ska hållas|ska rymmas|ska placeras|ska förväntas|marknivå.*tomtgräns|risk för smitta|dubbla ångtäta|ångtäta skikt|om .*påträffas|om .*behöver tas i anspråk|om infart .* dike/.test(t);
}
export function registerProjectConditionRoutes(app:RouteApp){
  app.get('/api/studio/projects/:projectId/project-conditions',async c=>{
    const projectId=c.req.param('projectId');const project=await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);
    const tables=await c.env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('governing_documents','governing_items')").all();if((tables.results as any[]).length<2)return c.json({ok:true,conditions:[]});
    const result=await c.env.DB.prepare(`SELECT i.id,i.code,i.description,i.section_code,i.section_title,i.item_type,d.id governing_document_id,d.title governing_document_title,d.document_type,d.issuer,d.reference,d.imported_at FROM governing_items i JOIN governing_documents d ON d.id=i.governing_document_id WHERE d.project_id=? ORDER BY d.imported_at,i.sort_order,i.id`).bind(projectId).all();
    const conditions=(result.results as any[]).filter(isProjectCondition).map(row=>({...row,condition_kind:'project_condition'}));
    return c.json({ok:true,conditions});
  });
}
