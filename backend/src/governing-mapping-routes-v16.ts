import { registerGoverningMappingRoutesV15 } from './governing-mapping-routes-v15';

type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;put:(path:string,handler:(c:any)=>unknown)=>void};
const EXCEPTIONS=new Set(['not_applicable','cannot_verify','alternative_evidence']);
function norm(v:unknown){return String(v||'').toLocaleLowerCase('sv-SE').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim()}
function pureProjectCondition(item:any){
 const t=norm(item.description),kinds=Array.isArray(item.handling_kinds)?item.handling_kinds.map(String):[String(item.handling_kind||'')];
 if(/etablering, upplag och bodar ska rymmas inom den egna fastigheten/.test(t))return true;
 const substantive=kinds.some((k:string)=>['work','control','administration','operation','evidence'].includes(k));
 return String(item.handling_kind)==='condition'&&!substantive;
}
function recalc(data:any){
 const items=Array.isArray(data.items)?data.items:[];
 for(const item of items)item.project_condition=pureProjectCondition(item);
 const documents=Array.isArray(data.documents)?data.documents:[];
 for(const document of documents){
  const rows=items.filter((item:any)=>String(item.governing_document_id)===String(document.id));
  const exceptionCount=rows.filter((item:any)=>EXCEPTIONS.has(String(item.handling_status||''))).length;
  const projectConditionCount=rows.filter((item:any)=>item.project_condition&&String(item.handling_status||'')==='handled').length;
  const mappedCount=rows.filter((item:any)=>!EXCEPTIONS.has(String(item.handling_status||''))&&!(item.project_condition&&String(item.handling_status||'')==='handled')&&Number(item.mapped_activity_count||0)>0).length;
  const uncoveredCount=rows.filter((item:any)=>!EXCEPTIONS.has(String(item.handling_status||''))&&!(item.project_condition&&String(item.handling_status||'')==='handled')&&Number(item.mapped_activity_count||0)===0).length;
  const coveredCount=mappedCount+exceptionCount+projectConditionCount;
  document.item_count=rows.length;document.mapped_count=mappedCount;document.exception_count=exceptionCount;document.project_condition_count=projectConditionCount;document.uncovered_count=uncoveredCount;document.covered_count=coveredCount;document.coverage_percent=rows.length?Math.round(coveredCount*100/rows.length):100;
 }
 const itemCount=documents.reduce((s:number,d:any)=>s+Number(d.item_count||0),0),mappedCount=documents.reduce((s:number,d:any)=>s+Number(d.mapped_count||0),0),exceptionCount=documents.reduce((s:number,d:any)=>s+Number(d.exception_count||0),0),projectConditionCount=documents.reduce((s:number,d:any)=>s+Number(d.project_condition_count||0),0),uncoveredCount=documents.reduce((s:number,d:any)=>s+Number(d.uncovered_count||0),0),coveredCount=mappedCount+exceptionCount+projectConditionCount;
 data.summary={...(data.summary||{}),item_count:itemCount,mapped_count:mappedCount,exception_count:exceptionCount,project_condition_count:projectConditionCount,covered_count:coveredCount,uncovered_count:uncoveredCount,coverage_percent:itemCount?Math.round(coveredCount*100/itemCount):100};
 return data;
}

export function registerGoverningMappingRoutesV16(app:RouteApp){
 const proxy:RouteApp={
  get(path,handler){
   if(path!=='/api/studio/projects/:projectId/governing-mapping'){app.get(path,handler);return}
   app.get(path,async c=>{const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;const data:any=await response.clone().json().catch(()=>null);if(!data)return response;recalc(data);data.runtime='mapping-v17';return c.json(data,response.status)});
  },
  put(path,handler){app.put(path,async c=>{const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;const data:any=await response.clone().json().catch(()=>null);if(!data)return response;data.runtime='mapping-v17';return c.json(data,response.status)})}
 };
 registerGoverningMappingRoutesV15(proxy);
}
