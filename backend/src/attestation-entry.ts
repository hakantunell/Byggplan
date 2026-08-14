import app from './master-project-entry';
import { registerGoverningAttestationRoutes } from './governing-attestation-routes';
import { registerActivityOwnDocumentationRoutes } from './activity-own-documentation-routes';
import { registerProjectDocumentCategoryRoutes } from './project-document-category-routes';
import { registerProjectDocumentAnnotationRoutes } from './project-document-annotation-routes';

const ANNOTATION_RUNTIME_VERSION = '2026-08-14-v2';

registerGoverningAttestationRoutes(app as any);
registerActivityOwnDocumentationRoutes(app as any);
registerProjectDocumentCategoryRoutes(app as any);
registerProjectDocumentAnnotationRoutes(app as any);

app.get('/api/project-document-annotations-version', c => c.json({ ok: true, version: ANNOTATION_RUNTIME_VERSION }));

export default app;
