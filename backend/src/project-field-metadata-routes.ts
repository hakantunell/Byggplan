type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void};

async function tableExists(db:D1Database,table:string){
  const row=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
  return Boolean(row);
}

export function registerProjectFieldMetadataRoutes(app:RouteApp){
  app.get('/api/project-field-metadata',async c=>{
    const projectId=c.req.query('projectId');
    if(!projectId)return c.json({ok:false,error:'projectId krävs.'},400);

    const hasExecution=await tableExists(c.env.DB,'activity_execution_contexts');
    const hasLinks=await tableExists(c.env.DB,'governing_item_activity_links');
    const hasItems=await tableExists(c.env.DB,'governing_items');
    const hasDocuments=await tableExists(c.env.DB,'governing_documents');

    const executionJoin=hasExecution
      ? 'LEFT JOIN activity_execution_contexts ec ON ec.activity_id=a.id'
      : '';
    const contextExpr=hasExecution?"COALESCE(ec.context,'field')":"'field'";
    const executorExpr=hasExecution?"COALESCE(ec.executor_type,'self')":"'self'";
    const executorLabelExpr=hasExecution?'ec.executor_label':'NULL';

    const rows=await c.env.DB.prepare(`SELECT
        a.id AS activity_id,
        ${contextExpr} AS context,
        ${executorExpr} AS executor_type,
        ${executorLabelExpr} AS executor_label
      FROM activities a
      JOIN tasks t ON t.id=a.task_id
      JOIN work_sections ws ON ws.id=t.work_section_id
      JOIN work_areas wa ON wa.id=ws.work_area_id
      ${executionJoin}
      WHERE wa.project_id=?
      ORDER BY wa.sort_order,ws.sort_order,t.sort_order,a.sort_order`).bind(projectId).all();

    const byActivity=new Map<string,any>();
    for(const row of rows.results as any[]){
      byActivity.set(String(row.activity_id),{
        activity_id:String(row.activity_id),
        context:String(row.context||'field'),
        executor_type:String(row.executor_type||'self'),
        executor_label:row.executor_label??null,
        governing_documents:[] as any[]
      });
    }

    let linkCount=0;
    if(hasLinks&&hasItems&&hasDocuments){
      const links=await c.env.DB.prepare(`SELECT
          l.activity_id,
          d.id AS document_id,d.document_type,d.title AS document_title,d.issuer,
          i.id AS item_id,i.code AS item_code,i.description AS item_description,i.responsible_role
        FROM governing_item_activity_links l
        JOIN governing_items i ON i.id=l.governing_item_id
        JOIN governing_documents d ON d.id=i.governing_document_id
        JOIN activities a ON a.id=l.activity_id
        JOIN tasks t ON t.id=a.task_id
        JOIN work_sections ws ON ws.id=t.work_section_id
        JOIN work_areas wa ON wa.id=ws.work_area_id
        WHERE wa.project_id=?
        ORDER BY l.activity_id,d.imported_at,i.sort_order`).bind(projectId).all();

      for(const row of links.results as any[]){
        const item=byActivity.get(String(row.activity_id));
        if(!item)continue;
        item.governing_documents.push({
          documentId:row.document_id,
          documentType:row.document_type,
          documentTitle:row.document_title,
          issuer:row.issuer,
          itemId:row.item_id,
          code:row.item_code,
          label:row.item_description,
          responsibleRole:row.responsible_role,
          mappingSource:'explicit'
        });
        linkCount+=1;
      }
    }

    return c.json({
      ok:true,
      items:[...byActivity.values()],
      diagnostics:{activities:byActivity.size,links:linkCount,hasExecution,hasLinks,hasItems,hasDocuments}
    });
  });
}
