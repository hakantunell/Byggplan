from pathlib import Path

p=Path('backend/src/auth-routes.ts')
s=p.read_text()
start=s.index('async function userProfile(c:any,user:any){')
end=s.index('\nasync function ensureProjectRoleCatalog', start)
new="""async function userProfile(c:any,user:any){
 let globalRoles:string[]=[];
 try{
  const global=await c.env.DB.prepare('SELECT role_code FROM global_user_roles WHERE user_id=? ORDER BY role_code').bind(user.id).all();
  globalRoles=(global.results as any[]).map(r=>String(r.role_code));
 }catch(error){console.error('Global role lookup failed while building auth profile',error)}
 const workspaceProfile=await userWorkspaceProfile(c.env.DB,user);
 let membershipRows:any[]=[];
 try{
  const memberships=workspaceProfile.systemAdmin
   ? await c.env.DB.prepare(`SELECT p.id project_id,p.name project_name,p.workspace_id,w.name workspace_name FROM projects p LEFT JOIN workspaces w ON w.id=p.workspace_id WHERE p.status='active' ORDER BY w.name,p.sort_order,p.name`).all()
   : await c.env.DB.prepare(`SELECT DISTINCT p.id project_id,p.name project_name,p.workspace_id,w.name workspace_name FROM projects p JOIN workspaces w ON w.id=p.workspace_id JOIN workspace_members wm ON wm.workspace_id=w.id WHERE wm.user_id=? AND wm.status='active' AND w.status='active' AND p.status='active' ORDER BY w.name,p.sort_order,p.name`).bind(user.id).all();
  membershipRows=memberships.results as any[];
 }catch(error){console.error('Project membership lookup failed while building auth profile',error)}
 const byProject=new Map<string,string[]>();
 try{
  const roles=await c.env.DB.prepare('SELECT project_id,role_code FROM project_member_roles WHERE user_id=? ORDER BY project_id,role_code').bind(user.id).all();
  for(const row of roles.results as any[]){const list=byProject.get(String(row.project_id))||[];list.push(String(row.role_code));byProject.set(String(row.project_id),list)}
 }catch(error){console.error('Project role lookup failed while building auth profile',error)}
 return{id:user.id,email:user.email,displayName:user.display_name,globalRoles,systemAdmin:workspaceProfile.systemAdmin,workspaces:workspaceProfile.workspaces,projects:membershipRows.map(r=>({id:String(r.project_id),name:String(r.project_name),workspaceId:r.workspace_id?String(r.workspace_id):'',workspaceName:r.workspace_name?String(r.workspace_name):'',roles:byProject.get(String(r.project_id))||[]}))};
}
"""
s=s[:start]+new+s[end:]
p.write_text(s)
# trigger workflow
