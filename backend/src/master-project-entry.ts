import app from './studio-import-entry';
import { registerMasterProjectRoutes } from './master-project-routes';
import { registerMasterProjectCloneRoutes } from './master-project-clone-routes';
import { registerMasterProjectModuleRoutes } from './master-project-module-routes';
import { ensureMasterV22, registerMasterProjectV2UpgradeRoutesV22 } from './master-project-v2-upgrade-routes-v22';
import { registerProjectStructureAuditRoutes } from './project-structure-audit-routes';
import { registerProjectStructureCleanupV18Routes } from './project-structure-cleanup-v18';
import { registerProjectStructureCleanupV19Routes } from './project-structure-cleanup-v19';
import { registerProjectStructureCleanupV20Routes } from './project-structure-cleanup-v20';
import { registerProjectStructureCleanupV21Routes } from './project-structure-cleanup-v21';
import { registerProjectStructureConsolidateV21Routes } from './project-structure-consolidate-v21';
import { registerProjectStructureCleanupV22Routes } from './project-structure-cleanup-v22';
import { registerOpenApiRoutes } from './openapi-routes';
import { registerProjectSupportAttachmentUploadRoutes } from './project-support-attachment-upload-routes';
import { registerProjectSupportRoutes } from './project-support-routes';
import { registerProjectSupportJsonUploadRoutes } from './project-support-json-upload-routes';
import { registerProjectExecutionContextRoutes } from './project-execution-context-routes';
import { registerProjectFieldMetadataRoutes } from './project-field-metadata-routes';
import { registerProjectExecutionDiagnosticsRoutes } from './project-execution-diagnostics-routes';
import { registerProjectManagementRoutes } from './project-management-routes';
import { registerProjectMasterDiagnosticsRoutes } from './project-master-diagnostics-routes';
import { registerProjectMasterRepairRoutes } from './project-master-repair-routes';
import { registerProjectConditionRoutes } from './project-condition-routes';
import { registerGoverningDocumentFileRoutes } from './governing-document-file-routes';

const MASTER_V2_TARGET_VERSION=22;

async function reconcileMaster(c:any,next:any){
  if(c.req.method==='GET'){
    const master=await c.env.DB.prepare("SELECT id,version FROM master_projects WHERE code='fritidshus-v2'").first<any>();
    if(master&&Number(master.version||0)<MASTER_V2_TARGET_VERSION)await ensureMasterV22(c.env.DB,String(master.id));
  }
  await next();
}

app.use('/api/studio/master-projects',reconcileMaster);
app.use('/api/studio/master-projects/*',reconcileMaster);

registerMasterProjectRoutes(app as any);
registerMasterProjectModuleRoutes(app as any);
registerMasterProjectV2UpgradeRoutesV22(app as any);
registerMasterProjectCloneRoutes(app as any);
registerProjectStructureAuditRoutes(app as any);
registerProjectStructureCleanupV18Routes(app as any);
registerProjectStructureCleanupV19Routes(app as any);
registerProjectStructureCleanupV20Routes(app as any);
registerProjectStructureCleanupV21Routes(app as any);
registerProjectStructureConsolidateV21Routes(app as any);
registerProjectStructureCleanupV22Routes(app as any);
registerOpenApiRoutes(app as any);
registerProjectSupportAttachmentUploadRoutes(app as any);
registerProjectSupportRoutes(app as any);
registerProjectSupportJsonUploadRoutes(app as any);
registerProjectExecutionContextRoutes(app as any);
registerProjectFieldMetadataRoutes(app as any);
registerProjectExecutionDiagnosticsRoutes(app as any);
registerProjectManagementRoutes(app as any);
registerProjectMasterDiagnosticsRoutes(app as any);
registerProjectMasterRepairRoutes(app as any);
registerProjectConditionRoutes(app as any);
registerGoverningDocumentFileRoutes(app as any);

export default app;
