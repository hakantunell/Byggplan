import { registerGoverningVerificationRoutesV2 } from './governing-verification-routes-v2';

type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;put:(path:string,handler:(c:any)=>unknown)=>void};
async function tableExists(db:D1Database,name:string){return Boolean(await db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").bind(name).first())}
function rolesFor(roleRaw:string,documentType:string){const role=roleRaw.toUpperCase().replace(/\s+/g,'');const roles:string[]=[];if(role.includes('EK')||role.includes('BH')||role.includes('BYGGHERRE'))roles.push('builder');if(role.includes('KA'))roles.push('ka');if(role.includes('KOMMUN')||role.includes('MYNDIGHET'))roles.push('authority');if(!roles.length&&documentType!=='control_plan')roles.push('builder');return[...new Set(roles)]}
async function ensureFallbackSchema(db:D1Database){
 try{await db.prepare("ALTER TABLE governing_items ADD COLUMN source_basis TEXT NOT NULL DEFAULT ''").run()}catch{}
 try{await db.prepare("ALTER TABLE governing_items ADD COLUMN source_note TEXT NOT NULL DEFAULT ''").run()}catch{}
 await db.prepare(`CREATE TABLE IF NOT EXISTS governing_item_verifications(id TEXT PRIMARY KEY,governing_item_id TEXT NOT NULL,role_code TEXT NOT NULL,required INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'pending',comment TEXT NOT NULL DEFAULT '',verified_by TEXT,verified_at TEXT,updated_at TEXT NOT NULL DEFAULT (datetime('now')),UNIQUE(governing_item_id,role_code))`).run();
}
async function fallbackVerification(c:any,cause:unknown){
 try{
  await ensureFallbackSchema(c.env.DB);const documentId=String(c.req.param('id'));const hasContexts=await tableExists(c.env.DB,'activity_contexts');
  const doc=await c.env.DB.prepare('SELECT id,document_type FROM governing_documents WHERE id=?').bind(documentId).first<any>();if(!doc)return c.json({ok:false,error:'Styrdokumentet hittades inte.'},404);
  const items=(await c.env.DB.prepare(`SELECT id,responsible_role,COALESCE(source_basis,'') source_basis,COALESCE(source_note,'') source_note,sort_order FROM governing_items WHERE governing_document_id=? ORDER BY sort_order,id`).bind(documentId).all()).results as any[];
  for(const item of items)for(const role of rolesFor(String(item.responsible_role||''),String(doc.document_type||'')))await c.env.DB.prepare(`INSERT OR IGNORE INTO governing_item_verifications(id,governing_item_id,role_code,required,status) VALUES(?,?,?,1,'pending')`).bind(crypto.randomUUID(),String(item.id),role).run();
  const status:Record<string,string>={};
  for(const item of items){
   const itemId=String(item.id);
   const linked=hasContexts
    ? await c.env.DB.prepare(`SELECT a.id,COALESCE(e.done,0) done,e.completed_by,e.completed_at FROM governing_item_activity_links l JOIN activities a ON a.id=l.activity_id LEFT JOIN activity_entries e ON e.activity_id=a.id LEFT JOIN activity_contexts ac ON ac.activity_id=a.id WHERE l.governing_item_id=? AND COALESCE(ac.applicability,'always')<>'deprecated'`).bind(itemId).all()
    : await c.env.DB.prepare(`SELECT a.id,COALESCE(e.done,0) done,e.completed_by,e.completed_at FROM governing_item_activity_links l JOIN activities a ON a.id=l.activity_id LEFT JOIN activity_entries e ON e.activity_id=a.id WHERE l.governing_item_id=?`).bind(itemId).all();
   const rows=linked.results as any[];const builder=await c.env.DB.prepare(`SELECT id FROM governing_item_verifications WHERE governing_item_id=? AND role_code='builder' AND required=1`).bind(itemId).first<any>();
   if(builder){if(rows.length&&rows.every(r=>Number(r.done)===1)){const completed=rows.filter(r=>r.completed_at).sort((a,b)=>String(a.completed_at).localeCompare(String(b.completed_at))),last=completed[completed.length-1];await c.env.DB.prepare(`UPDATE governing_item_verifications SET status='verified',verified_by=?,verified_at=?,comment='Egenkontroll via färdigställda aktiviteter',updated_at=datetime('now') WHERE id=?`).bind(last?.completed_by||null,last?.completed_at||null,builder.id).run()}else await c.env.DB.prepare(`UPDATE governing_item_verifications SET status='pending',verified_by=NULL,verified_at=NULL,comment='',updated_at=datetime('now') WHERE id=?`).bind(builder.id).run()}
   if(!rows.length){status[itemId]='waiting_activity';continue}if(!rows.every(r=>Number(r.done)===1)){status[itemId]=rows.some(r=>Number(r.done)===1)?'in_progress':'waiting_activity';continue}
   const vr=await c.env.DB.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) verified,SUM(CASE WHEN role_code='ka' AND status<>'verified' THEN 1 ELSE 0 END) ka_pending,SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) rejected FROM governing_item_verifications WHERE governing_item_id=? AND required=1`).bind(itemId).first<any>();
   status[itemId]=Number(vr?.rejected||0)>0?'rejected':Number(vr?.ka_pending||0)>0?'waiting_ka':Number(vr?.total||0)===Number(vr?.verified||0)?'verified':'ready_for_verification';
  }
  const rows=await c.env.DB.prepare(`SELECT v.id,v.governing_item_id,v.role_code,v.required,v.status,v.comment,v.verified_by,v.verified_at,u.display_name verified_by_name,i.source_basis,i.source_note FROM governing_item_verifications v JOIN governing_items i ON i.id=v.governing_item_id LEFT JOIN users u ON u.id=v.verified_by WHERE i.governing_document_id=? ORDER BY i.sort_order,CASE v.role_code WHEN 'builder' THEN 0 WHEN 'ka' THEN 1 WHEN 'authority' THEN 2 ELSE 3 END`).bind(documentId).all();
  console.error('Verification primary pipeline failed; fallback used',cause);
  return c.json({ok:true,runtime:'verification-v3-fallback',verifications:rows.results,source:items.map(i=>({id:i.id,source_basis:i.source_basis,source_note:i.source_note})),status},200);
 }catch(error){console.error('Verification fallback failed',error);return c.json({ok:false,error:`Verifieringsflödet kunde inte läsas: ${error instanceof Error?error.message:String(error)}`},500)}
}
export function registerGoverningVerificationRoutesV3(app:RouteApp){const proxy:RouteApp={get(path,handler){if(path!=='/api/studio/governing-documents/:id/verification-map'){app.get(path,handler);return}app.get(path,async c=>{try{const response:any=await handler(c);if(response&&response.ok)return response;return fallbackVerification(c,`Primär pipeline returnerade HTTP ${response?.status||'okänt'}`)}catch(error){return fallbackVerification(c,error)}})},put(path,handler){app.put(path,handler)}};registerGoverningVerificationRoutesV2(proxy)}
