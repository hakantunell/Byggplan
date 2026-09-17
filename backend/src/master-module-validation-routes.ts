import {sessionUser} from './auth-session';
import {isSystemAdmin} from './workspace-access';

type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void};
type Behavior='add_flow'|'replace_flow'|'augment_base'|'parameter_only';
type Policy={behavior:Behavior;targetTitle?:string};

const EXACT_POLICIES:Record<string,Policy>={
 municipal_water:{behavior:'parameter_only',targetTitle:'Förlägg och anslut servisledning för vatten'},
 shared_water:{behavior:'parameter_only',targetTitle:'Förlägg och anslut servisledning för vatten'},
 private_well:{behavior:'add_flow'}
};
const GROUP_POLICIES:Record<string,Policy>={
 foundation:{behavior:'add_flow'},
 frame:{behavior:'augment_base',targetTitle:'Res bärande stomme'},
 roof:{behavior:'replace_flow'},
 sewage:{behavior:'replace_flow'},
 ventilation:{behavior:'augment_base',targetTitle:'Utför ventilation'},
 features:{behavior:'add_flow'}
};
const CONDITIONAL_BASE_PATTERNS=[
 /grundsulor.*grundmurar/i,
 /grundmurar/i,
 /källarvägg/i,
 /plint/i,
 /takstol/i,
 /åstak/i,
 /egen brunn/i,
 /kommunalt avlopp/i,
 /enskilt avlopp/i
];

function norm(v:unknown){return String(v||'').trim().toLocaleLowerCase('sv-SE').replace(/\s+/g,' ')}
function parseObject(raw:unknown){try{const v=JSON.parse(String(raw||'{}'));return v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{} }catch{return{}}}
function policy(groupCode:string,moduleCode:string):Policy{return EXACT_POLICIES[moduleCode]||GROUP_POLICIES[groupCode]||{behavior:'add_flow'}}

export function registerMasterModuleValidationRoutes(app:RouteApp){
 app.get('/api/studio/master-projects/:masterProjectId/module-validation',async c=>{
  try{
   const user=await sessionUser(c);if(!user)return c.json({ok:false,error:'Du måste vara inloggad.'},401);
   if(!await isSystemAdmin(c.env.DB,user))return c.json({ok:false,error:'Endast systemadministratör kan validera Mastermoduler.'},403);
   const masterProjectId=String(c.req.param('masterProjectId'));
   const master=await c.env.DB.prepare('SELECT id,code,name,version,status FROM master_projects WHERE id=?').bind(masterProjectId).first<any>();
   if(!master)return c.json({ok:false,error:'Masterprojektet hittades inte.'},404);
   const [modulesResult,tasksResult,graphRow]=await Promise.all([
    c.env.DB.prepare(`SELECT id,group_code,group_name,selection_mode,code,name,description,sort_order FROM master_modules WHERE master_project_id=? ORDER BY sort_order,name`).bind(masterProjectId).all(),
    c.env.DB.prepare(`SELECT t.id,t.title,t.description,s.name section_name,a.name area_name,COALESCE(mm.code,'') module_code,COALESCE(mm.name,'') module_name,COALESCE(mm.group_code,'') group_code,COALESCE(mm.selection_mode,'') selection_mode FROM master_tasks t JOIN master_work_sections s ON s.id=t.master_work_section_id JOIN master_work_areas a ON a.id=s.master_work_area_id LEFT JOIN master_task_modules mtm ON mtm.master_task_id=t.id LEFT JOIN master_modules mm ON mm.id=mtm.module_id WHERE a.master_project_id=? ORDER BY a.sort_order,s.sort_order,t.sort_order,t.id`).bind(masterProjectId).all(),
    c.env.DB.prepare('SELECT dependencies_json,positions_json,routes_json FROM master_graph_states WHERE master_project_id=?').bind(masterProjectId).first<any>()
   ]);
   const modules=modulesResult.results as any[],tasks=tasksResult.results as any[];
   const taskById=new Map(tasks.map(t=>[String(t.id),t]));
   const taskByTitle=new Map<string,any[]>();for(const t of tasks){const k=norm(t.title),list=taskByTitle.get(k)||[];list.push(t);taskByTitle.set(k,list)}
   const dependencies=parseObject(graphRow?.dependencies_json),positions=parseObject(graphRow?.positions_json),routes=parseObject(graphRow?.routes_json);
   const graphRefs=new Set<string>();
   for(const[child,parents]of Object.entries(dependencies)){graphRefs.add(child);for(const p of Array.isArray(parents)?parents:[])graphRefs.add(String(p))}
   for(const id of Object.keys(positions))graphRefs.add(id);
   for(const key of Object.keys(routes)){const[a,b]=key.split('->');if(a)graphRefs.add(a);if(b)graphRefs.add(b)}
   const staleGraphRefs=[...graphRefs].filter(id=>!taskById.has(id));
   const baseTasks=tasks.filter(t=>!String(t.module_code||''));
   const baseConditionalCandidates=baseTasks.filter(t=>CONDITIONAL_BASE_PATTERNS.some(rx=>rx.test(String(t.title||'')))).map(t=>({id:String(t.id),title:String(t.title),areaName:String(t.area_name||''),sectionName:String(t.section_name||''),inGraph:graphRefs.has(String(t.id))}));
   const groupsMap=new Map<string,any[]>();for(const m of modules){const key=String(m.group_code||'');const list=groupsMap.get(key)||[];list.push(m);groupsMap.set(key,list)}
   const groups=[...groupsMap.entries()].map(([groupCode,groupModules])=>{
    const groupName=String(groupModules[0]?.group_name||groupCode),selectionMode=String(groupModules[0]?.selection_mode||'single');
    const allGroupTasks=tasks.filter(t=>String(t.group_code||'')===groupCode),groupGraphTaskIds=allGroupTasks.filter(t=>graphRefs.has(String(t.id))).map(t=>String(t.id));
    const options=groupModules.map(m=>{
     const moduleCode=String(m.code),p=policy(groupCode,moduleCode),moduleTasks=tasks.filter(t=>String(t.module_code||'')===moduleCode),directGraphTasks=moduleTasks.filter(t=>graphRefs.has(String(t.id)));
     const targetMatches=p.targetTitle?(taskByTitle.get(norm(p.targetTitle))||[]):[];
     const warnings:string[]=[];
     if(p.behavior==='augment_base'&&targetMatches.length===0)warnings.push(`Basmomentet "${p.targetTitle}" saknas.`);
     if(p.behavior==='parameter_only'&&targetMatches.length===0)warnings.push(`Målmomentet "${p.targetTitle}" saknas.`);
     if(p.behavior==='add_flow'&&moduleTasks.length===0)warnings.push('Modulen saknar eget moment trots att den ska lägga till ett flöde.');
     if(p.behavior==='add_flow'&&moduleTasks.length>0&&directGraphTasks.length===0&&groupGraphTaskIds.length===0)warnings.push('Modulens moment saknar grafankare och riskerar att bli frikopplade.');
     if(p.behavior==='replace_flow'&&groupGraphTaskIds.length===0)warnings.push('Modulgruppen saknar grafankare för substitutionsflödet.');
     if(p.behavior==='augment_base'&&moduleTasks.some(t=>norm(t.title)===norm(p.targetTitle)))warnings.push('Modulen innehåller ett separat moment med samma namn som basmomentet; kontrollera att det inte blir en dubblett.');
     const duplicateTitles=moduleTasks.filter(t=>(taskByTitle.get(norm(t.title))||[]).some(x=>String(x.id)!==String(t.id)&&String(x.module_code||'')!==moduleCode)).map(t=>String(t.title));
     if(duplicateTitles.length)warnings.push(`Samma momentnamn finns även utanför modulen: ${[...new Set(duplicateTitles)].join(', ')}.`);
     return{code:moduleCode,name:String(m.name||moduleCode),behavior:p.behavior,targetTitle:p.targetTitle||null,taskCount:moduleTasks.length,directGraphTaskCount:directGraphTasks.length,taskTitles:moduleTasks.map(t=>String(t.title)),warnings,status:warnings.length?'review':'ok'};
    });
    return{groupCode,groupName,selectionMode,graphAnchorCount:groupGraphTaskIds.length,options,status:options.some(o=>o.status==='review')?'review':'ok'};
   });
   const summary={baseTaskCount:baseTasks.length,moduleTaskCount:tasks.length-baseTasks.length,groupCount:groups.length,moduleCount:modules.length,groupsNeedingReview:groups.filter(g=>g.status==='review').length,optionsNeedingReview:groups.flatMap(g=>g.options).filter(o=>o.status==='review').length,staleGraphRefCount:staleGraphRefs.length,conditionalBaseCandidateCount:baseConditionalCandidates.length};
   return c.json({ok:true,master:{id:String(master.id),code:String(master.code||''),name:String(master.name||''),version:Number(master.version||0)},summary,base:{taskCount:baseTasks.length,conditionalCandidates:baseConditionalCandidates},groups,staleGraphRefs});
  }catch(error){console.error('Master module validation failed',error);return c.json({ok:false,error:`Modulvalideringen misslyckades: ${error instanceof Error?error.message:String(error)}`},500)}
 });
}
