type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;post:(path:string,handler:(c:any)=>unknown)=>void};
type TableInfo={name:string;pk:number};
type ForeignKey={table:string;from:string;to:string};
type SystemBackup={format:string;version:number;exportedAt:string;scope:'system-master-data';entities:Record<string,Record<string,unknown>[]>};
const FORMAT='byggplan-system-backup';
const MAX_BIND_PARAMS=80;
const SCHEMA_BATCH_SIZE=100;

function ident(v:string){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v))throw new Error(`Ogiltigt databasnamn: ${v}`);return `"${v}"`}
async function requireAdmin(c:any){const email=String(c.env.DEV_USER_EMAIL||'');if(!email)return false;const row=await c.env.DB.prepare(`SELECT 1 AS ok FROM users u JOIN global_user_roles r ON r.user_id=u.id WHERE u.email=? AND u.status='active' AND r.role_code='admin' LIMIT 1`).bind(email).first();return Boolean(row)}
async function systemTables(db:D1Database){const r=await db.prepare('PRAGMA table_list').all();return (r.results as any[]).filter(x=>String(x.type||'')==='table'&&String(x.name||'').startsWith('master_')).map(x=>String(x.name)).sort();}
async function batched<T=unknown>(db:D1Database,statements:D1PreparedStatement[],chunkSize=SCHEMA_BATCH_SIZE):Promise<D1Result<T>[]> {const out:D1Result<T>[]=[];for(let i=0;i<statements.length;i+=chunkSize)out.push(...await db.batch<T>(statements.slice(i,i+chunkSize)));return out;}
async function loadSchema(db:D1Database,names:string[]){
 const infos=new Map<string,TableInfo[]>(),links=new Map<string,ForeignKey[]>();
 const infoResults=await batched<any>(db,names.map(t=>db.prepare(`PRAGMA table_info(${ident(t)})`)));
 const fkResults=await batched<any>(db,names.map(t=>db.prepare(`PRAGMA foreign_key_list(${ident(t)})`)));
 for(let i=0;i<names.length;i++){
  infos.set(names[i],((infoResults[i]?.results||[]) as any[]).map(x=>({name:String(x.name),pk:Number(x.pk||0)})));
  links.set(names[i],((fkResults[i]?.results||[]) as any[]).map(x=>({table:String(x.table),from:String(x.from),to:String(x.to||'id')})));
 }
 return{infos,links};
}
function topo(names:string[],links:Map<string,ForeignKey[]>){const set=new Set(names),done:string[]=[],left=new Set(names);while(left.size){let progress=false;for(const t of [...left]){const parents=(links.get(t)||[]).map(f=>f.table).filter(p=>set.has(p)&&p!==t);if(parents.every(p=>done.includes(p))){done.push(t);left.delete(t);progress=true;}}if(!progress){done.push(...left);break;}}return done;}
async function exportSystem(db:D1Database){const names=await systemTables(db);const entities:Record<string,Record<string,unknown>[]>= {};const results=await batched<any>(db,names.map(t=>db.prepare(`SELECT * FROM ${ident(t)}`)));names.forEach((t,i)=>{entities[t]=(results[i]?.results||[]) as Record<string,unknown>[]});return entities;}

function buildInsertStatements(db:D1Database,table:string,rows:Record<string,unknown>[],cols:Set<string>){
 const statements:D1PreparedStatement[]=[];const groups=new Map<string,{keys:string[];rows:unknown[][]}>();
 for(const row of rows){const keys=Object.keys(row).filter(k=>cols.has(k));if(!keys.length)continue;const signature=keys.join('\u001f');let group=groups.get(signature);if(!group){group={keys,rows:[]};groups.set(signature,group)}group.rows.push(keys.map(k=>row[k]??null));}
 for(const group of groups.values()){
  const maxRows=Math.max(1,Math.floor(MAX_BIND_PARAMS/Math.max(1,group.keys.length)));
  for(let i=0;i<group.rows.length;i+=maxRows){const chunk=group.rows.slice(i,i+maxRows);const tuple=`(${group.keys.map(()=>'?').join(',')})`;const sql=`INSERT INTO ${ident(table)}(${group.keys.map(ident).join(',')}) VALUES ${chunk.map(()=>tuple).join(',')}`;statements.push(db.prepare(sql).bind(...chunk.flat()));}
 }
 return statements;
}

async function restoreSystem(db:D1Database,entities:Record<string,Record<string,unknown>[]>) {
 const available=await systemTables(db),set=new Set(available),selected=Object.keys(entities).filter(t=>set.has(t)&&t.startsWith('master_'));if(!selected.length)throw new Error('Backupen innehåller ingen masterdata som kan återställas.');
 const {infos,links}=await loadSchema(db,available);const order=topo(selected,links);const statements:D1PreparedStatement[]=[];
 for(const t of [...order].reverse())statements.push(db.prepare(`DELETE FROM ${ident(t)}`));
 for(const t of order){const cols=new Set((infos.get(t)||[]).map(c=>c.name));statements.push(...buildInsertStatements(db,t,entities[t]||[],cols));}
 await db.batch(statements);
 return{tables:selected,statements:statements.length};
}

export function registerSystemBackupRoutes(app:RouteApp){
 app.get('/api/studio/system/backup-manifest',async c=>{if(!await requireAdmin(c))return c.json({ok:false,error:'Endast administratörer kan skapa systembackup.'},403);try{const entities=await exportSystem(c.env.DB);const backup:SystemBackup={format:FORMAT,version:1,exportedAt:new Date().toISOString(),scope:'system-master-data',entities};return c.json({ok:true,backup});}catch(e){console.error('system backup failed',e);return c.json({ok:false,error:e instanceof Error?e.message:String(e)},500)}});
 app.post('/api/studio/system/restore-data',async c=>{if(!await requireAdmin(c))return c.json({ok:false,error:'Endast administratörer kan återställa systemdata.'},403);const body=await c.req.json<{backup?:SystemBackup}>().catch(()=>({}));const backup=body.backup;if(!backup||backup.format!==FORMAT||backup.version!==1||backup.scope!=='system-master-data'||!backup.entities)return c.json({ok:false,error:'Filen är inte en giltig ByggPlan-systembackup.'},400);try{const result=await restoreSystem(c.env.DB,backup.entities);return c.json({ok:true,...result});}catch(e){console.error('system restore failed',e);return c.json({ok:false,error:`Systemåterställningen misslyckades: ${e instanceof Error?e.message:String(e)}`},500)}});
}
