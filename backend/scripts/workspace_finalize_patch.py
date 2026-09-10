from pathlib import Path

# 1. Seed legacy global admins only once. Afterwards the system-admin email list is authoritative.
p=Path('backend/src/workspace-access.ts')
s=p.read_text()
old=""" try{
  const admins=await db.prepare(`SELECT u.id,u.email,u.display_name FROM users u JOIN global_user_roles g ON g.user_id=u.id WHERE g.role_code='admin' AND u.status='active' ORDER BY u.created_at`).all();
  for(const row of admins.results as any[]){
   const email=String(row.email||'').trim().toLowerCase();if(!email)continue;
   await db.prepare('INSERT OR IGNORE INTO system_admin_emails(email,user_id,added_by) VALUES(?,?,?)').bind(email,String(row.id),String(row.id)).run();
   await db.prepare('UPDATE system_admin_emails SET user_id=? WHERE email=? AND user_id IS NULL').bind(String(row.id),email).run();
  }
 }catch{}"""
new=""" try{
  const seeded=await db.prepare('SELECT COUNT(*) count FROM system_admin_emails').first<any>();
  if(Number(seeded?.count||0)===0){
   const admins=await db.prepare(`SELECT u.id,u.email,u.display_name FROM users u JOIN global_user_roles g ON g.user_id=u.id WHERE g.role_code='admin' AND u.status='active' ORDER BY u.created_at`).all();
   for(const row of admins.results as any[]){
    const email=String(row.email||'').trim().toLowerCase();if(!email)continue;
    await db.prepare('INSERT OR IGNORE INTO system_admin_emails(email,user_id,added_by) VALUES(?,?,?)').bind(email,String(row.id),String(row.id)).run();
   }
  }
 }catch{}"""
assert old in s
s=s.replace(old,new,1)
p.write_text(s)

# 2. New projects must be created inside a workspace.
p=Path('backend/src/master-project-clone-routes.ts')
s=p.read_text()
s=s.replace("type CloneBody={name?:string;propertyDesignation?:string;selectedModuleCodes?:string[];deliveryMode?:string};", "import {ensureWorkspaceSchema} from './workspace-access';\n\ntype CloneBody={name?:string;propertyDesignation?:string;selectedModuleCodes?:string[];deliveryMode?:string;workspaceId?:string};",1)
old=""" app.post('/api/studio/master-projects/:masterProjectId/create-project',async c=>{
  await ensureSnapshotSchema(c.env.DB);const masterProjectId=c.req.param('masterProjectId');const body=await c.req.json<CloneBody>().catch(()=>({}));const name=text(body.name),propertyDesignation=text(body.propertyDesignation),mode=deliveryMode(body.deliveryMode),requestedCodes=[...new Set((body.selectedModuleCodes||[]).map(text).filter(Boolean))];if(!name)return c.json({ok:false,error:'Projektnamn krävs.'},400);"""
new=""" app.post('/api/studio/master-projects/:masterProjectId/create-project',async c=>{
  await ensureSnapshotSchema(c.env.DB);await ensureWorkspaceSchema(c.env.DB);const masterProjectId=c.req.param('masterProjectId');const body=await c.req.json<CloneBody>().catch(()=>({}));const name=text(body.name),propertyDesignation=text(body.propertyDesignation),mode=deliveryMode(body.deliveryMode),requestedCodes=[...new Set((body.selectedModuleCodes||[]).map(text).filter(Boolean))];if(!name)return c.json({ok:false,error:'Projektnamn krävs.'},400);
  let workspaceId=text(body.workspaceId);if(!workspaceId){const rows=await c.env.DB.prepare("SELECT id FROM workspaces WHERE status='active' ORDER BY created_at").all();if(rows.results.length===1)workspaceId=String((rows.results[0] as any).id);else return c.json({ok:false,error:'Välj vilken projektyta projektet ska skapas i.'},400)}const workspace=await c.env.DB.prepare("SELECT id FROM workspaces WHERE id=? AND status='active'").bind(workspaceId).first();if(!workspace)return c.json({ok:false,error:'Projektytan hittades inte eller är inte aktiv.'},404);"""
assert old in s
s=s.replace(old,new,1)
old="await c.env.DB.prepare(`INSERT INTO projects(id,name,property_designation,status,sort_order,created_at,updated_at) VALUES(?,?,?,'active',?,datetime('now'),datetime('now'))`).bind(projectId,name,propertyDesignation||null,Number(order?.next_order??10)).run();"
new="await c.env.DB.prepare(`INSERT INTO projects(id,name,property_designation,status,sort_order,workspace_id,created_at,updated_at) VALUES(?,?,?,'active',?,?,datetime('now'),datetime('now'))`).bind(projectId,name,propertyDesignation||null,Number(order?.next_order??10),workspaceId).run();"
assert old in s
s=s.replace(old,new,1)
p.write_text(s)

# 3. Workspace admins can only create projects inside workspaces they administer.
p=Path('backend/src/auth-entry.ts')
s=p.read_text()
s=s.replace("import {canAccessProject,ensureWorkspaceSchema,isSystemAdmin,projectIdFromRequest} from './workspace-access';", "import {canAccessProject,canAdminWorkspace,ensureWorkspaceSchema,isSystemAdmin,projectIdFromRequest} from './workspace-access';",1)
needle="""  const scopedProjectId=await projectIdFromRequest(env.DB,request);
  if(scopedProjectId&&!await canAccessProject(env.DB,user,scopedProjectId))return jsonResponse({ok:false,error:'Du har inte åtkomst till den här projektytan eller projektet.'},403);"""
replacement="""  const scopedProjectId=await projectIdFromRequest(env.DB,request);
  if(scopedProjectId&&!await canAccessProject(env.DB,user,scopedProjectId))return jsonResponse({ok:false,error:'Du har inte åtkomst till den här projektytan eller projektet.'},403);
  if(request.method==='POST'&&/^\/api\/studio\/master-projects\/[^/]+\/create-project$/.test(url.pathname)&&!systemAdmin){
   const body=await request.clone().json().catch(()=>({})) as any;const workspaceId=String(body?.workspaceId||'');
   if(!workspaceId||!await canAdminWorkspace(env.DB,user,workspaceId))return jsonResponse({ok:false,error:'Du får bara skapa projekt i en projektyta som du administrerar.'},403);
  }"""
assert needle in s
s=s.replace(needle,replacement,1)
p.write_text(s)
