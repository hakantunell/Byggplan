import app from './studio-import-entry';
import { registerMasterProjectRoutes } from './master-project-routes';
import { registerMasterProjectCloneRoutes } from './master-project-clone-routes';
import { registerMasterSupportRoutes } from './master-support-routes';
import { registerProjectSupportRoutes } from './project-support-routes';

registerMasterProjectRoutes(app as any);
registerMasterProjectCloneRoutes(app as any);
registerMasterSupportRoutes(app as any);
registerProjectSupportRoutes(app as any);

export default app;
