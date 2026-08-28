type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;put:(path:string,handler:(c:any)=>unknown)=>void};

async function ensureSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS activity_comments(
    activity_id TEXT PRIMARY KEY,
    comment TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
  )`).run();
}

async function activityExists(db:D1Database,id:string){return Boolean(await db.prepare('SELECT 1 ok FROM activities WHERE id=? LIMIT 1').bind(id).first())}

export function registerActivityCommentRoutes(app:RouteApp){
  app.get('/api/activities/:id/comment',async c=>{
    await ensureSchema(c.env.DB);
    const id=String(c.req.param('id'));
    if(!await activityExists(c.env.DB,id))return c.json({ok:false,error:'Aktiviteten hittades inte.'},404);
    const row=await c.env.DB.prepare('SELECT comment,updated_at FROM activity_comments WHERE activity_id=?').bind(id).first<any>();
    return c.json({ok:true,comment:String(row?.comment||''),updatedAt:row?.updated_at||null});
  });

  app.put('/api/activities/:id/comment',async c=>{
    await ensureSchema(c.env.DB);
    const id=String(c.req.param('id'));
    if(!await activityExists(c.env.DB,id))return c.json({ok:false,error:'Aktiviteten hittades inte.'},404);
    const body=await c.req.json<{comment?:string}>().catch(()=>({}));
    const comment=typeof body.comment==='string'?body.comment:'';
    await c.env.DB.prepare(`INSERT INTO activity_comments(activity_id,comment,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(activity_id) DO UPDATE SET comment=excluded.comment,updated_at=datetime('now')`).bind(id,comment).run();
    return c.json({ok:true});
  });

  app.get('/api/projects/:projectId/activity-comments',async c=>{
    await ensureSchema(c.env.DB);
    const projectId=String(c.req.param('projectId'));
    const rows=await c.env.DB.prepare(`
      SELECT ac.activity_id,a.title AS activity_title,ac.comment,ac.updated_at
      FROM activity_comments ac
      JOIN activities a ON a.id=ac.activity_id
      JOIN tasks t ON t.id=a.task_id
      JOIN work_sections ws ON ws.id=t.work_section_id
      JOIN work_areas wa ON wa.id=ws.work_area_id
      WHERE wa.project_id=? AND trim(ac.comment)<>''
    `).bind(projectId).all();
    return c.json({ok:true,items:(rows.results as any[]).map(r=>({activityId:String(r.activity_id),activityTitle:String(r.activity_title||''),comment:String(r.comment||''),updatedAt:r.updated_at||null}))});
  });
}
