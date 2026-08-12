import { ensureMasterV15 } from './master-project-v2-upgrade-routes-v15';

type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void};

async function tableExists(db:D1Database,name:string){return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first())}

export function registerProjectMasterDiagnosticsRoutes(app:RouteApp){
  app.get('/api/studio/projects/:projectId/master-diagnostics',async c=>{
    const projectId=c.req.param('projectId');
    const project=await c.env.DB.prepare('SELECT id,name FROM projects WHERE id=?').bind(projectId).first<any>();
    if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);
    if(!await tableExists(c.env.DB,'project_master_snapshots'))return c.json({ok:true,diagnostics:{hasSnapshot:false,projectId,projectName:String(project.name||'')}});

    const snapshotBase=await c.env.DB.prepare('SELECT master_project_id,master_project_code FROM project_master_snapshots WHERE project_id=?').bind(projectId).first<any>();
    if(!snapshotBase)return c.json({ok:true,diagnostics:{hasSnapshot:false,projectId,projectName:String(project.name||'')}});
    if(String(snapshotBase.master_project_code)==='fritidshus-v2'){
      let master=await c.env.DB.prepare('SELECT id,version FROM master_projects WHERE id=?').bind(snapshotBase.master_project_id).first<any>();
      if(!master)master=await c.env.DB.prepare("SELECT id,version FROM master_projects WHERE code='fritidshus-v2'").first<any>();
      if(master&&Number(master.version||0)<15)await ensureMasterV15(c.env.DB,String(master.id));
    }

    const snapshot=await c.env.DB.prepare(`SELECT s.master_project_id,s.master_project_code,s.master_project_version,s.created_at,m.name master_project_name,m.version current_master_version
      FROM project_master_snapshots s LEFT JOIN master_projects m ON m.id=s.master_project_id WHERE s.project_id=?`).bind(projectId).first<any>();
    if(!snapshot)return c.json({ok:true,diagnostics:{hasSnapshot:false,projectId,projectName:String(project.name||'')}});

    let selectedModuleCodes:string[]=[];
    if(await tableExists(c.env.DB,'project_master_module_selections')){
      const rows=await c.env.DB.prepare('SELECT module_code FROM project_master_module_selections WHERE project_id=? ORDER BY module_code').bind(projectId).all();
      selectedModuleCodes=(rows.results as any[]).map(r=>String(r.module_code));
    }

    const activityCount=await c.env.DB.prepare(`SELECT COUNT(*) count FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id LEFT JOIN activity_contexts ac ON ac.activity_id=a.id WHERE wa.project_id=? AND COALESCE(ac.applicability,'always')<>'deprecated'`).bind(projectId).first<any>();
    let linkedActivityCount=0;
    if(await tableExists(c.env.DB,'project_master_node_links')){
      const linked=await c.env.DB.prepare(`SELECT COUNT(*) count FROM project_master_node_links l JOIN activities a ON a.id=l.entity_id LEFT JOIN activity_contexts ac ON ac.activity_id=a.id WHERE l.project_id=? AND l.entity_type='activity' AND COALESCE(ac.applicability,'always')<>'deprecated'`).bind(projectId).first<any>();
      linkedActivityCount=Number(linked?.count||0);
    }

    const canonicalTitles=[
      'Registrera BAS-P','Registrera BAS-U','Beställ och genomför lägeskontroll samt spara mätintyg',
      'Säkerställ att erforderlig geoteknisk utredning finns','Kontrollera radonförutsättningar och eventuell radonklass',
      'Kontrollera att fuktsäkerhetsprojektering har beaktats i projekteringen','Samla ifylld och signerad kontrollplan',
      'Samla egenkontroller och intyg för installationer och brandskydd','Samla ventilationsintyg för slutbesked',
      'Bevaka avloppstillståndets start- och färdigställandefrister','Dokumentera sakkunskap hos den person som utför avloppsinstallationen',
      'Fotografera varje installerad brunn','Fotografera ledningar före återfyllning','Fuktskydda material och konstruktion under byggtid'
    ];
    const placeholders=canonicalTitles.map(()=>'?').join(',');
    const present=await c.env.DB.prepare(`SELECT a.title FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id LEFT JOIN activity_contexts ac ON ac.activity_id=a.id WHERE wa.project_id=? AND COALESCE(ac.applicability,'always')<>'deprecated' AND a.title IN (${placeholders})`).bind(projectId,...canonicalTitles).all();
    const presentSet=new Set((present.results as any[]).map(r=>String(r.title)));
    const presentCanonicalTitles=canonicalTitles.filter(t=>presentSet.has(t));
    const missingCanonicalTitles=canonicalTitles.filter(t=>!presentSet.has(t));

    return c.json({ok:true,diagnostics:{
      hasSnapshot:true,projectId,projectName:String(project.name||''),
      masterProjectId:String(snapshot.master_project_id||''),masterProjectCode:String(snapshot.master_project_code||''),
      masterProjectName:String(snapshot.master_project_name||''),snapshotVersion:Number(snapshot.master_project_version||0),
      currentMasterVersion:Number(snapshot.current_master_version||0),snapshotCreatedAt:String(snapshot.created_at||''),
      selectedModuleCodes,activityCount:Number(activityCount?.count||0),linkedActivityCount,
      canonicalCheck:{present:presentCanonicalTitles,missing:missingCanonicalTitles,presentCount:presentCanonicalTitles.length,total:canonicalTitles.length}
    }});
  });
}
