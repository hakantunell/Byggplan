function norm(value:unknown){return String(value??'').toLocaleLowerCase('sv-SE').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim()}

const PRACTICAL_REQUIREMENTS:Record<string,string>={
 'A-03':'Grundbotten ska vara tillgänglig för kontroll innan gjutning.',
 'A-04':'Stommen ska vara rest vid kontrollen.',
 'A-05':'Kontrollen ska ske under pågående invändiga arbeten, innan relevanta delar byggs igen.',
 'A-06':'Huset ska vara tätt och kontrollen ske innan allt byggs igen.',
 '2-01':'Rökkanal och taksäkerhet ska vara färdigställda för sotarens kontroll.',
 '3-04':'VA-installationen ska vara provtryckt.',
 '4-01':'Elinstallationsföretaget ska vara registrerat hos Elsäkerhetsverket.',
 '4-02':'Isolationsprovning av elinstallationen ska vara utförd.',
 '4-03':'Jordfelsbrytare ska finnas där den krävs.',
 '4-04':'Knivlåda ska ha säkerhetsbeslag.',
 '4-05':'Medicinskåp ska ha säkerhetsbeslag.',
 '4-06':'Lågt sittande fönster ska ha klassat glas.',
 '9-01':'VA ska kontrolleras innan ledningar och anslutningar täcks över.',
 '9-02':'Relationshandlingar ska visa LOD och utvändigt VA.',
 '10-01':'Byggnaden ska vara förberedd för bredbandsanslutning.'
};

function cleanGeneratedDescription(description:string,code:string){
 const text=description.trim();
 const oldWhole=new RegExp(`^Kontrollplan\\s+${code.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}\\s*:`, 'i');
 if(oldWhole.test(text))return '';
 const marker='Styrdokument – tillkommande kontroll:';
 const marker2='Styrdokument – kontrollinstruktion:';
 let base=text;
 for(const m of [marker,marker2]){
  const index=base.indexOf(m);
  if(index>=0){
   const before=base.slice(0,index).trim();
   const after=base.slice(index+m.length).trim();
   const lines=after.split(/\r?\n/).filter(line=>!new RegExp(`^•?\\s*Kontrollplan\\s+${code.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')}\\b`,'i').test(line.trim()));
   base=[before,lines.join('\n').trim()].filter(Boolean).join('\n\n').trim();
  }
 }
 return base;
}

export async function enrichPracticalGoverningInstructions(db:D1Database,projectId:string){
 const rows=await db.prepare(`
  SELECT i.code,a.id activity_id,a.description activity_description
  FROM governing_documents d
  JOIN governing_items i ON i.governing_document_id=d.id
  JOIN governing_item_activity_links l ON l.governing_item_id=i.id
  JOIN activities a ON a.id=l.activity_id
  JOIN tasks t ON t.id=a.task_id
  JOIN work_sections s ON s.id=t.work_section_id
  JOIN work_areas w ON w.id=s.work_area_id
  LEFT JOIN activity_contexts ac ON ac.activity_id=a.id
  WHERE d.project_id=? AND d.document_type='control_plan' AND w.project_id=?
    AND COALESCE(ac.applicability,'always')<>'deprecated'
 `).bind(projectId,projectId).all();
 let changed=0;
 for(const row of rows.results as any[]){
  const code=String(row.code||'').trim(),requirement=PRACTICAL_REQUIREMENTS[code];
  if(!requirement)continue;
  let description=cleanGeneratedDescription(String(row.activity_description||''),code);
  if(norm(description).includes(norm(requirement)))continue;
  const block=`Praktiskt att verifiera:\n• ${requirement}`;
  description=description?`${description}\n\n${block}`:block;
  await db.prepare('UPDATE activities SET description=? WHERE id=?').bind(description,String(row.activity_id)).run();
  changed++;
 }
 return{changed,reviewedCodes:Object.keys(PRACTICAL_REQUIREMENTS)};
}
