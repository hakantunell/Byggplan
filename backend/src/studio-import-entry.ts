import app from './studio-routes';

type ImportActivity = { title?: string; description?: string; type?: string };
type ImportTask = { title?: string; description?: string; activities?: ImportActivity[] };
type ImportSection = { name?: string; tasks?: ImportTask[] };
type ImportBody = {
  projectId?: string;
  targetWorkAreaId?: string;
  areaName?: string;
  sections?: ImportSection[];
};

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

app.post('/api/studio/import-tree', async c => {
  const body = await c.req.json<ImportBody>();
  const projectId = clean(body.projectId);
  const targetWorkAreaId = clean(body.targetWorkAreaId);
  const areaName = clean(body.areaName);
  const sections = Array.isArray(body.sections) ? body.sections : [];

  if (!sections.length) {
    return c.json({ ok: false, error: 'Importen innehåller inga arbetsavsnitt.' }, 400);
  }

  let workAreaId = targetWorkAreaId;
  let sectionOrder = 0;
  const statements: D1PreparedStatement[] = [];

  if (workAreaId) {
    const area = await c.env.DB.prepare(
      'SELECT id,project_id FROM work_areas WHERE id=?'
    ).bind(workAreaId).first<{ id: string; project_id: string }>();

    if (!area) return c.json({ ok: false, error: 'Målarbetsområdet hittades inte.' }, 404);
    if (projectId && area.project_id !== projectId) {
      return c.json({ ok: false, error: 'Arbetsområdet tillhör inte valt projekt.' }, 409);
    }

    const orderRow = await c.env.DB.prepare(
      'SELECT COALESCE(MAX(sort_order),0) AS max_order FROM work_sections WHERE work_area_id=?'
    ).bind(workAreaId).first<{ max_order: number }>();
    sectionOrder = Number(orderRow?.max_order ?? 0);
  } else {
    if (!projectId || !areaName) {
      return c.json({ ok: false, error: 'Projekt och namn på arbetsområde krävs.' }, 400);
    }

    const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id=?')
      .bind(projectId).first();
    if (!project) return c.json({ ok: false, error: 'Projektet hittades inte.' }, 404);

    const orderRow = await c.env.DB.prepare(
      'SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM work_areas WHERE project_id=?'
    ).bind(projectId).first<{ next_order: number }>();

    workAreaId = crypto.randomUUID();
    statements.push(c.env.DB.prepare(
      'INSERT INTO work_areas(id,project_id,name,sort_order) VALUES(?,?,?,?)'
    ).bind(workAreaId, projectId, areaName, Number(orderRow?.next_order ?? 10)));
  }

  let sectionCount = 0;
  let taskCount = 0;
  let activityCount = 0;

  for (const section of sections) {
    const sectionName = clean(section.name);
    if (!sectionName) continue;

    sectionOrder += 10;
    const sectionId = crypto.randomUUID();
    statements.push(c.env.DB.prepare(
      'INSERT INTO work_sections(id,work_area_id,name,sort_order) VALUES(?,?,?,?)'
    ).bind(sectionId, workAreaId, sectionName, sectionOrder));
    sectionCount += 1;

    let taskOrder = 0;
    for (const task of section.tasks ?? []) {
      const taskTitle = clean(task.title);
      if (!taskTitle) continue;

      taskOrder += 10;
      const taskId = crypto.randomUUID();
      statements.push(c.env.DB.prepare(`
        INSERT INTO tasks(id,work_section_id,title,description,status,sort_order,updated_at)
        VALUES(?,?,?,?,'todo',?,datetime('now'))
      `).bind(taskId, sectionId, taskTitle, clean(task.description), taskOrder));
      taskCount += 1;

      let activityOrder = 0;
      for (const activity of task.activities ?? []) {
        const activityTitle = clean(activity.title);
        if (!activityTitle) continue;

        activityOrder += 10;
        statements.push(c.env.DB.prepare(`
          INSERT INTO activities
            (id,task_id,title,description,activity_type,required,blocking,irreversible,sort_order)
          VALUES(?,?,?,?,?,1,0,0,?)
        `).bind(
          crypto.randomUUID(), taskId, activityTitle, clean(activity.description),
          clean(activity.type) || 'work', activityOrder
        ));
        activityCount += 1;
      }
    }
  }

  if (!sectionCount) {
    return c.json({ ok: false, error: 'Importen innehåller inga giltiga arbetsavsnitt.' }, 400);
  }

  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    console.error('Studio tree import failed', error);
    return c.json({ ok: false, error: 'Importen kunde inte sparas i databasen.' }, 500);
  }

  return c.json({
    ok: true,
    workAreaId,
    created: { sections: sectionCount, tasks: taskCount, activities: activityCount }
  }, 201);
});

export default app;
