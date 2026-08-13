import { registerGoverningMappingRoutesV16 } from './governing-mapping-routes-v16';

type RouteApp={
  get:(path:string,handler:(c:any)=>unknown)=>void;
  put:(path:string,handler:(c:any)=>unknown)=>void;
  post:(path:string,handler:(c:any)=>unknown)=>void;
};

type CreateMode='existing_task'|'new_task'|'new_section'|'new_area';

type ReviewedCreateBody={
  title?:string;
  activityType?:string;
  mode?:CreateMode;
  areaId?:string;
  areaName?:string;
  sectionId?:string;
  sectionName?:string;
  taskId?:string;
  taskTitle?:string;
};

function clean(value:unknown){return String(value||'').trim();}

async function governingItem(db:D1Database,projectId:string,itemId:string){
  return db.prepare(`
    SELECT i.id,i.code,i.description,d.project_id
    FROM governing_items i
    JOIN governing_documents d ON d.id=i.governing_document_id
    WHERE i.id=? AND d.project_id=?
  `).bind(itemId,projectId).first<any>();
}

async function placementOptions(db:D1Database,projectId:string){
  const result=await db.prepare(`
    SELECT wa.id area_id,wa.name area_name,wa.sort_order area_order,
           ws.id section_id,ws.name section_name,ws.sort_order section_order,
           t.id task_id,t.title task_title,t.sort_order task_order
    FROM work_areas wa
    LEFT JOIN work_sections ws ON ws.work_area_id=wa.id
    LEFT JOIN tasks t ON t.work_section_id=ws.id
    WHERE wa.project_id=?
    ORDER BY wa.sort_order,ws.sort_order,t.sort_order
  `).bind(projectId).all();
  const areas:any[]=[];
  const byArea=new Map<string,any>();
  const bySection=new Map<string,any>();
  for(const row of result.results as any[]){
    let area=byArea.get(String(row.area_id));
    if(!area){area={id:String(row.area_id),name:String(row.area_name),sections:[]};byArea.set(area.id,area);areas.push(area);}
    if(!row.section_id)continue;
    let section=bySection.get(String(row.section_id));
    if(!section){section={id:String(row.section_id),name:String(row.section_name),tasks:[]};bySection.set(section.id,section);area.sections.push(section);}
    if(row.task_id)section.tasks.push({id:String(row.task_id),title:String(row.task_title)});
  }
  return areas;
}

async function verifyArea(db:D1Database,projectId:string,areaId:string){
  return db.prepare('SELECT id,name FROM work_areas WHERE id=? AND project_id=?').bind(areaId,projectId).first<any>();
}
async function verifySection(db:D1Database,projectId:string,sectionId:string){
  return db.prepare(`SELECT ws.id,ws.name,ws.work_area_id FROM work_sections ws JOIN work_areas wa ON wa.id=ws.work_area_id WHERE ws.id=? AND wa.project_id=?`).bind(sectionId,projectId).first<any>();
}
async function verifyTask(db:D1Database,projectId:string,taskId:string){
  return db.prepare(`SELECT t.id,t.title,t.work_section_id,ws.work_area_id FROM tasks t JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE t.id=? AND wa.project_id=?`).bind(taskId,projectId).first<any>();
}

async function createReviewed(db:D1Database,projectId:string,item:any,body:ReviewedCreateBody){
  const title=clean(body.title);
  const activityType=clean(body.activityType)||'check';
  const mode=(body.mode||'existing_task') as CreateMode;
  if(!title)throw new Error('Aktiviteten måste ha en titel.');
  if(!['perform','check','measurement','document'].includes(activityType))throw new Error('Ogiltig aktivitetstyp.');
  if(!['existing_task','new_task','new_section','new_area'].includes(mode))throw new Error('Ogiltigt placeringsval.');

  const existing=await db.prepare('SELECT activity_id FROM governing_item_activity_links WHERE governing_item_id=? LIMIT 1').bind(item.id).first<any>();
  if(existing)throw new Error('Styrposten är redan kopplad till en aktivitet.');

  let areaId=clean(body.areaId),sectionId=clean(body.sectionId),taskId=clean(body.taskId);
  let areaName=clean(body.areaName),sectionName=clean(body.sectionName),taskTitle=clean(body.taskTitle);

  if(mode==='existing_task'){
    if(!taskId)throw new Error('Välj ett befintligt moment.');
    const task=await verifyTask(db,projectId,taskId);if(!task)throw new Error('Valt moment finns inte i projektet.');
    sectionId=String(task.work_section_id);areaId=String(task.work_area_id);
  }

  if(mode==='new_task'){
    if(!sectionId)throw new Error('Välj ett arbetsavsnitt.');
    const section=await verifySection(db,projectId,sectionId);if(!section)throw new Error('Valt arbetsavsnitt finns inte i projektet.');
    areaId=String(section.work_area_id);
    if(!taskTitle)throw new Error('Ange namn på det nya momentet.');
  }

  if(mode==='new_section'){
    if(!areaId)throw new Error('Välj ett arbetsområde.');
    const area=await verifyArea(db,projectId,areaId);if(!area)throw new Error('Valt arbetsområde finns inte i projektet.');
    if(!sectionName)throw new Error('Ange namn på det nya arbetsavsnittet.');
    if(!taskTitle)throw new Error('Ange namn på det nya momentet.');
  }

  if(mode==='new_area'){
    if(!areaName)throw new Error('Ange namn på det nya arbetsområdet.');
    if(!sectionName)throw new Error('Ange namn på det nya arbetsavsnittet.');
    if(!taskTitle)throw new Error('Ange namn på det nya momentet.');
    const same=await db.prepare('SELECT id FROM work_areas WHERE project_id=? AND lower(trim(name))=lower(trim(?)) LIMIT 1').bind(projectId,areaName).first<any>();
    if(same)areaId=String(same.id);else{
      areaId=crypto.randomUUID();
      const order=await db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 next_order FROM work_areas WHERE project_id=?').bind(projectId).first<any>();
      await db.prepare('INSERT INTO work_areas(id,project_id,name,sort_order) VALUES(?,?,?,?)').bind(areaId,projectId,areaName,Number(order?.next_order||10)).run();
    }
  }

  if(mode==='new_area'||mode==='new_section'){
    const same=await db.prepare('SELECT id FROM work_sections WHERE work_area_id=? AND lower(trim(name))=lower(trim(?)) LIMIT 1').bind(areaId,sectionName).first<any>();
    if(same)sectionId=String(same.id);else{
      sectionId=crypto.randomUUID();
      const order=await db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 next_order FROM work_sections WHERE work_area_id=?').bind(areaId).first<any>();
      await db.prepare('INSERT INTO work_sections(id,work_area_id,name,sort_order) VALUES(?,?,?,?)').bind(sectionId,areaId,sectionName,Number(order?.next_order||10)).run();
    }
  }

  if(mode!=='existing_task'){
    const same=await db.prepare('SELECT id FROM tasks WHERE work_section_id=? AND lower(trim(title))=lower(trim(?)) LIMIT 1').bind(sectionId,taskTitle).first<any>();
    if(same)taskId=String(same.id);else{
      taskId=crypto.randomUUID();
      const section=await db.prepare('SELECT name FROM work_sections WHERE id=?').bind(sectionId).first<any>();
      const order=await db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 next_order FROM tasks WHERE work_section_id=?').bind(sectionId).first<any>();
      await db.prepare(`INSERT INTO tasks(id,work_section_id,section,title,description,status,sort_order,updated_at) VALUES(?,?,?,?,?,'todo',?,datetime('now'))`)
        .bind(taskId,sectionId,String(section?.name||sectionName),taskTitle,'Projektspecifikt moment skapat från styrande dokument.',Number(order?.next_order||10)).run();
    }
  }

  const activityId=crypto.randomUUID();
  const order=await db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 next_order FROM activities WHERE task_id=?').bind(taskId).first<any>();
  const description=`Projektspecifik aktivitet skapad från styrande post ${item.code||''}: ${item.description}`.trim();
  await db.prepare(`INSERT INTO activities(id,task_id,title,description,activity_type,required,blocking,irreversible,sort_order) VALUES(?,?,?,?,?,1,0,0,?)`)
    .bind(activityId,taskId,title,description,activityType,Number(order?.next_order||10)).run();
  await db.prepare(`INSERT INTO governing_item_activity_links(id,governing_item_id,activity_id,link_type,mapping_source,mapping_comment,created_at) VALUES(?,?,?,'supports','project_specific','Skapad och granskad i kartläggningsvyn',datetime('now'))`)
    .bind(crypto.randomUUID(),item.id,activityId).run();
  return{activityId,taskId,title,activityType,mode};
}

export function registerGoverningMappingRoutesV17(app:RouteApp){
  app.get('/api/studio/projects/:projectId/project-activity-placement-options',async c=>{
    const projectId=String(c.req.param('projectId'));
    return c.json({ok:true,areas:await placementOptions(c.env.DB,projectId)});
  });

  app.post('/api/studio/projects/:projectId/governing-items/:itemId/create-project-activity-reviewed',async c=>{
    const projectId=String(c.req.param('projectId')),itemId=String(c.req.param('itemId'));
    const item=await governingItem(c.env.DB,projectId,itemId);
    if(!item)return c.json({ok:false,error:'Styrposten hittades inte i projektet.'},404);
    const body=await c.req.json().catch(()=>({})) as ReviewedCreateBody;
    try{return c.json({ok:true,created:await createReviewed(c.env.DB,projectId,item,body)},201);}
    catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},409);}
  });

  registerGoverningMappingRoutesV16(app);
}
