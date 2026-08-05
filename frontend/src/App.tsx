import { useCallback, useEffect, useMemo, useState } from 'react';

type Requirement = { id:string; label:string; kind:'photo'|'measurement'|'check'; unit?:string; min?:number; done:boolean; value?:string; required?:boolean };
type TechnicalItem = { id:string; title:string; type:'text'|'drawing'|'image'|'document'|'material'; summary:string; revision?:string; details?:string[] };
type Project = { id:string; name:string; property_designation?:string; status:string; work_area_count:number; work_section_count:number; task_count:number };
type Task = { id:string; projectId:string; project:string; workAreaId:string; workArea:string; workSectionId:string; workSection:string; title:string; description:string; status:'todo'|'active'|'review'|'done'|'blocked'; assignee?:string; requirements:Requirement[]; technical:TechnicalItem[] };
type DetailTab = 'work'|'technical'|'history';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'https://api.byggplan.tunell.org').replace(/\/$/, '');
const labels = {todo:'Kan göras',active:'Pågår',review:'Redo för kontroll',done:'Klart',blocked:'Blockerat'};
const typeLabels = {text:'Tekniska data',drawing:'Ritning',image:'Bild',document:'Dokument',material:'Material'};

const technicalByTask: Record<string,TechnicalItem[]> = {
  t1:[{id:'ti1',title:'Situationsplan',type:'drawing',summary:'Husets placering, tomtgränser och höjdpunkter.',revision:'Rev B'},{id:'ti2',title:'Referensnivåer',type:'text',summary:'Projektets höjdsystem och fasta mätpunkter.',details:['Referenspunkt: nordvästra tomthörnet','Alla nivåer anges i millimeter']}],
  t2:[{id:'ti3',title:'VA-plan',type:'drawing',summary:'Ledningsdragning från huset till trekammarbrunn och infiltration.',revision:'Gällande'},{id:'ti4',title:'Schakt och ledningsbädd',type:'material',summary:'Mått och material för schaktbotten och bädd.',details:['Rördimension: 110 mm','Bäddtjocklek: minst 100 mm','Bäddmaterial enligt projekterat underlag']}],
  t3:[{id:'ti5',title:'Avloppsledning – tekniska data',type:'text',summary:'Dimensioner, fall och kontrollpunkter.',details:['Rördimension: 110 mm','Minsta fall: 10 mm/m','Registrera djup vid hus, riktningsändringar och brunn']},{id:'ti6',title:'Detaljritning anslutning',type:'drawing',summary:'Principdetalj för anslutning mot trekammarbrunn.',revision:'Rev A'}]
};

function addTechnical(tasks: Omit<Task,'technical'>[]): Task[]{return tasks.map(task=>({...task,technical:technicalByTask[task.id]??[]}));}

export function App(){
  const [projects,setProjects]=useState<Project[]>([]);
  const [projectId,setProjectId]=useState<string|null>(null);
  const [tasks,setTasks]=useState<Task[]>([]);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [tab,setTab]=useState<DetailTab>('work');
  const [lastSync,setLastSync]=useState(new Date());
  const [apiState,setApiState]=useState<'loading'|'connected'|'error'|'offline'>('loading');
  const selected=useMemo(()=>tasks.find(task=>task.id===selectedId)??tasks[0],[tasks,selectedId]);
  const currentProject=projects.find(project=>project.id===projectId);

  const grouped=useMemo(()=>{
    const areas=new Map<string,{id:string;name:string;sections:Map<string,{id:string;name:string;tasks:Task[]}>}>();
    for(const task of tasks){
      if(!areas.has(task.workAreaId))areas.set(task.workAreaId,{id:task.workAreaId,name:task.workArea,sections:new Map()});
      const area=areas.get(task.workAreaId)!;
      if(!area.sections.has(task.workSectionId))area.sections.set(task.workSectionId,{id:task.workSectionId,name:task.workSection,tasks:[]});
      area.sections.get(task.workSectionId)!.tasks.push(task);
    }
    return [...areas.values()].map(area=>({...area,sections:[...area.sections.values()]}));
  },[tasks]);

  const loadTasks=useCallback(async(id:string)=>{
    if(!navigator.onLine){setApiState('offline');return;}
    try{
      const response=await fetch(`${API_BASE}/api/tasks?projectId=${encodeURIComponent(id)}`);
      if(!response.ok)throw new Error(`API svarade ${response.status}`);
      const data=await response.json() as {tasks:Omit<Task,'technical'>[]};
      const loaded=addTechnical(data.tasks);
      setTasks(loaded);
      setSelectedId(current=>loaded.some(task=>task.id===current)?current:(loaded[0]?.id??null));
      setApiState('connected');setLastSync(new Date());
    }catch(error){console.error(error);setApiState('error');}
  },[]);

  const loadProjects=useCallback(async()=>{
    if(!navigator.onLine){setApiState('offline');return;}
    try{
      const response=await fetch(`${API_BASE}/api/projects`);
      if(!response.ok)throw new Error(`API svarade ${response.status}`);
      const data=await response.json() as {projects:Project[]};
      setProjects(data.projects);
      setProjectId(current=>current??(data.projects.length===1?data.projects[0].id:null));
      setApiState('connected');
    }catch(error){console.error(error);setApiState('error');}
  },[]);

  useEffect(()=>{void loadProjects()},[loadProjects]);
  useEffect(()=>{if(projectId)void loadTasks(projectId)},[projectId,loadTasks]);
  useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible'&&projectId)void loadTasks(projectId)},60000);return()=>clearInterval(timer)},[projectId,loadTasks]);

  const chooseProject=(id:string)=>{setProjectId(id);setSelectedId(null);setTab('work')};
  const selectTask=(id:string)=>{setSelectedId(id);setTab('work')};
  const update=async(req:Requirement,value?:string)=>{
    if(!navigator.onLine)return alert('Du måste vara online för att registrera.');
    const done=req.kind==='check'?!req.done:Boolean(value);
    const response=await fetch(`${API_BASE}/api/requirements/${req.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:value??null,done})});
    if(!response.ok)return alert('Uppgiften kunde inte sparas.');
    setTasks(current=>current.map(task=>task.id!==selected.id?task:{...task,requirements:task.requirements.map(item=>item.id!==req.id?item:{...item,value,done})}));
    setLastSync(new Date());
  };
  const submit=async()=>{
    const missing=selected.requirements.filter(req=>(req.required??true)&&!req.done);
    if(missing.length)return alert(`${missing.length} obligatoriska uppgifter saknas.`);
    const response=await fetch(`${API_BASE}/api/tasks/${selected.id}/review`,{method:'POST'});
    if(!response.ok)return alert('Momentet kunde inte skickas för kontroll.');
    setTasks(current=>current.map(task=>task.id===selected.id?{...task,status:'review'}:task));
  };

  if(projects.length>1&&!projectId)return <ProjectChooser projects={projects} onChoose={chooseProject}/>;
  if(apiState==='loading'&&!projectId)return <div className="centerState"><strong>ByggPlan</strong><p>Hämtar projekt…</p></div>;
  if(!currentProject)return <div className="centerState"><strong>ByggPlan</strong><p>Inget projekt kunde öppnas.</p><button onClick={()=>void loadProjects()}>Försök igen</button></div>;

  const next=tasks.find(task=>task.status==='active')??tasks.find(task=>task.status==='todo')??tasks.find(task=>task.status!=='done');
  const connection=apiState==='connected'?'Online · Cloudflare':apiState==='offline'?'Offline':'API-fel';

  return <div className="app">
    <header><div><strong>ByggPlan</strong><span>{currentProject.name}</span></div><div className="headerActions">{projects.length>1&&<button onClick={()=>setProjectId(null)}>Byt projekt</button>}<b className={apiState==='connected'?'online':'offline'}>{connection}</b></div></header>
    <main>
      <section className="hero"><p>NÄSTA VIKTIGA MOMENT</p><h1>{next?.title??'Inga öppna moment'}</h1><small>{next?`${next.workArea} · ${next.workSection}`:'Projektet saknar öppna moment'} · Uppdaterad {lastSync.toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'})}</small></section>
      <section className="grid">
        <div className="panel hierarchy"><h2>Projektets arbete</h2>{grouped.map(area=><section className="areaGroup" key={area.id}><h3>{area.name}</h3>{area.sections.map(section=><div className="sectionGroup" key={section.id}><h4>{section.name}</h4>{section.tasks.map(task=><button className={`task ${selected?.id===task.id?'selected':''}`} onClick={()=>selectTask(task.id)} key={task.id}><i className={task.status}/><span><b>{task.title}</b><small>{labels[task.status]}{task.assignee?` · ${task.assignee}`:''}</small></span><em>›</em></button>)}</div>)}</section>)}</div>
        {selected&&<aside><p>{selected.workArea.toUpperCase()} · {selected.workSection.toUpperCase()}</p><h2>{selected.title}</h2><span className={`pill ${selected.status}`}>{labels[selected.status]}</span><p>{selected.description}</p><div className="detailTabs"><button className={tab==='work'?'active':''} onClick={()=>setTab('work')}>Arbete</button><button className={tab==='technical'?'active':''} onClick={()=>setTab('technical')}>Tekniskt underlag <span>{selected.technical.length}</span></button><button className={tab==='history'?'active':''} onClick={()=>setTab('history')}>Historik</button></div>
        {tab==='work'&&<><h3>Kontrollpunkter och dokumentation</h3>{selected.requirements.map(req=><div className="requirement" key={req.id}><div><b>{req.label}</b>{req.kind==='measurement'?<label><input inputMode="decimal" value={req.value??''} onChange={event=>void update(req,event.target.value)}/>{req.unit}</label>:req.kind==='photo'?<button onClick={()=>void update(req,'registrerat')}>{req.done?'Foto registrerat':'Lägg till foto'}</button>:<label><input type="checkbox" checked={req.done} onChange={()=>void update(req)}/> Kontrollerat</label>}{req.min!=null&&<small>Minst {req.min} {req.unit}</small>}</div><strong className={req.done?'done':''}>{req.done?'Klar':'Saknas'}</strong></div>)}<button className="technicalShortcut" onClick={()=>setTab('technical')}>Visa tekniskt underlag</button><button className="complete" onClick={()=>void submit()}>Skicka för kontroll</button></>}
        {tab==='technical'&&<section className="technicalPanel"><div className="technicalHeader"><div><h3>Tekniskt underlag</h3><p>Ritningar, data, material och dokument som gäller för momentet.</p></div><button>＋ Lägg till</button></div>{selected.technical.length===0&&<p className="emptyText">Inget tekniskt underlag är kopplat ännu.</p>}{selected.technical.map(item=><article className="technicalCard" key={item.id}><div className={`fileIcon ${item.type}`}>{item.type==='drawing'?'▱':item.type==='image'?'▧':item.type==='document'?'▤':item.type==='material'?'▦':'i'}</div><div><div className="technicalMeta"><span>{typeLabels[item.type]}</span>{item.revision&&<b>{item.revision}</b>}</div><h4>{item.title}</h4><p>{item.summary}</p>{item.details&&<ul>{item.details.map(detail=><li key={detail}>{detail}</li>)}</ul>}<button className="openResource">Öppna underlag</button></div></article>)}</section>}
        {tab==='history'&&<section className="history"><h3>Historik</h3><p>Ändringar, registreringar och godkännanden visas här.</p></section>}</aside>}
      </section>
    </main>
  </div>;
}

function ProjectChooser({projects,onChoose}:{projects:Project[];onChoose:(id:string)=>void}){
  return <main className="projectChooser"><div><strong className="brand">ByggPlan</strong><p>Välj vilket byggprojekt du vill arbeta med.</p></div><section>{projects.map(project=><button key={project.id} onClick={()=>onChoose(project.id)}><span><b>{project.name}</b><small>{project.property_designation??'Ingen fastighetsbeteckning'} · {project.status}</small><em>{project.work_area_count} områden · {project.task_count} moment</em></span><i>›</i></button>)}</section></main>;
}
