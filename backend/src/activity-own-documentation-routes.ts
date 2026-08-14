type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};

const MARKER='__byggplan_own__:';

export function registerActivityOwnDocumentationRoutes(app:RouteApp){
  app.post('/api/activities/:id/ensure-own-documentation',async c=>{
    const activityId=String(c.req.param('id'));
    const activity=await c.env.DB.prepare('SELECT id,activity_type FROM activities WHERE id=?').bind(activityId).first<any>();
    if(!activity)return c.json({ok:false,error:'Aktiviteten hittades inte.'},404);

    const existing=await c.env.DB.prepare('SELECT id,field_type,label,help_text FROM activity_documentation_fields WHERE activity_id=?').bind(activityId).all();
    const own=(existing.results as any[]).filter(row=>String(row.help_text||'').startsWith(MARKER));
    const existingTypes=new Set(own.map(row=>String(row.field_type)));
    const maxOrder=await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order),0) AS max_order FROM activity_documentation_fields WHERE activity_id=?').bind(activityId).first<any>();
    let order=Number(maxOrder?.max_order||0)+100;
    const inserts:D1PreparedStatement[]=[];
    const textLabel=String(activity.activity_type)==='measurement'?'Mätvärde / registrering':'Egen anteckning';

    if(!existingTypes.has('text')){
      inserts.push(c.env.DB.prepare(`INSERT INTO activity_documentation_fields(id,activity_id,field_type,label,help_text,required,sort_order) VALUES(?,?,?,?,?,0,?)`).bind(crypto.randomUUID(),activityId,'text',textLabel,`${MARKER} Frivillig anteckning för eget bruk.`,order));
      order+=10;
    }
    if(!existingTypes.has('photo')){
      inserts.push(c.env.DB.prepare(`INSERT INTO activity_documentation_fields(id,activity_id,field_type,label,help_text,required,minimum_items,maximum_items,sort_order) VALUES(?,?,?,?,?,0,NULL,NULL,?)`).bind(crypto.randomUUID(),activityId,'photo','Egna foton',`${MARKER} Frivilliga foton för eget bruk.`,order));
    }
    if(inserts.length)await c.env.DB.batch(inserts);
    return c.json({ok:true,created:inserts.length});
  });
}
