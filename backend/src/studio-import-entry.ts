import app from './studio-routes';
import { registerControlPlanRoutes } from './control-plan-routes';
import { registerGoverningDocumentRoutes } from './governing-document-routes';
import { registerGoverningVerificationRoutesV2 } from './governing-verification-routes-v2';
import { registerGoverningMappingRoutesV3 } from './governing-mapping-routes-v3';
import { registerProjectDocumentRoutes } from './project-document-routes';
import { registerProjectDocumentAnnotationRoutes } from './project-document-annotation-routes';
import { registerProjectAdministrationRoutes } from './project-administration-routes';
import { registerProjectManagementRoutes } from './project-management-routes';

const IMPORT_RUNTIME_VERSION = '2026-08-11-v16';
const ANNOTATION_RUNTIME_VERSION = '2026-08-14-v3';

type ImportClassification = { category?: string; code?: string; label?: string; source?: string };
type ImportActivity = { title?: string; description?: string; type?: string; classifications?: ImportClassification[] };
type ImportTask = { title?: string; description?: string; activities?: ImportActivity[] };
type ImportSection = { name?: string; tasks?: ImportTask[] };
type ImportBody = { projectId?: string; targetWorkAreaId?: string; areaName?: string; sections?: ImportSection[] };
type ClassificationBody = { classifications?: ImportClassification[] };

function clean(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function mapActivityType(value: unknown): string {
  const type = clean(value);
  const mapping: Record<string, string> = { work:'perform',perform:'perform',documentation:'document',document:'document',measurement:'measurement',control:'check',check:'check',approval:'approval',wait:'note',note:'note',choice:'choice' };
  return mapping[type] ?? 'perform';
}
function mapClassificationCategory(value: unknown): string {
  const category = clean(value); const allowed = new Set(['documentation','control_plan','requirement']); return allowed.has(category) ? category : '';
}
async function ensureClassificationSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS activity_classifications (id TEXT PRIMARY KEY,activity_id TEXT NOT NULL,category TEXT NOT NULL CHECK(category IN ('documentation','control_plan','requirement')),code TEXT NOT NULL,label TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'project',created_at TEXT NOT NULL DEFAULT (datetime('now')),UNIQUE(activity_id, category, code),FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_activity_classifications_activity ON activity_classifications(activity_id)`).run();
}
async function insertClassifications(db: D1Database, activityId: string, classifications: ImportClassification[] | undefined, defaultSource: string) {
  for (const classification of classifications ?? []) {
    const category = mapClassificationCategory(classification.category), code = clean(classification.code), label = clean(classification.label);
    if (!category || !code || !label) continue;
    await db.prepare(`INSERT OR IGNORE INTO activity_classifications(id,activity_id,category,code,label,source) VALUES(?,?,?,?,?,?)`).bind(crypto.randomUUID(),activityId,category,code,label,clean(classification.source) || defaultSource).run();
  }
}

app.get('/api/studio/import-version', c => c.json({ ok: true, version: IMPORT_RUNTIME_VERSION }));
app.get('/api/project-document-annotations-version', c => c.json({ ok: true, version: ANNOTATION_RUNTIME_VERSION }));
app.get('/api/studio/activities/:id/classifications', async c => {
  await ensureClassificationSchema(c.env.DB); const activityId=c.req.param('id'); const activity=await c.env.DB.prepare('SELECT id FROM activities WHERE id=?').bind(activityId).first();
  if(!activity)return c.json({ok:false,error:'Aktiviteten hittades inte.'},404);
  const result=await c.env.DB.prepare(`SELECT id,activity_id,category,code,label,source FROM activity_classifications WHERE activity_id=? ORDER BY category,label`).bind(activityId).all();
  return c.json({ok:true,classifications:result.results});
});
app.put('/api/studio/activities/:id/classifications', async c => {
  await ensureClassificationSchema(c.env.DB); const activityId=c.req.param('id'); const activity=await c.env.DB.prepare('SELECT id FROM activities WHERE id=?').bind(activityId).first();
  if(!activity)return c.json({ok:false,error:'Aktiviteten hittades inte.'},404);
  const body=await c.req.json<ClassificationBody>(); await c.env.DB.prepare('DELETE FROM activity_classifications WHERE activity_id=?').bind(activityId).run(); await insertClassifications(c.env.DB,activityId,body.classifications,'project'); return c.json({ok:true});
});

app.post('/api/studio/import-tree', async c => {
  const body=await c.req.json<ImportBody>(); const projectId=clean(body.projectId),targetWorkAreaId=clean(body.targetWorkAreaId),areaName=clean(body.areaName),sections=Array.isArray(body.sections)?body.sections:[];
  if(!sections.length)return c.json({ok:false,error:'Importen innehåller inga arbetsavsnitt.',version:IMPORT_RUNTIME_VERSION},400);
  let workAreaId=targetWorkAreaId,sectionOrder=0,createdArea=false,sectionCount=0,taskCount=0,activityCount=0,classificationCount=0;
  try{
    await ensureClassificationSchema(c.env.DB);
    if(workAreaId){
      const area=await c.env.DB.prepare('SELECT id,project_id FROM work_areas WHERE id=?').bind(workAreaId).first<{id:string;project_id:string}>();
      if(!area)return c.json({ok:false,error:'Målarbetsområdet hittades inte.',version:IMPORT_RUNTIME_VERSION},404);
      if(projectId&&area.project_id!==projectId)return c.json({ok:false,error:'Arbetsområdet tillhör inte valt projekt.',version:IMPORT_RUNTIME_VERSION},409);
      const orderRow=await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order),0) AS max_order FROM work_sections WHERE work_area_id=?').bind(workAreaId).first<{max_order:number}>(); sectionOrder=Number(orderRow?.max_order??0);
    }else{
      if(!projectId||!areaName)return c.json({ok:false,error:'Projekt och namn på arbetsområde krävs.',version:IMPORT_RUNTIME_VERSION},400);
      const project=await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first(); if(!project)return c.json({ok:false,error:'Projektet hittades inte.',version:IMPORT_RUNTIME_VERSION},404);
      const orderRow=await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM work_areas WHERE project_id=?').bind(projectId).first<{next_order:number}>();
      workAreaId=crypto.randomUUID(); await c.env.DB.prepare('INSERT INTO work_areas(id,project_id,name,sort_order) VALUES(?,?,?,?)').bind(workAreaId,projectId,areaName,Number(orderRow?.next_order??10)).run(); createdArea=true;
    }
    for(const section of sections){ const sectionName=clean(section.name); if(!sectionName)continue; sectionOrder+=10; const sectionId=crypto.randomUUID(); await c.env.DB.prepare('INSERT INTO work_sections(id,work_area_id,name,sort_order) VALUES(?,?,?,?,?)').bind(sectionId,workAreaId,sectionName,sectionOrder).run(); sectionCount+=1; let taskOrder=0;
      for(const task of section.tasks??[]){ const taskTitle=clean(task.title); if(!taskTitle)continue; taskOrder+=10; const taskId=crypto.randomUUID(); await c.env.DB.prepare(`INSERT INTO tasks(id,work_section_id,section,title,description,status,sort_order,updated_at) VALUES(?,?,?,?,?,'todo',?,datetime('now'))`).bind(taskId,sectionId,sectionName,taskTitle,clean(task.description),taskOrder).run(); taskCount+=1; let activityOrder=0;
        for(const activity of task.activities??[]){ const activityTitle=clean(activity.title); if(!activityTitle)continue; activityOrder+=10; const activityId=crypto.randomUUID(); await c.env.DB.prepare(`INSERT INTO activities(id,task_id,title,description,activity_type,required,blocking,irreversible,sort_order) VALUES(?,?,?,?,?,1,0,0,?)`).bind(activityId,taskId,activityTitle,clean(activity.description),mapActivityType(activity.type),activityOrder).run(); activityCount+=1; await insertClassifications(c.env.DB,activityId,activity.classifications,'module'); classificationCount+=(activity.classifications??[]).filter(item=>mapClassificationCategory(item.category)&&clean(item.code)&&clean(item.label)).length; }
      }
    }
    if(!sectionCount){ if(createdArea)await c.env.DB.prepare('DELETE FROM work_areas WHERE id=?').bind(workAreaId).run(); return c.json({ok:false,error:'Importen innehåller inga giltiga arbetsavsnitt.',version:IMPORT_RUNTIME_VERSION},400); }
  }catch(error){ console.error('Studio tree import failed',error); const databaseError=error instanceof Error?error.message:String(error); return c.json({ok:false,error:`Import v16: ${databaseError}`,progress:{sections:sectionCount,tasks:taskCount,activities:activityCount,classifications:classificationCount},version:IMPORT_RUNTIME_VERSION},500); }
  return c.json({ok:true,version:IMPORT_RUNTIME_VERSION,workAreaId,created:{sections:sectionCount,tasks:taskCount,activities:activityCount,classifications:classificationCount}},201);
});

registerControlPlanRoutes(app as any);
registerGoverningDocumentRoutes(app as any);
registerGoverningVerificationRoutesV2(app as any);
registerGoverningMappingRoutesV3(app as any);
registerProjectDocumentRoutes(app as any);
registerProjectDocumentAnnotationRoutes(app as any);
registerProjectAdministrationRoutes(app as any);
registerProjectManagementRoutes(app as any);

export default app;