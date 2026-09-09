import { ensureMasterV25, registerMasterProjectV2UpgradeRoutesV25 } from './master-project-v2-upgrade-routes-v25';

type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};

type ActivitySpec={title:string;description:string;type?:string;sortOrder:number};
type TaskSpec={title:string;description:string;sortOrder:number;activities:ActivitySpec[]};

const TASKS:TaskSpec[]=[
 {
  title:'Elnät: Planera och beställ',
  description:'Planera och beställ permanent elnätsanslutning. Fastställ tillsammans med nätägaren anslutningspunkt, servisens utförande, placering av mätarskåp samt vad nätägaren respektive byggherren/elinstallationsföretaget ansvarar för.',
  sortOrder:110,
  activities:[
   {title:'Beställ elnätsanslutning',description:'Beställ permanent anslutning från nätägaren och säkerställ att erforderliga uppgifter om fastigheten, byggnaden och önskad anslutning är lämnade.',type:'perform',sortOrder:10},
   {title:'Samordna anslutningspunkt och servis med nätägaren',description:'Klargör var nätägaren ansluter anläggningen, var mätarskåpet ska placeras och hur servisledning eller kabel ska förläggas fram till anslutningspunkten.',type:'perform',sortOrder:20},
   {title:'Samordna arbetet med elinstallationsföretag',description:'Säkerställ att ett elinstallationsföretag kan utföra de delar som kräver registrerat elinstallationsföretag samt hantera för- och färdiganmälan till nätägaren.',type:'perform',sortOrder:30}
  ]
 },
 {
  title:'Elnät: Förbered anslutning på tomt',
  description:'Utför de mark- och installationsförberedelser på tomten som krävs för servis och mätarskåp innan anläggningen kan färdigställas och anslutas till elnätet.',
  sortOrder:120,
  activities:[
   {title:'Förbered kabelväg och kabelrör',description:'Schakta och förbered kabelvägen samt lägg kabelrör eller skyddsrör enligt överenskommen sträckning och nätägarens eller installatörens krav. Dokumentera läget innan återfyllning där det är relevant.',type:'perform',sortOrder:10},
   {title:'Förlägg servis-/markkabel på tomten',description:'Förlägg den kabel som ligger inom byggherrens ansvar mellan anslutningspunkt eller mätarskåp och byggnaden. Anpassa förläggningen till andra ledningar och kommande markarbeten.',type:'perform',sortOrder:20},
   {title:'Montera mätarskåp',description:'Montera mätarskåpet på överenskommen plats och förbered anslutningar för inkommande servis och utgående kabel till huset.',type:'perform',sortOrder:30}
  ]
 },
 {
  title:'Elnät: Färdigställ anläggning',
  description:'Färdigställ de delar av elanläggningen som måste vara klara innan nätägaren kan ansluta och spänningssätta anläggningen.',
  sortOrder:130,
  activities:[
   {title:'Anslut servis/matning till byggnadens elanläggning',description:'Färdigställ anslutningen mellan mätarskåp och byggnadens elcentral så att anläggningen är klar för nätanslutning.',type:'perform',sortOrder:10},
   {title:'Kontrollera att anläggningen är klar för inkoppling',description:'Kontrollera att mätarskåp, servis, kabeldragning och erforderliga delar av elanläggningen är färdigställda och redo för nätägarens anslutning.',type:'check',sortOrder:20},
   {title:'Färdiganmäl till nätägaren',description:'Elinstallationsföretaget färdiganmäler anläggningen till nätägaren när arbetena som krävs för anslutning är färdiga.',type:'document',sortOrder:30}
  ]
 },
 {
  title:'Elnät: Anslut och driftsätt',
  description:'Genomför nätägarens anslutning och kontrollera därefter att byggnaden har fungerande permanent elförsörjning.',
  sortOrder:140,
  activities:[
   {title:'Inkoppling nätägare',description:'Nätägaren ansluter servisen, monterar eller aktiverar elmätaren och spänningssätter anslutningen när anläggningen är godkänd för inkoppling.',type:'approval',sortOrder:10},
   {title:'Verifiera permanent elförsörjning',description:'Kontrollera efter inkopplingen att mätarskåp och byggnadens inkommande matning är spänningssatta och att permanent elförsörjning fungerar.',type:'check',sortOrder:20}
  ]
 }
];

async function ensureContextSchema(db:D1Database){await db.prepare(`CREATE TABLE IF NOT EXISTS master_activity_contexts(master_activity_id TEXT PRIMARY KEY,lifecycle_stage TEXT NOT NULL DEFAULT 'build',surface TEXT NOT NULL DEFAULT 'field',applicability TEXT NOT NULL DEFAULT 'always',condition_text TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(master_activity_id) REFERENCES master_activities(id) ON DELETE CASCADE)`).run()}

async function ensureTask(db:D1Database,sectionId:string,spec:TaskSpec){let row=await db.prepare('SELECT id FROM master_tasks WHERE master_work_section_id=? AND lower(trim(title))=lower(trim(?)) LIMIT 1').bind(sectionId,spec.title).first<any>();if(row?.id){await db.prepare('UPDATE master_tasks SET title=?,description=?,sort_order=? WHERE id=?').bind(spec.title,spec.description,spec.sortOrder,row.id).run();return String(row.id)}const id=crypto.randomUUID();await db.prepare('INSERT INTO master_tasks(id,master_work_section_id,title,description,sort_order) VALUES(?,?,?,?,?)').bind(id,sectionId,spec.title,spec.description,spec.sortOrder).run();return id}

async function ensureActivity(db:D1Database,taskId:string,spec:ActivitySpec){let row=await db.prepare('SELECT id FROM master_activities WHERE master_task_id=? AND lower(trim(title))=lower(trim(?)) LIMIT 1').bind(taskId,spec.title).first<any>();if(!row?.id&&spec.title==='Inkoppling nätägare')row=await db.prepare("SELECT id FROM master_activities WHERE master_task_id=? AND lower(trim(title))=lower(trim('Nätägarens inkoppling')) LIMIT 1").bind(taskId).first<any>();let id:string;if(row?.id){id=String(row.id);await db.prepare('UPDATE master_activities SET title=?,description=?,activity_type=?,required=1,sort_order=? WHERE id=?').bind(spec.title,spec.description,spec.type||'perform',spec.sortOrder,id).run()}else{id=crypto.randomUUID();await db.prepare('INSERT INTO master_activities(id,master_task_id,title,description,activity_type,required,sort_order) VALUES(?,?,?,?,?,1,?)').bind(id,taskId,spec.title,spec.description,spec.type||'perform',spec.sortOrder).run()}await db.prepare(`INSERT INTO master_activity_contexts(master_activity_id,lifecycle_stage,surface,applicability,condition_text,updated_at) VALUES(?,'build','field','always','',datetime('now')) ON CONFLICT(master_activity_id) DO UPDATE SET lifecycle_stage='build',surface='field',applicability='always',condition_text='',updated_at=datetime('now')`).bind(id).run()}

async function extend(db:D1Database,masterId:string){
 await ensureContextSchema(db);
 const section=await db.prepare(`SELECT s.id FROM master_work_sections s JOIN master_work_areas w ON w.id=s.master_work_area_id WHERE w.master_project_id=? AND lower(trim(w.name))=lower(trim('Installationer')) AND lower(trim(s.name))=lower(trim('El')) LIMIT 1`).bind(masterId).first<any>();
 if(!section?.id)throw new Error('Masterstrukturen saknar Installationer › El.');
 for(const spec of TASKS){const taskId=await ensureTask(db,String(section.id),spec);for(const activity of spec.activities)await ensureActivity(db,taskId,activity)}
 await db.prepare("UPDATE master_projects SET version=CASE WHEN version<26 THEN 26 ELSE version END,updated_at=datetime('now') WHERE id=?").bind(masterId).run();
}

export async function ensureMasterV26(db:D1Database,masterId:string){const row=await db.prepare('SELECT version FROM master_projects WHERE id=?').bind(masterId).first<any>();if(Number(row?.version||0)<25)await ensureMasterV25(db,masterId);await extend(db,masterId)}
export function registerMasterProjectV2UpgradeRoutesV26(app:RouteApp){const proxy:RouteApp={post(path,handler){if(path!=='/api/studio/master-projects/upgrade-fritidshus-v2'){app.post(path,handler);return}app.post(path,async c=>{const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;const data:any=await response.clone().json().catch(()=>null);if(!data?.id)return response;await extend(c.env.DB,String(data.id));return c.json({...data,version:26},response.status)})}};registerMasterProjectV2UpgradeRoutesV25(proxy)}
