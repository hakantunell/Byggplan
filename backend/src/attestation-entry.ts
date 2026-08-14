import app from './master-project-entry';
import { registerGoverningAttestationRoutes } from './governing-attestation-routes';
import { registerActivityOwnDocumentationRoutes } from './activity-own-documentation-routes';

registerGoverningAttestationRoutes(app as any);
registerActivityOwnDocumentationRoutes(app as any);

export default app;
