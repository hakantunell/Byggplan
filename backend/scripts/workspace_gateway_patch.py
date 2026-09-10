from pathlib import Path
p=Path('backend/src/auth-entry.ts')
s=p.read_text()
s=s.replace("import {enrichPracticalGoverningInstructions} from './governing-practical-instruction-enrichment';", "import {enrichPracticalGoverningInstructions} from './governing-practical-instruction-enrichment';\nimport {canAccessProject,ensureWorkspaceSchema,isSystemAdmin,projectIdFromRequest} from './workspace-access';")
needle="  const user=await sessionUserFromRequest(env.DB,request);\n  if(!user)return jsonResponse({ok:false,error:'Du måste logga in.',authenticated:false},401);\n  if(request.method==='POST'&&url.pathname==='/api/studio/tasks')return createTaskDirect(request,env);"
replacement="""  const user=await sessionUserFromRequest(env.DB,request);
  if(!user)return jsonResponse({ok:false,error:'Du måste logga in.',authenticated:false},401);
  await ensureWorkspaceSchema(env.DB);
  const systemAdmin=await isSystemAdmin(env.DB,user);
  if((url.pathname.startsWith('/api/system/')||url.pathname.startsWith('/api/studio/system-'))&&!systemAdmin)return jsonResponse({ok:false,error:'Systemadministratörsbehörighet krävs.'},403);
  if(request.method==='GET'&&url.pathname==='/api/projects'&&!systemAdmin){
   const rows=await env.DB.prepare(`SELECT DISTINCT p.id,p.name,p.property_designation,p.status,p.workspace_id,w.name workspace_name,
     (SELECT COUNT(*) FROM work_areas wa WHERE wa.project_id=p.id) work_area_count,
     (SELECT COUNT(*) FROM work_sections ws JOIN work_areas wa ON wa.id=ws.work_area_id WHERE wa.project_id=p.id) work_section_count,
     (SELECT COUNT(*) FROM tasks t JOIN work_sections ws ON ws.id=t.work_section_id JOIN work_areas wa ON wa.id=ws.work_area_id WHERE wa.project_id=p.id) task_count
     FROM projects p JOIN workspaces w ON w.id=p.workspace_id JOIN workspace_members wm ON wm.workspace_id=w.id
     WHERE wm.user_id=? AND wm.status='active' AND w.status='active' ORDER BY w.name,p.sort_order,p.name`).bind(user.id).all();
   return jsonResponse({projects:rows.results});
  }
  const scopedProjectId=await projectIdFromRequest(env.DB,request);
  if(scopedProjectId&&!await canAccessProject(env.DB,user,scopedProjectId))return jsonResponse({ok:false,error:'Du har inte åtkomst till den här projektytan eller projektet.'},403);
  if(request.method==='GET'&&url.pathname==='/api/tasks'&&!url.searchParams.get('projectId')&&!systemAdmin)return jsonResponse({ok:false,error:'projectId krävs för projektavgränsad åtkomst.'},400);
  if(request.method==='POST'&&url.pathname==='/api/studio/tasks')return createTaskDirect(request,env);"""
assert needle in s
s=s.replace(needle,replacement,1)
p.write_text(s)
