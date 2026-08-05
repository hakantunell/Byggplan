const PROJECT_ID = 'vemdalens-kyrkby-44-10';

const cors = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
});

const json = (data, status = 200, origin = '*') => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) },
});

const now = () => new Date().toISOString();
const allowedOrigin = (request, env) => {
  const origin = request.headers.get('Origin') || '*';
  const configured = env.ALLOWED_ORIGIN || '*';
  return configured === '*' || origin === configured ? origin : configured;
};

async function listTasks(env) {
  const tasks = await env.DB.prepare(`
    SELECT id, section, title, description, status, assignee, blocked_by, updated_at
    FROM tasks WHERE project_id = ? ORDER BY sort_order, created_at
  `).bind(PROJECT_ID).all();

  const requirements = await env.DB.prepare(`
    SELECT id, task_id, label, kind, unit, min_value, required, done, value, updated_at
    FROM requirements WHERE project_id = ? ORDER BY sort_order, created_at
  `).bind(PROJECT_ID).all();

  return tasks.results.map(task => ({
    ...task,
    blockedBy: task.blocked_by ? JSON.parse(task.blocked_by) : [],
    requirements: requirements.results
      .filter(req => req.task_id === task.id)
      .map(req => ({
        id: req.id,
        label: req.label,
        kind: req.kind,
        unit: req.unit,
        min: req.min_value,
        required: Boolean(req.required),
        done: Boolean(req.done),
        value: req.value,
        updatedAt: req.updated_at,
      })),
  }));
}

async function updateRequirement(request, env, taskId, requirementId, origin) {
  const body = await request.json();
  const existing = await env.DB.prepare(`SELECT kind FROM requirements WHERE id = ? AND task_id = ? AND project_id = ?`)
    .bind(requirementId, taskId, PROJECT_ID).first();
  if (!existing) return json({ error: 'Kontrollpunkten finns inte.' }, 404, origin);

  const value = body.value ?? null;
  const done = body.done === undefined ? Boolean(value) : Boolean(body.done);
  const updatedAt = now();
  await env.DB.prepare(`
    UPDATE requirements SET value = ?, done = ?, updated_at = ?
    WHERE id = ? AND task_id = ? AND project_id = ?
  `).bind(value, done ? 1 : 0, updatedAt, requirementId, taskId, PROJECT_ID).run();

  await env.DB.prepare(`INSERT INTO activity_events (id, project_id, task_id, event_type, message, created_at)
    VALUES (?, ?, ?, 'requirement_updated', ?, ?)`)
    .bind(crypto.randomUUID(), PROJECT_ID, taskId, `Kontrollpunkt uppdaterad: ${requirementId}`, updatedAt).run();

  return json({ ok: true, updatedAt }, 200, origin);
}

async function submitTask(env, taskId, origin) {
  const missing = await env.DB.prepare(`
    SELECT COUNT(*) AS count FROM requirements
    WHERE task_id = ? AND project_id = ? AND required = 1 AND done = 0
  `).bind(taskId, PROJECT_ID).first();
  if (!missing) return json({ error: 'Momentet finns inte.' }, 404, origin);
  if (missing.count > 0) return json({ error: `${missing.count} obligatoriska uppgifter saknas.` }, 409, origin);

  const updatedAt = now();
  await env.DB.prepare(`UPDATE tasks SET status = 'review', updated_at = ? WHERE id = ? AND project_id = ?`)
    .bind(updatedAt, taskId, PROJECT_ID).run();
  await env.DB.prepare(`INSERT INTO notifications (id, project_id, task_id, type, title, message, created_at)
    VALUES (?, ?, ?, 'review', 'Moment redo för kontroll', 'Ett moment har skickats för arbetsledarens kontroll.', ?)`)
    .bind(crypto.randomUUID(), PROJECT_ID, taskId, updatedAt).run();
  return json({ ok: true, status: 'review', updatedAt }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        await env.DB.prepare('SELECT 1').first();
        return json({ ok: true, service: 'byggplan-api', time: now() }, 200, origin);
      }
      if (url.pathname === '/api/tasks' && request.method === 'GET') {
        return json({ projectId: PROJECT_ID, tasks: await listTasks(env), serverTime: now() }, 200, origin);
      }
      const reqMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/requirements\/([^/]+)$/);
      if (reqMatch && request.method === 'PUT') return updateRequirement(request, env, reqMatch[1], reqMatch[2], origin);

      const submitMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/submit$/);
      if (submitMatch && request.method === 'POST') return submitTask(env, submitMatch[1], origin);

      if (url.pathname === '/api/notifications' && request.method === 'GET') {
        const result = await env.DB.prepare(`SELECT * FROM notifications WHERE project_id = ? ORDER BY created_at DESC LIMIT 50`)
          .bind(PROJECT_ID).all();
        return json({ notifications: result.results }, 200, origin);
      }
      return json({ error: 'Not found' }, 404, origin);
    } catch (error) {
      console.error(error);
      return json({ error: 'Serverfel', detail: String(error?.message || error) }, 500, origin);
    }
  },
};
