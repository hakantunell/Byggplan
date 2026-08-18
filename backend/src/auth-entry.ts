import app from './attestation-entry';
import {authConfigured,sessionUserFromRequest} from './auth-session';

type Env={DB:D1Database;FILES:R2Bucket;DEV_USER_EMAIL:string;ALLOWED_ORIGIN?:string;AUTH_BOOTSTRAP_TOKEN?:string;[key:string]:unknown};

export default {
 async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response>{
  const url=new URL(request.url);
  const publicRoute=request.method==='OPTIONS'||url.pathname==='/health'||url.pathname.startsWith('/api/auth/');
  if(publicRoute)return app.fetch(request,env as any,ctx);
  if(!await authConfigured(env.DB))return app.fetch(request,env as any,ctx);
  const user=await sessionUserFromRequest(env.DB,request);
  if(!user)return new Response(JSON.stringify({ok:false,error:'Du måste logga in.',authenticated:false}),{status:401,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
  const headers=new Headers(request.headers);headers.delete('X-Demo-User');
  const authenticatedRequest=new Request(request,{headers});
  const authenticatedEnv={...env,DEV_USER_EMAIL:user.email};
  return app.fetch(authenticatedRequest,authenticatedEnv as any,ctx);
 }
};
