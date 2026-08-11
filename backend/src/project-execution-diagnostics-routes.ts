type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void};

async function tableExists(db:D1Database,table:string){
  const row=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
  return Boolean(row);
}

export function registerProjectExecutionDiagnosticsRoutes(app:RouteApp){
  app.get('/api/project-execution-contexts-diagnostics',async c=>{
    let projectId=String(c.req.query('projectId')||'').trim();
    const projectsResult=await c.env.DB.prepare('SELECT id,name,status FROM projects ORDER BY sort_order,name').all();
    const projects=projectsResult.results as any[];
    if(!projectId){
      if(projects.length===1){
        projectId=String(projects[0].id);
      }else{
        return c.json({ok:false,error:'projectId krävs när databasen innehåller flera projekt.',projects},400);
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
    const hasLegacyDocs=await tableExists(c.env.DB,'control_plan_documents');
    const hasLegacyPoints=await tableExists(c.env.DB,'control_plan_points');

    let activeDocuments=0,governingItems=0,explicitLinks=0,classifications=0,executionRows=0,legacyDocuments=0,legacyPoints=0;
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
    if(hasLegacyDocs){
      const row=await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM control_plan_documents WHERE project_id=?`).bind(projectId).first<any>();
      legacyDocuments=Number(row?.count||0);
    }
    if(hasLegacyDocs&&hasLegacyPoints){
      const row=await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM control_plan_points p
        JOIN control_plan_documents d ON d.id=p.control_plan_id
        WHERE d.project_id=?`).bind(projectId).first<any>();
      legacyPoints=Number(row?.count||0);
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

    let legacySample:any[]=[];
    if(hasLegacyDocs&&hasLegacyPoints){
      const rows=await c.env.DB.prepare(`SELECT p.code,p.description,p.responsible_role,p.point_type,d.title AS document_title,d.status
        FROM control_plan_points p
        JOIN control_plan_documents d ON d.id=p.control_plan_id
        WHERE d.project_id=?
        ORDER BY d.imported_at,p.sort_order LIMIT 20`).bind(projectId).all();
      legacySample=rows.results as any[];
    }

    const allProjects:any[]=[];
    for(const project of projects){
      let docs=0,items=0,legacyDocs=0,legacyPts=0;
      if(hasDocs){
        const row=await c.env.DB.prepare('SELECT COUNT(*) AS count FROM governing_documents WHERE project_id=?').bind(project.id).first<any>();
        docs=Number(row?.count||0);
      }
      if(hasDocs&&hasItems){
        const row=await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM governing_items i JOIN governing_documents d ON d.id=i.governing_document_id WHERE d.project_id=?`).bind(project.id).first<any>();
        items=Number(row?.count||0);
      }
      if(hasLegacyDocs){
        const row=await c.env.DB.prepare('SELECT COUNT(*) AS count FROM control_plan_documents WHERE project_id=?').bind(project.id).first<any>();
        legacyDocs=Number(row?.count||0);
      }
      if(hasLegacyDocs&&hasLegacyPoints){
        const row=await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM control_plan_points p JOIN control_plan_documents d ON d.id=p.control_plan_id WHERE d.project_id=?`).bind(project.id).first<any>();
        legacyPts=Number(row?.count||0);
      }
      allProjects.push({id:project.id,name:project.name,status:project.status,governingDocuments:docs,governingItems:items,legacyDocuments:legacyDocs,legacyPoints:legacyPts});
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
        executionRows,
        legacyDocuments,
        legacyPoints
      },
      tables:{
        governing_documents:hasDocs,
        governing_items:hasItems,
        governing_item_activity_links:hasLinks,
        activity_classifications:hasClassifications,
        activity_execution_contexts:hasExecution,
        control_plan_documents:hasLegacyDocs,
        control_plan_points:hasLegacyPoints
      },
      sample,
      legacySample,
      allProjects
    });
  });
}
