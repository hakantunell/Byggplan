import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = { DB: D1Database; FILES: R2Bucket; ALLOWED_ORIGIN: string };
const app = new Hono<{ Bindings: Bindings }>();

app.use('*', async (c, next) => cors({
  origin: [c.env.ALLOWED_ORIGIN, 'https://byggplan-web.hakan-tunell.workers.dev'],
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
      areaMap.set(row.area_id, area); project.workAreas.push(area);
    }
    if (!row.section_id) continue;
    if (!sectionMap.has(row.section_id)) {
      const section = { id: row.section_id, name: row.section_name, status: row.section_status, tasks: [] };
      sectionMap.set(row.section_id, section); areaMap.get(row.area_id).workSections.push(section);
    }
    if (row.task_id) sectionMap.get(row.section_id).tasks.push({ id: row.task_id, title: row.task_title, status: row.task_status, assignee: row.assignee });
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
           p.id AS project_id, p.name AS project_name
    FROM tasks t
    JOIN work_sections ws ON ws.id = t.work_section_id
    JOIN work_areas wa ON wa.id = ws.work_area_id
    JOIN projects p ON p.id = wa.project_id
    ${where}
    ORDER BY wa.sort_order, ws.sort_order, t.sort_order
  `);
  const taskRows = projectId ? await statement.bind(projectId).all() : await statement.all();
  const grouped = new Map<string, any>();
  for (const row of taskRows.results as any[]) grouped.set(row.id, {
    id: row.id, projectId: row.project_id, project: row.project_name,
    workAreaId: row.work_area_id, workArea: row.work_area,
    workSectionId: row.work_section_id, workSection: row.work_section,
    title: row.title, description: row.description, status: row.status,
    assignee: row.assignee, activities: [], technical: []
  });

  if (grouped.size) {
    const activityRows = await c.env.DB.prepare(`
      SELECT a.id, a.task_id, a.title, a.description, a.activity_type, a.unit,
             a.required, a.blocking, a.irreversible, a.technical_resource_id,
             COALESCE(e.done, 0) AS done, e.value, e.completed_by, e.completed_at
      FROM activities a
      LEFT JOIN activity_entries e ON e.activity_id = a.id
      ORDER BY a.task_id, a.sort_order
    `).all();
    for (const row of activityRows.results as any[]) {
      const task = grouped.get(row.task_id);
      if (!task) continue;
      task.activities.push({
        id: row.id, title: row.title, description: row.description,
        type: row.activity_type, unit: row.unit ?? undefined,
        required: Boolean(row.required), blocking: Boolean(row.blocking),
        irreversible: Boolean(row.irreversible), technicalResourceId: row.technical_resource_id ?? undefined,
        done: Boolean(row.done), value: row.value ?? undefined,
        completedBy: row.completed_by ?? undefined, completedAt: row.completed_at ?? undefined
      });
    }
  }

  const projectIds = [...new Set([...grouped.values()].map(task => task.projectId))];
  for (const id of projectIds) {
    const resources = await c.env.DB.prepare(`
      SELECT tr.id, tr.resource_type, tr.title, tr.summary, tr.revision,
             tr.object_key, tr.external_url, tr.content_text,
             l.entity_type, l.entity_id, l.sort_order
      FROM technical_resources tr
      JOIN technical_resource_links l ON l.technical_resource_id = tr.id
      WHERE tr.project_id = ? AND tr.status = 'current'
      ORDER BY l.sort_order, tr.title
    `).bind(id).all();
    for (const row of resources.results as any[]) {
      const resource = {
        id: row.id, type: mapResourceType(row.resource_type), title: row.title,
        summary: row.summary ?? '', revision: row.revision ?? undefined,
        details: row.content_text ? String(row.content_text).split('\n').filter(Boolean) : [],
        objectKey: row.object_key ?? undefined, externalUrl: row.external_url ?? undefined,
        sourceLevel: row.entity_type
      };
      for (const task of grouped.values()) {
        if (task.projectId !== id) continue;
        const applies = (row.entity_type === 'project' && row.entity_id === task.projectId)
          || (row.entity_type === 'work_area' && row.entity_id === task.workAreaId)
          || (row.entity_type === 'work_section' && row.entity_id === task.workSectionId)
          || (row.entity_type === 'task' && row.entity_id === task.id);
        if (applies && !task.technical.some((item: any) => item.id === resource.id)) task.technical.push(resource);
      }
    }
  }
  return c.json({ tasks: [...grouped.values()] });
});

app.put('/api/activities/:id', async c => {
  const id = c.req.param('id');
  const body = await c.req.json<{ value?: string | null; done?: boolean; completedBy?: string }>();
  const exists = await c.env.DB.prepare('SELECT id FROM activities WHERE id = ?').bind(id).first();
  if (!exists) return c.json({ ok: false, error: 'Aktiviteten hittades inte.' }, 404);
  await c.env.DB.prepare(`
    INSERT INTO activity_entries (id, activity_id, value, done, completed_by, completed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END, datetime('now'))
    ON CONFLICT(activity_id) DO UPDATE SET
      value=excluded.value,
      done=excluded.done,
      completed_by=excluded.completed_by,
      completed_at=CASE WHEN excluded.done = 1 THEN datetime('now') ELSE NULL END,
      updated_at=datetime('now')
  `).bind(crypto.randomUUID(), id, body.value ?? null, body.done ? 1 : 0, body.completedBy ?? null, body.done ? 1 : 0).run();
  return c.json({ ok: true });
});

app.post('/api/tasks/:id/review', async c => {
  const id = c.req.param('id');
  const missing = await c.env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM activities a
    LEFT JOIN activity_entries e ON e.activity_id = a.id
    WHERE a.task_id = ? AND a.required = 1 AND COALESCE(e.done, 0) = 0
  `).bind(id).first<{ count: number }>();
  if ((missing?.count ?? 0) > 0) return c.json({ ok: false, error: `${missing?.count} obligatoriska aktiviteter återstår.` }, 409);
  await c.env.DB.prepare("UPDATE tasks SET status='review', updated_at=datetime('now') WHERE id=?").bind(id).run();
  await c.env.DB.prepare("INSERT INTO notifications (id, type, task_id, message, created_at) VALUES (?, 'review', ?, ?, datetime('now'))")
    .bind(crypto.randomUUID(), id, 'Moment redo för arbetsledarens kontroll').run();
  return c.json({ ok: true });
});

function mapResourceType(type: string) {
  if (type === 'technical_data' || type === 'note' || type === 'link') return 'text';
  return type;
}

export default app;
