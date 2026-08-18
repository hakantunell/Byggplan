import {clearSession,createSession,ensureAuthSchema,hashPassword,sessionUser,verifyPassword} from './auth-session';

type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;post:(path:string,handler:(c:any)=>unknown)=>void};

async function userProfile(c:any,user:any){
 const global=await c.env.DB.prepare('SELECT role_code FROM global_user_roles WHERE user_id=? ORDER BY role_code').bind(user.id).all();
 const memberships=await c.env.DB.prepare(`SELECT pm.project_id,p.name project_name,pm.status FROM project_memberships pm JOIN projects p ON p.id=pm.project_id WHERE pm.user_id=? AND pm.status='active' ORDER BY p.sort_order,p.name`).bind(user.id).all();
 const roles=await c.env.DB.prepare('SELECT project_id,role_code FROM project_member_roles WHERE user_id=? ORDER BY project_id,role_code').bind(user.id).all();
 const byProject=new Map<string,string[]>();for(const row of roles.results as any[]){const list=byProject.get(String(row.project_id))||[];list.push(String(row.role_code));byProject.set(String(row.project_id),list)}
 return{id:user.id,email:user.email,displayName:user.display_name,globalRoles:(global.results as any[]).map(r=>String(r.role_code)),projects:(memberships.results as any[]).map(r=>({id:String(r.project_id),name:String(r.project_name),roles:byProject.get(String(r.project_id))||[]}))};
}

export function registerAuthRoutes(app:RouteApp){
 app.get('/api/auth/status',async c=>{await ensureAuthSchema(c.env.DB);const row=await c.env.DB.prepare('SELECT COUNT(*) count FROM user_credentials').first<any>();return c.json({ok:true,configured:Number(row?.count||0)>0});});
 app.get('/api/auth/me',async c=>{const user=await sessionUser(c);if(!user)return c.json({ok:false,authenticated:false},401);return c.json({ok:true,authenticated:true,user:await userProfile(c,user)});});
 app.post('/api/auth/bootstrap',async c=>{
  await ensureAuthSchema(c.env.DB);
  const existing=await c.env.DB.prepare('SELECT COUNT(*) count FROM user_credentials').first<any>();if(Number(existing?.count||0)>0)return c.json({ok:false,error:'Inloggningen är redan konfigurerad.'},409);
  const body=await c.req.json<{bootstrapToken?:string;password?:string}>().catch(()=>({}));
  const expected=String(c.env.AUTH_BOOTSTRAP_TOKEN||'');if(!expected||String(body.bootstrapToken||'')!==expected)return c.json({ok:false,error:'Fel bootstrapnyckel.'},403);
  const password=String(body.password||'');if(password.length<10)return c.json({ok:false,error:'Lösenordet måste vara minst 10 tecken.'},400);
  const email=String(c.env.DEV_USER_EMAIL||'').trim();const user=await c.env.DB.prepare("SELECT id,email,display_name,status FROM users WHERE email=? AND status='active'").bind(email).first<any>();if(!user)return c.json({ok:false,error:'Bootstrap-användaren hittades inte.'},404);
  const h=await hashPassword(password);await c.env.DB.prepare(`INSERT INTO user_credentials(user_id,password_salt,password_hash,iterations) VALUES(?,?,?,?)`).bind(user.id,h.salt,h.hash,h.iterations).run();
  const cookie=await createSession(c,String(user.id));c.header('Set-Cookie',cookie);return c.json({ok:true,user:await userProfile(c,user)},201);
 });
 app.post('/api/auth/login',async c=>{
  await ensureAuthSchema(c.env.DB);const body=await c.req.json<{email?:string;password?:string}>().catch(()=>({}));const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
  const row=await c.env.DB.prepare(`SELECT u.id,u.email,u.display_name,u.status,cr.password_salt,cr.password_hash,cr.iterations FROM users u JOIN user_credentials cr ON cr.user_id=u.id WHERE lower(u.email)=? AND u.status='active'`).bind(email).first<any>();
  if(!row||!await verifyPassword(password,String(row.password_salt),String(row.password_hash),Number(row.iterations||210000)))return c.json({ok:false,error:'Fel e-postadress eller lösenord.'},401);
  await c.env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at<=datetime('now')").run();const cookie=await createSession(c,String(row.id));c.header('Set-Cookie',cookie);return c.json({ok:true,user:await userProfile(c,row)});
 });
 app.post('/api/auth/logout',async c=>{c.header('Set-Cookie',await clearSession(c));return c.json({ok:true});});
}
