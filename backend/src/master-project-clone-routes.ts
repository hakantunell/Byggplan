type RouteApp = {
  post: (path: string, handler: (c: any) => unknown) => void;
};

type CloneBody = { name?: string; propertyDesignation?: string };
function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }

async function ensureSnapshotSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS project_master_snapshots (
    project_id TEXT PRIMARY KEY,
    master_project_id TEXT NOT NULL,
    master_project_code TEXT NOT NULL,
    master_project_version INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS project_master_node_links (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('work_area','work_section','task','activity')),
    entity_id TEXT NOT NULL,
    master_entity_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(project_id,entity_type,entity_id),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_project_master_node_links_project ON project_master_node_links(project_id,entity_type)').run();
}

export function registerMasterProjectCloneRoutes(app: RouteApp) {
  app.post('/api/studio/master-projects/:masterProjectId/create-project', async c => {
    await ensureSnapshotSchema(c.env.DB);
    const masterProjectId = c.req.param('masterProjectId');
    const body = await c.req.json<CloneBody>().catch(() => ({}));
    const name = text(body.name);
    const propertyDesignation = text(body.propertyDesignation);
    if (!name) return c.json({ ok:false, error:'Projektnamn krävs.' }, 400);

    const master = await c.env.DB.prepare('SELECT id,code,name,version,status FROM master_projects WHERE id=?').bind(masterProjectId).first<any>();
    if (!master) return c.json({ ok:false, error:'Masterprojektet hittades inte.' }, 404);
    if (master.status !== 'active') return c.json({ ok:false, error:'Endast aktiva masterprojekt kan användas för nya projekt.' }, 409);

    const [areasResult, sectionsResult, tasksResult, activitiesResult] = await Promise.all([
      c.env.DB.prepare('SELECT id,number,name,sort_order FROM master_work_areas WHERE master_project_id=? ORDER BY sort_order,id').bind(masterProjectId).all(),
      c.env.DB.prepare(`SELECT s.id,s.master_work_area_id,s.number,s.name,s.sort_order FROM master_work_sections s JOIN master_work_areas a ON a.id=s.master_work_area_id WHERE a.master_project_id=? ORDER BY a.sort_order,s.sort_order,s.id`).bind(masterProjectId).all(),
      c.env.DB.prepare(`SELECT t.id,t.master_work_section_id,t.title,t.description,t.sort_order FROM master_tasks t JOIN master_work_sections s ON s.id=t.master_work_section_id JOIN master_work_areas a ON a.id=s.master_work_area_id WHERE a.master_project_id=? ORDER BY a.sort_order,s.sort_order,t.sort_order,t.id`).bind(masterProjectId).all(),
      c.env.DB.prepare(`SELECT ac.id,ac.master_task_id,ac.title,ac.description,ac.activity_type,ac.required,ac.sort_order FROM master_activities ac JOIN master_tasks t ON t.id=ac.master_task_id JOIN master_work_sections s ON s.id=t.master_work_section_id JOIN master_work_areas a ON a.id=s.master_work_area_id WHERE a.master_project_id=? ORDER BY a.sort_order,s.sort_order,t.sort_order,ac.sort_order,ac.id`).bind(masterProjectId).all()
    ]);

    const areas = areasResult.results as any[];
    const sections = sectionsResult.results as any[];
    const tasks = tasksResult.results as any[];
    const activities = activitiesResult.results as any[];
    if (!areas.length) return c.json({ ok:false, error:'Masterprojektet innehåller inga arbetsområden.' }, 409);

    const projectId = crypto.randomUUID();
    const areaMap = new Map<string,string>();
    const sectionMap = new Map<string,string>();
    const taskMap = new Map<string,string>();
    const order = await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM projects').first<{next_order:number}>();
    const nextProjectOrder = Number(order?.next_order ?? 10);

    try {
      await c.env.DB.prepare(`INSERT INTO projects(id,name,property_designation,status,sort_order,created_at,updated_at) VALUES(?,?,?,'active',?,datetime('now'),datetime('now'))`).bind(projectId,name,propertyDesignation || null,nextProjectOrder).run();
      await c.env.DB.prepare(`INSERT INTO project_master_snapshots(project_id,master_project_id,master_project_code,master_project_version) VALUES(?,?,?,?)`).bind(projectId,master.id,master.code,Number(master.version)).run();

      for (const source of areas) {
        const id = crypto.randomUUID(); areaMap.set(source.id,id);
        await c.env.DB.prepare(`INSERT INTO work_areas(id,project_id,name,description,status,sort_order,created_at,updated_at) VALUES(?,?,?,?,'todo',?,datetime('now'),datetime('now'))`).bind(id,projectId,source.name,source.number ? `Masterkod ${source.number}` : null,Number(source.sort_order)).run();
        await c.env.DB.prepare(`INSERT INTO project_master_node_links(id,project_id,entity_type,entity_id,master_entity_id) VALUES(?,?,'work_area',?,?)`).bind(crypto.randomUUID(),projectId,id,source.id).run();
      }
      for (const source of sections) {
        const parentId = areaMap.get(source.master_work_area_id); if (!parentId) throw new Error(`Saknar arbetsområde för ${source.name}.`);
        const id = crypto.randomUUID(); sectionMap.set(source.id,id);
        await c.env.DB.prepare(`INSERT INTO work_sections(id,work_area_id,name,description,status,sort_order,created_at,updated_at) VALUES(?,?,?,?,'todo',?,datetime('now'),datetime('now'))`).bind(id,parentId,source.name,source.number ? `Masterkod ${source.number}` : null,Number(source.sort_order)).run();
        await c.env.DB.prepare(`INSERT INTO project_master_node_links(id,project_id,entity_type,entity_id,master_entity_id) VALUES(?,?,'work_section',?,?)`).bind(crypto.randomUUID(),projectId,id,source.id).run();
      }
      for (const source of tasks) {
        const parentId = sectionMap.get(source.master_work_section_id); if (!parentId) throw new Error(`Saknar arbetsavsnitt för ${source.title}.`);
        const section = sections.find(item => item.id === source.master_work_section_id);
        const id = crypto.randomUUID(); taskMap.set(source.id,id);
        await c.env.DB.prepare(`INSERT INTO tasks(id,work_section_id,section,title,description,status,sort_order,updated_at) VALUES(?,?,?,?,?,'todo',?,datetime('now'))`).bind(id,parentId,section?.name || '',source.title,source.description || '',Number(source.sort_order)).run();
        await c.env.DB.prepare(`INSERT INTO project_master_node_links(id,project_id,entity_type,entity_id,master_entity_id) VALUES(?,?,'task',?,?)`).bind(crypto.randomUUID(),projectId,id,source.id).run();
      }
      for (const source of activities) {
        const parentId = taskMap.get(source.master_task_id); if (!parentId) throw new Error(`Saknar moment för ${source.title}.`);
        const id = crypto.randomUUID();
        await c.env.DB.prepare(`INSERT INTO activities(id,task_id,title,description,activity_type,required,blocking,irreversible,sort_order) VALUES(?,?,?,?,?,?,0,0,?)`).bind(id,parentId,source.title,source.description || '',source.activity_type,Number(source.required ?? 1),Number(source.sort_order)).run();
        await c.env.DB.prepare(`INSERT INTO project_master_node_links(id,project_id,entity_type,entity_id,master_entity_id) VALUES(?,?,'activity',?,?)`).bind(crypto.randomUUID(),projectId,id,source.id).run();
      }
    } catch (error) {
      await c.env.DB.prepare('DELETE FROM projects WHERE id=?').bind(projectId).run().catch(() => undefined);
      console.error('Master project clone failed', error);
      return c.json({ ok:false, error:error instanceof Error ? error.message : 'Projektet kunde inte skapas.' }, 500);
    }

    return c.json({
      ok:true,
      project:{ id:projectId,name,propertyDesignation:propertyDesignation || null,status:'active' },
      snapshot:{ masterProjectId:master.id,code:master.code,version:Number(master.version) },
      created:{ areas:areas.length,sections:sections.length,tasks:tasks.length,activities:activities.length }
    },201);
  });
}
