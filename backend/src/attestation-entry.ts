import app from './master-project-entry';
import { registerGoverningAttestationRoutes } from './governing-attestation-routes';
import { registerActivityOwnDocumentationRoutes } from './activity-own-documentation-routes';
import { registerActivityCommentRoutes } from './activity-comment-routes';
import { registerActivityMoveRoutes } from './activity-move-routes';
import { registerProjectDocumentCategoryRoutes } from './project-document-category-routes';
import { registerAuthRoutes } from './auth-routes';
import { registerProjectInformationRoutes } from './project-information-routes';
import { registerProjectBackupRoutes } from './project-backup-routes';
import { registerSystemBackupRoutes } from './system-backup-routes';
import { registerProjectExecutionResetRoutes } from './project-execution-reset-routes';
import { registerGoverningDocumentVersionRoutes } from './governing-document-version-routes';
import { registerGoverningVersionDecisionRoutes } from './governing-version-decision-routes';
import { registerGoverningVersionApplyRoutes } from './governing-version-apply-routes';

registerAuthRoutes(app as any);
registerGoverningAttestationRoutes(app as any);
registerActivityOwnDocumentationRoutes(app as any);
registerActivityCommentRoutes(app as any);
registerActivityMoveRoutes(app as any);
registerProjectDocumentCategoryRoutes(app as any);
registerProjectInformationRoutes(app as any);
registerProjectBackupRoutes(app as any);
registerSystemBackupRoutes(app as any);
registerProjectExecutionResetRoutes(app as any);
registerGoverningDocumentVersionRoutes(app as any);
registerGoverningVersionDecisionRoutes(app as any);
registerGoverningVersionApplyRoutes(app as any);

(app as any).onError((error:any,c:any)=>{
  console.error('Unhandled API error',error);
  const detail=error instanceof Error?error.message:String(error);
  if(c.req.path==='/api/auth/bootstrap'){
    return c.json({ok:false,error:`Bootstrapfel: ${detail}`},500);
  }
  if(c.req.path.includes('/api/studio/projects/')&&c.req.path.includes('/members')){
    return c.json({ok:false,error:`Medlemsfel: ${detail}`},500);
  }
  return c.json({ok:false,error:'Ett internt fel uppstod i ByggPlan API.'},500);
});

export default app;
