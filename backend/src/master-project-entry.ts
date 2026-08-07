import app from './studio-import-entry';
import { registerMasterProjectRoutes } from './master-project-routes';

registerMasterProjectRoutes(app as any);

export default app;
