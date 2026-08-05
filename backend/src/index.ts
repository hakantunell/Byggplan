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

app.get('/health', c => c.json({ ok: true, service: 'byggplan-api' }));

app.get('/api/tasks', async c => {
  const tasks = await c.env.DB.prepare(`
    SELECT t.id, t.section, t.title, t.description, t.status, t.assignee,
           r.id AS requirement_id, r.label, r.kind, r.unit, r.minimum, r.required,
           a.value, CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS done
    FROM tasks t
    LEFT JOIN requirements r ON r.task_id = t.id
    LEFT JOIN answers a ON a.requirement_id = r.id
    ORDER BY t.sort_order, r.sort_order
  `).all();

  const grouped = new Map<string, any>();
  for (const row of tasks.results as any[]) {
    if (!grouped.has(row.id)) grouped.set(row.id, { id: row.id, section: row.section, title: row.title, description: row.description, status: row.status, assignee: row.assignee, requirements: [] });
    if (row.requirement_id) grouped.get(row.id).requirements.push({ id: row.requirement_id, label: row.label, kind: row.kind, unit: row.unit, min: row.minimum, required: Boolean(row.required), value: row.value, done: Boolean(row.done) });
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
