import app from './attestation-entry';
import {authConfigured,sessionUserFromRequest} from './auth-session';
import {enrichPracticalGoverningInstructions} from './governing-practical-instruction-enrichment';

// Governing document version comparison/activation routes are registered through attestation-entry.
type Env={DB:D1Database;FILES:R2Bucket;DEV_USER_EMAIL:string;ALLOWED_ORIGIN?:string;AUTH_BOOTSTRAP_TOKEN?:string;[key:string]:unknown};

function clean(value:unknown){return typeof value==='string'?value.trim():''}

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

export default {
 async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
  const url=new URL(request.url);
  const publicRoute=request.method==='OPTIONS'||url.pathname==='/health'||url.pathname.startsWith('/api/auth/');
  if(publicRoute)return app.fetch(request,env as any,ctx);
  if(!await authConfigured(env.DB))return app.fetch(request,env as any,ctx);
  const user=await sessionUserFromRequest(env.DB,request);
  if(!user)return new Response(JSON.stringify({ok:false,error:'Du måste logga in.',authenticated:false}),{status:401,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
  if(request.method==='POST'&&url.pathname==='/api/studio/tasks')return createTaskDirect(request,env);
  const governingListMatch=request.method==='GET'?url.pathname.match(/^\/api\/studio\/projects\/([^/]+)\/governing-documents$/):null;
  if(governingListMatch){
   const projectId=decodeURIComponent(governingListMatch[1]);
   await enrichPracticalGoverningInstructions(env.DB,projectId).catch(error=>console.error('Practical governing instruction enrichment failed',error));
  }
  const headers=new Headers(request.headers);headers.delete('X-Demo-User');
  const authenticatedRequest=new Request(request,{headers});
  const authenticatedEnv={...env,DEV_USER_EMAIL:user.email};
  return app.fetch(authenticatedRequest,authenticatedEnv as any,ctx);
 }
};
