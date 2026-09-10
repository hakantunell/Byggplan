import {createSession,hashPassword,sessionUser} from './auth-session';

type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};

export function registerAuthPasswordRoutes(app:RouteApp){
  app.post('/api/auth/change-password',async c=>{
    const user=await sessionUser(c);
    if(!user)return c.json({ok:false,error:'Du måste vara inloggad för att byta lösenord.'},401);

    const body=await c.req.json<{password?:string;confirmPassword?:string}>().catch(()=>({}));
    const password=String(body.password||'');
    const confirmPassword=String(body.confirmPassword||'');
    if(password.length<10)return c.json({ok:false,error:'Lösenordet måste vara minst 10 tecken.'},400);
    if(password!==confirmPassword)return c.json({ok:false,error:'Lösenorden är inte lika.'},400);

    const h=await hashPassword(password);
    await c.env.DB.prepare(`INSERT INTO user_credentials(user_id,password_salt,password_hash,iterations,updated_at)
      VALUES(?,?,?,?,datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        password_salt=excluded.password_salt,
        password_hash=excluded.password_hash,
        iterations=excluded.iterations,
        updated_at=datetime('now')`)
      .bind(String(user.id),h.salt,h.hash,h.iterations).run();

    // Revoke all old sessions. The current browser immediately receives a fresh session.
    await c.env.DB.prepare('DELETE FROM auth_sessions WHERE user_id=?').bind(String(user.id)).run();
    const cookie=await createSession(c,String(user.id));
    c.header('Set-Cookie',cookie);
    return c.json({ok:true});
  });
}
