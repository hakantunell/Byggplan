export type AuthUser={id:string;email:string;display_name:string;status:string};
const COOKIE='bp_session';
const SESSION_DAYS=14;

function bytesToHex(bytes:Uint8Array){return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('')}
function bytesToBase64(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}
function base64ToBytes(value:string){const s=atob(value);return Uint8Array.from(s,c=>c.charCodeAt(0))}
async function sha256(value:string){const data=new TextEncoder().encode(value);return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256',data)))}

export async function ensureAuthSchema(db:D1Database){
 await db.prepare(`CREATE TABLE IF NOT EXISTS user_credentials(
   user_id TEXT PRIMARY KEY,
   password_salt TEXT NOT NULL,
   password_hash TEXT NOT NULL,
   iterations INTEGER NOT NULL DEFAULT 210000,
   created_at TEXT NOT NULL DEFAULT (datetime('now')),
   updated_at TEXT NOT NULL DEFAULT (datetime('now')),
   FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
 )`).run();
 await db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions(
   id TEXT PRIMARY KEY,
   user_id TEXT NOT NULL,
   token_hash TEXT NOT NULL UNIQUE,
   expires_at TEXT NOT NULL,
   created_at TEXT NOT NULL DEFAULT (datetime('now')),
   last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
   FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
 )`).run();
 await db.prepare('CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id,expires_at)').run();
}

export async function authConfigured(db:D1Database){
 try{const row=await db.prepare('SELECT COUNT(*) count FROM user_credentials').first<any>();return Number(row?.count||0)>0}catch{return false}
}

export async function hashPassword(password:string,salt?:Uint8Array,iterations=210000){
 const actualSalt=salt||crypto.getRandomValues(new Uint8Array(16));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:actualSalt,iterations},key,256);
 return{salt:bytesToBase64(actualSalt),hash:bytesToBase64(new Uint8Array(bits)),iterations};
}

export async function verifyPassword(password:string,saltBase64:string,expectedHash:string,iterations:number){
 const result=await hashPassword(password,base64ToBytes(saltBase64),iterations);
 const a=new TextEncoder().encode(result.hash),b=new TextEncoder().encode(expectedHash);
 if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}

function cookieValue(c:any){const raw=String(c.req.header('Cookie')||'');for(const part of raw.split(';')){const [name,...rest]=part.trim().split('=');if(name===COOKIE)return decodeURIComponent(rest.join('='))}return''}

export async function sessionUser(c:any):Promise<AuthUser|null>{
 const token=cookieValue(c);if(!token)return null;
 try{
  const tokenHash=await sha256(token);
  const user=await c.env.DB.prepare(`SELECT u.id,u.email,u.display_name,u.status,s.id session_id
    FROM auth_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>datetime('now') AND u.status='active'`).bind(tokenHash).first<any>();
  if(!user)return null;
  c.executionCtx?.waitUntil?.(c.env.DB.prepare("UPDATE auth_sessions SET last_seen_at=datetime('now') WHERE id=?").bind(user.session_id).run());
  return{id:String(user.id),email:String(user.email),display_name:String(user.display_name),status:String(user.status)};
 }catch{return null}
}

export async function createSession(c:any,userId:string){
 await ensureAuthSchema(c.env.DB);
 const token=bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
 const tokenHash=await sha256(token),id=crypto.randomUUID();
 await c.env.DB.prepare(`INSERT INTO auth_sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,datetime('now',?))`).bind(id,userId,tokenHash,`+${SESSION_DAYS} days`).run();
 return`${COOKIE}=${encodeURIComponent(token)}; Path=/; Domain=.byggplan.tunell.org; Max-Age=${SESSION_DAYS*86400}; HttpOnly; Secure; SameSite=Lax`;
}

export async function clearSession(c:any){
 const token=cookieValue(c);if(token){try{await c.env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await sha256(token)).run()}catch{}}
 return`${COOKIE}=; Path=/; Domain=.byggplan.tunell.org; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
