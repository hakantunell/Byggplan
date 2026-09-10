import app from './attestation-entry';
import {authConfigured,sessionUserFromRequest} from './auth-session';
import {enrichPracticalGoverningInstructions} from './governing-practical-instruction-enrichment';
import {canAccessProject,canAdminWorkspace,ensureWorkspaceSchema,isSystemAdmin,projectIdFromRequest} from './workspace-access';

// Governing document version comparison/activation routes are registered through attestation-entry.
type Env={DB:D1Database;FILES:R2Bucket;DEV_USER_EMAIL:string;ALLOWED_ORIGIN?:string;AUTH_BOOTSTRAP_TOKEN?:string;[key:string]:unknown};

function clean(value:unknown){return typeof value==='string'?value.trim():''}
async function tableExists(db:D1Database,name:string){return Boolean(await db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").bind(name).first())}

async function createTaskDirect(request:Request,env:Env){
 try{
  const body=await request.clone().json() as {workSectionId?:string;title?:string;description?:string};
  const workSectionId=clean(body.workSectionId),title=clean(body.title),description=clean(body.description);
  if(!workSectionId||!title)return new Response(JSON.stringify({ok:false,error:'Arbetsavsnitt och momentnamn krävs.'}),{status:400,headers:{'content-type':'application/json; charset=utf-8'}});
  const section=await env.DB.prepare('SELECT id,name FROM work_sections WHERE id=?').bind(workSectionId).first<any>();
  if(!section)return new Response(JSON.stringify({ok:false,error:'Arbetsavsnittet hittades inte.'}),{status:404,headers:{'content-type':'application/json; charset=utf-8'}});
  const duplicate=await env.DB.prepare('SELECT id FROM tasks WHERE work_section_id=? AND lower(trim(title))=lower(trim(?)) LIMIT 1').bind(workSectionId,title).first<any>();
  if(duplicate)return new Response(JSON.stringify({ok:false,error:'Det finns redan ett moment med samma namn i arbetsavsnittet.',id:String(duplicate.id)}),{status:409,headers:{'content-type':'application/json; charset=utf-8'}});
  const order=await env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM tasks WHERE work_section_id=?').bind(workSectionId).first<any>();
  const id=crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO tasks(id,work_section_id,section,title,description,status,sort_order,updated_at) VALUES(?,?,?,?,?,'todo',?,datetime('now'))`).bind(id,workSectionId,String(section.name||''),title,description,Number(order?.next_order||10)).run();
  return new Response(JSON.stringify({ok:true,id,title,route:'auth-entry-task-create-v1'}),{status:201,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
 }catch(error){
  console.error('Direct task creation failed',error);
  const detail=error instanceof Error?error.message:String(error);
  return new Response(JSON.stringify({ok:false,error:`Kunde inte skapa momentet: ${detail}`}),{status:500,headers:{'content-type':'application/json; charset=utf-8'}});
 }
}

function jsonResponse(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
const EXCEPTIONS=new Set(['not_applicable','cannot_verify','alternative_evidence']);
function simpleKind(item:any){const t=String(item.item_type||'');if(t==='control'||t==='visit'||t==='measurement')return'control';if(t==='documentation'||t==='administration')return'administration';if(t==='condition'||t==='information')return'condition';return'work'}

async function governingMappingFallback(env:Env,projectId:string,cause:unknown){
 try{
  const hasContexts=await tableExists(env.DB,'activity_contexts');
  const [dr,ir,ar,lr]=await Promise.all([
   env.DB.prepare(`SELECT id,document_type,title,issuer,reference,imported_at FROM governing_documents WHERE project_id=? ORDER BY CASE document_type WHEN 'control_plan' THEN 0 ELSE 1 END,imported_at,title`).bind(projectId).all(),
   env.DB.prepare(`SELECT i.id,i.governing_document_id,i.code,i.description,i.section_code,i.section_title,i.item_type,i.responsible_role,i.handling_status,COALESCE(i.source_note,'') source_note,i.sort_order FROM governing_items i JOIN governing_documents d ON d.id=i.governing_document_id WHERE d.project_id=? ORDER BY d.imported_at,i.sort_order,i.id`).bind(projectId).all(),
   hasContexts
    ? env.DB.prepare(`SELECT a.id,a.title,a.description,a.activity_type,t.title task_title,ws.name section_name,wa.name area_name,COALESCE(ac.lifecycle_stage,'build') lifecycle_stage,COALESCE(ac.surface,'field') surface,COALESCE(ac.applicability,'always') applicability,COALESCE(ac.condition_text,'') condition_text FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id LEFT JOIN activity_contexts ac ON ac.activity_id=a.id WHERE wa.project_id=? AND COALESCE(ac.applicability,'always')<>'deprecated' ORDER BY wa.sort_order,ws.sort_order,t.sort_order,a.sort_order`).bind(projectId).all()
    : env.DB.prepare(`SELECT a.id,a.title,a.description,a.activity_type,t.title task_title,ws.name section_name,wa.name area_name,'build' lifecycle_stage,'field' surface,'always' applicability,'' condition_text FROM activities a JOIN tasks t ON t.id=a.task_id JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE wa.project_id=? ORDER BY wa.sort_order,ws.sort_order,t.sort_order,a.sort_order`).bind(projectId).all(),
   hasContexts
    ? env.DB.prepare(`SELECT l.governing_item_id,l.activity_id,a.title activity_title FROM governing_item_activity_links l JOIN governing_items i ON i.id=l.governing_item_id JOIN governing_documents d ON d.id=i.governing_document_id JOIN activities a ON a.id=l.activity_id LEFT JOIN activity_contexts ac ON ac.activity_id=a.id WHERE d.project_id=? AND COALESCE(ac.applicability,'always')<>'deprecated'`).bind(projectId).all()
    : env.DB.prepare(`SELECT l.governing_item_id,l.activity_id,a.title activity_title FROM governing_item_activity_links l JOIN governing_items i ON i.id=l.governing_item_id JOIN governing_documents d ON d.id=i.governing_document_id JOIN activities a ON a.id=l.activity_id WHERE d.project_id=?`).bind(projectId).all()
  ]);
  const documents=dr.results as any[],items=ir.results as any[],activities=ar.results as any[],links=lr.results as any[];
  const byItem=new Map<string,any[]>(),byActivity=new Map<string,number>();for(const link of links){const iid=String(link.governing_item_id),xs=byItem.get(iid)||[];xs.push(link);byItem.set(iid,xs);const aid=String(link.activity_id);byActivity.set(aid,(byActivity.get(aid)||0)+1)}
  const itemRows=items.map(item=>{const ls=byItem.get(String(item.id))||[],handling_kind=simpleKind(item);return{...item,handling_kind,handling_kinds:[handling_kind],mapped_activity_count:ls.length,mapped_activity_ids:ls.map(x=>String(x.activity_id)),mapped_activity_titles:ls.map(x=>String(x.activity_title||'')).filter(Boolean).join(' || ')||null,project_condition:false}});
  const activityRows=activities.map(a=>({...a,governing_item_count:byActivity.get(String(a.id))||0}));
  const documentRows=documents.map(d=>{const rows=itemRows.filter(i=>String(i.governing_document_id)===String(d.id));const item_count=rows.length,exception_count=rows.filter(i=>EXCEPTIONS.has(String(i.handling_status||''))).length,mapped_count=rows.filter(i=>!EXCEPTIONS.has(String(i.handling_status||''))&&Number(i.mapped_activity_count)>0).length,uncovered_count=rows.filter(i=>!EXCEPTIONS.has(String(i.handling_status||''))&&Number(i.mapped_activity_count)===0).length,covered_count=mapped_count+exception_count;return{...d,item_count,mapped_count,exception_count,project_condition_count:0,covered_count,uncovered_count,coverage_percent:item_count?Math.round(covered_count*100/item_count):100}});
  const item_count=documentRows.reduce((s,d)=>s+Number(d.item_count||0),0),mapped_count=documentRows.reduce((s,d)=>s+Number(d.mapped_count||0),0),exception_count=documentRows.reduce((s,d)=>s+Number(d.exception_count||0),0),uncovered_count=documentRows.reduce((s,d)=>s+Number(d.uncovered_count||0),0),covered_count=mapped_count+exception_count;
  console.error('Primary governing mapping read failed; safe fallback used',cause);
  return jsonResponse({ok:true,runtime:'mapping-safe-fallback',summary:{item_count,mapped_count,exception_count,project_condition_count:0,covered_count,uncovered_count,coverage_percent:item_count?Math.round(covered_count*100/item_count):100},documents:documentRows,items:itemRows,activities:activityRows,suggestions:{}});
 }catch(error){console.error('Safe governing mapping fallback failed',error);return jsonResponse({ok:false,error:`Kunde inte läsa kartläggningen: ${error instanceof Error?error.message:String(error)}`},500)}
}

function verificationRoles(raw:string,documentType:string){const role=raw.toUpperCase().replace(/\s+/g,'');const roles:string[]=[];if(role.includes('EK')||role.includes('BH')||role.includes('BYGGHERRE'))roles.push('builder');if(role.includes('KA'))roles.push('ka');if(role.includes('KOMMUN')||role.includes('MYNDIGHET'))roles.push('authority');if(!roles.length&&documentType!=='control_plan')roles.push('builder');return[...new Set(roles)]}
async function ensureVerificationFallbackSchema(db:D1Database){try{await db.prepare("ALTER TABLE governing_items ADD COLUMN source_basis TEXT NOT NULL DEFAULT ''").run()}catch{}try{await db.prepare("ALTER TABLE governing_items ADD COLUMN source_note TEXT NOT NULL DEFAULT ''").run()}catch{}await db.prepare(`CREATE TABLE IF NOT EXISTS governing_item_verifications(id TEXT PRIMARY KEY,governing_item_id TEXT NOT NULL,role_code TEXT NOT NULL,required INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'pending',comment TEXT NOT NULL DEFAULT '',verified_by TEXT,verified_at TEXT,updated_at TEXT NOT NULL DEFAULT (datetime('now')),UNIQUE(governing_item_id,role_code))`).run()}

async function verificationFallback(env:Env,documentId:string,cause:unknown){
 try{
  await ensureVerificationFallbackSchema(env.DB);const doc=await env.DB.prepare('SELECT id,document_type FROM governing_documents WHERE id=?').bind(documentId).first<any>();if(!doc)return jsonResponse({ok:false,error:'Styrdokumentet hittades inte.'},404);const hasContexts=await tableExists(env.DB,'activity_contexts');
  const items=(await env.DB.prepare(`SELECT id,responsible_role,COALESCE(source_basis,'') source_basis,COALESCE(source_note,'') source_note,sort_order FROM governing_items WHERE governing_document_id=? ORDER BY sort_order,id`).bind(documentId).all()).results as any[];
  for(const item of items)for(const role of verificationRoles(String(item.responsible_role||''),String(doc.document_type||'')))await env.DB.prepare(`INSERT OR IGNORE INTO governing_item_verifications(id,governing_item_id,role_code,required,status) VALUES(?,?,?,1,'pending')`).bind(crypto.randomUUID(),String(item.id),role).run();
  const status:Record<string,string>={};for(const item of items){const itemId=String(item.id);const linked=hasContexts?await env.DB.prepare(`SELECT a.id,COALESCE(e.done,0) done,e.completed_by,e.completed_at FROM governing_item_activity_links l JOIN activities a ON a.id=l.activity_id LEFT JOIN activity_entries e ON e.activity_id=a.id LEFT JOIN activity_contexts ac ON ac.activity_id=a.id WHERE l.governing_item_id=? AND COALESCE(ac.applicability,'always')<>'deprecated'`).bind(itemId).all():await env.DB.prepare(`SELECT a.id,COALESCE(e.done,0) done,e.completed_by,e.completed_at FROM governing_item_activity_links l JOIN activities a ON a.id=l.activity_id LEFT JOIN activity_entries e ON e.activity_id=a.id WHERE l.governing_item_id=?`).bind(itemId).all();const rows=linked.results as any[];const builder=await env.DB.prepare(`SELECT id FROM governing_item_verifications WHERE governing_item_id=? AND role_code='builder' AND required=1`).bind(itemId).first<any>();if(builder){if(rows.length&&rows.every(r=>Number(r.done)===1)){const done=rows.filter(r=>r.completed_at).sort((a,b)=>String(a.completed_at).localeCompare(String(b.completed_at))),last=done[done.length-1];await env.DB.prepare(`UPDATE governing_item_verifications SET status='verified',verified_by=?,verified_at=?,comment='Egenkontroll via färdigställda aktiviteter',updated_at=datetime('now') WHERE id=?`).bind(last?.completed_by||null,last?.completed_at||null,builder.id).run()}else await env.DB.prepare(`UPDATE governing_item_verifications SET status='pending',verified_by=NULL,verified_at=NULL,comment='',updated_at=datetime('now') WHERE id=?`).bind(builder.id).run()}if(!rows.length){status[itemId]='waiting_activity';continue}if(!rows.every(r=>Number(r.done)===1)){status[itemId]=rows.some(r=>Number(r.done)===1)?'in_progress':'waiting_activity';continue}const vr=await env.DB.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) verified,SUM(CASE WHEN role_code='ka' AND status<>'verified' THEN 1 ELSE 0 END) ka_pending,SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) rejected FROM governing_item_verifications WHERE governing_item_id=? AND required=1`).bind(itemId).first<any>();status[itemId]=Number(vr?.rejected||0)>0?'rejected':Number(vr?.ka_pending||0)>0?'waiting_ka':Number(vr?.total||0)===Number(vr?.verified||0)?'verified':'ready_for_verification'}
  const rows=await env.DB.prepare(`SELECT v.id,v.governing_item_id,v.role_code,v.required,v.status,v.comment,v.verified_by,v.verified_at,u.display_name verified_by_name,i.source_basis,i.source_note FROM governing_item_verifications v JOIN governing_items i ON i.id=v.governing_item_id LEFT JOIN users u ON u.id=v.verified_by WHERE i.governing_document_id=? ORDER BY i.sort_order,CASE v.role_code WHEN 'builder' THEN 0 WHEN 'ka' THEN 1 WHEN 'authority' THEN 2 ELSE 3 END`).bind(documentId).all();console.error('Primary verification read failed; safe fallback used',cause);return jsonResponse({ok:true,runtime:'verification-safe-fallback',verifications:rows.results,source:items.map(i=>({id:i.id,source_basis:i.source_basis,source_note:i.source_note})),status});
 }catch(error){console.error('Safe verification fallback failed',error);return jsonResponse({ok:false,error:`Kunde inte läsa verifieringsflödet: ${error instanceof Error?error.message:String(error)}`},500)}
}

export default {
 async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
  const url=new URL(request.url);
  const publicRoute=request.method==='OPTIONS'||url.pathname==='/health'||url.pathname.startsWith('/api/auth/');
  if(publicRoute)return app.fetch(request,env as any,ctx);
  if(!await authConfigured(env.DB))return app.fetch(request,env as any,ctx);
  const user=await sessionUserFromRequest(env.DB,request);
  if(!user)return jsonResponse({ok:false,error:'Du måste logga in.',authenticated:false},401);
  await ensureWorkspaceSchema(env.DB);
  const systemAdmin=await isSystemAdmin(env.DB,user);
  if((url.pathname.startsWith('/api/system/')||url.pathname.startsWith('/api/studio/system-'))&&!systemAdmin)return jsonResponse({ok:false,error:'Systemadministratörsbehörighet krävs.'},403);
  if(request.method==='GET'&&url.pathname==='/api/projects'&&!systemAdmin){
   const rows=await env.DB.prepare(`SELECT DISTINCT p.id,p.name,p.property_designation,p.status,p.workspace_id,w.name workspace_name,
     (SELECT COUNT(*) FROM work_areas wa WHERE wa.project_id=p.id) work_area_count,
     (SELECT COUNT(*) FROM work_sections ws JOIN work_areas wa ON wa.id=ws.work_area_id WHERE wa.project_id=p.id) work_section_count,
     (SELECT COUNT(*) FROM tasks t JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE wa.project_id=p.id) task_count
     FROM projects p JOIN workspaces w ON w.id=p.workspace_id JOIN workspace_members wm ON wm.workspace_id=w.id
     WHERE wm.user_id=? AND wm.status='active' AND w.status='active' ORDER BY w.name,p.sort_order,p.name`).bind(user.id).all();
   return jsonResponse({projects:rows.results});
  }
  const scopedProjectId=await projectIdFromRequest(env.DB,request);
  if(scopedProjectId&&!await canAccessProject(env.DB,user,scopedProjectId))return jsonResponse({ok:false,error:'Du har inte åtkomst till den här projektytan eller projektet.'},403);
  if(request.method==='POST'&&/^\/api\/studio\/master-projects\/[^/]+\/create-project$/.test(url.pathname)&&!systemAdmin){
   const body=await request.clone().json().catch(()=>({})) as any;const workspaceId=String(body?.workspaceId||'');
   if(!workspaceId||!await canAdminWorkspace(env.DB,user,workspaceId))return jsonResponse({ok:false,error:'Du får bara skapa projekt i en projektyta som du administrerar.'},403);
  }
  if(request.method==='GET'&&url.pathname==='/api/tasks'&&!url.searchParams.get('projectId')&&!systemAdmin)return jsonResponse({ok:false,error:'projectId krävs för projektavgränsad åtkomst.'},400);
  if(request.method==='POST'&&url.pathname==='/api/studio/tasks')return createTaskDirect(request,env);
  const governingListMatch=request.method==='GET'?url.pathname.match(/^\/api\/studio\/projects\/([^/]+)\/governing-documents$/):null;
  if(governingListMatch){const projectId=decodeURIComponent(governingListMatch[1]);await enrichPracticalGoverningInstructions(env.DB,projectId).catch(error=>console.error('Practical governing instruction enrichment failed',error));}
  const headers=new Headers(request.headers);headers.delete('X-Demo-User');
  const authenticatedRequest=new Request(request,{headers});const authenticatedEnv={...env,DEV_USER_EMAIL:user.email};
  if(request.method==='GET'){
   const mappingMatch=url.pathname.match(/^\/api\/studio\/projects\/([^/]+)\/governing-mapping$/);
   if(mappingMatch){try{const response=await app.fetch(authenticatedRequest,authenticatedEnv as any,ctx);if(response.ok)return response;return governingMappingFallback(env,decodeURIComponent(mappingMatch[1]),`HTTP ${response.status}`)}catch(error){return governingMappingFallback(env,decodeURIComponent(mappingMatch[1]),error)}}
   const verificationMatch=url.pathname.match(/^\/api\/studio\/governing-documents\/([^/]+)\/verification-map$/);
   if(verificationMatch){try{const response=await app.fetch(authenticatedRequest,authenticatedEnv as any,ctx);if(response.ok)return response;return verificationFallback(env,decodeURIComponent(verificationMatch[1]),`HTTP ${response.status}`)}catch(error){return verificationFallback(env,decodeURIComponent(verificationMatch[1]),error)}}
  }
  return app.fetch(authenticatedRequest,authenticatedEnv as any,ctx);
 }
};
