import puppeteer from '@cloudflare/puppeteer';

type Env={DB:D1Database;FILES:R2Bucket;AI:any;BROWSER:any;[key:string]:any};

type ControlItem={
  code:string;
  description:string;
  sectionCode:string;
  sectionTitle:string;
  itemType:'control'|'documentation';
  responsibleRole:string;
  evidenceRequired:string;
  sourcePage:number;
  sourceQuote:string;
  action:string;
  timing:string;
};

type SourcePage={page:number;text:string;source:'pdf-text-layer'|'moondream-ocr'};

const CONTROL_PLAN_TEXT_MODEL='@cf/meta/llama-3.1-8b-instruct-fast';
const CONTROL_PLAN_OCR_MODEL='@cf/moondream/moondream3.1-9B-A2B';

function clean(value:unknown){return typeof value==='string'?value.trim():''}
function collapse(value:string){return value.replace(/\s+/g,' ').trim()}
function bytesToBase64(bytes:ArrayBuffer){
  const input=new Uint8Array(bytes);let binary='';const chunkSize=0x8000;
  for(let i=0;i<input.length;i+=chunkSize)binary+=String.fromCharCode(...input.subarray(i,Math.min(i+chunkSize,input.length)));
  return btoa(binary);
}

async function addColumnIfMissing(db:D1Database,sql:string){
  try{await db.prepare(sql).run()}
  catch(error){const m=error instanceof Error?error.message:String(error);if(!m.toLowerCase().includes('duplicate column'))throw error}
}

async function ensureSchema(db:D1Database){
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
}

async function openPdfJsPage(browserBinding:any){
  if(!browserBinding)throw new Error('Browser Run-binding saknas för kontrollplansanalys.');
  const browser=await puppeteer.launch(browserBinding);
  const page=await browser.newPage();
  await page.setViewport({width:1700,height:2300,deviceScaleFactor:1});
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff}</style><script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script></head><body></body></html>`,{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>Boolean((globalThis as any).pdfjsLib),{timeout:20000});
  return {browser,page};
}

async function extractPdfTextPages(browserBinding:any,pdfBytes:ArrayBuffer,maxPages=20):Promise<SourcePage[]>{
  if(pdfBytes.byteLength>12*1024*1024)throw new Error('PDF-filen är för stor för kontrollplansanalys (max 12 MB i denna väg).');
  const {browser,page}=await openPdfJsPage(browserBinding);
  try{
    const base64=bytesToBase64(pdfBytes);
    const pages=await page.evaluate(async({base64,maxPages}:{base64:string;maxPages:number})=>{
      const pdfjs=(globalThis as any).pdfjsLib;
      pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const raw=atob(base64);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
      const pdf=await pdfjs.getDocument({data:bytes}).promise;
      const count=Math.min(Number(pdf.numPages||0),maxPages);
      const result:{page:number;text:string}[]=[];
      for(let n=1;n<=count;n++){
        const p=await pdf.getPage(n);
        const content=await p.getTextContent();
        const items=(content.items||[]).map((item:any)=>({
          text:String(item?.str||'').trim(),
          x:Number(item?.transform?.[4]||0),
          y:Number(item?.transform?.[5]||0)
        })).filter((item:any)=>item.text);
        items.sort((a:any,b:any)=>Math.abs(b.y-a.y)>2?b.y-a.y:a.x-b.x);
        const lines:{y:number;items:{text:string;x:number}[]}[]=[];
        for(const item of items){
          let line=lines.find(candidate=>Math.abs(candidate.y-item.y)<=2.2);
          if(!line){line={y:item.y,items:[]};lines.push(line)}
          line.items.push({text:item.text,x:item.x});
        }
        lines.sort((a,b)=>b.y-a.y);
        const text=lines.map(line=>line.items.sort((a,b)=>a.x-b.x).map(item=>item.text).join('\t')).join('\n');
        result.push({page:n,text});
      }
      return result;
    },{base64,maxPages}) as {page:number;text:string}[];
    return pages.map(p=>({page:p.page,text:clean(p.text),source:'pdf-text-layer' as const}));
  }finally{await browser.close().catch(()=>undefined)}
}

async function renderPdfPages(browserBinding:any,pdfBytes:ArrayBuffer,maxPages=20){
  const {browser,page}=await openPdfJsPage(browserBinding);
  try{
    const base64=bytesToBase64(pdfBytes);
    const totalPages=await page.evaluate(async({base64,maxPages}:{base64:string;maxPages:number})=>{
      const pdfjs=(globalThis as any).pdfjsLib;
      pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const raw=atob(base64);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
      const pdf=await pdfjs.getDocument({data:bytes}).promise;
      const count=Math.min(Number(pdf.numPages||0),maxPages);
      const host=document.body;
      for(let n=1;n<=count;n++){
        const p=await pdf.getPage(n);const viewport=p.getViewport({scale:2});
        const canvas=document.createElement('canvas');canvas.dataset.page=String(n);canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        const ctx=canvas.getContext('2d',{alpha:false})!;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
        await p.render({canvasContext:ctx,viewport}).promise;host.appendChild(canvas);
      }
      return count;
    },{base64,maxPages});
    const images:ArrayBuffer[]=[];
    for(let n=1;n<=totalPages;n++){
      const handle=await page.$(`canvas[data-page="${n}"]`);if(!handle)continue;
      const shot=await handle.screenshot({type:'png'}) as Uint8Array;
      const copy=new Uint8Array(shot.byteLength);copy.set(shot);images.push(copy.buffer);
    }
    return images;
  }finally{await browser.close().catch(()=>undefined)}
}

const OCR_PROMPT=`Läs av all synlig text på denna sida ordagrant.
Detta är OCR/transkription, inte analys.
- Sammanfatta inte.
- Förklara inte.
- Översätt inte.
- Ändra inte formuleringar.
- Bevara alla nummer, koder, rubriker och tabellceller.
- Skriv varje synlig tabellrad på en egen rad och separera celler med TAB.
- Om något inte går att läsa, skriv [OLÄSLIGT] i stället för att gissa.
Returnera endast den avlästa texten.`;

async function ocrImage(ai:any,image:ArrayBuffer,page:number):Promise<SourcePage>{
  const response=await ai.run(CONTROL_PLAN_OCR_MODEL,{
    task:'query',
    image:`data:image/png;base64,${bytesToBase64(image)}`,
    question:OCR_PROMPT,
    reasoning:false
  }) as any;
  const text=clean(response?.answer);
  if(!text)throw new Error(`OCR-modellen gav ingen text för sida ${page}.`);
  return {page,text,source:'moondream-ocr'};
}

function detectedRowCodes(text:string){
  const found=new Set<string>();
  for(const match of text.matchAll(/(?:^|[\s\t])((?:\d{1,2}|[A-Z])\.\d{1,2})(?=[\s\t]|$)/gm))found.add(match[1]);
  return [...found];
}

function extractionSchema(){return {
  type:'object',additionalProperties:false,
  properties:{items:{type:'array',items:{
    type:'object',additionalProperties:false,
    properties:{
      code:{type:'string'},description:{type:'string'},sectionCode:{type:'string'},sectionTitle:{type:'string'},
      itemType:{type:'string',enum:['control','documentation']},responsibleRole:{type:'string'},evidenceRequired:{type:'string'},
      sourceQuote:{type:'string'},action:{type:'string'},timing:{type:'string'}
    },
    required:['code','description','sectionCode','sectionTitle','itemType','responsibleRole','evidenceRequired','sourceQuote','action','timing']
  }}},required:['items']
}}

function aiJson(response:any){
  if(response&&typeof response.response==='object'&&response.response!==null)return response.response;
  if(typeof response?.response==='string'&&response.response.trim()){try{return JSON.parse(response.response)}catch{}}
  const choice=response?.choices?.[0]?.message?.content;if(typeof choice==='string'&&choice.trim()){try{return JSON.parse(choice)}catch{}}
  return null;
}

function exactSourceQuote(pageText:string,item:any){
  const normalizedPage=collapse(pageText);
  const requested=collapse(clean(item?.sourceQuote));
  if(requested&&normalizedPage.includes(requested))return requested.slice(0,600);
  const lines=pageText.split(/\r?\n/).map(collapse).filter(Boolean);
  const code=clean(item?.code);const description=collapse(clean(item?.description));
  const byCode=code?lines.find(line=>line.includes(code)):undefined;
  if(byCode)return byCode.slice(0,600);
  const byDescription=description?lines.find(line=>line.includes(description)):undefined;
  return (byDescription||'').slice(0,600);
}

async function extractItemsFromSourcePage(ai:any,source:SourcePage):Promise<ControlItem[]>{
  const codes=detectedRowCodes(source.text);
  const codeInstruction=codes.length
    ? `Följande möjliga kontrollradskoder finns bokstavligen i källtexten: ${codes.join(', ')}. Kontrollera vilka som verkligen är radkoder och returnera varje verklig kontrollrad exakt en gång.`
    : 'Det hittades inga säkra numrerade kontrollradskoder. Leta ändå efter uttryckliga kontrollpunkter eller uttryckliga dokumentationskrav.';
  const prompt=`Du får här DIREKT KÄLLTEXT från en sida i en svensk kontrollplan. Texten är avläst från PDF:ens textlager eller med ren OCR. Det finns inget sammanfattningssteg före dig.

Din uppgift är att identifiera styrande poster DIREKT i källtexten.
${codeInstruction}

Regler:
- En verklig kontrollrad ska bli exakt en itemType="control".
- Ett uttryckligt krav på handling/intyg/dokument/foto som ska lämnas in får bli itemType="documentation".
- Hoppa inte över kontrollrader.
- Slå inte ihop flera kontrollrader.
- Hitta inte på krav eller ord som inte finns i källtexten.
- description ska i första hand vara texten i Moment/kontrollpunkt, inte en sammanfattning av hela raden.
- responsibleRole och evidenceRequired ska bara fyllas när de går att läsa i källtexten.
- sourceQuote ska kopieras ordagrant från källtexten, aldrig parafraseras.
- action får vara en kort praktisk formulering baserad direkt på kontrollpunkten.
- timing ska vara tomt om tidpunkt/ordning inte uttryckligen framgår.
- Returnera ingen dokumentöversikt eller sammanfattning.

KÄLLTEXT SIDA ${source.page}:
---
${source.text}
---`;
  const response=await ai.run(CONTROL_PLAN_TEXT_MODEL,{
    messages:[
      {role:'system',content:'Extrahera styrposter direkt ur given källtext. Sammanfatta aldrig dokumentet och hitta aldrig på källinnehåll.'},
      {role:'user',content:prompt}
    ],
    response_format:{type:'json_schema',json_schema:extractionSchema()},
    max_completion_tokens:7000,
    temperature:0
  }) as any;
  const parsed=aiJson(response);if(!parsed)throw new Error(`Textanalysen gav inget giltigt JSON-resultat för sida ${source.page}.`);
  const raw=Array.isArray(parsed.items)?parsed.items:[];
  const items:ControlItem[]=[];
  for(const item of raw){
    const description=clean(item?.description);if(!description)continue;
    const code=clean(item?.code);
    if(code&&codes.length&&!codes.includes(code))continue;
    const quote=exactSourceQuote(source.text,item);
    if(!quote&&code)continue;
    items.push({
      code,description,sectionCode:clean(item?.sectionCode),sectionTitle:clean(item?.sectionTitle),
      itemType:item?.itemType==='documentation'?'documentation':'control',responsibleRole:clean(item?.responsibleRole),
      evidenceRequired:clean(item?.evidenceRequired),sourcePage:source.page,sourceQuote:quote,
      action:clean(item?.action)||description,timing:clean(item?.timing)
    });
  }
  return items;
}

export async function analyzeControlPlanDeterministically(env:Env,documentId:string){
  await ensureSchema(env.DB);
  if(!env.AI||typeof env.AI.run!=='function')throw new Error('Workers AI är inte konfigurerat.');
  if(!env.FILES||typeof env.FILES.get!=='function')throw new Error('Fillagringen är inte tillgänglig.');
  const document=await env.DB.prepare(`SELECT d.id,d.document_type,d.title,d.source_filename,d.source_mime_type,f.object_key,f.original_name,f.content_type,f.size_bytes FROM governing_documents d JOIN governing_document_files f ON f.document_id=d.id WHERE d.id=?`).bind(documentId).first<any>();
  if(!document)throw new Error('Styrdokumentet eller originalfilen hittades inte.');
  if(String(document.document_type)!=='control_plan')throw new Error('Dokumentet är inte en kontrollplan.');
  const existing=await env.DB.prepare('SELECT COUNT(*) count FROM governing_items WHERE governing_document_id=?').bind(documentId).first<any>();
  if(Number(existing?.count||0)>0)throw new Error('Dokumentet är redan analyserat.');
  const object=await env.FILES.get(String(document.object_key));if(!object)throw new Error('Originalfilen saknas i fillagringen.');
  const bytes=await object.arrayBuffer();

  let pages=await extractPdfTextPages(env.BROWSER,bytes,20);
  const sparsePages=pages.filter(page=>collapse(page.text).length<120).map(page=>page.page);
  if(sparsePages.length){
    const images=await renderPdfPages(env.BROWSER,bytes,20);
    for(const pageNumber of sparsePages){
      const image=images[pageNumber-1];if(!image)continue;
      pages=pages.map(page=>page.page===pageNumber?page:page);
      const ocr=await ocrImage(env.AI,image,pageNumber);
      pages=pages.map(page=>page.page===pageNumber?ocr:page);
    }
  }

  const all:ControlItem[]=[];const pageResults:any[]=[];
  for(const source of pages){
    const pageItems=await extractItemsFromSourcePage(env.AI,source);
    all.push(...pageItems);
    pageResults.push({
      page:source.page,source:source.source,sourceCharacters:source.text.length,detectedCodes:detectedRowCodes(source.text),
      controls:pageItems.filter(x=>x.itemType==='control').length,documentation:pageItems.filter(x=>x.itemType==='documentation').length
    });
  }

  const seen=new Set<string>();const items=all.filter(item=>{
    const key=`${item.code}|${item.description.toLocaleLowerCase('sv-SE')}|${item.sourcePage}`;
    if(seen.has(key))return false;seen.add(key);return true;
  });
  if(!items.length)throw new Error('Ingen styrande kontrollpunkt kunde verifieras direkt mot dokumentets källtext.');

  for(let i=0;i<items.length;i++){
    const item=items[i];
    await env.DB.prepare(`INSERT INTO governing_items(
      id,governing_document_id,code,description,section_code,section_title,item_type,responsible_role,evidence_required,
      handling_status,handling_comment,sort_order,source_note,source_page,source_quote,confidence,action_text,timing_text)
      VALUES(?,?,?,?,?,?,?,?,?,'unhandled','',?,?,?,?,?,?,?)`).bind(
        crypto.randomUUID(),documentId,item.code,item.description,item.sectionCode,item.sectionTitle,item.itemType,item.responsibleRole,item.evidenceRequired,
        (i+1)*10,`Sida ${item.sourcePage} · ${item.sourceQuote}`,item.sourcePage,item.sourceQuote,0.99,item.action,item.timing
      ).run();
  }
  await env.DB.prepare("UPDATE governing_documents SET status='active',updated_at=datetime('now') WHERE id=?").bind(documentId).run();
  const controlCount=items.filter(x=>x.itemType==='control').length;const documentationCount=items.filter(x=>x.itemType==='documentation').length;
  const summary=`Kontrollplan: ${controlCount} kontrollpunkter och ${documentationCount} dokumentationspunkter extraherade direkt ur källtext.`;
  await env.DB.prepare(`INSERT INTO governing_document_analysis_runs(id,governing_document_id,analyzer,model,status,document_summary,item_count) VALUES(?,?,?,?,'completed',?,?)`).bind(
    crypto.randomUUID(),documentId,'control-plan-source-text-v5',CONTROL_PLAN_TEXT_MODEL,summary,items.length
  ).run();
  return {
    ok:true,id:documentId,createdItems:items.length,provider:'workers-ai',analyzer:'control-plan-source-text-v5',model:CONTROL_PLAN_TEXT_MODEL,
    documentSummary:summary,conversionMode:'pdf-source-text-direct-extraction',renderedPages:pages.length,pageResults,
    conversionQuality:'PDF-text läses direkt från textlagret. AI identifierar styrposter direkt i källtexten utan mellanliggande sammanfattning. OCR används endast om en sida saknar användbart textlager.'
  };
}
