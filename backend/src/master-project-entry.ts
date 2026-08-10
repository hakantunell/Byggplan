import { Hono } from 'hono';
import app from './studio-import-entry';
import { registerMasterProjectRoutes } from './master-project-routes';
import { registerMasterProjectCloneRoutes } from './master-project-clone-routes';
import { registerProjectSupportAttachmentUploadRoutes } from './project-support-attachment-upload-routes';
import { registerProjectSupportRoutes } from './project-support-routes';
import { registerProjectSupportJsonUploadRoutes } from './project-support-json-upload-routes';
import { registerProjectExecutionContextRoutes } from './project-execution-context-routes';
import { registerProjectManagementRoutes } from './project-management-routes';
import { activityDependencyGuard, registerActivityDependencyRoutes } from './activity-dependency-routes';

registerMasterProjectRoutes(app as any);
registerMasterProjectCloneRoutes(app as any);
registerProjectSupportAttachmentUploadRoutes(app as any);
registerProjectSupportRoutes(app as any);
registerProjectSupportJsonUploadRoutes(app as any);
registerProjectExecutionContextRoutes(app as any);
registerProjectManagementRoutes(app as any);

// Wrap the existing application so hard activity prerequisites are evaluated
// before the original activity PUT route can change project state.
const root = new Hono<any>();
root.use('/api/activities/*', activityDependencyGuard as any);
registerActivityDependencyRoutes(root as any);
root.route('/', app as any);

export default root;
