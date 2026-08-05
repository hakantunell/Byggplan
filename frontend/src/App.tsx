import { useEffect, useMemo, useState } from 'react';

type Requirement = { id:string; label:string; kind:'photo'|'measurement'|'check'; unit?:string; min?:number; done:boolean; value?:string };
type Task = { id:string; section:string; title:string; description:string; status:'todo'|'active'|'review'|'done'|'blocked'; assignee?:string; requirements:Requirement[] };

const seed: Task[] = [
  {id:'t1',section:'Markarbete',title:'Dokumentera ursprunglig mark',description:'Ta översiktsbilder och notera befintliga nivåer innan schaktningen startar.',status:'active',assignee:'Håkan',requirements:[{id:'r1',label:'Översiktsbilder från fyra riktningar',kind:'photo',done:false},{id:'r2',label:'Referensnivå vid nordvästra hörnet',kind:'measurement',unit:'mm',done:false}]},
  {id:'t2',section:'Avlopp',title:'Kontrollera schakt före rörläggning',description:'Kontrollera schaktbotten och anslutningspunkt innan bädden läggs.',status:'todo',requirements:[{id:'r3',label:'Schaktdjup vid huset',kind:'measurement',unit:'mm',min:800,done:false},{id:'r4',label:'Foto av hela ledningssträckan',kind:'photo',done:false},{id:'r5',label:'Schaktbotten fri från löst material',kind:'check',done:false}]},
  {id:'t3',section:'Avlopp',title:'Lägg och kontrollera avloppsrör',description:'Registrera fall och förläggningsdjup innan återfyllning.',status:'blocked',requirements:[{id:'r6',label:'Förläggningsdjup vid huset',kind:'measurement',unit:'mm',min:800,done:false},{id:'r7',label:'Rörfall',kind:'measurement',unit:'mm/m',min:10,done:false},{id:'r8',label:'Foto av anslutningar och skarvar',kind:'photo',done:false}]}
];

const labels = {todo:'Kan göras',active:'Pågår',review:'Redo för kontroll',done:'Klart',blocked:'Blockerat'};

export function App(){
  const [tasks,setTasks]=useState<Task[]>(seed);
  const [selectedId,setSelectedId]=useState('t1');
  const [lastSync,setLastSync]=useState(new Date());
  const selected=useMemo(()=>tasks.find(t=>t.id===selectedId)!,[tasks,selectedId]);
  useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible'&&navigator.onLine)setLastSync(new Date())},60000);return()=>clearInterval(timer)},[]);
  const update=(taskId:string,reqId:string,value?:string)=>{if(!navigator.onLine)return alert('Du måste vara online för att registrera.');setTasks(current=>current.map(task=>task.id!==taskId?task:{...task,requirements:task.requirements.map(req=>req.id!==reqId?req:{...req,value,done:req.kind==='check'?!req.done:Boolean(value)})}));setLastSync(new Date())};
  const submit=()=>{const missing=selected.requirements.filter(r=>!r.done);if(missing.length)return alert(`${missing.length} obligatoriska uppgifter saknas.`);setTasks(current=>current.map(t=>t.id===selected.id?{...t,status:'review'}:t))};
  return <div className="app"><header><div><strong>ByggPlan</strong><span>Vemdalens Kyrkby 44:10</span></div><b className={navigator.onLine?'online':'offline'}>{navigator.onLine?'Online':'Offline'}</b></header><main><section className="hero"><p>NÄSTA VIKTIGA MOMENT</p><h1>{tasks.find(t=>t.status!=='done')?.title}</h1><small>Senast uppdaterad {lastSync.toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'})}</small></section><section className="grid"><div className="panel"><h2>Vad kan göras nu?</h2>{tasks.map(task=><button className={`task ${selectedId===task.id?'selected':''}`} onClick={()=>setSelectedId(task.id)} key={task.id}><i className={task.status}/><span><b>{task.title}</b><small>{task.section} · {labels[task.status]}{task.assignee?` · ${task.assignee}`:''}</small></span><em>›</em></button>)}</div><aside><p>{selected.section.toUpperCase()}</p><h2>{selected.title}</h2><span className={`pill ${selected.status}`}>{labels[selected.status]}</span><p>{selected.description}</p><h3>Obligatorisk dokumentation</h3>{selected.requirements.map(req=><div className="requirement" key={req.id}><div><b>{req.label}</b>{req.kind==='measurement'?<label><input inputMode="decimal" value={req.value??''} onChange={e=>update(selected.id,req.id,e.target.value)}/>{req.unit}</label>:req.kind==='photo'?<button onClick={()=>update(selected.id,req.id,'registrerat')}>{req.done?'Foto registrerat':'Lägg till foto'}</button>:<label><input type="checkbox" checked={req.done} onChange={()=>update(selected.id,req.id)}/> Kontrollerat</label>}{req.min&&<small>Minst {req.min} {req.unit}</small>}</div><strong className={req.done?'done':''}>{req.done?'Klar':'Saknas'}</strong></div>)}<button className="complete" onClick={submit}>Skicka för kontroll</button></aside></section></main></div>
}
