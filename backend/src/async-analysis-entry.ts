import authEntry from './auth-entry';
import internalApp from './attestation-entry';
import {authConfigured,sessionUserFromRequest} from './auth-session';
import {canAccessProject,ensureWorkspaceSchema} from './workspace-access';

type Env={
  DB:D1Database;
  ANALYSIS_QUEUE?:{send:(body:unknown)=>Promise<void>};
  [key:string]:any;
};

type AnalysisMessage={jobId:string;documentId:string};

function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}

async function ensureJobSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS governing_document_analysis_jobs(
    id TEXT PRIMARY KEY,
    governing_document_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    stage TEXT NOT NULL DEFAULT 'queued',
    result_json TEXT NOT NULL DEFAULT '',
    error_text TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(governing_document_id) REFERENCES governing_documents(id) ON DELETE CASCADE
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_governing_analysis_jobs_document ON governing_document_analysis_jobs(governing_document_id,created_at)').run();
}

async function authorizedDocument(request:Request,env:Env,documentId:string){
  if(!await authConfigured(env.DB))return {ok:true,user:null,document:null};
  const user=await sessionUserFromRequest(env.DB,request);
  if(!user)return {ok:false,response:json({ok:false,error:'Du måste logga in.',authenticated:false},401)};
  await ensureWorkspaceSchema(env.DB);
  const document=await env.DB.prepare('SELECT id,project_id FROM governing_documents WHERE id=?').bind(documentId).first<any>();
  if(!document)return {ok:false,response:json({ok:false,error:'Styrdokumentet hittades inte.'},404)};
  if(!await canAccessProject(env.DB,user,String(document.project_id)))return {ok:false,response:json({ok:false,error:'Du har inte åtkomst till projektet.'},403)};
  return {ok:true,user,document};
}

async function queueAnalysis(request:Request,env:Env,documentId:string){
  if(!env.ANALYSIS_QUEUE||typeof env.ANALYSIS_QUEUE.send!=='function')return json({ok:false,error:'Analyskön är inte konfigurerad i backend.'},503);
  const access=await authorizedDocument(request,env,documentId);if(!access.ok)return access.response!;
  await ensureJobSchema(env.DB);
  const existingItems=await env.DB.prepare('SELECT COUNT(*) AS count FROM governing_items WHERE governing_document_id=?').bind(documentId).first<any>();
  if(Number(existingItems?.count||0)>0)return json({ok:false,error:'Dokumentet är redan analyserat. Nollställ analysen om du vill köra om den.',existingItems:Number(existingItems?.count||0)},409);
  const active=await env.DB.prepare("SELECT id,status,stage,created_at,updated_at FROM governing_document_analysis_jobs WHERE governing_document_id=? AND status IN ('queued','processing') ORDER BY created_at DESC LIMIT 1").bind(documentId).first<any>();
  if(active)return json({ok:true,status:String(active.status),analysisRunId:String(active.id),documentId,stage:String(active.stage),alreadyQueued:true},202);
  const jobId=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO governing_document_analysis_jobs(id,governing_document_id,status,stage) VALUES(?,?,'queued','queued')").bind(jobId,documentId).run();
  try{
    await env.ANALYSIS_QUEUE.send({jobId,documentId} satisfies AnalysisMessage);
  }catch(error){
    const detail=error instanceof Error?error.message:String(error);
    await env.DB.prepare("UPDATE governing_document_analysis_jobs SET status='failed',stage='queue_publish',error_text=?,updated_at=datetime('now') WHERE id=?").bind(detail,jobId).run();
    return json({ok:false,status:'failed',analysisRunId:jobId,documentId,stage:'queue_publish',error:`Kunde inte köa analysen: ${detail}`},500);
  }
  return json({ok:true,status:'queued',analysisRunId:jobId,documentId,stage:'queued'},202);
}

async function analysisStatus(request:Request,env:Env,documentId:string){
  const access=await authorizedDocument(request,env,documentId);if(!access.ok)return access.response!;
  await ensureJobSchema(env.DB);
  const row=await env.DB.prepare('SELECT id,status,stage,result_json,error_text,created_at,updated_at FROM governing_document_analysis_jobs WHERE governing_document_id=? ORDER BY created_at DESC LIMIT 1').bind(documentId).first<any>();
  if(!row)return json({ok:true,documentId,status:'not_started'});
  let result:any=null;if(row.result_json){try{result=JSON.parse(String(row.result_json))}catch{result=null}}
  return json({ok:true,documentId,analysisRunId:String(row.id),status:String(row.status),stage:String(row.stage),createdAt:row.created_at,updatedAt:row.updated_at,error:row.error_text||undefined,result});
}

async function processMessage(message:any,env:Env,ctx:ExecutionContext){
  await ensureJobSchema(env.DB);
  const body=message.body as AnalysisMessage;
  const jobId=String(body?.jobId||''),documentId=String(body?.documentId||'');
  if(!jobId||!documentId){message.ack?.();return}
  await env.DB.prepare("UPDATE governing_document_analysis_jobs SET status='processing',stage='analysis',updated_at=datetime('now') WHERE id=?").bind(jobId).run();
  try{
    const req=new Request(`https://internal/api/studio/governing-documents/${encodeURIComponent(documentId)}/analyze-generic`,{method:'POST',headers:{'x-byggplan-queue-job':jobId}});
    const response=await internalApp.fetch(req,env as any,ctx);
    const text=await response.text();
    let payload:any;try{payload=JSON.parse(text)}catch{payload={ok:false,error:text||`HTTP ${response.status}`}}
    if(response.ok&&payload?.ok){
      await env.DB.prepare("UPDATE governing_document_analysis_jobs SET status='completed',stage='completed',result_json=?,error_text='',updated_at=datetime('now') WHERE id=?").bind(JSON.stringify(payload),jobId).run();
    }else{
      const stage=String(payload?.stage||'analysis');const detail=String(payload?.error||`HTTP ${response.status}`);
      await env.DB.prepare("UPDATE governing_document_analysis_jobs SET status='failed',stage=?,result_json=?,error_text=?,updated_at=datetime('now') WHERE id=?").bind(stage,JSON.stringify(payload),detail,jobId).run();
    }
    message.ack?.();
  }catch(error){
    const detail=error instanceof Error?error.message:String(error);
    await env.DB.prepare("UPDATE governing_document_analysis_jobs SET status='failed',stage='queue_consumer',error_text=?,updated_at=datetime('now') WHERE id=?").bind(detail,jobId).run();
    if(Number(message.attempts||1)<3)message.retry?.({delaySeconds:10});else message.ack?.();
  }
}

export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(request.url);
    const start=url.pathname.match(/^\/api\/studio\/governing-documents\/([^/]+)\/analyze-generic$/);
    if(request.method==='POST'&&start)return queueAnalysis(request,env,decodeURIComponent(start[1]));
    const status=url.pathname.match(/^\/api\/studio\/governing-documents\/([^/]+)\/analysis-status$/);
    if(request.method==='GET'&&status)return analysisStatus(request,env,decodeURIComponent(status[1]));
    return authEntry.fetch(request,env as any,ctx);
  },
  async queue(batch:any,env:Env,ctx:ExecutionContext){
    for(const message of batch.messages||[])await processMessage(message,env,ctx);
  }
};
