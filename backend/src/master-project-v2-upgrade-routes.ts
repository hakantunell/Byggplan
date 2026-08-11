type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};
type ActivitySeed={title:string;type:string;description?:string};
type TaskSeed={sectionNumber:string;sectionName?:string;title:string;activities:ActivitySeed[]};

const TASKS:TaskSeed[]=[
 {sectionNumber:'10.10',title:'Hantera generella byggstartskontroller',activities:[
  {title:'Registrera BAS-P',type:'document'},{title:'Registrera BAS-U',type:'document'},
  {title:'Genomför startmöte med byggherre och KA',type:'approval'},
  {title:'Utför utsättning av byggnaden enligt gällande handling',type:'measurement'},
  {title:'Beställ och genomför lägeskontroll samt spara mätintyg',type:'measurement'}]},
 {sectionNumber:'20.10',title:'Kontrollera markförutsättningar',activities:[
  {title:'Kontrollera geotekniskt underlag och markförhållanden',type:'check'},
  {title:'Kontrollera radonförutsättningar och eventuell radonklass',type:'check'}]},
 {sectionNumber:'20.20',title:'Genomför extern kontroll av grund',activities:[
  {title:'Beställ och genomför KA-besök vid grundbotten före gjutning',type:'approval'}]},
 {sectionNumber:'20.20',title:'Bygg och kontrollera grund',activities:[
  {title:'Kontrollera grundläggning och vald grundlösning mot konstruktionshandling',type:'check'}]},
 {sectionNumber:'30.10',title:'Genomför extern stomkontroll',activities:[
  {title:'Beställ och genomför KA-besök när stommen är rest',type:'approval'}]},
 {sectionNumber:'30.20',sectionName:'Bjälklag och golvbärning',title:'Bygg och kontrollera bärande bjälklag',activities:[
  {title:'Utför bjälklag och golvbärning enligt konstruktionshandling',type:'perform'},
  {title:'Kontrollera dimensioner, upplag, avväxlingar och infästningar',type:'check'}]},
 {sectionNumber:'40.10',title:'Bygg bärande tak',activities:[
  {title:'Kontrollera bärande takkonstruktion mot konstruktionshandling',type:'check'}]},
 {sectionNumber:'40.20',title:'Färdigställ yttertak',activities:[
  {title:'Kontrollera tak- och väggtäckning, beslag och tätningar',type:'check'}]},
 {sectionNumber:'50.10',title:'Montera fönster och ytterdörrar',activities:[
  {title:'Kontrollera fönster och dörrar mot handling, infästning och tätning',type:'check'}]},
 {sectionNumber:'50.20',title:'Färdigställ klimatskal',activities:[
  {title:'Kontrollera värmeisolering, lufttäthet och klimatskalets anslutningar',type:'check'}]},
 {sectionNumber:'60.10',title:'Dokumentera VVS-provning',activities:[
  {title:'Spara provtryckningsprotokoll för VA/VVS',type:'document'}]},
 {sectionNumber:'60.10',title:'Kontrollera VA före övertäckning',activities:[
  {title:'Genomför och dokumentera VA-inspektion före övertäckning',type:'check'}]},
 {sectionNumber:'60.20',title:'Verifiera elinstallationen',activities:[
  {title:'Kontrollera att elinstallationsföretaget är registrerat hos Elsäkerhetsverket',type:'check'},
  {title:'Genomför och dokumentera isolationsprovning',type:'document'},
  {title:'Funktionskontrollera jordfelsbrytare',type:'check'}]},
 {sectionNumber:'60.30',title:'Utför ventilation',activities:[
  {title:'Kontrollera vald ventilationsprincip och funktion mot projekterade krav',type:'check'}]},
 {sectionNumber:'70.10',title:'Genomför kontroll under invändiga arbeten',activities:[
  {title:'Beställ och genomför KA-besök under pågående invändiga arbeten',type:'approval'}]},
 {sectionNumber:'80.10',title:'Kontrollera utformning och tillgänglighet',activities:[
  {title:'Kontrollera byggnadens utformning mot arkitektritningar och egenkontroller',type:'check'},
  {title:'Kontrollera tillgänglighet och användbarhet mot gällande handlingar',type:'check'}]},
 {sectionNumber:'80.20',title:'Hantera myndighetskontroller och avslut',activities:[
  {title:'Beställ och genomför byggnadsnämndens arbetsplatsbesök innan allt byggs igen',type:'approval'},
  {title:'Kontrollera överensstämmelse med bygglov',type:'check'},
  {title:'Beställ och genomför slutsamråd när det krävs',type:'approval'}]},
 {sectionNumber:'80.20',title:'Samla slutdokumentation',activities:[
  {title:'Samla ifylld och signerad kontrollplan',type:'document'},
  {title:'Samla egenkontroller och intyg för installationer och brandskydd',type:'document'},
  {title:'Samla erforderlig fotodokumentation för dolda arbeten och myndighetskrav',type:'document'},
  {title:'Samla myndighetsintyg och beslut för VA eller avlopp när det krävs',type:'document'}]},
 {sectionNumber:'80.20',title:'Avsluta projektet',activities:[
  {title:'Genomför generell färdigställandekontroll före slutbesked',type:'check'}]}
];

async function ensureSection(db:D1Database,masterId:string,number:string,name:string){
 const existing=await db.prepare(`SELECT s.id FROM master_work_sections s JOIN master_work_areas a ON a.id=s.master_work_area_id WHERE a.master_project_id=? AND s.number=?`).bind(masterId,number).first<any>();
 if(existing)return String(existing.id);
 const areaNumber=number.split('.')[0];const area=await db.prepare('SELECT id FROM master_work_areas WHERE master_project_id=? AND number=?').bind(masterId,areaNumber).first<any>();
 if(!area)throw new Error(`Arbetsområde ${areaNumber} saknas i Master v2.`);
 const order=await db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM master_work_sections WHERE master_work_area_id=?').bind(area.id).first<any>();const id=crypto.randomUUID();
 await db.prepare('INSERT INTO master_work_sections(id,master_work_area_id,number,name,sort_order) VALUES(?,?,?,?,?)').bind(id,area.id,number,name,Number(order?.n||10)).run();return id;
}
async function ensureTask(db:D1Database,sectionId:string,seed:TaskSeed){
 let task=await db.prepare('SELECT id FROM master_tasks WHERE master_work_section_id=? AND title=?').bind(sectionId,seed.title).first<any>();let taskId=task?.id?String(task.id):'';
 if(!taskId){const order=await db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM master_tasks WHERE master_work_section_id=?').bind(sectionId).first<any>();taskId=crypto.randomUUID();await db.prepare('INSERT INTO master_tasks(id,master_work_section_id,title,description,sort_order) VALUES(?,?,?,?,?)').bind(taskId,sectionId,seed.title,'Generell aktivitet för småhusprojekt. Kopplas till styrdokument när den är relevant.',Number(order?.n||10)).run();}
 let created=0;for(const activity of seed.activities){const exists=await db.prepare('SELECT id FROM master_activities WHERE master_task_id=? AND title=?').bind(taskId,activity.title).first();if(exists)continue;const order=await db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM master_activities WHERE master_task_id=?').bind(taskId).first<any>();await db.prepare('INSERT INTO master_activities(id,master_task_id,title,description,activity_type,required,sort_order) VALUES(?,?,?,?,?,1,?)').bind(crypto.randomUUID(),taskId,activity.title,activity.description||'',activity.type,Number(order?.n||10)).run();created++;}return created;
}
async function addActivityToModuleTask(db:D1Database,masterId:string,moduleCode:string,taskTitle:string,activity:ActivitySeed){
 const task=await db.prepare(`SELECT t.id FROM master_tasks t JOIN master_task_modules tm ON tm.master_task_id=t.id JOIN master_modules m ON m.id=tm.module_id WHERE m.master_project_id=? AND m.code=? AND t.title=?`).bind(masterId,moduleCode,taskTitle).first<any>();
 if(!task)return 0;const exists=await db.prepare('SELECT id FROM master_activities WHERE master_task_id=? AND title=?').bind(task.id,activity.title).first();if(exists)return 0;const order=await db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM master_activities WHERE master_task_id=?').bind(task.id).first<any>();await db.prepare('INSERT INTO master_activities(id,master_task_id,title,description,activity_type,required,sort_order) VALUES(?,?,?,?,?,1,?)').bind(crypto.randomUUID(),task.id,activity.title,activity.description||'',activity.type,Number(order?.n||10)).run();return 1;
}

export function registerMasterProjectV2UpgradeRoutes(app:RouteApp){app.post('/api/studio/master-projects/upgrade-fritidshus-v2',async c=>{
 const master=await c.env.DB.prepare("SELECT id,version FROM master_projects WHERE code='fritidshus-v2'").first<any>();if(!master)return c.json({ok:false,error:'Masterprojekt v2 finns inte ännu.'},404);let created=0;const mid=String(master.id);
 for(const seed of TASKS){const sid=await ensureSection(c.env.DB,mid,seed.sectionNumber,seed.sectionName||'Generella kontroller');created+=await ensureTask(c.env.DB,sid,seed)}
 const fireSection=await ensureSection(c.env.DB,mid,'80.15','Brandskydd');created+=await ensureTask(c.env.DB,fireSection,{sectionNumber:'80.15',title:'Dokumentera byggnadens brandskydd',activities:[{title:'Upprätta eller samla brandskyddsbeskrivning där det krävs',type:'document'},{title:'Kontrollera att brandskyddsbeskrivningen beaktas i utförandet',type:'check'},{title:'Upprätta eller samla slutlig brandskyddsdokumentation',type:'document'}]});
 created+=await addActivityToModuleTask(c.env.DB,mid,'log','Utför timmerstomme',{title:'Kontrollera skarvar, konstruktiva förband och dragstag i timmerstommen',type:'check'});
 created+=await addActivityToModuleTask(c.env.DB,mid,'truss','Montera takstolar',{title:'Kontrollera takstolar och bärande takkonstruktion mot konstruktionshandling',type:'check'});
 created+=await addActivityToModuleTask(c.env.DB,mid,'purlin','Bygg åstak',{title:'Kontrollera åsar, sparrar och bärande takkonstruktion mot konstruktionshandling',type:'check'});
 created+=await addActivityToModuleTask(c.env.DB,mid,'natural_vent','Utför självdragsventilation',{title:'Kontrollera självdragsventilationens öppningar och funktion',type:'check'});
 created+=await addActivityToModuleTask(c.env.DB,mid,'extract_vent','Utför mekanisk frånluft',{title:'Kontrollera mekanisk frånluftsventilation och funktion',type:'check'});
 created+=await addActivityToModuleTask(c.env.DB,mid,'ftx','Installera FTX',{title:'Kontrollera FTX-installation och funktion',type:'check'});
 created+=await addActivityToModuleTask(c.env.DB,mid,'fireplace','Installera eldstad och rökkanal',{title:'Spara intyg eller protokoll från sotarbesiktning av rökkanal och taksäkerhet',type:'document'});
 created+=await addActivityToModuleTask(c.env.DB,mid,'wetroom','Utför våtrum',{title:'Verifiera behörighet eller dokumentera vald våtrumsmetod',type:'document'});
 let broadband=await c.env.DB.prepare("SELECT id FROM master_modules WHERE master_project_id=? AND code='broadband'").bind(mid).first<any>();if(!broadband){const order=await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM master_modules WHERE master_project_id=?').bind(mid).first<any>();const id=crypto.randomUUID();await c.env.DB.prepare("INSERT INTO master_modules(id,master_project_id,group_code,group_name,selection_mode,code,name,description,sort_order) VALUES(?,?,'features','Tillval','multi','broadband','Bredbandsanslutning','Förberedelse för fiber eller annan bredbandsanslutning.',?)").bind(id,mid,Number(order?.n||10)).run();broadband={id};}
 const installArea=await c.env.DB.prepare("SELECT id FROM master_work_areas WHERE master_project_id=? AND number='60'").bind(mid).first<any>();if(installArea){let section=await c.env.DB.prepare("SELECT id FROM master_work_sections WHERE master_work_area_id=? AND number='60.60'").bind(installArea.id).first<any>();let sid=section?.id;if(!sid){const order=await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM master_work_sections WHERE master_work_area_id=?').bind(installArea.id).first<any>();sid=crypto.randomUUID();await c.env.DB.prepare("INSERT INTO master_work_sections(id,master_work_area_id,number,name,sort_order) VALUES(?,?, '60.60','Bredband – val',?)").bind(sid,installArea.id,Number(order?.n||10)).run();}let task=await c.env.DB.prepare("SELECT id FROM master_tasks WHERE master_work_section_id=? AND title='Förbered bredbandsanslutning'").bind(sid).first<any>();let tid=task?.id;if(!tid){const order=await c.env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS n FROM master_tasks WHERE master_work_section_id=?').bind(sid).first<any>();tid=crypto.randomUUID();await c.env.DB.prepare("INSERT INTO master_tasks(id,master_work_section_id,title,description,sort_order) VALUES(?,?,'Förbered bredbandsanslutning','Valbar modul för kanalisation/fiberförberedelse.',?)").bind(tid,sid,Number(order?.n||10)).run();await c.env.DB.prepare('INSERT OR IGNORE INTO master_task_modules(master_task_id,module_id) VALUES(?,?)').bind(tid,broadband.id).run();}const exists=await c.env.DB.prepare("SELECT id FROM master_activities WHERE master_task_id=? AND title='Förbered kanalisation och anslutningspunkt för bredband'").bind(tid).first();if(!exists){await c.env.DB.prepare("INSERT INTO master_activities(id,master_task_id,title,description,activity_type,required,sort_order) VALUES(?,?, 'Förbered kanalisation och anslutningspunkt för bredband','', 'perform',1,10)").bind(crypto.randomUUID(),tid).run();created++;}}
 await c.env.DB.prepare("UPDATE master_projects SET version=CASE WHEN version<5 THEN 5 ELSE version END,updated_at=datetime('now') WHERE id=?").bind(mid).run();return c.json({ok:true,id:mid,version:5,createdActivities:created});
})}
