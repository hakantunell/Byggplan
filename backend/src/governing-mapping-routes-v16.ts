import { registerGoverningMappingRoutesV15 } from './governing-mapping-routes-v15';

type RouteApp={
  get:(path:string,handler:(c:any)=>unknown)=>void;
  put:(path:string,handler:(c:any)=>unknown)=>void;
  post:(path:string,handler:(c:any)=>unknown)=>void;
};

function norm(value:unknown){
  return String(value||'').toLocaleLowerCase('sv-SE').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim();
}

function semanticKinds(item:any){
  const values=Array.isArray(item?.handling_kinds)&&item.handling_kinds.length
    ? item.handling_kinds
    : [item?.handling_kind||'work'];
  return new Set(values.map((value:unknown)=>String(value)));
}

function addKind(item:any,kind:string){
  const kinds=semanticKinds(item);
  kinds.add(kind);
  item.handling_kinds=[...kinds];
  if(!item.handling_kind)item.handling_kind=kind;
}

function normalizeMixedSemantics(data:any){
  if(!data||!Array.isArray(data.items))return data;
  for(const item of data.items){
    const text=norm(`${item.description||''} ${item.section_title||''}`);

    if(/\bska\b.*\b(utföras|placeras|förberedas|anordnas|ordnas|installeras|monteras|förvaras|sorteras)\b/.test(text)
      || /\bfår inte\b.*\b(eldas|ledas|användas|placeras)\b/.test(text)){
      addKind(item,'work');
    }

    if(/\b(utföras|placeras|installeras|monteras)\b.*\benligt\b.*\b(ansökan|handling|ritning|tillstånd|anvisning|anvisningar|branschregler)\b/.test(text)){
      addKind(item,'work');
      addKind(item,'control');
    }

    if(/\b(skötsel|skötas|drift|underhåll|underhållas)\b/.test(text)){
      addKind(item,'operation');
    }
  }
  return data;
}

function suggestionIsCompatible(item:any,activity:any){
  if(!activity)return false;
  const kinds=semanticKinds(item);
  const activityType=String(activity.activity_type||'');

  if(activityType==='perform')return kinds.has('work');
  if(activityType==='check'||activityType==='measurement')return kinds.has('control')||kinds.has('administration');
  if(activityType==='document')return kinds.has('administration')||kinds.has('evidence')||kinds.has('control')||kinds.has('operation');
  return true;
}

function filterSuggestionsBySemantics(data:any){
  if(!data||!Array.isArray(data.items)||!Array.isArray(data.activities)||!data.suggestions)return data;
  const activityById=new Map<string,any>(data.activities.map((activity:any)=>[String(activity.id),activity]));
  for(const item of data.items){
    const suggestions=Array.isArray(data.suggestions[item.id])?data.suggestions[item.id]:[];
    data.suggestions[item.id]=suggestions.filter((suggestion:any)=>
      suggestionIsCompatible(item,activityById.get(String(suggestion.activity_id)))
    );
  }
  return data;
}

const STOP_WORDS=new Set([
  'och','eller','samt','med','mot','för','vid','av','på','i','till','en','ett','den','det','de','som','ska','kontroll','kontrollera'
]);

const DOMAIN_GROUPS=[
  ['stomme','timmer','bärande','konstruktion','stabilitet','upplag','infästning'],
  ['bjälklag','golvbärning','golv','balk','bärning'],
  ['isolering','värmeisolering','täthet','lufttäthet','klimatskal','vindskydd','ångbroms'],
  ['vatten','avlopp','spillvatten','va','vvs','rör','sanitet'],
  ['tak','takkonstruktion','takstol','ås','sparre'],
  ['fönster','dörr','ytterdörr','öppning'],
  ['grund','grundläggning','sula','mur','dränering'],
  ['ventilation','frånluft','tilluft','imkanal'],
  ['el','elinstallation','elektrisk'],
  ['brand','brandskydd','utrymning','rökkanal','eldstad']
];

function words(value:unknown){
  return norm(value)
    .replace(/[^a-zåäö0-9]+/g,' ')
    .split(' ')
    .filter(word=>word.length>2&&!STOP_WORDS.has(word));
}

function domainSet(value:unknown){
  const text=norm(value);
  const set=new Set<number>();
  DOMAIN_GROUPS.forEach((terms,index)=>{
    if(terms.some(term=>text.includes(term)))set.add(index);
  });
  return set;
}

function textDomainScore(itemText:string,candidateText:string){
  const itemWords=new Set(words(itemText));
  const candidateWords=new Set(words(candidateText));
  let score=0;
  for(const word of itemWords){if(candidateWords.has(word))score+=2;}

  const itemDomains=domainSet(itemText);
  const candidateDomains=domainSet(candidateText);
  for(const domain of itemDomains){if(candidateDomains.has(domain))score+=5;}
  return score;
}

function domainScore(item:any,activity:any){
  const itemText=`${item.section_title||''} ${item.section_code||''} ${item.description||''}`;
  const activityText=`${activity.area_name||''} ${activity.section_name||''} ${activity.task_title||''} ${activity.title||''} ${activity.description||''}`;
  let score=textDomainScore(itemText,activityText);
  const description=norm(item.description);
  const title=norm(activity.title);
  if(description&&title&&(title.includes(description)||description.includes(title)))score+=4;
  return score;
}

function asDomainSuggestion(activity:any,score:number){
  return{
    activity_id:activity.id,
    title:activity.title,
    task_title:activity.task_title,
    section_name:activity.section_name,
    area_name:activity.area_name,
    confidence:Math.min(96,82+score),
    lifecycle_stage:activity.lifecycle_stage,
    surface:activity.surface,
    applicability:activity.applicability,
    condition_text:activity.condition_text
  };
}

function addDomainFallbackSuggestions(data:any){
  if(!data||!Array.isArray(data.items)||!Array.isArray(data.activities)||!data.suggestions)return data;
  const controls=data.activities.filter((activity:any)=>
    String(activity.applicability||'always')!=='deprecated'
    && (activity.activity_type==='check'||activity.activity_type==='measurement')
  );

  for(const item of data.items){
    if(item.project_condition||Number(item.mapped_activity_count||0)>0)continue;
    if(!semanticKinds(item).has('control'))continue;
    if((data.suggestions[item.id]||[]).length>0)continue;

    const ranked=controls
      .map((activity:any)=>({activity,score:domainScore(item,activity)}))
      .filter((candidate:any)=>candidate.score>=7)
      .sort((a:any,b:any)=>b.score-a.score);

    if(!ranked.length)continue;
    const best=ranked[0];
    const second=ranked[1];
    if(second&&best.score-second.score<2)continue;

    data.suggestions[item.id]=[asDomainSuggestion(best.activity,best.score)];
  }
  return data;
}

function activityTypeFor(item:any){
  const kinds=semanticKinds(item);
  if(kinds.has('control'))return 'check';
  if(kinds.has('administration')||kinds.has('evidence')||kinds.has('operation'))return 'document';
  return 'perform';
}

function cleanRequirementName(value:unknown){
  return String(value||'').replace(/^[\s\d.\-–—]+/,'').trim().replace(/[.;:]$/,'');
}

function suggestedActivityTitle(item:any){
  const base=cleanRequirementName(item.description)||'styrande krav';
  const type=activityTypeFor(item);
  if(type==='check')return `Kontrollera ${base.charAt(0).toLocaleLowerCase('sv-SE')}${base.slice(1)}`;
  if(type==='document')return `Dokumentera ${base.charAt(0).toLocaleLowerCase('sv-SE')}${base.slice(1)}`;
  return `Utför ${base.charAt(0).toLocaleLowerCase('sv-SE')}${base.slice(1)}`;
}

type PlacementRow={
  task_id:string;task_title:string;section_id:string;section_name:string;area_id:string;area_name:string;activity_titles:string|null;
};

async function loadPlacementRows(db:D1Database,projectId:string){
  const result=await db.prepare(`
    SELECT t.id task_id,t.title task_title,
           ws.id section_id,ws.name section_name,
           wa.id area_id,wa.name area_name,
           GROUP_CONCAT(a.title,' ') activity_titles
    FROM tasks t
    JOIN work_sections ws ON ws.id=t.work_section_id
    JOIN work_areas wa ON wa.id=ws.work_area_id
    LEFT JOIN activities a ON a.task_id=t.id
    WHERE wa.project_id=?
    GROUP BY t.id,t.title,ws.id,ws.name,wa.id,wa.name
    ORDER BY wa.sort_order,ws.sort_order,t.sort_order
  `).bind(projectId).all();
  return (result.results||[]) as PlacementRow[];
}

function buildCreationSuggestion(item:any,rows:PlacementRow[]){
  const itemText=`${item.section_title||''} ${item.section_code||''} ${item.description||''}`;
  const ranked=rows.map(row=>{
    const fullText=`${row.area_name} ${row.section_name} ${row.task_title} ${row.activity_titles||''}`;
    const taskScore=textDomainScore(itemText,fullText);
    const sectionScore=textDomainScore(itemText,`${row.area_name} ${row.section_name}`);
    const areaScore=textDomainScore(itemText,row.area_name);
    return{row,taskScore,sectionScore,areaScore};
  }).sort((a,b)=>b.taskScore-a.taskScore||b.sectionScore-a.sectionScore||b.areaScore-a.areaScore);

  const best=ranked[0];
  const second=ranked[1];
  const title=suggestedActivityTitle(item);
  const activityType=activityTypeFor(item);

  if(best&&best.taskScore>=5&&(!second||best.taskScore-second.taskScore>=1)){
    return{
      mode:'existing_task',title,activityType,confidence:Math.min(96,76+best.taskScore),
      areaId:best.row.area_id,areaName:best.row.area_name,
      sectionId:best.row.section_id,sectionName:best.row.section_name,
      taskId:best.row.task_id,taskTitle:best.row.task_title
    };
  }

  if(best&&best.sectionScore>=4){
    return{
      mode:'new_task',title,activityType,confidence:Math.min(90,72+best.sectionScore),
      areaId:best.row.area_id,areaName:best.row.area_name,
      sectionId:best.row.section_id,sectionName:best.row.section_name,
      taskTitle:cleanRequirementName(item.description)||'Projektspecifikt krav'
    };
  }

  if(best&&best.areaScore>=3){
    return{
      mode:'new_section',title,activityType,confidence:Math.min(86,68+best.areaScore),
      areaId:best.row.area_id,areaName:best.row.area_name,
      sectionName:cleanRequirementName(item.section_title)||'Projektspecifikt',
      taskTitle:cleanRequirementName(item.description)||'Projektspecifikt krav'
    };
  }

  return{
    mode:'new_area',title,activityType,confidence:65,
    areaName:'Projektspecifika arbeten',
    sectionName:cleanRequirementName(item.section_title)||'Övrigt',
    taskTitle:cleanRequirementName(item.description)||'Projektspecifikt krav'
  };
}

async function attachCreationSuggestions(db:D1Database,projectId:string,data:any){
  if(!data||!Array.isArray(data.items))return data;
  const rows=await loadPlacementRows(db,projectId);
  for(const item of data.items){
    if(item.project_condition||Number(item.mapped_activity_count||0)>0||(data.suggestions?.[item.id]||[]).length>0)continue;
    item.creation_suggestion=buildCreationSuggestion(item,rows);
  }
  return data;
}

async function getGoverningItem(db:D1Database,projectId:string,itemId:string){
  return db.prepare(`
    SELECT i.id,i.code,i.description,i.section_code,i.section_title,i.item_type,
           d.project_id
    FROM governing_items i
    JOIN governing_documents d ON d.id=i.governing_document_id
    WHERE i.id=? AND d.project_id=?
  `).bind(itemId,projectId).first<any>();
}

async function createProjectActivityFromItem(db:D1Database,projectId:string,item:any,suggestion:any){
  const existing=await db.prepare('SELECT activity_id FROM governing_item_activity_links WHERE governing_item_id=? LIMIT 1').bind(item.id).first<any>();
  if(existing)throw new Error('Styrposten är redan kopplad till en aktivitet.');

  let areaId=String(suggestion.areaId||'');
  let sectionId=String(suggestion.sectionId||'');
  let taskId=String(suggestion.taskId||'');

  if(suggestion.mode==='new_area'){
    const existingArea=await db.prepare('SELECT id FROM work_areas WHERE project_id=? AND lower(trim(name))=lower(trim(?)) LIMIT 1').bind(projectId,suggestion.areaName).first<any>();
    if(existingArea)areaId=String(existingArea.id);
    else{
      areaId=crypto.randomUUID();
      const order=await db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 next_order FROM work_areas WHERE project_id=?').bind(projectId).first<any>();
      await db.prepare('INSERT INTO work_areas(id,project_id,name,sort_order) VALUES(?,?,?,?)').bind(areaId,projectId,suggestion.areaName,Number(order?.next_order||10)).run();
    }
  }

  if(suggestion.mode==='new_area'||suggestion.mode==='new_section'){
    const existingSection=await db.prepare('SELECT id FROM work_sections WHERE work_area_id=? AND lower(trim(name))=lower(trim(?)) LIMIT 1').bind(areaId,suggestion.sectionName).first<any>();
    if(existingSection)sectionId=String(existingSection.id);
    else{
      sectionId=crypto.randomUUID();
      const order=await db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 next_order FROM work_sections WHERE work_area_id=?').bind(areaId).first<any>();
      await db.prepare('INSERT INTO work_sections(id,work_area_id,name,sort_order) VALUES(?,?,?,?)').bind(sectionId,areaId,suggestion.sectionName,Number(order?.next_order||10)).run();
    }
  }

  if(suggestion.mode!=='existing_task'){
    const existingTask=await db.prepare('SELECT id FROM tasks WHERE work_section_id=? AND lower(trim(title))=lower(trim(?)) LIMIT 1').bind(sectionId,suggestion.taskTitle).first<any>();
    if(existingTask)taskId=String(existingTask.id);
    else{
      taskId=crypto.randomUUID();
      const order=await db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 next_order FROM tasks WHERE work_section_id=?').bind(sectionId).first<any>();
      await db.prepare(`INSERT INTO tasks(id,work_section_id,section,title,description,status,sort_order,updated_at) VALUES(?,?,?,?,?,'todo',?,datetime('now'))`)
        .bind(taskId,sectionId,suggestion.sectionName,suggestion.taskTitle,'Projektspecifikt moment skapat från styrande dokument.',Number(order?.next_order||10)).run();
    }
  }

  if(!taskId)throw new Error('Ingen giltig placering kunde bestämmas för aktiviteten.');

  const activityId=crypto.randomUUID();
  const order=await db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 next_order FROM activities WHERE task_id=?').bind(taskId).first<any>();
  const description=`Projektspecifik aktivitet skapad från styrande post ${item.code||''}: ${item.description}`.trim();
  await db.prepare(`INSERT INTO activities(id,task_id,title,description,activity_type,required,blocking,irreversible,sort_order) VALUES(?,?,?,?,?,1,0,0,?)`)
    .bind(activityId,taskId,suggestion.title,description,suggestion.activityType,Number(order?.next_order||10)).run();

  await db.prepare(`INSERT INTO governing_item_activity_links(id,governing_item_id,activity_id,link_type,created_at) VALUES(?,?,?,'supports',datetime('now'))`)
    .bind(crypto.randomUUID(),item.id,activityId).run();

  return{activityId,taskId,title:suggestion.title,placement:suggestion};
}

export function registerGoverningMappingRoutesV16(app:RouteApp){
  app.post('/api/studio/projects/:projectId/governing-items/:itemId/create-project-activity',async c=>{
    const projectId=String(c.req.param('projectId'));
    const itemId=String(c.req.param('itemId'));
    const item=await getGoverningItem(c.env.DB,projectId,itemId);
    if(!item)return c.json({ok:false,error:'Styrposten hittades inte i projektet.'},404);

    const rows=await loadPlacementRows(c.env.DB,projectId);
    const suggestion=buildCreationSuggestion(item,rows);
    try{
      const created=await createProjectActivityFromItem(c.env.DB,projectId,item,suggestion);
      return c.json({ok:true,created},201);
    }catch(error){
      return c.json({ok:false,error:error instanceof Error?error.message:String(error)},409);
    }
  });

  const proxy:RouteApp={
    get(path,handler){
      if(path!=='/api/studio/projects/:projectId/governing-mapping'){
        app.get(path,handler);
        return;
      }
      app.get(path,async c=>{
        const response:any=await handler(c);
        if(!response||typeof response.clone!=='function'||!response.ok)return response;
        const data:any=await response.clone().json().catch(()=>null);
        if(!data)return response;
        normalizeMixedSemantics(data);
        filterSuggestionsBySemantics(data);
        addDomainFallbackSuggestions(data);
        filterSuggestionsBySemantics(data);
        await attachCreationSuggestions(c.env.DB,String(c.req.param('projectId')),data);
        data.runtime='mapping-v20';
        return c.json(data,response.status);
      });
    },
    put(path,handler){app.put(path,handler);},
    post(path,handler){app.post(path,handler);}
  };
  registerGoverningMappingRoutesV15(proxy);
}
