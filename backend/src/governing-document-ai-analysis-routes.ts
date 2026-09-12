type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};

type AiItem={
  code:string;
  description:string;
  sectionCode:string;
  sectionTitle:string;
  itemType:'control'|'visit'|'documentation'|'measurement'|'condition'|'information'|'administration'|'other';
  responsibleRole:string;
  evidenceRequired:string;
  handlingStatus:'unhandled'|'in_progress'|'handled'|'not_applicable'|'cannot_verify'|'alternative_evidence';
  sourcePage:number|null;
  sourceQuote:string;
  confidence:number;
  action:string;
  timing:string;
};

type AiAnalysis={documentSummary:string;items:AiItem[]};
type AnalysisStage='load_file'|'upload_file'|'openai_analysis'|'save_result'|'cleanup';

function clean(value:unknown){return typeof value==='string'?value.trim():''}
function clampConfidence(value:unknown){const n=Number(value);if(!Number.isFinite(n))return 0;return Math.max(0,Math.min(1,n))}
function normalizeItemType(value:unknown){const candidate=clean(value);return ['control','visit','documentation','measurement','condition','information','administration','other'].includes(candidate)?candidate:'other'}
function normalizeHandlingStatus(value:unknown){const candidate=clean(value);return ['unhandled','in_progress','handled','not_applicable','cannot_verify','alternative_evidence'].includes(candidate)?candidate:'unhandled'}
async function addColumnIfMissing(db:D1Database,sql:string){try{await db.prepare(sql).run()}catch(error){const message=error instanceof Error?error.message:String(error);if(!message.toLowerCase().includes('duplicate column'))throw error}}

async function ensureAiSchema(db:D1Database){
  await addColumnIfMissing(db,"ALTER TABLE governing_items ADD COLUMN source_page INTEGER");
  await addColumnIfMissing(db,"ALTER TABLE governing_items ADD COLUMN source_quote TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db,"ALTER TABLE governing_items ADD COLUMN confidence REAL NOT NULL DEFAULT 0");
  await addColumnIfMissing(db,"ALTER TABLE governing_items ADD COLUMN action_text TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db,"ALTER TABLE governing_items ADD COLUMN timing_text TEXT NOT NULL DEFAULT ''");
  await db.prepare(`CREATE TABLE IF NOT EXISTS governing_document_analysis_runs(
    id TEXT PRIMARY KEY,
    governing_document_id TEXT NOT NULL,
    analyzer TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    document_summary TEXT NOT NULL DEFAULT '',
    item_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(governing_document_id) REFERENCES governing_documents(id) ON DELETE CASCADE
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_governing_analysis_runs_document ON governing_document_analysis_runs(governing_document_id,created_at)').run();
}

function jsonSchema(){return {
  type:'object',
  additionalProperties:false,
  properties:{
    documentSummary:{type:'string'},
    items:{
      type:'array',
      items:{
        type:'object',
        additionalProperties:false,
        properties:{
          code:{type:'string'},
          description:{type:'string'},
          sectionCode:{type:'string'},
          sectionTitle:{type:'string'},
          itemType:{type:'string',enum:['control','visit','documentation','measurement','condition','information','administration','other']},
          responsibleRole:{type:'string'},
          evidenceRequired:{type:'string'},
          handlingStatus:{type:'string',enum:['unhandled','in_progress','handled','not_applicable','cannot_verify','alternative_evidence']},
          sourcePage:{anyOf:[{type:'integer',minimum:1},{type:'null'}]},
          sourceQuote:{type:'string'},
          confidence:{type:'number',minimum:0,maximum:1},
          action:{type:'string'},
          timing:{type:'string'}
        },
        required:['code','description','sectionCode','sectionTitle','itemType','responsibleRole','evidenceRequired','handlingStatus','sourcePage','sourceQuote','confidence','action','timing']
      }
    }
  },
  required:['documentSummary','items']
}}

function analysisPrompt(document:any){
  return `Du analyserar ett styrdokument för ett svenskt byggprojekt. Dokumenttypen är "${clean(document.document_type)||'other'}" och rubriken är "${clean(document.title)}".

Målet är att hitta sådant som faktiskt ska styra genomförandet eller verifieringen i projektet, oberoende av hur dokumentet är formulerat eller uppställt. Dokumentet kan vara en kontrollplan från valfri KA, ett protokoll, ett myndighetsbeslut, ett tillstånd, ett bygglov, ett arbetsmiljödokument eller annan text.

Extrahera bara poster som innebär minst ett av följande:
- en kontroll som ska göras,
- en konkret aktivitet eller åtgärd som ska utföras,
- ett dokument, intyg, foto eller annat bevis som ska tas fram,
- en mätning, provning eller besiktning,
- ett myndighetsvillkor eller annat bindande projektvillkor,
- en administrativ åtgärd som måste genomföras,
- ett tydligt beslut eller åtagande i ett protokoll,
- ett krav med en tidpunkt eller ordningsrelation, t.ex. före gjutning, innan återfyllnad eller inför slutsamråd.

Skapa INTE poster av rena rubriker, bakgrundstext, allmän information, laghänvisningar utan konkret åtgärd, kontaktuppgifter, signaturer, sidhuvuden eller upprepningar. Gissa inte fram krav som inte finns i dokumentet.

För kontrollplaner: tolka varje verklig kontrollrad semantiskt även om tabellens kolumner eller ordval varierar.
För protokoll: leta särskilt efter beslut, uppgifter, ansvariga, krav, deadlines och sådant som någon ska återkomma med.
För myndighetsbeslut/tillstånd: leta särskilt efter villkor, dokumentationskrav, kontrollkrav, anmälningskrav och saker som måste göras före/efter ett visst arbetsmoment.

Skriv description som en kort, självständig svensk styrpost som kan kartläggas mot en aktivitet senare. Bevara ansvarig roll och beviskrav endast när det framgår. action ska beskriva den praktiska åtgärden. timing ska beskriva när den ska ske om det framgår. sourceQuote ska vara ett kort källutdrag från dokumentet, normalt högst cirka 280 tecken. sourcePage ska vara sidnumret när det går att identifiera, annars null. confidence anger hur säker du är på att posten verkligen är styrande och korrekt tolkad.

handlingStatus ska normalt vara "unhandled". Använd "not_applicable" bara om dokumentet uttryckligen säger att punkten inte gäller. Använd itemType utifrån vad posten huvudsakligen innebär. Undvik dubletter och slå inte ihop två tydligt separata krav till en post.`;
}

async function uploadToOpenAI(apiKey:string,object:R2ObjectBody,filename:string,contentType:string){
  const form=new FormData();
  form.append('purpose','user_data');
  const bytes=await object.arrayBuffer();
  form.append('file',new Blob([bytes],{type:contentType||'application/octet-stream'}),filename||'styrdokument');
  const response=await fetch('https://api.openai.com/v1/files',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`},body:form});
  const data=await response.json().catch(()=>({})) as any;
  if(!response.ok||!data?.id)throw new Error(clean(data?.error?.message)||`OpenAI filuppladdning misslyckades (HTTP ${response.status}).`);
  return String(data.id);
}

async function deleteOpenAIFile(apiKey:string,fileId:string){
  try{await fetch(`https://api.openai.com/v1/files/${encodeURIComponent(fileId)}`,{method:'DELETE',headers:{Authorization:`Bearer ${apiKey}`}})}catch{}
}

function outputText(response:any){
  if(typeof response?.output_text==='string'&&response.output_text.trim())return response.output_text.trim();
  for(const item of Array.isArray(response?.output)?response.output:[]){
    for(const content of Array.isArray(item?.content)?item.content:[]){
      if(content?.type==='output_text'&&typeof content.text==='string'&&content.text.trim())return content.text.trim();
    }
  }
  return '';
}

async function analyzeWithOpenAI(apiKey:string,model:string,fileId:string,isImage:boolean,document:any):Promise<AiAnalysis>{
  const inputAttachment=isImage
    ? {type:'input_image',file_id:fileId,detail:'high'}
    : {type:'input_file',file_id:fileId};
  const body={
    model,
    store:false,
    max_output_tokens:16000,
    instructions:'Du är en noggrann dokumentanalytiker för byggprojekt. Följ användarens extraktionsregler exakt och returnera endast data enligt JSON-schemat.',
    input:[{role:'user',content:[{type:'input_text',text:analysisPrompt(document)},inputAttachment]}],
    text:{format:{type:'json_schema',name:'byggplan_governing_document_analysis',strict:true,schema:jsonSchema()}}
  };
  const response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
  const data=await response.json().catch(()=>({})) as any;
  if(!response.ok)throw new Error(clean(data?.error?.message)||`OpenAI-analysen misslyckades (HTTP ${response.status}).`);
  const text=outputText(data);
  if(!text)throw new Error('AI-analysen returnerade inget strukturerat resultat.');
  let parsed:any;try{parsed=JSON.parse(text)}catch{throw new Error('AI-analysen returnerade ett ogiltigt strukturerat resultat.');}
  return {documentSummary:clean(parsed?.documentSummary),items:Array.isArray(parsed?.items)?parsed.items:[]};
}

function normalizedItems(items:AiItem[]){
  const result:AiItem[]=[];const seen=new Set<string>();
  for(const raw of items){
    const description=clean(raw?.description);if(!description)continue;
    const page=Number.isInteger(raw?.sourcePage)&&Number(raw.sourcePage)>0?Number(raw.sourcePage):null;
    const key=`${description.toLocaleLowerCase('sv-SE').replace(/\s+/g,' ').trim()}|${page??''}`;
    if(seen.has(key))continue;seen.add(key);
    result.push({
      code:clean(raw?.code),description,sectionCode:clean(raw?.sectionCode),sectionTitle:clean(raw?.sectionTitle),
      itemType:normalizeItemType(raw?.itemType) as AiItem['itemType'],responsibleRole:clean(raw?.responsibleRole),
      evidenceRequired:clean(raw?.evidenceRequired),handlingStatus:normalizeHandlingStatus(raw?.handlingStatus) as AiItem['handlingStatus'],
      sourcePage:page,sourceQuote:clean(raw?.sourceQuote).slice(0,600),confidence:clampConfidence(raw?.confidence),
      action:clean(raw?.action),timing:clean(raw?.timing)
    });
  }
  return result;
}

function sourceNote(item:AiItem){
  const parts:string[]=[];
  if(item.sourcePage)parts.push(`Sida ${item.sourcePage}`);
  if(item.sourceQuote)parts.push(item.sourceQuote);
  return parts.join(' · ');
}

export function registerGoverningDocumentAiAnalysisRoutes(app:RouteApp){
  app.post('/api/studio/governing-documents/:id/analyze-generic',async c=>{
    await ensureAiSchema(c.env.DB);
    const id=c.req.param('id');
    const apiKey=clean(c.env.OPEN_API_KEY);
    if(!apiKey)return c.json({ok:false,error:'Generell dokumentanalys är inte konfigurerad ännu. OPEN_API_KEY saknas i backend.'},503);
    const model=clean(c.env.OPENAI_MODEL)||'gpt-5.4-mini';
    const document=await c.env.DB.prepare(`SELECT d.id,d.project_id,d.document_type,d.title,d.issuer,d.reference,d.source_filename,d.source_mime_type,
      f.object_key,f.original_name,f.content_type,f.size_bytes
      FROM governing_documents d JOIN governing_document_files f ON f.document_id=d.id WHERE d.id=?`).bind(id).first<any>();
    if(!document)return c.json({ok:false,error:'Styrdokumentet eller originalfilen hittades inte.'},404);
    const existing=await c.env.DB.prepare('SELECT COUNT(*) AS count FROM governing_items WHERE governing_document_id=?').bind(id).first<{count:number}>();
    if(Number(existing?.count||0)>0)return c.json({ok:false,error:'Dokumentet är redan analyserat. Analysera om dokumentet om du vill ersätta befintliga poster.',existingItems:Number(existing?.count||0)},409);
    if(!c.env.FILES||typeof c.env.FILES.get!=='function')return c.json({ok:false,error:'Fillagringen är inte tillgänglig.'},503);

    let stage:AnalysisStage='load_file';
    let openAiFileId='';
    try{
      const object=await c.env.FILES.get(String(document.object_key));
      if(!object)return c.json({ok:false,stage,error:'Originalfilen saknas i fillagringen.'},404);

      const filename=clean(document.original_name)||clean(document.source_filename)||'styrdokument';
      const contentType=clean(document.content_type)||clean(document.source_mime_type)||'application/octet-stream';

      stage='upload_file';
      openAiFileId=await uploadToOpenAI(apiKey,object,filename,contentType);

      stage='openai_analysis';
      const analysis=await analyzeWithOpenAI(apiKey,model,openAiFileId,contentType.startsWith('image/'),document);
      const items=normalizedItems(analysis.items);

      stage='save_result';
      let created=0;
      for(let index=0;index<items.length;index+=1){
        const item=items[index];
        await c.env.DB.prepare(`INSERT INTO governing_items(
          id,governing_document_id,code,description,section_code,section_title,item_type,responsible_role,evidence_required,
          handling_status,handling_comment,sort_order,source_note,source_page,source_quote,confidence,action_text,timing_text)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
            crypto.randomUUID(),id,item.code,item.description,item.sectionCode,item.sectionTitle,item.itemType,item.responsibleRole,item.evidenceRequired,
            item.handlingStatus,'',(index+1)*10,sourceNote(item),item.sourcePage,item.sourceQuote,item.confidence,item.action,item.timing
          ).run();
        created+=1;
      }
      await c.env.DB.prepare("UPDATE governing_documents SET status='active',updated_at=datetime('now') WHERE id=?").bind(id).run();
      await c.env.DB.prepare(`INSERT INTO governing_document_analysis_runs(id,governing_document_id,analyzer,model,status,document_summary,item_count)
        VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),id,'generic-ai-v1',model,'completed',analysis.documentSummary,created).run();
      return c.json({ok:true,id,createdItems:created,analyzer:'generic-ai-v1',model,documentSummary:analysis.documentSummary});
    }catch(error){
      console.error('Generic governing document analysis failed',{stage,error});
      const detail=error instanceof Error?error.message:String(error);
      try{await c.env.DB.prepare(`INSERT INTO governing_document_analysis_runs(id,governing_document_id,analyzer,model,status,document_summary,item_count) VALUES(?,?,?,?,?,'',0)`).bind(crypto.randomUUID(),id,'generic-ai-v1',model,'failed').run()}catch{}
      return c.json({ok:false,stage,error:`Kunde inte analysera dokumentet: ${detail}`},500);
    }finally{
      if(openAiFileId){
        stage='cleanup';
        await deleteOpenAIFile(apiKey,openAiFileId);
      }
    }
  });
}
