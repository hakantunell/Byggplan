type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void};

async function tableExists(db:D1Database,table:string){
  const row=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
  return Boolean(row);
}

export function registerProjectExecutionDiagnosticsRoutes(app:RouteApp){
  app.get('/api/project-execution-contexts-diagnostics',async c=>{
    let projectId=String(c.req.query('projectId')||'').trim();
    if(!projectId){
      const projects=await c.env.DB.prepare('SELECT id,name FROM projects ORDER BY sort_order,name').all();
      if((projects.results as any[]).length===1){
        projectId=String((projects.results as any[])[0].id);
      }else{
        return c.json({ok:false,error:'projectId krävs när databasen innehåller flera projekt.',projects:projects.results},400);
      }
    }

    const activityCount=await c.env.DB.prepare(`SELECT COUNT(*) AS count
      FROM activities a
      JOIN tasks t ON t.id=a.task_id
      JOIN work_sections ws ON ws.id=t.work_section_id
      JOIN work_areas wa ON wa.id=ws.work_area_id
      WHERE wa.project_id=?`).bind(projectId).first<any>();

    const hasDocs=await tableExists(c.env.DB,'governing_documents');
    const hasItems=await tableExists(c.env.DB,'governing_items');
    const hasLinks=await tableExists(c.env.DB,'governing_item_activity_links');
    const hasClassifications=await tableExists(c.env.DB,'activity_classifications');
    const hasExecution=await tableExists(c.env.DB,'activity_execution_contexts');

    let activeDocuments=0,governingItems=0,explicitLinks=0,classifications=0,executionRows=0;
    if(hasDocs){
      const row=await c.env.DB.prepare("SELECT COUNT(*) AS count FROM governing_documents WHERE project_id=? AND status='active'").bind(projectId).first<any>();
      activeDocuments=Number(row?.count||0);
    }
    if(hasDocs&&hasItems){
      const row=await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM governing_items i
        JOIN governing_documents d ON d.id=i.governing_document_id
        WHERE d.project_id=? AND d.status='active'`).bind(projectId).first<any>();
      governingItems=Number(row?.count||0);
    }
    if(hasLinks){
      const row=await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM governing_item_activity_links l
        JOIN activities a ON a.id=l.activity_id
        JOIN tasks t ON t.id=a.task_id
        JOIN work_sections ws ON ws.id=t.work_section_id
        JOIN work_areas wa ON wa.id=ws.work_area_id
        WHERE wa.project_id=?`).bind(projectId).first<any>();
      explicitLinks=Number(row?.count||0);
    }
    if(hasClassifications){
      const row=await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM activity_classifications ac
        JOIN activities a ON a.id=ac.activity_id
        JOIN tasks t ON t.id=a.task_id
        JOIN work_sections ws ON ws.id=t.work_section_id
        JOIN work_areas wa ON wa.id=ws.work_area_id
        WHERE wa.project_id=? AND ac.category IN ('control_plan','requirement')`).bind(projectId).first<any>();
      classifications=Number(row?.count||0);
    }
    if(hasExecution){
      const row=await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM activity_execution_contexts ec
        JOIN activities a ON a.id=ec.activity_id
        JOIN tasks t ON t.id=a.task_id
        JOIN work_sections ws ON ws.id=t.work_section_id
        JOIN work_areas wa ON wa.id=ws.work_area_id
        WHERE wa.project_id=?`).bind(projectId).first<any>();
      executionRows=Number(row?.count||0);
    }

    let sample:any[]=[];
    if(hasDocs&&hasItems){
      const rows=await c.env.DB.prepare(`SELECT i.code,i.description,i.responsible_role,d.document_type,d.title AS document_title,d.status
        FROM governing_items i
        JOIN governing_documents d ON d.id=i.governing_document_id
        WHERE d.project_id=?
        ORDER BY d.imported_at,i.sort_order LIMIT 20`).bind(projectId).all();
      sample=rows.results as any[];
    }

    return c.json({
      ok:true,
      projectId,
      counts:{
        activities:Number(activityCount?.count||0),
        activeDocuments,
        governingItems,
        explicitLinks,
        classifications,
        executionRows
      },
      tables:{
        governing_documents:hasDocs,
        governing_items:hasItems,
        governing_item_activity_links:hasLinks,
        activity_classifications:hasClassifications,
        activity_execution_contexts:hasExecution
      },
      sample
    });
  });
}
