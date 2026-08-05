const seedTasks = [
  {id:'t1',section:'Markarbete',title:'Dokumentera ursprunglig mark',description:'Ta översiktsbilder och notera befintliga nivåer innan schaktningen startar.',status:'active',assignee:'Håkan',requirements:[{id:'r1',label:'Översiktsbilder från fyra riktningar',kind:'photo',required:true,done:false},{id:'r2',label:'Referensnivå vid husets nordvästra hörn',kind:'measurement',unit:'mm',required:true,done:false}]},
  {id:'t2',section:'Avlopp',title:'Kontrollera schakt före rörläggning',description:'Kontrollera schaktbotten, ledningssträckning och anslutningspunkt innan bädden läggs.',status:'todo',requirements:[{id:'r3',label:'Schaktdjup vid huset',kind:'measurement',unit:'mm',min:800,required:true,done:false},{id:'r4',label:'Foto av hela ledningssträckan',kind:'photo',required:true,done:false},{id:'r5',label:'Schaktbotten fri från löst material',kind:'check',required:true,done:false}]},
  {id:'t3',section:'Avlopp',title:'Lägg och kontrollera avloppsrör',description:'Registrera rördimension, fall och förläggningsdjup innan återfyllning.',status:'blocked',blockedBy:['t2'],requirements:[{id:'r6',label:'Förläggningsdjup vid huset',kind:'measurement',unit:'mm',min:800,required:true,done:false},{id:'r7',label:'Rörfall',kind:'measurement',unit:'mm/m',min:10,required:true,done:false},{id:'r8',label:'Foto av anslutningar och skarvar',kind:'photo',required:true,done:false}]},
  {id:'t4',section:'Grund',title:'Märk ut grundens hörn',description:'Kontrollera mått och diagonaler innan schakt för sulor.',status:'todo',requirements:[{id:'r9',label:'Diagonal A',kind:'measurement',unit:'mm',required:true,done:false},{id:'r10',label:'Diagonal B',kind:'measurement',unit:'mm',required:true,done:false},{id:'r11',label:'Hörnpunkter fotograferade',kind:'photo',required:true,done:false}]}
];

const API = (window.BYGGPLAN_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');
const statusLabels = {todo:'Kan göras',active:'Pågår',review:'Redo för kontroll',done:'Klart',blocked:'Blockerat'};
let tasks = structuredClone(seedTasks), selectedId = 't1', lastSync = new Date(), notice = '', apiConnected = false;
const app = document.querySelector('#app');
const icon = n => ({hardhat:'⛑',cloud:'☁',offline:'☁',next:'›',active:'◉',warning:'⚠',bell:'●',users:'👥',plus:'＋',camera:'▣',ruler:'↔',check:'✓'}[n] || '•');
const selectedTask = () => tasks.find(t => t.id === selectedId);
const online = () => navigator.onLine;
const setNotice = message => { notice=message; render(); setTimeout(()=>{if(notice===message){notice='';render();}},3500); };

async function api(path, options={}) {
  if(!API) throw new Error('API är inte konfigurerat');
  const response = await fetch(`${API}${path}`, {headers:{'Content-Type':'application/json'}, ...options});
  const data = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error || 'API-anropet misslyckades');
  return data;
}
async function syncNow(showError=false){
  if(!online() || !API) { apiConnected=false; render(); return; }
  try {
    const data = await api('/api/tasks');
    tasks = data.tasks; apiConnected=true; lastSync=new Date(data.serverTime || Date.now());
    if(!tasks.some(t=>t.id===selectedId)) selectedId=tasks[0]?.id;
    render();
  } catch(error) { apiConnected=false; if(showError) setNotice(error.message); else render(); }
}
async function updateRequirement(taskId, reqId, value){
  if(!online()) return setNotice('Du måste vara online för att registrera uppgifter.');
  const task=tasks.find(t=>t.id===taskId), req=task.requirements.find(r=>r.id===reqId);
  const done=req.kind==='check' ? !req.done : Boolean(value);
  if(!API) { req.done=done; req.value=value; lastSync=new Date(); render(); return setNotice('Demoläge: uppgiften sparas inte permanent ännu.'); }
  try { await api(`/api/tasks/${taskId}/requirements/${reqId}`,{method:'PUT',body:JSON.stringify({value,done})}); await syncNow(true); }
  catch(error){ setNotice(error.message); }
}
async function submitForReview(taskId){
  if(!online()) return setNotice('Du måste vara online för att slutföra ett moment.');
  const task=tasks.find(t=>t.id===taskId), missing=task.requirements.filter(r=>r.required&&!r.done);
  if(missing.length) return setNotice(`Kan inte slutföras. ${missing.length} obligatoriska uppgifter saknas.`);
  if(!API) { task.status='review'; render(); return setNotice('Demoläge: statusen sparas inte permanent ännu.'); }
  try { await api(`/api/tasks/${taskId}/submit`,{method:'POST'}); await syncNow(); setNotice('Momentet är skickat till arbetsledaren för kontroll.'); }
  catch(error){ setNotice(error.message); }
}
function requirementMarkup(task,req){
  const control=req.kind==='measurement'
    ? `<div class="measure"><input data-action="measure" data-task="${task.id}" data-req="${req.id}" inputmode="decimal" value="${req.value??''}" placeholder="Ange värde"><span>${req.unit??''}</span></div>${req.min?`<small>Minst ${req.min} ${req.unit}</small>`:''}`
    : req.kind==='photo' ? `<button class="secondary" data-action="photo" data-task="${task.id}" data-req="${req.id}">${req.done?'Foto registrerat':'Registrera foto'}</button>`
    : `<label class="check"><input data-action="check" data-task="${task.id}" data-req="${req.id}" type="checkbox" ${req.done?'checked':''}>Kontrollerat</label>`;
  return `<div class="req"><div class="reqIcon">${icon(req.kind==='photo'?'camera':req.kind==='measurement'?'ruler':'check')}</div><div class="reqBody"><b>${req.label}</b>${control}</div><span class="state ${req.done?'done':''}">${req.done?'Klar':'Saknas'}</span></div>`;
}
function render(){
  const selected=selectedTask(), active=tasks.filter(t=>t.status!=='done');
  const connection=!online()?'Offline':API?(apiConnected?'Online · sparar i Cloudflare':'Online · API ej nåbart'):'Demoläge';
  app.innerHTML=`<div class="app"><header><div class="brand"><span class="brandIcon">${icon('hardhat')}</span><div><strong>ByggPlan</strong><span>Vemdalens Kyrkby 44:10</span></div></div><div class="online ${online()?'ok':'bad'}">${icon(online()?'cloud':'offline')} ${connection}</div></header>
  <main><section class="hero"><div><p class="eyebrow">NÄSTA VIKTIGA MOMENT</p><h1>${active[0]?.title??'Inga öppna moment'}</h1><p>${active[0]?.description??''}</p><button data-action="select" data-id="${active[0]?.id??''}">Öppna moment ${icon('next')}</button></div><div class="sync">Senast uppdaterad ${lastSync.toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'})}</div></section>
  <section class="stats"><article><span>${icon('active')}</span><div><b>${tasks.filter(t=>t.status==='active').length}</b><span>Pågår</span></div></article><article><span>${icon('warning')}</span><div><b>${tasks.filter(t=>t.status==='blocked').length}</b><span>Blockerade</span></div></article><article><span>${icon('bell')}</span><div><b>${tasks.filter(t=>t.status==='review').length}</b><span>För kontroll</span></div></article><article><span>${icon('users')}</span><div><b>3</b><span>På bygget</span></div></article></section>
  <section class="layout"><div class="list"><div class="sectionTitle"><div><p class="eyebrow">AKTIVA ARBETSAVSNITT</p><h2>Vad kan göras nu?</h2></div><button class="ghost">${icon('plus')} Nytt moment</button></div>${tasks.map(t=>`<button class="task ${selectedId===t.id?'selected':''}" data-action="select" data-id="${t.id}"><span class="dot ${t.status}"></span><div><b>${t.title}</b><small>${t.section} · ${statusLabels[t.status]}${t.assignee?` · ${t.assignee}`:''}</small></div><span>${icon('next')}</span></button>`).join('')}</div>
  ${selected?`<aside><div class="asideHead"><p class="eyebrow">${selected.section.toUpperCase()}</p><h2>${selected.title}</h2><p>${selected.description}</p><span class="pill ${selected.status}">${statusLabels[selected.status]}</span></div><div class="reqs"><h3>Obligatorisk dokumentation</h3>${selected.requirements.map(r=>requirementMarkup(selected,r)).join('')}</div><button class="complete" data-action="submit" data-id="${selected.id}">Skicka för kontroll</button></aside>`:''}</section></main>
  ${notice?`<div class="toast">${notice}</div>`:''}<nav><button class="active"><span>${icon('hardhat')}</span><span>Arbete</span></button><button><span>${icon('bell')}</span><span>Notiser</span></button><button><span>${icon('users')}</span><span>Personer</span></button></nav></div>`;
}
app.addEventListener('click',e=>{const el=e.target.closest('[data-action]');if(!el)return;const a=el.dataset.action;if(a==='select'){selectedId=el.dataset.id;render();}if(a==='photo')updateRequirement(el.dataset.task,el.dataset.req,'foto-registrerat');if(a==='check')updateRequirement(el.dataset.task,el.dataset.req);if(a==='submit')submitForReview(el.dataset.id);});
app.addEventListener('change',e=>{const el=e.target;if(el.dataset.action==='measure')updateRequirement(el.dataset.task,el.dataset.req,el.value.trim());});
addEventListener('online',()=>syncNow());addEventListener('offline',render);addEventListener('focus',()=>syncNow());
setInterval(()=>{if(document.visibilityState==='visible'&&online())syncNow();},60000);
render();syncNow();
