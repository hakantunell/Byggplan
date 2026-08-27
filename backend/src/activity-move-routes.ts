type Bindings={DB:D1Database;DEV_USER_EMAIL:string};

type ActivityLocation={activity_id:string;task_id:string;project_id:string};
type TargetTask={task_id:string;project_id:string;status:string};

export function registerActivityMoveRoutes(app:any){
  app.post('/api/activities/:id/move',async(c:any)=>{
    const activityId=c.req.param('id');
    const body=await c.req.json<{targetTaskId?:string}>();
    const targetTaskId=body.targetTaskId?.trim();
    if(!targetTaskId)return c.json({ok:false,error:'Välj vilket moment aktiviteten ska flyttas till.'},400);

    const source=await c.env.DB.prepare(`
      SELECT a.id AS activity_id,a.task_id,wa.project_id
      FROM activities a
      JOIN tasks t ON t.id=a.task_id
      JOIN work_sections ws ON ws.id=t.work_section_id
      JOIN work_areas wa ON wa.id=ws.work_area_id
      WHERE a.id=?
    `).bind(activityId).first<ActivityLocation>();
    if(!source)return c.json({ok:false,error:'Aktiviteten hittades inte.'},404);

    const target=await c.env.DB.prepare(`
      SELECT t.id AS task_id,wa.project_id,t.status
      FROM tasks t
      JOIN work_sections ws ON ws.id=t.work_section_id
      JOIN work_areas wa ON wa.id=ws.work_area_id
      WHERE t.id=?
    `).bind(targetTaskId).first<TargetTask>();
    if(!target)return c.json({ok:false,error:'Målmomentet hittades inte.'},404);
    if(target.project_id!==source.project_id)return c.json({ok:false,error:'En aktivitet kan bara flyttas inom samma projekt.'},409);
    if(target.task_id===source.task_id)return c.json({ok:false,error:'Aktiviteten ligger redan i det momentet.'},409);
    if(target.status==='review'||target.status==='done')return c.json({ok:false,error:'Aktiviteten kan inte flyttas till ett moment som är skickat för kontroll eller redan klart.'},409);

    const nextOrder=await c.env.DB.prepare(
      'SELECT COALESCE(MAX(sort_order),0)+10 AS sort_order FROM activities WHERE task_id=?'
    ).bind(targetTaskId).first<{sort_order:number}>();

    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE activities SET task_id=?,sort_order=? WHERE id=?')
        .bind(targetTaskId,nextOrder?.sort_order??10,activityId),
      c.env.DB.prepare("UPDATE tasks SET updated_at=datetime('now') WHERE id IN (?,?)")
        .bind(source.task_id,targetTaskId)
    ]);

    return c.json({ok:true,activityId,targetTaskId});
  });
}
