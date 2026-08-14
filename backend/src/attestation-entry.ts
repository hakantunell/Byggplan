import app from './master-project-entry';
import { registerGoverningAttestationRoutes } from './governing-attestation-routes';
import { registerActivityOwnDocumentationRoutes } from './activity-own-documentation-routes';
import { registerProjectDocumentCategoryRoutes } from './project-document-category-routes';
import { registerProjectDocumentAnnotationRoutes } from './project-document-annotation-routes';

registerGoverningAttestationRoutes(app as any);
registerActivityOwnDocumentationRoutes(app as any);
registerProjectDocumentCategoryRoutes(app as any);
registerProjectDocumentAnnotationRoutes(app as any);

export default app;
