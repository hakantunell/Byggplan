from pathlib import Path

p=Path('backend/src/auth-routes.ts')
s=p.read_text()

s=s.replace("import {clearSession,createSession,ensureAuthSchema,hashPassword,sessionUser,verifyPassword} from './auth-session';", "import {clearSession,createSession,ensureAuthSchema,hashPassword,sessionUser,verifyPassword} from './auth-session';\nimport {canAdminWorkspace,ensureWorkspaceSchema,isSystemAdmin,userWorkspaceProfile} from './workspace-access';")

start=s.index('async function userProfile(c:any,user:any){')
end=s.index('\nasync function ensureProjectRoleCatalog', start)
new_profile="""async function userProfile(c:any,user:any){
 await ensureWorkspaceSchema(c.env.DB);
 const global=await c.env.DB.prepare('SELECT role_code FROM global_user_roles WHERE user_id=? ORDER BY role_code').bind(user.id).all();
 const workspaceProfile=await userWorkspaceProfile(c.env.DB,user);
 const memberships=workspaceProfile.systemAdmin
  ? await c.env.DB.prepare(`SELECT p.id project_id,p.name project_name,p.workspace_id,w.name workspace_name FROM projects p LEFT JOIN workspaces w ON w.id=p.workspace_id WHERE p.status='active' ORDER BY w.name,p.sort_order,p.name`).all()
  : await c.env.DB.prepare(`SELECT DISTINCT p.id project_id,p.name project_name,p.workspace_id,w.name workspace_name FROM projects p JOIN workspaces w ON w.id=p.workspace_id JOIN workspace_members wm ON wm.workspace_id=w.id WHERE wm.user_id=? AND wm.status='active' AND w.status='active' AND p.status='active' ORDER BY w.name,p.sort_order,p.name`).bind(user.id).all();
 const roles=await c.env.DB.prepare('SELECT project_id,role_code FROM project_member_roles WHERE user_id=? ORDER BY project_id,role_code').bind(user.id).all();
 const byProject=new Map<string,string[]>();for(const row of roles.results as any[]){const list=byProject.get(String(row.project_id))||[];list.push(String(row.role_code));byProject.set(String(row.project_id),list)}
 return{id:user.id,email:user.email,displayName:user.display_name,globalRoles:(global.results as any[]).map(r=>String(r.role_code)),systemAdmin:workspaceProfile.systemAdmin,workspaces:workspaceProfile.workspaces,projects:(memberships.results as any[]).map(r=>({id:String(r.project_id),name:String(r.project_name),workspaceId:r.workspace_id?String(r.workspace_id):'',workspaceName:r.workspace_name?String(r.workspace_name):'',roles:byProject.get(String(r.project_id))||[]}))};
}"""
s=s[:start]+new_profile+s[end:]

old="async function requireAdmin(c:any){const user=await sessionUser(c);if(!user)return null;const role=await c.env.DB.prepare(\"SELECT 1 ok FROM global_user_roles WHERE user_id=? AND role_code='admin'\").bind(user.id).first();return role?user:null}"
new="""async function requireAdmin(c:any,projectId?:string){const user=await sessionUser(c);if(!user)return null;await ensureWorkspaceSchema(c.env.DB);if(await isSystemAdmin(c.env.DB,user))return user;if(projectId){const row=await c.env.DB.prepare('SELECT workspace_id FROM projects WHERE id=?').bind(projectId).first<any>();if(row?.workspace_id&&await canAdminWorkspace(c.env.DB,user,String(row.workspace_id)))return user}return null}"""
assert old in s
s=s.replace(old,new)

s=s.replace("if(!await requireAdmin(c))return c.json({ok:false,error:'Administratörsbehörighet krävs.'},403);await ensureAuthSchema(c.env.DB);await ensureProjectRoleCatalog(c.env.DB);const projectId=String(c.req.param('projectId'));", "const projectId=String(c.req.param('projectId'));if(!await requireAdmin(c,projectId))return c.json({ok:false,error:'Projektyteadministratörsbehörighet krävs.'},403);await ensureAuthSchema(c.env.DB);await ensureProjectRoleCatalog(c.env.DB);")
s=s.replace("app.post('/api/studio/projects/:projectId/members',async c=>{if(!await requireAdmin(c))return c.json({ok:false,error:'Administratörsbehörighet krävs.'},403);await ensureAuthSchema(c.env.DB);await ensureProjectRoleCatalog(c.env.DB);const projectId=String(c.req.param('projectId'));", "app.post('/api/studio/projects/:projectId/members',async c=>{const projectId=String(c.req.param('projectId'));if(!await requireAdmin(c,projectId))return c.json({ok:false,error:'Projektyteadministratörsbehörighet krävs.'},403);await ensureAuthSchema(c.env.DB);await ensureProjectRoleCatalog(c.env.DB);")
s=s.replace("app.put('/api/studio/projects/:projectId/members/:userId',async c=>{\n  if(!await requireAdmin(c))return c.json({ok:false,error:'Administratörsbehörighet krävs.'},403);await ensureProjectRoleCatalog(c.env.DB);const projectId=String(c.req.param('projectId')),userId=String(c.req.param('userId'));", "app.put('/api/studio/projects/:projectId/members/:userId',async c=>{\n  const projectId=String(c.req.param('projectId')),userId=String(c.req.param('userId'));if(!await requireAdmin(c,projectId))return c.json({ok:false,error:'Projektyteadministratörsbehörighet krävs.'},403);await ensureProjectRoleCatalog(c.env.DB);")

# When a project member is created/updated, also ensure workspace membership exists.
needle="await c.env.DB.prepare(`INSERT INTO project_memberships(project_id,user_id,status) VALUES(?,?,'active') ON CONFLICT(project_id,user_id) DO UPDATE SET status='active',updated_at=datetime('now')`).bind(projectId,userId).run();"
replacement=needle+"const wp=await c.env.DB.prepare('SELECT workspace_id FROM projects WHERE id=?').bind(projectId).first<any>();if(wp?.workspace_id)await c.env.DB.prepare(`INSERT INTO workspace_members(workspace_id,user_id,role,status,updated_at) VALUES(?,?,'member','active',datetime('now')) ON CONFLICT(workspace_id,user_id) DO UPDATE SET status='active',updated_at=datetime('now')`).bind(String(wp.workspace_id),userId).run();"
s=s.replace(needle,replacement)

p.write_text(s)
