import {authConfigured,sessionUserFromRequest} from './auth-session';
import {canAccessProject,ensureWorkspaceSchema} from './workspace-access';

type Env={DB:D1Database;[key:string]:any};

function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
function mapResourceType(type:string){return ['technical_data','note','link'].includes(type)?'text':type}

export async function projectTasksFast(request:Request,env:Env,projectId:string):Promise<Response>{
 if(!projectId)return json({ok:false,error:'Projekt saknas.'},400);
 if(await authConfigured(env.DB)){
  const user=await sessionUserFromRequest(env.DB,request);
  if(!user)return json({ok:false,error:'Du måste logga in.',authenticated:false},401);
  await ensureWorkspaceSchema(env.DB);
  if(!await canAccessProject(env.DB,user,projectId))return json({ok:false,error:'Du har inte åtkomst till projektet.'},403);
 }

 const [taskResult,activityResult,fieldResult,profileResult,resourceResult]=await Promise.all([
  env.DB.prepare(`
   SELECT t.id,t.title,t.description,t.status,t.assignee,
          ws.id work_section_id,ws.name work_section,
          wa.id work_area_id,wa.name work_area,
          p.id project_id,p.name project_name
   FROM tasks t
   JOIN work_sections ws ON ws.id=t.work_section_id
   JOIN work_areas wa ON wa.id=ws.work_area_id
   JOIN projects p ON p.id=wa.project_id
   WHERE p.id=?
   ORDER BY wa.sort_order,ws.sort_order,t.sort_order
  `).bind(projectId).all(),
  env.DB.prepare(`
   SELECT a.id,a.task_id,a.title,a.description,a.activity_type,a.unit,
          a.required,a.blocking,a.irreversible,a.technical_resource_id,
          COALESCE(e.done,0) done,e.value,e.completed_by,e.completed_at
   FROM activities a
   JOIN tasks t ON t.id=a.task_id
   JOIN work_sections ws ON ws.id=t.work_section_id
   JOIN work_areas wa ON wa.id=ws.work_area_id
   LEFT JOIN activity_entries e ON e.activity_id=a.id
   WHERE wa.project_id=?
   ORDER BY t.sort_order,a.sort_order
  `).bind(projectId).all(),
  env.DB.prepare(`
   SELECT f.id,f.activity_id,f.field_type,f.label,f.help_text,f.unit,f.required,
          f.minimum_items,f.maximum_items,f.minimum_value,f.maximum_value,
          f.options_json,f.sort_order,e.id entry_id,e.value_text,
          e.value_number,e.value_boolean,e.object_key,e.original_name,
          e.content_type,e.note,e.created_at
   FROM activity_documentation_fields f
   JOIN activities a ON a.id=f.activity_id
   JOIN tasks t ON t.id=a.task_id
   JOIN work_sections ws ON ws.id=t.work_section_id
   JOIN work_areas wa ON wa.id=ws.work_area_id
   LEFT JOIN activity_documentation_entries e ON e.field_id=f.id
   WHERE wa.project_id=?
   ORDER BY f.activity_id,f.sort_order,e.created_at
  `).bind(projectId).all(),
  env.DB.prepare(`
   SELECT adp.activity_id,dp.id,dp.code,dp.name,dp.profile_type
   FROM activity_documentation_profiles adp
   JOIN documentation_profiles dp ON dp.id=adp.documentation_profile_id
   JOIN activities a ON a.id=adp.activity_id
   JOIN tasks t ON t.id=a.task_id
   JOIN work_sections ws ON ws.id=t.work_section_id
   JOIN work_areas wa ON wa.id=ws.work_area_id
   WHERE wa.project_id=? AND dp.status='active'
   ORDER BY dp.sort_order,dp.name
  `).bind(projectId).all(),
  env.DB.prepare(`
   SELECT tr.id,tr.resource_type,tr.title,tr.summary,tr.revision,
          tr.object_key,tr.external_url,tr.content_text,
          l.entity_type,l.entity_id,l.sort_order
   FROM technical_resources tr
   JOIN technical_resource_links l ON l.technical_resource_id=tr.id
   WHERE tr.project_id=? AND tr.status='current'
   ORDER BY l.sort_order,tr.title
  `).bind(projectId).all()
 ]);

 const grouped=new Map<string,any>();
 for(const row of taskResult.results as any[]){
  grouped.set(String(row.id),{
   id:row.id,projectId:row.project_id,project:row.project_name,
   workAreaId:row.work_area_id,workArea:row.work_area,
   workSectionId:row.work_section_id,workSection:row.work_section,
   title:row.title,description:row.description,status:row.status,
   assignee:row.assignee,activities:[],technical:[]
  });
 }
 const activities=new Map<string,any>();
 for(const row of activityResult.results as any[]){
  const task=grouped.get(String(row.task_id));if(!task)continue;
  const activity={
   id:row.id,title:row.title,description:row.description,type:row.activity_type,unit:row.unit??undefined,
   required:Boolean(row.required),blocking:Boolean(row.blocking),irreversible:Boolean(row.irreversible),
   technicalResourceId:row.technical_resource_id??undefined,done:Boolean(row.done),value:row.value??undefined,
   completedBy:row.completed_by??undefined,completedAt:row.completed_at??undefined,
   documentationFields:[],documentationProfiles:[]
  };
  task.activities.push(activity);activities.set(String(row.id),activity);
 }
 const fields=new Map<string,any>();
 for(const row of fieldResult.results as any[]){
  const activity=activities.get(String(row.activity_id));if(!activity)continue;
  let field=fields.get(String(row.id));
  if(!field){
   field={id:row.id,type:row.field_type,label:row.label,helpText:row.help_text??undefined,unit:row.unit??undefined,
    required:Boolean(row.required),minimumItems:row.minimum_items??undefined,maximumItems:row.maximum_items??undefined,
    minimumValue:row.minimum_value??undefined,maximumValue:row.maximum_value??undefined,
    options:row.options_json?JSON.parse(row.options_json):undefined,entries:[]};
   fields.set(String(row.id),field);activity.documentationFields.push(field);
  }
  if(row.entry_id)field.entries.push({id:row.entry_id,valueText:row.value_text??undefined,valueNumber:row.value_number??undefined,
   valueBoolean:row.value_boolean==null?undefined:Boolean(row.value_boolean),objectKey:row.object_key??undefined,
   originalName:row.original_name??undefined,contentType:row.content_type??undefined,note:row.note??undefined,createdAt:row.created_at});
 }
 for(const row of profileResult.results as any[]){
  const activity=activities.get(String(row.activity_id));if(activity)activity.documentationProfiles.push({id:row.id,code:row.code,name:row.name,type:row.profile_type});
 }

 const projectResources:any[]=[];
 const areaResources=new Map<string,any[]>(),sectionResources=new Map<string,any[]>(),taskResources=new Map<string,any[]>();
 const add=(map:Map<string,any[]>,id:string,value:any)=>{const list=map.get(id)||[];list.push(value);map.set(id,list)};
 for(const row of resourceResult.results as any[]){
  const resource={id:row.id,type:mapResourceType(String(row.resource_type)),title:row.title,summary:row.summary??'',revision:row.revision??undefined,
   details:row.content_text?String(row.content_text).split('\n').filter(Boolean):[],objectKey:row.object_key??undefined,
   externalUrl:row.external_url??undefined,sourceLevel:row.entity_type};
  const kind=String(row.entity_type),id=String(row.entity_id||'');
  if(kind==='project'&&id===projectId)projectResources.push(resource);
  else if(kind==='work_area')add(areaResources,id,resource);
  else if(kind==='work_section')add(sectionResources,id,resource);
  else if(kind==='task')add(taskResources,id,resource);
 }
 for(const task of grouped.values()){
  const seen=new Set<string>();
  for(const resource of [...projectResources,...(areaResources.get(String(task.workAreaId))||[]),...(sectionResources.get(String(task.workSectionId))||[]),...(taskResources.get(String(task.id))||[])]){
   const id=String(resource.id);if(seen.has(id))continue;seen.add(id);task.technical.push(resource);
  }
 }
 return json({tasks:[...grouped.values()]});
}
