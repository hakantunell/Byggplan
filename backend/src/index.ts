import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
  FILES: R2Bucket;
  ALLOWED_ORIGIN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', async (c, next) => cors({
  origin: c.env.ALLOWED_ORIGIN,
  allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowHeaders: ['Content-Type']
})(c, next));

app.onError((error, c) => {
  console.error('Unhandled API error', error);
  return c.json({ ok: false, error: 'Ett internt fel uppstod i ByggPlan API.' }, 500);
});

app.get('/health', async c => {
  const database = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
  return c.json({ ok: database?.ok === 1, service: 'byggplan-api', database: database?.ok === 1 });
});

app.get('/api/projects', async c => {
  const result = await c.env.DB.prepare(`
    SELECT p.id, p.name, p.property_designation, p.status,
           COUNT(DISTINCT wa.id) AS work_area_count,
           COUNT(DISTINCT ws.id) AS work_section_count,
           COUNT(DISTINCT t.id) AS task_count
    FROM projects p
    LEFT JOIN work_areas wa ON wa.project_id = p.id
    LEFT JOIN work_sections ws ON ws.work_area_id = wa.id
    LEFT JOIN tasks t ON t.work_section_id = ws.id
    GROUP BY p.id
    ORDER BY p.sort_order, p.name
  `).all();

  return c.json({ projects: result.results });
});

app.get('/api/projects/:projectId/hierarchy', async c => {
  const projectId = c.req.param('projectId');
  const rows = await c.env.DB.prepare(`
    SELECT p.id AS project_id, p.name AS project_name,
           wa.id AS area_id, wa.name AS area_name, wa.status AS area_status,
           ws.id AS section_id, ws.name AS section_name, ws.status AS section_status,
           t.id AS task_id, t.title AS task_title, t.status AS task_status, t.assignee
    FROM projects p
    LEFT JOIN work_areas wa ON wa.project_id = p.id
    LEFT JOIN work_sections ws ON ws.work_area_id = wa.id
    LEFT JOIN tasks t ON t.work_section_id = ws.id
    WHERE p.id = ?
    ORDER BY wa.sort_order, ws.sort_order, t.sort_order
  `).bind(projectId).all();

  if (!rows.results.length) return c.json({ ok: false, error: 'Projektet hittades inte.' }, 404);

  const first = rows.results[0] as any;
  const project: any = { id: first.project_id, name: first.project_name, workAreas: [] };
  const areaMap = new Map<string, any>();
  const sectionMap = new Map<string, any>();

  for (const row of rows.results as any[]) {
    if (!row.area_id) continue;
    if (!areaMap.has(row.area_id)) {
      const area = { id: row.area_id, name: row.area_name, status: row.area_status, workSections: [] };
      areaMap.set(row.area_id, area);
      project.workAreas.push(area);
    }
    if (!row.section_id) continue;
    if (!sectionMap.has(row.section_id)) {
      const section = { id: row.section_id, name: row.section_name, status: row.section_status, tasks: [] };
      sectionMap.set(row.section_id, section);
      areaMap.get(row.area_id).workSections.push(section);
    }
    if (row.task_id) sectionMap.get(row.section_id).tasks.push({
      id: row.task_id,
      title: row.task_title,
      status: row.task_status,
      assignee: row.assignee
    });
  }

  return c.json({ project });
});

app.get('/api/tasks', async c => {
  const projectId = c.req.query('projectId');
  const where = projectId ? 'WHERE p.id = ?' : '';
  const statement = c.env.DB.prepare(`
    SELECT t.id, t.title, t.description, t.status, t.assignee,
           ws.id AS work_section_id, ws.name AS work_section,
           wa.id AS work_area_id, wa.name AS work_area,
           p.id AS project_id, p.name AS project_name,
           r.id AS requirement_id, r.label, r.kind, r.unit, r.minimum, r.required,
           a.value, COALESCE(a.done, 0) AS done
    FROM tasks t
    JOIN work_sections ws ON ws.id = t.work_section_id
    JOIN work_areas wa ON wa.id = ws.work_area_id
    JOIN projects p ON p.id = wa.project_id
    LEFT JOIN requirements r ON r.task_id = t.id
    LEFT JOIN answers a ON a.requirement_id = r.id
    ${where}
    ORDER BY wa.sort_order, ws.sort_order, t.sort_order, r.sort_order
  `);
  const tasks = projectId ? await statement.bind(projectId).all() : await statement.all();

  const grouped = new Map<string, any>();
  for (const row of tasks.results as any[]) {
    if (!grouped.has(row.id)) grouped.set(row.id, {
      id: row.id,
      projectId: row.project_id,
      project: row.project_name,
      workAreaId: row.work_area_id,
      workArea: row.work_area,
      workSectionId: row.work_section_id,
      workSection: row.work_section,
      section: row.work_area,
      title: row.title,
      description: row.description,
      status: row.status,
      assignee: row.assignee,
      requirements: []
    });
    if (row.requirement_id) grouped.get(row.id).requirements.push({
      id: row.requirement_id,
      label: row.label,
      kind: row.kind,
      unit: row.unit,
      min: row.minimum,
      required: Boolean(row.required),
      value: row.value,
      done: Boolean(row.done)
    });
  }
  return c.json({ tasks: [...grouped.values()] });
});

app.put('/api/requirements/:id', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<{ value?: string; done?: boolean }>();
  await c.env.DB.prepare(`
    INSERT INTO answers (id, requirement_id, value, done, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(requirement_id) DO UPDATE SET value=excluded.value, done=excluded.done, updated_at=datetime('now')
  `).bind(crypto.randomUUID(), id, body.value ?? null, body.done ? 1 : 0).run();
  return c.json({ ok: true });
});

app.post('/api/tasks/:id/review', async c => {
  const id = c.req.param('id');
  await c.env.DB.prepare("UPDATE tasks SET status='review', updated_at=datetime('now') WHERE id=?").bind(id).run();
  await c.env.DB.prepare("INSERT INTO notifications (id, type, task_id, message, created_at) VALUES (?, 'review', ?, ?, datetime('now'))")
    .bind(crypto.randomUUID(), id, 'Moment redo för arbetsledarens kontroll').run();
  return c.json({ ok: true });
});

export default app;
