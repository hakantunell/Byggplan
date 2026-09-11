type RouteApp={
  get:(path:string,handler:(c:any)=>unknown)=>void;
  put:(path:string,handler:(c:any)=>unknown)=>void;
};

function validState(value:unknown){
  return Boolean(value&&typeof value==='object'&&!Array.isArray(value));
}

async function ensureSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS project_drawing_palette_state(
    project_id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`).run();
}

export function registerProjectDrawingPaletteRoutes(app:RouteApp){
  app.get('/api/project-drawing-palette',async c=>{
    const projectId=String(c.req.query('projectId')||'').trim();
    if(!projectId)return c.json({ok:false,error:'projectId krävs.'},400);
    await ensureSchema(c.env.DB);
    const project=await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
    if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);
    const row=await c.env.DB.prepare('SELECT state_json,updated_at FROM project_drawing_palette_state WHERE project_id=?').bind(projectId).first<any>();
    if(!row)return c.json({ok:true,state:{},updatedAt:null});
    let state:any={};try{state=JSON.parse(row.state_json||'{}')}catch{}
    return c.json({ok:true,state:validState(state)?state:{},updatedAt:row.updated_at||null});
  });

  app.put('/api/project-drawing-palette',async c=>{
    await ensureSchema(c.env.DB);
    const body=await c.req.json<{projectId?:string;state?:unknown}>().catch(()=>({}));
    const projectId=String(body.projectId||'').trim();
    if(!projectId||!validState(body.state))return c.json({ok:false,error:'Ogiltig ritdata.'},400);
    const project=await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
    if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);
    const json=JSON.stringify(body.state);
    if(json.length>2_000_000)return c.json({ok:false,error:'Ritdatan är för stor.'},413);
    await c.env.DB.prepare(`INSERT INTO project_drawing_palette_state(project_id,state_json,updated_at) VALUES(?,?,datetime('now'))
      ON CONFLICT(project_id) DO UPDATE SET state_json=excluded.state_json,updated_at=datetime('now')`).bind(projectId,json).run();
    return c.json({ok:true});
  });
}
