import app from './studio-import-entry';
import { registerMasterProjectRoutes } from './master-project-routes';
import { registerMasterProjectCloneRoutes } from './master-project-clone-routes';
import { registerMasterProjectModuleRoutes } from './master-project-module-routes';
import { ensureMasterV14, registerMasterProjectV2UpgradeRoutesV14 } from './master-project-v2-upgrade-routes-v14';
import { registerProjectSupportAttachmentUploadRoutes } from './project-support-attachment-upload-routes';
import { registerProjectSupportRoutes } from './project-support-routes';
import { registerProjectSupportJsonUploadRoutes } from './project-support-json-upload-routes';
import { registerProjectExecutionContextRoutes } from './project-execution-context-routes';
import { registerProjectExecutionDiagnosticsRoutes } from './project-execution-diagnostics-routes';
import { registerProjectManagementRoutes } from './project-management-routes';
import { registerProjectMasterDiagnosticsRoutes } from './project-master-diagnostics-routes';
import { registerProjectMasterRepairRoutes } from './project-master-repair-routes';
import { registerProjectConditionRoutes } from './project-condition-routes';
import { registerGoverningDocumentFileRoutes } from './governing-document-file-routes';

const MASTER_V2_TARGET_VERSION=14;

async function reconcileMaster(c:any,next:any){
  if(c.req.method==='GET'){
    const master=await c.env.DB.prepare("SELECT id,version FROM master_projects WHERE code='fritidshus-v2'").first<any>();
    if(master&&Number(master.version||0)<MASTER_V2_TARGET_VERSION)await ensureMasterV14(c.env.DB,String(master.id));
  }
  await next();
}
app.use('/api/studio/master-projects',reconcileMaster);
app.use('/api/studio/master-projects/*',reconcileMaster);

registerMasterProjectRoutes(app as any);
registerMasterProjectModuleRoutes(app as any);
registerMasterProjectV2UpgradeRoutesV14(app as any);
registerMasterProjectCloneRoutes(app as any);
registerProjectSupportAttachmentUploadRoutes(app as any);
registerProjectSupportRoutes(app as any);
registerProjectSupportJsonUploadRoutes(app as any);
registerProjectExecutionContextRoutes(app as any);
registerProjectExecutionDiagnosticsRoutes(app as any);
registerProjectManagementRoutes(app as any);
registerProjectMasterDiagnosticsRoutes(app as any);
registerProjectMasterRepairRoutes(app as any);
registerProjectConditionRoutes(app as any);
registerGoverningDocumentFileRoutes(app as any);

export default app;
