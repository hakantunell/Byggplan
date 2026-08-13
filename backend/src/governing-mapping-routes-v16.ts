import { registerGoverningMappingRoutesV15 } from './governing-mapping-routes-v15';

type RouteApp={
  get:(path:string,handler:(c:any)=>unknown)=>void;
  put:(path:string,handler:(c:any)=>unknown)=>void;
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

function domainScore(item:any,activity:any){
  const itemText=`${item.section_title||''} ${item.section_code||''} ${item.description||''}`;
  const activityText=`${activity.area_name||''} ${activity.section_name||''} ${activity.task_title||''} ${activity.title||''} ${activity.description||''}`;
  const itemWords=new Set(words(itemText));
  const activityWords=new Set(words(activityText));
  let score=0;
  for(const word of itemWords){if(activityWords.has(word))score+=2;}

  const itemDomains=domainSet(itemText);
  const activityDomains=domainSet(activityText);
  for(const domain of itemDomains){if(activityDomains.has(domain))score+=5;}

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

export function registerGoverningMappingRoutesV16(app:RouteApp){
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
        data.runtime='mapping-v19';
        return c.json(data,response.status);
      });
    },
    put(path,handler){
      app.put(path,handler);
    }
  };
  registerGoverningMappingRoutesV15(proxy);
}
