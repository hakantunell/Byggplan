import app from './master-project-entry';
import { registerGoverningAttestationRoutes } from './governing-attestation-routes';
import { registerActivityOwnDocumentationRoutes } from './activity-own-documentation-routes';
import { registerProjectDocumentCategoryRoutes } from './project-document-category-routes';
import { registerAuthRoutes } from './auth-routes';

registerAuthRoutes(app as any);
registerGoverningAttestationRoutes(app as any);
registerActivityOwnDocumentationRoutes(app as any);
registerProjectDocumentCategoryRoutes(app as any);

export default app;
