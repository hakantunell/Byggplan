type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;put:(path:string,handler:(c:any)=>unknown)=>void};

async function ensureProjectInformationSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS project_information (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    address TEXT,
    municipality TEXT,
    building_authority TEXT,
    case_number TEXT,
    building_permit_date TEXT,
    start_notice_date TEXT,
    decision_notes TEXT,
    important_dates_notes TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
}

async function canEdit(db:D1Database,email:string,projectId:string){
  const user=await db.prepare("SELECT id FROM users WHERE email=? AND status='active'").bind(email).first<any>();
  if(!user)return false;
  const global=await db.prepare("SELECT 1 AS ok FROM global_user_roles WHERE user_id=? AND role_code='admin'").bind(user.id).first<any>();
  if(global)return true;
  const role=await db.prepare("SELECT 1 AS ok FROM project_member_roles WHERE user_id=? AND project_id=? AND role_code='BH'").bind(user.id,projectId).first<any>();
  return Boolean(role);
}

async function projectPeople(db:D1Database,projectId:string){
  const rows=await db.prepare(`SELECT u.display_name,u.email,pmr.role_code
    FROM project_member_roles pmr
    JOIN users u ON u.id=pmr.user_id
    JOIN project_memberships pm ON pm.project_id=pmr.project_id AND pm.user_id=pmr.user_id
    WHERE pmr.project_id=? AND pm.status='active' AND u.status='active' AND pmr.role_code IN ('BH','KA')
    ORDER BY pmr.role_code,u.display_name`).bind(projectId).all();
  const people=(rows.results as any[]).map(r=>({name:String(r.display_name||''),email:String(r.email||''),role:String(r.role_code||'')}));
  return {builders:people.filter(p=>p.role==='BH'),ka:people.filter(p=>p.role==='KA')};
}

export function registerProjectInformationRoutes(app:RouteApp){
  app.get('/api/studio/projects/:projectId/information',async c=>{
    const projectId=c.req.param('projectId');
    await ensureProjectInformationSchema(c.env.DB);
    const project=await c.env.DB.prepare('SELECT id,name,property_designation FROM projects WHERE id=?').bind(projectId).first<any>();
    if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);
    const info=await c.env.DB.prepare(`SELECT address,municipality,building_authority,case_number,building_permit_date,start_notice_date,decision_notes,important_dates_notes
      FROM project_information WHERE project_id=?`).bind(projectId).first<any>();
    const people=await projectPeople(c.env.DB,projectId);
    return c.json({ok:true,information:{
      projectId:project.id,projectName:project.name,propertyDesignation:project.property_designation||'',
      address:info?.address||'',municipality:info?.municipality||'',buildingAuthority:info?.building_authority||'',caseNumber:info?.case_number||'',
      buildingPermitDate:info?.building_permit_date||'',startNoticeDate:info?.start_notice_date||'',decisionNotes:info?.decision_notes||'',importantDatesNotes:info?.important_dates_notes||'',
      builders:people.builders,ka:people.ka
    }});
  });

  app.put('/api/studio/projects/:projectId/information',async c=>{
    const projectId=c.req.param('projectId');
    await ensureProjectInformationSchema(c.env.DB);
    const email=String(c.env.DEV_USER_EMAIL||'');
    if(!await canEdit(c.env.DB,email,projectId))return c.json({ok:false,error:'Endast byggherre eller administratör kan ändra projektinformationen.'},403);
    const body=await c.req.json<any>();
    const propertyDesignation=String(body.propertyDesignation||'').trim();
    await c.env.DB.prepare("UPDATE projects SET property_designation=?,updated_at=datetime('now') WHERE id=?").bind(propertyDesignation||null,projectId).run();
    await c.env.DB.prepare(`INSERT INTO project_information(project_id,address,municipality,building_authority,case_number,building_permit_date,start_notice_date,decision_notes,important_dates_notes,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(project_id) DO UPDATE SET address=excluded.address,municipality=excluded.municipality,building_authority=excluded.building_authority,
      case_number=excluded.case_number,building_permit_date=excluded.building_permit_date,start_notice_date=excluded.start_notice_date,
      decision_notes=excluded.decision_notes,important_dates_notes=excluded.important_dates_notes,updated_at=datetime('now')`)
      .bind(projectId,String(body.address||'').trim()||null,String(body.municipality||'').trim()||null,String(body.buildingAuthority||'').trim()||null,
        String(body.caseNumber||'').trim()||null,String(body.buildingPermitDate||'').trim()||null,String(body.startNoticeDate||'').trim()||null,
        String(body.decisionNotes||'').trim()||null,String(body.importantDatesNotes||'').trim()||null).run();
    return c.json({ok:true});
  });
}
