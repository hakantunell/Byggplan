import app from './master-project-entry';
import { registerGoverningAttestationRoutes } from './governing-attestation-routes';

registerGoverningAttestationRoutes(app as any);

export default app;
