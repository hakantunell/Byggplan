const seedTasks = [
  {id:'t1',section:'Markarbete',title:'Dokumentera ursprunglig mark',description:'Ta översiktsbilder och notera befintliga nivåer innan schaktningen startar.',status:'active',assignee:'Håkan',requirements:[{id:'r1',label:'Översiktsbilder från fyra riktningar',kind:'photo',required:true,done:false},{id:'r2',label:'Referensnivå vid husets nordvästra hörn',kind:'measurement',unit:'mm',required:true,done:false}]},
  {id:'t2',section:'Avlopp',title:'Kontrollera schakt före rörläggning',description:'Kontrollera schaktbotten, ledningssträckning och anslutningspunkt innan bädden läggs.',status:'todo',requirements:[{id:'r3',label:'Schaktdjup vid huset',kind:'measurement',unit:'mm',min:800,required:true,done:false},{id:'r4',label:'Foto av hela ledningssträckan',kind:'photo',required:true,done:false},{id:'r5',label:'Schaktbotten fri från löst material',kind:'check',required:true,done:false}]},
  {id:'t3',section:'Avlopp',title:'Lägg och kontrollera avloppsrör',description:'Registrera rördimension, fall och förläggningsdjup innan återfyllning.',status:'blocked',blockedBy:['t2'],requirements:[{id:'r6',label:'Förläggningsdjup vid huset',kind:'measurement',unit:'mm',min:800,required:true,done:false},{id:'r7',label:'Rörfall',kind:'measurement',unit:'mm/m',min:10,required:true,done:false},{id:'r8',label:'Foto av anslutningar och skarvar',kind:'photo',required:true,done:false}]},
  {id:'t4',section:'Grund',title:'Märk ut grundens hörn',description:'Kontrollera mått och diagonaler innan schakt för sulor.',status:'todo',requirements:[{id:'r9',label:'Diagonal A',kind:'measurement',unit:'mm',required:true,done:false},{id:'r10',label:'Diagonal B',kind:'measurement',unit:'mm',required:true,done:false},{id:'r11',label:'Hörnpunkter fotograferade',kind:'photo',required:true,done:false}]}
];

const statusLabels = {todo:'Kan göras',active:'Pågår',review:'Redo för kontroll',done:'Klart',blocked:'Blockerat'};
let tasks = structuredClone(seedTasks);
let selectedId = 't1';
let lastSync = new Date();
let notice = '';

const app = document.querySelector('#app');
const icon = (name) => ({hardhat:'⛑',cloud:'☁',offline:'☁',next:'›',active:'◉',warning:'⚠',bell:'●',users:'👥',plus:'＋',camera:'▣',ruler:'↔',check:'✓'}[name] || '•');
const selectedTask = () => tasks.find(t => t.id === selectedId);
const online = () => navigator.onLine;

function setNotice(message){ notice = message; render(); setTimeout(() => { if(notice === message){ notice=''; render(); } }, 3500); }
function syncNow(){ if(online()) { lastSync = new Date(); render(); } }
function updateRequirement(taskId, reqId, value){
  if(!online()) return setNotice('Du måste vara online för att registrera uppgifter.');
  const task = tasks.find(t => t.id === taskId); const req = task.requirements.find(r => r.id === reqId);
  if(req.kind === 'check') req.done = !req.done;
  else { req.value = value; req.done = Boolean(value); }
  lastSync = new Date(); render();
}
function submitForReview(taskId){
  if(!online()) return setNotice('Du måste vara online för att slutföra ett moment.');
  const task = tasks.find(t => t.id === taskId); const missing = task.requirements.filter(r => r.required && !r.done);
  if(missing.length) return setNotice(`Kan inte slutföras. ${missing.length} obligatoriska uppgifter saknas.`);
  task.status = 'review'; lastSync = new Date(); setNotice('Momentet är skickat till arbetsledaren för kontroll.');
}
function requirementMarkup(task, req){
  const control = req.kind === 'measurement'
    ? `<div class="measure"><input data-action="measure" data-task="${task.id}" data-req="${req.id}" inputmode="decimal" value="${req.value ?? ''}" placeholder="Ange värde"><span>${req.unit ?? ''}</span></div>${req.min ? `<small>Minst ${req.min} ${req.unit}</small>` : ''}`
    : req.kind === 'photo'
      ? `<button class="secondary" data-action="photo" data-task="${task.id}" data-req="${req.id}">${req.done ? 'Foto registrerat' : 'Lägg till foto'}</button>`
      : `<label class="check"><input data-action="check" data-task="${task.id}" data-req="${req.id}" type="checkbox" ${req.done ? 'checked' : ''}>Kontrollerat</label>`;
  return `<div class="req"><div class="reqIcon">${icon(req.kind === 'photo' ? 'camera' : req.kind === 'measurement' ? 'ruler' : 'check')}</div><div class="reqBody"><b>${req.label}</b>${control}</div><span class="state ${req.done ? 'done' : ''}">${req.done ? 'Klar' : 'Saknas'}</span></div>`;
}
function render(){
  const selected = selectedTask(); const active = tasks.filter(t => t.status !== 'done');
  app.innerHTML = `<div class="app"><header><div class="brand"><span class="brandIcon">${icon('hardhat')}</span><div><strong>ByggPlan</strong><span>Vemdalens Kyrkby 44:10</span></div></div><div class="online ${online() ? 'ok':'bad'}">${icon(online() ? 'cloud':'offline')} ${online() ? 'Online':'Offline'}</div></header>
  <main><section class="hero"><div><p class="eyebrow">NÄSTA VIKTIGA MOMENT</p><h1>${active[0]?.title ?? 'Inga öppna moment'}</h1><p>${active[0]?.description ?? ''}</p><button data-action="select" data-id="${active[0]?.id ?? ''}">Öppna moment ${icon('next')}</button></div><div class="sync">Senast uppdaterad ${lastSync.toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'})}</div></section>
  <section class="stats"><article><span>${icon('active')}</span><div><b>${tasks.filter(t=>t.status==='active').length}</b><span>Pågår</span></div></article><article><span>${icon('warning')}</span><div><b>${tasks.filter(t=>t.status==='blocked').length}</b><span>Blockerade</span></div></article><article><span>${icon('bell')}</span><div><b>2</b><span>Kräver uppmärksamhet</span></div></article><article><span>${icon('users')}</span><div><b>3</b><span>På bygget</span></div></article></section>
  <section class="layout"><div class="list"><div class="sectionTitle"><div><p class="eyebrow">AKTIVA ARBETSAVSNITT</p><h2>Vad kan göras nu?</h2></div><button class="ghost">${icon('plus')} Nytt moment</button></div>${tasks.map(t=>`<button class="task ${selectedId===t.id?'selected':''}" data-action="select" data-id="${t.id}"><span class="dot ${t.status}"></span><div><b>${t.title}</b><small>${t.section} · ${statusLabels[t.status]}${t.assignee ? ` · ${t.assignee}`:''}</small></div><span>${icon('next')}</span></button>`).join('')}</div>
  ${selected ? `<aside><div class="asideHead"><p class="eyebrow">${selected.section.toUpperCase()}</p><h2>${selected.title}</h2><p>${selected.description}</p><span class="pill ${selected.status}">${statusLabels[selected.status]}</span></div><div class="reqs"><h3>Obligatorisk dokumentation</h3>${selected.requirements.map(r=>requirementMarkup(selected,r)).join('')}</div><button class="complete" data-action="submit" data-id="${selected.id}">Skicka för kontroll</button></aside>`:''}</section></main>
  ${notice ? `<div class="toast">${notice}</div>`:''}<nav><button class="active"><span>${icon('hardhat')}</span><span>Arbete</span></button><button><span>${icon('bell')}</span><span>Notiser</span></button><button><span>${icon('users')}</span><span>Personer</span></button></nav></div>`;
}

app.addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if(!el) return;
  const action = el.dataset.action;
  if(action === 'select'){ selectedId = el.dataset.id; render(); }
  if(action === 'photo') updateRequirement(el.dataset.task, el.dataset.req, 'foto-uppladdat');
  if(action === 'check') updateRequirement(el.dataset.task, el.dataset.req);
  if(action === 'submit') submitForReview(el.dataset.id);
});
app.addEventListener('change', e => {
  const el = e.target; if(el.dataset.action === 'measure') updateRequirement(el.dataset.task, el.dataset.req, el.value.trim());
});
addEventListener('online', render); addEventListener('offline', render); addEventListener('focus', syncNow);
setInterval(() => { if(document.visibilityState === 'visible' && online()) syncNow(); }, 60000);
render();
