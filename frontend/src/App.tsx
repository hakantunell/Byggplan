import { useCallback, useEffect, useMemo, useState } from 'react';

type Requirement = { id:string; label:string; kind:'photo'|'measurement'|'check'; unit?:string; min?:number; done:boolean; value?:string; required?:boolean };
type TechnicalItem = { id:string; title:string; type:'text'|'drawing'|'image'|'document'; summary:string; revision?:string; details?:string[] };
type Task = { id:string; section:string; title:string; description:string; status:'todo'|'active'|'review'|'done'|'blocked'; assignee?:string; requirements:Requirement[]; technical:TechnicalItem[] };
type DetailTab = 'work'|'technical'|'history';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'https://api.byggplan.tunell.org').replace(/\/$/, '');

const seed: Task[] = [
  {id:'t1',section:'Markarbete',title:'Dokumentera ursprunglig mark',description:'Ta översiktsbilder och notera befintliga nivåer innan schaktningen startar.',status:'active',assignee:'Håkan',requirements:[{id:'r1',label:'Översiktsbilder från fyra riktningar',kind:'photo',done:false},{id:'r2',label:'Referensnivå vid nordvästra hörnet',kind:'measurement',unit:'mm',done:false}],technical:[{id:'ti1',title:'Situationsplan',type:'drawing',summary:'Husets placering, tomtgränser och höjdpunkter.',revision:'Rev B'},{id:'ti2',title:'Referensnivåer',type:'text',summary:'Projektets höjdsystem och fasta mätpunkter.',details:['Referenspunkt: nordvästra tomthörnet','Alla nivåer anges i millimeter','Fotografera mätinstrument och referenspunkt tillsammans']}]},
  {id:'t2',section:'Avlopp',title:'Kontrollera schakt före rörläggning',description:'Kontrollera schaktbotten och anslutningspunkt innan bädden läggs.',status:'todo',requirements:[{id:'r3',label:'Schaktdjup vid huset',kind:'measurement',unit:'mm',min:800,done:false},{id:'r4',label:'Foto av hela ledningssträckan',kind:'photo',done:false},{id:'r5',label:'Schaktbotten fri från löst material',kind:'check',done:false}],technical:[{id:'ti3',title:'VA-plan',type:'drawing',summary:'Ledningsdragning från huset till trekammarbrunn och befintlig infiltration.',revision:'Gällande'},{id:'ti4',title:'Schakt och ledningsbädd',type:'text',summary:'Mått och material för schaktbotten och bädd.',details:['Rördimension: 110 mm','Bäddtjocklek: minst 100 mm','Förläggningsdjup vid huset: minst 800 mm','Dokumentera innan rör läggs och innan återfyllning']}]},
  {id:'t3',section:'Avlopp',title:'Lägg och kontrollera avloppsrör',description:'Registrera fall och förläggningsdjup innan återfyllning.',status:'blocked',requirements:[{id:'r6',label:'Förläggningsdjup vid huset',kind:'measurement',unit:'mm',min:800,done:false},{id:'r7',label:'Rörfall',kind:'measurement',unit:'mm/m',min:10,done:false},{id:'r8',label:'Foto av anslutningar och skarvar',kind:'photo',done:false}],technical:[{id:'ti5',title:'Avloppsledning – tekniska data',type:'text',summary:'Dimensioner, fall och kontrollpunkter.',details:['Rördimension: 110 mm','Minsta fall: 10 mm/m','Kontrollera och fotografera samtliga anslutningar','Registrera djup vid hus, riktningsändringar och brunn']},{id:'ti6',title:'Detaljritning anslutning',type:'drawing',summary:'Principdetalj för anslutning mot trekammarbrunn.',revision:'Rev A'}]}
];

const labels = {todo:'Kan göras',active:'Pågår',review:'Redo för kontroll',done:'Klart',blocked:'Blockerat'};
const typeLabels = {text:'Teknisk information',drawing:'Ritning',image:'Bild',document:'Dokument'};
const technicalByTask = new Map(seed.map(task => [task.id, task.technical]));

function withTechnical(tasks: Omit<Task,'technical'>[]): Task[] {
  return tasks.map(task => ({...task, technical: technicalByTask.get(task.id) ?? []}));
}

export function App(){
  const [tasks,setTasks]=useState<Task[]>(seed);
  const [selectedId,setSelectedId]=useState('t1');
  const [tab,setTab]=useState<DetailTab>('work');
  const [lastSync,setLastSync]=useState(new Date());
  const [apiState,setApiState]=useState<'loading'|'connected'|'fallback'|'offline'>('loading');
  const selected=useMemo(()=>tasks.find(t=>t.id===selectedId) ?? tasks[0],[tasks,selectedId]);

  const loadTasks=useCallback(async()=>{
    if(!navigator.onLine){setApiState('offline');return;}
    try{
      const response=await fetch(`${API_BASE}/api/tasks`,{headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error(`API svarade ${response.status}`);
      const data=await response.json() as {tasks: Omit<Task,'technical'>[]};
      const loaded=withTechnical(data.tasks);
      setTasks(loaded.length?loaded:seed);
      setSelectedId(current=>loaded.some(task=>task.id===current)?current:(loaded[0]?.id??'t1'));
      setApiState('connected');
      setLastSync(new Date());
    }catch(error){
      console.error(error);
      setApiState('fallback');
    }
  },[]);

  useEffect(()=>{void loadTasks();const timer=setInterval(()=>{if(document.visibilityState==='visible')void loadTasks()},60000);const onFocus=()=>void loadTasks();addEventListener('focus',onFocus);return()=>{clearInterval(timer);removeEventListener('focus',onFocus)}},[loadTasks]);

  const selectTask=(id:string)=>{setSelectedId(id);setTab('work')};
  const update=async(taskId:string,reqId:string,value?:string)=>{
    if(!navigator.onLine)return alert('Du måste vara online för att registrera.');
    const task=tasks.find(item=>item.id===taskId);const req=task?.requirements.find(item=>item.id===reqId);if(!req)return;
    const done=req.kind==='check'?!req.done:Boolean(value);
    const response=await fetch(`${API_BASE}/api/requirements/${reqId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:value??null,done})});
    if(!response.ok)return alert('Uppgiften kunde inte sparas. Försök igen.');
    setTasks(current=>current.map(item=>item.id!==taskId?item:{...item,requirements:item.requirements.map(requirement=>requirement.id!==reqId?requirement:{...requirement,value,done})}));
    setApiState('connected');setLastSync(new Date());
  };
  const submit=async()=>{
    const missing=selected.requirements.filter(r=>(r.required??true)&&!r.done);if(missing.length)return alert(`${missing.length} obligatoriska uppgifter saknas.`);
    const response=await fetch(`${API_BASE}/api/tasks/${selected.id}/review`,{method:'POST'});if(!response.ok)return alert('Momentet kunde inte skickas för kontroll.');
    setTasks(current=>current.map(t=>t.id===selected.id?{...t,status:'review'}:t));setLastSync(new Date());
  };
  const connectionLabel=apiState==='connected'?'Online · Cloudflare':apiState==='offline'?'Offline':apiState==='loading'?'Ansluter…':'Demoläge · API ej nåbart';

  return <div className="app"><header><div><strong>ByggPlan</strong><span>Vemdalens Kyrkby 44:10</span></div><b className={apiState==='connected'?'online':'offline'}>{connectionLabel}</b></header><main><section className="hero"><p>NÄSTA VIKTIGA MOMENT</p><h1>{tasks.find(t=>t.status!=='done')?.title??'Inga öppna moment'}</h1><small>Senast uppdaterad {lastSync.toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'})}</small></section><section className="grid"><div className="panel"><h2>Vad kan göras nu?</h2>{tasks.map(task=><button className={`task ${selectedId===task.id?'selected':''}`} onClick={()=>selectTask(task.id)} key={task.id}><i className={task.status}/><span><b>{task.title}</b><small>{task.section} · {labels[task.status]}{task.assignee?` · ${task.assignee}`:''}</small></span><em>›</em></button>)}</div>{selected&&<aside><p>{selected.section.toUpperCase()}</p><h2>{selected.title}</h2><span className={`pill ${selected.status}`}>{labels[selected.status]}</span><p>{selected.description}</p><div className="detailTabs"><button className={tab==='work'?'active':''} onClick={()=>setTab('work')}>Arbete</button><button className={tab==='technical'?'active':''} onClick={()=>setTab('technical')}>Tekniskt underlag <span>{selected.technical.length}</span></button><button className={tab==='history'?'active':''} onClick={()=>setTab('history')}>Historik</button></div>{tab==='work'&&<><h3>Obligatorisk dokumentation</h3>{selected.requirements.map(req=><div className="requirement" key={req.id}><div><b>{req.label}</b>{req.kind==='measurement'?<label><input inputMode="decimal" value={req.value??''} onChange={e=>void update(selected.id,req.id,e.target.value)}/>{req.unit}</label>:req.kind==='photo'?<button onClick={()=>void update(selected.id,req.id,'registrerat')}>{req.done?'Foto registrerat':'Lägg till foto'}</button>:<label><input type="checkbox" checked={req.done} onChange={()=>void update(selected.id,req.id)}/> Kontrollerat</label>}{req.min&&<small>Minst {req.min} {req.unit}</small>}</div><strong className={req.done?'done':''}>{req.done?'Klar':'Saknas'}</strong></div>)}<button className="technicalShortcut" onClick={()=>setTab('technical')}>Visa tekniskt underlag</button><button className="complete" onClick={()=>void submit()}>Skicka för kontroll</button></>}{tab==='technical'&&<section className="technicalPanel"><div className="technicalHeader"><div><h3>Tekniskt underlag</h3><p>Gällande data, ritningar och dokument för momentet.</p></div><button title="Administratörsfunktion">＋ Lägg till</button></div>{selected.technical.map(item=><article className="technicalCard" key={item.id}><div className={`fileIcon ${item.type}`}>{item.type==='drawing'?'▱':item.type==='image'?'▧':item.type==='document'?'▤':'i'}</div><div><div className="technicalMeta"><span>{typeLabels[item.type]}</span>{item.revision&&<b>{item.revision}</b>}</div><h4>{item.title}</h4><p>{item.summary}</p>{item.details&&<ul>{item.details.map(detail=><li key={detail}>{detail}</li>)}</ul>}<button className="openResource">Öppna underlag</button></div></article>)}</section>}{tab==='history'&&<section className="history"><h3>Historik</h3><p>Ändringar, registreringar och godkännanden kommer att visas här.</p><div><b>Moment skapat</b><small>System · ursprunglig projektplan</small></div></section>}</aside>}</section></main></div>
}
