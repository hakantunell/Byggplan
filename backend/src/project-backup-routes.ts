type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;post:(path:string,handler:(c:any)=>unknown)=>void};
type TableInfo={name:string;pk:number};
type ForeignKey={table:string;from:string;to:string};
type Backup={format:string;version:number;exportedAt:string;sourceProjectId:string;entities:Record<string,Record<string,unknown>[]>;files:Array<{key:string;size:number;etag?:string;contentType?:string}>};
type Schema={names:string[];infos:Map<string,TableInfo[]>;links:Map<string,ForeignKey[]>};
const FORMAT='byggplan-portable-backup';
const LOOKUP_CHUNK=75;
const MAX_BIND_PARAMS=80;
const SCHEMA_BATCH_SIZE=100;

function ident(v:string){if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v))throw new Error(`Ogiltigt databasnamn: ${v}`);return `"${v}"`}
function isApplicationTable(name:string,type:string){return type==='table'&&!name.startsWith('sqlite_')&&!name.startsWith('_cf_')&&name!=='d1_migrations';}
function values(rows:Record<string,unknown>[],column:string){return Array.from(new Set(rows.map(r=>r[column]).filter(v=>v!==null&&v!==undefined)));}
function mergeRows(target:Record<string,unknown>[],rows:Record<string,unknown>[],pk:string){const seen=new Set(target.map(r=>String(r[pk])));let changed=false;for(const row of rows){const key=String(row[pk]);if(!seen.has(key)){target.push(row);seen.add(key);changed=true;}}return changed;}
function topo(names:string[],links:Map<string,ForeignKey[]>){const set=new Set(names),done:string[]=[],left=new Set(names);while(left.size){let progress=false;for(const t of [...left]){const parents=(links.get(t)||[]).map(f=>f.table).filter(p=>set.has(p)&&p!==t);if(parents.every(p=>done.includes(p))){done.push(t);left.delete(t);progress=true;}}if(!progress){done.push(...left);break;}}return done;}
function primaryKey(infos:Map<string,TableInfo[]>,table:string){const cols=infos.get(table)||[];return cols.find(c=>c.pk===1)?.name||cols.find(c=>c.name==='id')?.name||'';}

async function tables(db:D1Database){const r=await db.prepare('PRAGMA table_list').all();return (r.results as any[]).filter(x=>isApplicationTable(String(x.name||''),String(x.type||''))).map(x=>String(x.name)).sort();}
async function batched<T=unknown>(db:D1Database,statements:D1PreparedStatement[],chunkSize=SCHEMA_BATCH_SIZE):Promise<D1Result<T>[]> {const out:D1Result<T>[]=[];for(let i=0;i<statements.length;i+=chunkSize)out.push(...await db.batch<T>(statements.slice(i,i+chunkSize)));return out;}
async function loadSchema(db:D1Database,names?:string[]):Promise<Schema>{
 const all=names||await tables(db);const infos=new Map<string,TableInfo[]>(),links=new Map<string,ForeignKey[]>();
 const infoResults=await batched<any>(db,all.map(t=>db.prepare(`PRAGMA table_info(${ident(t)})`)));
 const fkResults=await batched<any>(db,all.map(t=>db.prepare(`PRAGMA foreign_key_list(${ident(t)})`)));
 for(let i=0;i<all.length;i++){
  infos.set(all[i],((infoResults[i]?.results||[]) as any[]).map(x=>({name:String(x.name),pk:Number(x.pk||0)})));
  links.set(all[i],((fkResults[i]?.results||[]) as any[]).map(x=>({table:String(x.table),from:String(x.from),to:String(x.to||'id')})));
 }
 return{names:all,infos,links};
}

async function collectProject(db:D1Database,projectId:string,schema?:Schema){
 const s=schema||await loadSchema(db);const {names,infos,links}=s;
 const entities:Record<string,Record<string,unknown>[]>=Object.fromEntries(names.map(t=>[t,[]]));
 const projectResult=names.includes('projects')?await db.prepare('SELECT * FROM projects WHERE id=?').bind(projectId).all():null;
 if(projectResult){entities.projects=projectResult.results as Record<string,unknown>[];if(!entities.projects.length)throw new Error('Projektet hittades inte.');}
 const directTables=names.filter(t=>t!=='projects'&&(infos.get(t)||[]).some(c=>c.name==='project_id'));
 const directResults=await batched<any>(db,directTables.map(t=>db.prepare(`SELECT * FROM ${ident(t)} WHERE project_id=?`).bind(projectId)));
 directTables.forEach((t,i)=>{entities[t]=(directResults[i]?.results||[]) as Record<string,unknown>[]});
 let changed=true;
 for(let pass=0;changed&&pass<20;pass++){
  changed=false;const jobs:Array<{table:string;pk:string;statement:D1PreparedStatement}>=[];
  for(const t of names){const pk=primaryKey(infos,t);if(!pk)continue;for(const fk of links.get(t)||[]){const parents=entities[fk.table]||[];if(!parents.length)continue;const vals=values(parents,fk.to);for(let i=0;i<vals.length;i+=LOOKUP_CHUNK){const batch=vals.slice(i,i+LOOKUP_CHUNK);jobs.push({table:t,pk,statement:db.prepare(`SELECT * FROM ${ident(t)} WHERE ${ident(fk.from)} IN (${batch.map(()=>'?').join(',')})`).bind(...batch)});}}}
  if(!jobs.length)break;
  const results=await batched<any>(db,jobs.map(j=>j.statement));
  jobs.forEach((job,i)=>{if(mergeRows(entities[job.table],(results[i]?.results||[]) as Record<string,unknown>[],job.pk))changed=true});
 }
 for(const t of Object.keys(entities))if(!entities[t].length)delete entities[t];
 return{entities,schema:s};
}

async function listFiles(bucket:R2Bucket,projectId:string){const prefix=`projects/${projectId}/`;const out:Array<{key:string;size:number;etag?:string;contentType?:string}>=[];let cursor:string|undefined;do{const page=await bucket.list({prefix,cursor,limit:1000});for(const o of page.objects)out.push({key:o.key,size:o.size,etag:o.etag,contentType:(o as any).httpMetadata?.contentType});cursor=page.truncated?page.cursor:undefined;}while(cursor);return out;}

function buildDeleteStatements(db:D1Database,collected:Record<string,Record<string,unknown>[]>,schema:Schema){
 const statements:D1PreparedStatement[]=[];const order=topo(Object.keys(collected),schema.links).reverse();
 for(const t of order){if(t==='projects')continue;const pk=primaryKey(schema.infos,t),rows=collected[t]||[];if(!pk||!rows.length)continue;const ids=values(rows,pk);for(let i=0;i<ids.length;i+=LOOKUP_CHUNK){const batch=ids.slice(i,i+LOOKUP_CHUNK);statements.push(db.prepare(`DELETE FROM ${ident(t)} WHERE ${ident(pk)} IN (${batch.map(()=>'?').join(',')})`).bind(...batch));}}
 return statements;
}

function remapValue(value:unknown,sourceProjectId:string,projectId:string){if(typeof value!=='string'||sourceProjectId===projectId)return value;const from=`projects/${sourceProjectId}/`;return value.startsWith(from)?`projects/${projectId}/${value.slice(from.length)}`:value;}

function buildInsertStatements(db:D1Database,entities:Record<string,Record<string,unknown>[]>,sourceProjectId:string,projectId:string,schema:Schema){
 const statements:D1PreparedStatement[]=[];const nameSet=new Set(schema.names),selected=Object.keys(entities).filter(t=>nameSet.has(t));const order=topo(selected,schema.links);
 for(const t of order){
  const cols=new Set((schema.infos.get(t)||[]).map(c=>c.name));const groups=new Map<string,{keys:string[];rows:unknown[][]}>();
  for(const original of entities[t]||[]){
   const row:Record<string,unknown>={};for(const[k,v]of Object.entries(original))row[k]=remapValue(v,sourceProjectId,projectId);if('project_id'in row)row.project_id=projectId;if(t==='projects'&&'id'in row)row.id=projectId;
   const keys=Object.keys(row).filter(k=>cols.has(k));if(!keys.length)continue;const signature=keys.join('\u001f');let group=groups.get(signature);if(!group){group={keys,rows:[]};groups.set(signature,group)}group.rows.push(keys.map(k=>row[k]??null));
  }
  for(const group of groups.values()){
   const maxRows=Math.max(1,Math.floor(MAX_BIND_PARAMS/Math.max(1,group.keys.length)));
   for(let i=0;i<group.rows.length;i+=maxRows){const rows=group.rows.slice(i,i+maxRows);const tuple=`(${group.keys.map(()=>'?').join(',')})`;const sql=`INSERT OR REPLACE INTO ${ident(t)}(${group.keys.map(ident).join(',')}) VALUES ${rows.map(()=>tuple).join(',')}`;statements.push(db.prepare(sql).bind(...rows.flat()));}
  }
 }
 return statements;
}

async function restoreProject(db:D1Database,backup:Backup,projectId:string){
 const schema=await loadSchema(db);const existing=await db.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();let deletes:D1PreparedStatement[]=[];
 if(existing){const current=await collectProject(db,projectId,schema);deletes=buildDeleteStatements(db,current.entities,schema);}
 const inserts=buildInsertStatements(db,backup.entities,backup.sourceProjectId,projectId,schema);if(!inserts.length)throw new Error('Backupen innehåller ingen projektdata som kan återställas.');
 await db.batch([...deletes,...inserts]);
 return{deletedStatements:deletes.length,insertStatements:inserts.length};
}

export function registerProjectBackupRoutes(app:RouteApp){
 app.get('/api/studio/projects/:projectId/backup-manifest',async c=>{try{const projectId=c.req.param('projectId');const {entities}=await collectProject(c.env.DB,projectId);const files=c.env.FILES?await listFiles(c.env.FILES,projectId):[];const backup:Backup={format:FORMAT,version:1,exportedAt:new Date().toISOString(),sourceProjectId:projectId,entities,files};return c.json({ok:true,backup});}catch(e){console.error('backup manifest failed',e);return c.json({ok:false,error:e instanceof Error?e.message:String(e)},500)}});
 app.get('/api/studio/projects/:projectId/backup-file',async c=>{const projectId=c.req.param('projectId');const key=String(c.req.query('key')||'');if(!key.startsWith(`projects/${projectId}/`))return c.json({ok:false,error:'Ogiltig filsökväg.'},400);const o=await c.env.FILES.get(key);if(!o)return c.json({ok:false,error:'Backupfilen saknas i lagringen.'},404);const h=new Headers();o.writeHttpMetadata(h);h.set('Content-Type',h.get('Content-Type')||'application/octet-stream');h.set('Cache-Control','no-store');return new Response(o.body,{headers:h});});
 app.post('/api/studio/projects/:projectId/restore-data',async c=>{const projectId=c.req.param('projectId');const body=await c.req.json<{backup?:Backup}>().catch(()=>({}));const backup=body.backup;if(!backup||backup.format!==FORMAT||backup.version!==1||!backup.entities)return c.json({ok:false,error:'Filen är inte en giltig ByggPlan-backup.'},400);try{const result=await restoreProject(c.env.DB,backup,projectId);return c.json({ok:true,projectId,tables:Object.keys(backup.entities).length,...result});}catch(e){console.error('restore failed',e);return c.json({ok:false,error:`Återställningen misslyckades: ${e instanceof Error?e.message:String(e)}`},500)}});
 app.post('/api/studio/projects/:projectId/restore-file',async c=>{const projectId=c.req.param('projectId');let form:FormData;try{form=await c.req.raw.formData()}catch{return c.json({ok:false,error:'Kunde inte läsa backupfilen.'},400)}const key=String(form.get('key')||'');const file=form.get('file');if(!key.startsWith(`projects/${projectId}/`))return c.json({ok:false,error:'Ogiltig filsökväg.'},400);if(!file||typeof(file as any).stream!=='function')return c.json({ok:false,error:'Fil saknas.'},400);await c.env.FILES.put(key,(file as any).stream(),{httpMetadata:{contentType:String((file as any).type||'application/octet-stream')}});return c.json({ok:true,key});});
}
