import type { AuthUser } from './auth-session';

export type WorkspaceRole='workspace_admin'|'member';

async function columnExists(db:D1Database,table:string,column:string){
 const rows=await db.prepare(`PRAGMA table_info(${table})`).all();
 return (rows.results as any[]).some(r=>String(r.name)===column);
}

export async function ensureWorkspaceSchema(db:D1Database){
 await db.prepare(`CREATE TABLE IF NOT EXISTS workspaces(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
 )`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS workspace_members(
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(workspace_id,user_id),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
 )`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS system_admin_emails(
  email TEXT PRIMARY KEY,
  user_id TEXT,
  added_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
 )`).run();
 await db.prepare('CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id,status)').run();
 if(!await columnExists(db,'projects','workspace_id')){
  try{await db.prepare('ALTER TABLE projects ADD COLUMN workspace_id TEXT').run()}catch{}
 }

 // Existing global administrators become initial system administrators.
 try{
  const admins=await db.prepare(`SELECT u.id,u.email,u.display_name FROM users u JOIN global_user_roles g ON g.user_id=u.id WHERE g.role_code='admin' AND u.status='active' ORDER BY u.created_at`).all();
  for(const row of admins.results as any[]){
   const email=String(row.email||'').trim().toLowerCase();if(!email)continue;
   await db.prepare('INSERT OR IGNORE INTO system_admin_emails(email,user_id,added_by) VALUES(?,?,?)').bind(email,String(row.id),String(row.id)).run();
   await db.prepare('UPDATE system_admin_emails SET user_id=? WHERE email=? AND user_id IS NULL').bind(String(row.id),email).run();
  }
 }catch{}

 const wc=await db.prepare('SELECT COUNT(*) count FROM workspaces').first<any>();
 if(Number(wc?.count||0)===0){
  const pc=await db.prepare('SELECT COUNT(*) count FROM projects').first<any>();
  if(Number(pc?.count||0)>0){
   const admin=await db.prepare(`SELECT u.id,u.display_name FROM users u JOIN system_admin_emails s ON lower(s.email)=lower(u.email) WHERE u.status='active' ORDER BY u.created_at LIMIT 1`).first<any>();
   const first=String(admin?.display_name||'Befintliga').trim().split(/\s+/)[0]||'Befintliga';
   const suffix=first.toLocaleLowerCase('sv-SE').endsWith('s')?'':'s';
   const name=`${first}${suffix} projektyta`,id=crypto.randomUUID();
   await db.prepare('INSERT INTO workspaces(id,name,created_by) VALUES(?,?,?)').bind(id,name,admin?.id||null).run();
   await db.prepare('UPDATE projects SET workspace_id=? WHERE workspace_id IS NULL OR trim(workspace_id)=\'\'').bind(id).run();
   if(admin?.id)await db.prepare(`INSERT OR IGNORE INTO workspace_members(workspace_id,user_id,role,status) VALUES(?,?,'workspace_admin','active')`).bind(id,String(admin.id)).run();
  }
 }

 // Preserve existing project users by placing them in the owning workspace.
 try{
  await db.prepare(`INSERT OR IGNORE INTO workspace_members(workspace_id,user_id,role,status)
   SELECT DISTINCT p.workspace_id,pm.user_id,'member','active'
   FROM project_memberships pm JOIN projects p ON p.id=pm.project_id
   WHERE pm.status='active' AND p.workspace_id IS NOT NULL`).run();
 }catch{}
}

export async function isSystemAdmin(db:D1Database,user:AuthUser){
 await ensureWorkspaceSchema(db);
 const email=String(user.email||'').trim().toLowerCase();
 const row=await db.prepare('SELECT 1 ok FROM system_admin_emails WHERE lower(email)=?').bind(email).first();
 return Boolean(row);
}

export async function workspaceRole(db:D1Database,userId:string,workspaceId:string):Promise<WorkspaceRole|null>{
 await ensureWorkspaceSchema(db);
 const row=await db.prepare("SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=? AND status='active'").bind(workspaceId,userId).first<any>();
 const role=String(row?.role||'');return role==='workspace_admin'?'workspace_admin':role==='member'?'member':null;
}

export async function canAccessWorkspace(db:D1Database,user:AuthUser,workspaceId:string){
 if(await isSystemAdmin(db,user))return true;
 return Boolean(await workspaceRole(db,user.id,workspaceId));
}

export async function canAdminWorkspace(db:D1Database,user:AuthUser,workspaceId:string){
 if(await isSystemAdmin(db,user))return true;
 return await workspaceRole(db,user.id,workspaceId)==='workspace_admin';
}

export async function canAccessProject(db:D1Database,user:AuthUser,projectId:string){
 await ensureWorkspaceSchema(db);
 if(await isSystemAdmin(db,user))return true;
 const row=await db.prepare(`SELECT wm.role FROM projects p JOIN workspace_members wm ON wm.workspace_id=p.workspace_id WHERE p.id=? AND wm.user_id=? AND wm.status='active'`).bind(projectId,user.id).first();
 return Boolean(row);
}

export async function userWorkspaceProfile(db:D1Database,user:AuthUser){
 await ensureWorkspaceSchema(db);
 const systemAdmin=await isSystemAdmin(db,user);
 const rows=systemAdmin
  ? await db.prepare(`SELECT w.id,w.name,w.status,'system_admin' role FROM workspaces w WHERE w.status='active' ORDER BY w.name`).all()
  : await db.prepare(`SELECT w.id,w.name,w.status,wm.role FROM workspace_members wm JOIN workspaces w ON w.id=wm.workspace_id WHERE wm.user_id=? AND wm.status='active' AND w.status='active' ORDER BY w.name`).bind(user.id).all();
 const workspaces=(rows.results as any[]).map(r=>({id:String(r.id),name:String(r.name),role:String(r.role)}));
 return{systemAdmin,workspaces};
}

export async function projectIdFromRequest(db:D1Database,request:Request):Promise<string|null>{
 const url=new URL(request.url);
 const q=url.searchParams.get('projectId');if(q)return q;
 let m=url.pathname.match(/^\/api\/studio\/projects\/([^/]+)/)||url.pathname.match(/^\/api\/projects\/([^/]+)/);if(m)return decodeURIComponent(m[1]);
 // Resource routes that do not expose projectId directly.
 const lookups:Array<[RegExp,string]>= [
  [/^\/api\/(?:studio\/)?project-documents\/([^/]+)/,'SELECT project_id FROM project_documents WHERE id=?'],
  [/^\/api\/(?:studio\/)?project-document-files\/([^/]+)/,'SELECT project_id FROM project_document_attachments WHERE id=?'],
  [/^\/api\/studio\/governing-documents\/([^/]+)/,'SELECT project_id FROM governing_documents WHERE id=?'],
  [/^\/api\/activities\/([^/]+)/,`SELECT wa.project_id FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE a.id=?`],
  [/^\/api\/tasks\/([^/]+)/,`SELECT wa.project_id FROM tasks t JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE t.id=?`]
 ];
 for(const [re,sql] of lookups){m=url.pathname.match(re);if(!m)continue;try{const row=await db.prepare(sql).bind(decodeURIComponent(m[1])).first<any>();if(row?.project_id)return String(row.project_id)}catch{} }
 if(request.method!=='GET'&&request.headers.get('content-type')?.includes('application/json')){
  try{const body=await request.clone().json() as any;if(body?.projectId)return String(body.projectId)}catch{}
 }
 return null;
}
