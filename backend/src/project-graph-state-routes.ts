type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;put:(path:string,handler:(c:any)=>unknown)=>void};

type GraphState={dependencies:Record<string,string[]>;positions:Record<string,{dx:number;dy:number}>;routes:Record<string,Record<string,number>>};

function clean(value:unknown){return typeof value==='string'?value.trim():''}
function object(value:unknown){return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}}
function graphState(body:any):GraphState{
  return{
    dependencies:object(body?.dependencies) as Record<string,string[]>,
    positions:object(body?.positions) as Record<string,{dx:number;dy:number}>,
    routes:object(body?.routes) as Record<string,Record<string,number>>
  };
}

async function ensureSchema(db:D1Database){
  await db.prepare(`CREATE TABLE IF NOT EXISTS project_graph_states(
    project_id TEXT PRIMARY KEY,
    dependencies_json TEXT NOT NULL DEFAULT '{}',
    positions_json TEXT NOT NULL DEFAULT '{}',
    routes_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`).run();
}

function parseJson(raw:unknown){try{return JSON.parse(String(raw||'{}'))}catch{return{}}}

export function registerProjectGraphStateRoutes(app:RouteApp){
  app.get('/api/studio/projects/:projectId/graph-state',async c=>{
    await ensureSchema(c.env.DB);
    const projectId=clean(c.req.param('projectId'));
    const project=await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
    if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);
    const row=await c.env.DB.prepare('SELECT dependencies_json,positions_json,routes_json,updated_at FROM project_graph_states WHERE project_id=?').bind(projectId).first<any>();
    if(!row)return c.json({ok:true,projectId,exists:false,dependencies:{},positions:{},routes:{},updatedAt:null});
    return c.json({ok:true,projectId,exists:true,dependencies:parseJson(row.dependencies_json),positions:parseJson(row.positions_json),routes:parseJson(row.routes_json),updatedAt:row.updated_at});
  });

  app.put('/api/studio/projects/:projectId/graph-state',async c=>{
    await ensureSchema(c.env.DB);
    const projectId=clean(c.req.param('projectId'));
    const project=await c.env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first();
    if(!project)return c.json({ok:false,error:'Projektet hittades inte.'},404);
    const body=await c.req.json<any>().catch(()=>({}));
    const state=graphState(body);
    await c.env.DB.prepare(`INSERT INTO project_graph_states(project_id,dependencies_json,positions_json,routes_json,updated_at)
      VALUES(?,?,?,?,datetime('now'))
      ON CONFLICT(project_id) DO UPDATE SET dependencies_json=excluded.dependencies_json,positions_json=excluded.positions_json,routes_json=excluded.routes_json,updated_at=datetime('now')`)
      .bind(projectId,JSON.stringify(state.dependencies),JSON.stringify(state.positions),JSON.stringify(state.routes)).run();
    return c.json({ok:true,projectId});
  });
}
