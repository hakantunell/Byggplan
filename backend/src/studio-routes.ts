import app from './index';

type JsonBody = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function nextSortOrder(db: D1Database, table: string, parentColumn: string, parentId: string) {
  const allowed = new Set(['work_areas', 'work_sections', 'tasks', 'activities']);
  const allowedParents = new Set(['project_id', 'work_area_id', 'work_section_id', 'task_id']);
  if (!allowed.has(table) || !allowedParents.has(parentColumn)) throw new Error('Ogiltig sorteringsfråga.');
  const row = await db.prepare(
    `SELECT COALESCE(MAX(sort_order),0)+10 AS next_order FROM ${table} WHERE ${parentColumn}=?`
  ).bind(parentId).first<{ next_order: number }>();
  return row?.next_order ?? 10;
}

app.post('/api/studio/work-areas', async c => {
  const body = await c.req.json<JsonBody>();
  const projectId = text(body.projectId);
  const name = text(body.name);
  if (!projectId || !name) return c.json({ ok: false, error: 'Projekt och namn krävs.' }, 400);
  const project = await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
  if (!project) return c.json({ ok: false, error: 'Projektet hittades inte.' }, 404);
  const id = crypto.randomUUID();
  const sortOrder = await nextSortOrder(c.env.DB, 'work_areas', 'project_id', projectId);
  await c.env.DB.prepare(
    'INSERT INTO work_areas(id,project_id,name,sort_order) VALUES(?,?,?,?)'
  ).bind(id, projectId, name, sortOrder).run();
  return c.json({ ok: true, id }, 201);
});

app.put('/api/studio/work-areas/:id', async c => {
  const name = text((await c.req.json<JsonBody>()).name);
  if (!name) return c.json({ ok: false, error: 'Namn krävs.' }, 400);
  const result = await c.env.DB.prepare('UPDATE work_areas SET name=? WHERE id=?').bind(name, c.req.param('id')).run();
  if (!result.meta.changes) return c.json({ ok: false, error: 'Arbetsområdet hittades inte.' }, 404);
  return c.json({ ok: true });
});

app.post('/api/studio/work-sections', async c => {
  const body = await c.req.json<JsonBody>();
  const workAreaId = text(body.workAreaId);
  const name = text(body.name);
  if (!workAreaId || !name) return c.json({ ok: false, error: 'Arbetsområde och namn krävs.' }, 400);
  const parent = await c.env.DB.prepare('SELECT id FROM work_areas WHERE id=?').bind(workAreaId).first();
  if (!parent) return c.json({ ok: false, error: 'Arbetsområdet hittades inte.' }, 404);
  const id = crypto.randomUUID();
  const sortOrder = await nextSortOrder(c.env.DB, 'work_sections', 'work_area_id', workAreaId);
  await c.env.DB.prepare(
    'INSERT INTO work_sections(id,work_area_id,name,sort_order) VALUES(?,?,?,?)'
  ).bind(id, workAreaId, name, sortOrder).run();
  return c.json({ ok: true, id }, 201);
});

app.put('/api/studio/work-sections/:id', async c => {
  const name = text((await c.req.json<JsonBody>()).name);
  if (!name) return c.json({ ok: false, error: 'Namn krävs.' }, 400);
  const result = await c.env.DB.prepare('UPDATE work_sections SET name=? WHERE id=?').bind(name, c.req.param('id')).run();
  if (!result.meta.changes) return c.json({ ok: false, error: 'Arbetsavsnittet hittades inte.' }, 404);
  return c.json({ ok: true });
});

app.post('/api/studio/tasks', async c => {
  const body = await c.req.json<JsonBody>();
  const workSectionId = text(body.workSectionId);
  const title = text(body.title);
  const description = text(body.description);
  if (!workSectionId || !title) return c.json({ ok: false, error: 'Arbetsavsnitt och namn krävs.' }, 400);
  const parent = await c.env.DB.prepare('SELECT id FROM work_sections WHERE id=?').bind(workSectionId).first();
  if (!parent) return c.json({ ok: false, error: 'Arbetsavsnittet hittades inte.' }, 404);
  const id = crypto.randomUUID();
  const sortOrder = await nextSortOrder(c.env.DB, 'tasks', 'work_section_id', workSectionId);
  await c.env.DB.prepare(`
    INSERT INTO tasks(id,work_section_id,title,description,status,sort_order,updated_at)
    VALUES(?,?,?,?,'todo',?,datetime('now'))
  `).bind(id, workSectionId, title, description, sortOrder).run();
  return c.json({ ok: true, id }, 201);
});

app.put('/api/studio/tasks/:id', async c => {
  const body = await c.req.json<JsonBody>();
  const title = text(body.title);
  const description = text(body.description);
  if (!title) return c.json({ ok: false, error: 'Namn krävs.' }, 400);
  const result = await c.env.DB.prepare(
    "UPDATE tasks SET title=?,description=?,updated_at=datetime('now') WHERE id=?"
  ).bind(title, description, c.req.param('id')).run();
  if (!result.meta.changes) return c.json({ ok: false, error: 'Momentet hittades inte.' }, 404);
  return c.json({ ok: true });
});

app.post('/api/studio/activities', async c => {
  const body = await c.req.json<JsonBody>();
  const taskId = text(body.taskId);
  const title = text(body.title);
  const description = text(body.description);
  const activityType = text(body.activityType) || 'work';
  if (!taskId || !title) return c.json({ ok: false, error: 'Moment och namn krävs.' }, 400);
  const parent = await c.env.DB.prepare('SELECT id FROM tasks WHERE id=?').bind(taskId).first();
  if (!parent) return c.json({ ok: false, error: 'Momentet hittades inte.' }, 404);
  const id = crypto.randomUUID();
  const sortOrder = await nextSortOrder(c.env.DB, 'activities', 'task_id', taskId);
  await c.env.DB.prepare(`
    INSERT INTO activities
      (id,task_id,title,description,activity_type,required,blocking,irreversible,sort_order)
    VALUES(?,?,?,?,?,1,0,0,?)
  `).bind(id, taskId, title, description, activityType, sortOrder).run();
  return c.json({ ok: true, id }, 201);
});

app.put('/api/studio/activities/:id', async c => {
  const body = await c.req.json<JsonBody>();
  const title = text(body.title);
  const description = text(body.description);
  const activityType = text(body.activityType) || 'work';
  if (!title) return c.json({ ok: false, error: 'Namn krävs.' }, 400);
  const result = await c.env.DB.prepare(
    'UPDATE activities SET title=?,description=?,activity_type=? WHERE id=?'
  ).bind(title, description, activityType, c.req.param('id')).run();
  if (!result.meta.changes) return c.json({ ok: false, error: 'Aktiviteten hittades inte.' }, 404);
  return c.json({ ok: true });
});

export default app;
