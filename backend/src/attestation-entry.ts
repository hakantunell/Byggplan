import app from './master-project-entry';
import { registerGoverningAttestationRoutes } from './governing-attestation-routes';
import { registerActivityOwnDocumentationRoutes } from './activity-own-documentation-routes';
import { registerProjectDocumentCategoryRoutes } from './project-document-category-routes';
import { registerAuthRoutes } from './auth-routes';

registerAuthRoutes(app as any);
registerGoverningAttestationRoutes(app as any);
registerActivityOwnDocumentationRoutes(app as any);
registerProjectDocumentCategoryRoutes(app as any);

(app as any).onError((error:any,c:any)=>{
  console.error('Unhandled API error',error);
  if(c.req.path==='/api/auth/bootstrap'){
    const detail=error instanceof Error?error.message:String(error);
    return c.json({ok:false,error:`Bootstrapfel: ${detail}`},500);
  }
  return c.json({ok:false,error:'Ett internt fel uppstod i ByggPlan API.'},500);
});

export default app;
