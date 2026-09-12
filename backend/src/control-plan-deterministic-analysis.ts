import puppeteer from '@cloudflare/puppeteer';

type Env={DB:D1Database;FILES:R2Bucket;AI:any;BROWSER:any;[key:string]:any};

type ControlItem={
  code:string;description:string;sectionCode:string;sectionTitle:string;itemType:'control'|'documentation';
  responsibleRole:string;evidenceRequired:string;sourcePage:number;sourceQuote:string;action:string;timing:string;
};

const CONTROL_PLAN_VISION_MODEL='@cf/google/gemma-4-26b-a4b-it';

function clean(value:unknown){return typeof value==='string'?value.trim():''}
function plain(value:string){
  return value.replace(/\*\*/g,'').replace(/<br\s*\/?>/gi,' / ').replace(/\\\|/g,'|').replace(/\s+/g,' ').trim();
}
function primaryLanguage(value:string){
  const text=plain(value);
  return text.replace(/\s+\([^()]{2,120}\)\s*$/,'').trim()||text;
}
function norm(value:string){
  return primaryLanguage(value).toLocaleLowerCase('sv-SE').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}
function splitRow(line:string){
  const trimmed=line.trim().replace(/^\|/,'').replace(/\|$/,'');
  return trimmed.split(/(?<!\\)\|/).map(v=>v.trim());
}
function isSeparatorRow(cells:string[]){return cells.length>1&&cells.every(c=>/^:?-{3,}:?$/.test(c.replace(/\s+/g,'')))}
function columnIndex(headers:string[],patterns:RegExp[]){return headers.findIndex(h=>patterns.some(p=>p.test(norm(h))))}
function markdownSectionTitle(lines:string[],index:number){
  for(let i=index-1;i>=0;i--){
    const m=lines[i].match(/^#{2,4}\s+(\d+)\.?\s+(.+)$/);
    if(m)return {code:m[1],title:primaryLanguage(m[2])};
  }
  return {code:'',title:''};
}

export function parseControlPlanMarkdownPage(markdown:string,page:number):ControlItem[]{
  const lines=markdown.split(/\r?\n/);const result:ControlItem[]=[];
  for(let i=0;i<lines.length-1;i++){
    if(!lines[i].trim().startsWith('|'))continue;
    const headers=splitRow(lines[i]);const separator=splitRow(lines[i+1]);
    if(!isSeparatorRow(separator)||headers.length<2)continue;
    const codeIx=columnIndex(headers,[/^nr$/,/^nummer$/,/^no$/,/punkt/]);
    const pointIx=columnIndex(headers,[/moment.*kontrollpunkt/,/kontrollpunkt/,/^moment$/,/vad.*kontrolleras/,/control point/,/task.*control/]);
    if(pointIx<0)continue;
    const methodIx=columnIndex(headers,[/hur.*kontroll/,/kontrollmetod/,/method.*inspection/,/how.*control/]);
    const evidenceIx=columnIndex(headers,[/mot vad/,/kontrollunderlag/,/underlag/,/reference material/,/compared/]);
    const ruleIx=columnIndex(headers,[/pbl.*bbr/,/bbr.*pbl/,/regel/,/standard/]);
    const responsibleIx=columnIndex(headers,[/kontrolleras av/,/ansvarig/,/responsible/]);
    const section=markdownSectionTitle(lines,i);
    let j=i+2;
    for(;j<lines.length&&lines[j].trim().startsWith('|');j++){
      const cells=splitRow(lines[j]);if(isSeparatorRow(cells))continue;
      const point=primaryLanguage(cells[pointIx]||'');if(!point)continue;
      const code=codeIx>=0?primaryLanguage(cells[codeIx]||''):'';
      if(!code&&!point)continue;
      const method=methodIx>=0?primaryLanguage(cells[methodIx]||''):'';
      const evidence=evidenceIx>=0?primaryLanguage(cells[evidenceIx]||''):'';
      const rule=ruleIx>=0?primaryLanguage(cells[ruleIx]||''):'';
      const responsible=responsibleIx>=0?primaryLanguage(cells[responsibleIx]||''):'';
      const sourceParts=[code,point,method,evidence,rule,responsible].filter(Boolean);
      result.push({
        code,description:point,sectionCode:section.code,sectionTitle:section.title,itemType:'control',responsibleRole:responsible,
        evidenceRequired:evidence,sourcePage:page,sourceQuote:sourceParts.join(' | ').slice(0,600),action:point,timing:''
      });
    }
    i=j-1;
  }

  let bulletSection='';
  for(let i=0;i<lines.length;i++){
    const heading=lines[i].match(/^#{1,4}\s+(.+)$/);
    if(heading){bulletSection=primaryLanguage(heading[1]);continue}
    if(!/(handlingar|dokument|intyg).*(slutbesked|slutsamrad)|slutbesked.*(handlingar|dokument|intyg)/i.test(bulletSection))continue;
    const bullet=lines[i].match(/^\s*[-*•]\s+(.+)$/);if(!bullet)continue;
    const text=primaryLanguage(bullet[1]);if(!text)continue;
    result.push({code:'',description:text,sectionCode:'',sectionTitle:bulletSection,itemType:'documentation',responsibleRole:'',evidenceRequired:text,sourcePage:page,sourceQuote:text.slice(0,600),action:`Ta fram ${text}`,timing:'Inför slutbesked'});
  }
  return result;
}

function bytesToBase64(bytes:ArrayBuffer){
  const input=new Uint8Array(bytes);let binary='';const chunkSize=0x8000;
  for(let i=0;i<input.length;i+=chunkSize)binary+=String.fromCharCode(...input.subarray(i,Math.min(i+chunkSize,input.length)));
  return btoa(binary);
}

async function renderPdfPages(browserBinding:any,pdfBytes:ArrayBuffer,maxPages=20){
  if(!browserBinding)throw new Error('Browser Run-binding saknas för kontrollplansanalys.');
  if(pdfBytes.byteLength>12*1024*1024)throw new Error('PDF-filen är för stor för bildtolkning (max 12 MB).');
  const browser=await puppeteer.launch(browserBinding);
  try{
    const page=await browser.newPage();
    await page.setViewport({width:1700,height:2300,deviceScaleFactor:1});
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff}.pdf-page{display:block;margin:0 auto 24px;background:#fff}</style><script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script></head><body><main id="pages"></main></body></html>`,{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>Boolean((globalThis as any).pdfjsLib),{timeout:20000});
    const base64=bytesToBase64(pdfBytes);
    const totalPages=await page.evaluate(async({base64,maxPages}:{base64:string;maxPages:number})=>{
      const pdfjs=(globalThis as any).pdfjsLib;pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const raw=atob(base64);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
      const pdf=await pdfjs.getDocument({data:bytes}).promise;const count=Math.min(Number(pdf.numPages||0),maxPages);const host=document.getElementById('pages')!;
      for(let n=1;n<=count;n++){const p=await pdf.getPage(n);const viewport=p.getViewport({scale:2});const canvas=document.createElement('canvas');canvas.className='pdf-page';canvas.dataset.page=String(n);canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const ctx=canvas.getContext('2d',{alpha:false})!;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);await p.render({canvasContext:ctx,viewport}).promise;host.appendChild(canvas)}
      return count;
    },{base64,maxPages});
    const images:ArrayBuffer[]=[];
    for(let n=1;n<=totalPages;n++){const handle=await page.$(`canvas[data-page="${n}"]`);if(!handle)continue;const shot=await handle.screenshot({type:'png'}) as Uint8Array;images.push(shot.buffer.slice(shot.byteOffset,shot.byteOffset+shot.byteLength))}
    if(!images.length)throw new Error('Inga PDF-sidor kunde renderas.');
    return images;
  }finally{await browser.close().catch(()=>undefined)}
}

function visionOutputText(response:any){
  if(typeof response?.response==='string'&&response.response.trim())return response.response.trim();
  if(typeof response?.output_text==='string'&&response.output_text.trim())return response.output_text.trim();
  const choice=response?.choices?.[0]?.message?.content;
  if(typeof choice==='string'&&choice.trim())return choice.trim();
  return '';
}

const TRANSCRIPTION_PROMPT=`Du transkriberar en sida ur en svensk kontrollplan för byggprojekt.
Din uppgift är INTE att sammanfatta, beskriva eller tolka sidan. Återge allt relevant synligt innehåll så troget som möjligt som Markdown.

Regler:
- Transkribera VARJE tabellrad. Hoppa aldrig över en rad även om den liknar andra rader.
- Slå aldrig ihop flera kontrollpunkter.
- Bevara originalspråket. Översätt inte svenska termer till engelska.
- Bevara nummer/koder exakt, t.ex. 1.1, 1.2, 2.3.
- Bevara tabellens kolumner och deras ordning som en Markdown-tabell.
- Bevara rubriker som Markdown-rubriker.
- Bevara punktlistor, särskilt handlingar, intyg, foton eller dokument som ska lämnas in.
- Tomma signatur- och anmärkningsfält får utelämnas, men inga kontrollpunkter eller sakuppgifter får utelämnas.
- Lägg inte till förklaringar, översättningar, kommentarer eller en "Document Overview".

Returnera endast transkriberad Markdown.`;

async function transcribeWithVisionModel(ai:any,image:ArrayBuffer,page:number){
  const imageData=`data:image/png;base64,${bytesToBase64(image)}`;
  const response=await ai.run(CONTROL_PLAN_VISION_MODEL,{
    messages:[
      {role:'system',content:'Du är en exakt OCR- och dokumenttranskriptionsmotor. Följ instruktionen ordagrant och sammanfatta aldrig.'},
      {role:'user',content:TRANSCRIPTION_PROMPT}
    ],
    image:imageData,
    temperature:0,
    max_completion_tokens:7000
  }) as any;
  const text=visionOutputText(response);
  if(!text)throw new Error(`Visionmodellen gav ingen transkription för sida ${page}.`);
  const tokens=Number(response?.usage?.total_tokens||response?.usage?.output_tokens||0);
  return {text,tokens,source:'instructed-vision'};
}

async function fallbackToMarkdown(ai:any,image:ArrayBuffer,page:number){
  const converted=await ai.toMarkdown({name:`page-${page}.png`,blob:new Blob([image],{type:'image/png'})},{conversionOptions:{output:{format:'markdown'}}}) as any;
  const r=Array.isArray(converted)?converted[0]:converted;if(!r||r.format==='error')throw new Error(clean(r?.error)||`Bildtolkning av sida ${page} misslyckades.`);
  const text=clean(r?.data);if(!text)throw new Error(`Sida ${page} gav ingen text.`);return {text,tokens:Number(r?.tokens||0),source:'toMarkdown-fallback'};
}

async function transcribePage(ai:any,image:ArrayBuffer,page:number){
  try{return await transcribeWithVisionModel(ai,image,page)}
  catch(error){
    console.warn('Instructed control-plan vision transcription failed; using toMarkdown fallback',{page,error});
    return fallbackToMarkdown(ai,image,page);
  }
}

async function addColumnIfMissing(db:D1Database,sql:string){try{await db.prepare(sql).run()}catch(error){const m=error instanceof Error?error.message:String(error);if(!m.toLowerCase().includes('duplicate column'))throw error}}
async function ensureSchema(db:D1Database){
  await addColumnIfMissing(db,"ALTER TABLE governing_items ADD COLUMN source_page INTEGER");
  await addColumnIfMissing(db,"ALTER TABLE governing_items ADD COLUMN source_quote TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db,"ALTER TABLE governing_items ADD COLUMN confidence REAL NOT NULL DEFAULT 0");
  await addColumnIfMissing(db,"ALTER TABLE governing_items ADD COLUMN action_text TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing(db,"ALTER TABLE governing_items ADD COLUMN timing_text TEXT NOT NULL DEFAULT ''");
  await db.prepare(`CREATE TABLE IF NOT EXISTS governing_document_analysis_runs(id TEXT PRIMARY KEY,governing_document_id TEXT NOT NULL,analyzer TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,document_summary TEXT NOT NULL DEFAULT '',item_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(governing_document_id) REFERENCES governing_documents(id) ON DELETE CASCADE)`).run();
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
  const bytes=await object.arrayBuffer();const images=await renderPdfPages(env.BROWSER,bytes,20);
  const all:ControlItem[]=[];let conversionTokens=0;const pageResults:any[]=[];
  for(let i=0;i<images.length;i++){
    const page=i+1;
    const converted=await transcribePage(env.AI,images[i],page);
    conversionTokens+=converted.tokens;
    const pageItems=parseControlPlanMarkdownPage(converted.text,page);
    all.push(...pageItems);
    pageResults.push({page,source:converted.source,controls:pageItems.filter(x=>x.itemType==='control').length,documentation:pageItems.filter(x=>x.itemType==='documentation').length,characters:converted.text.length});
  }
  const seen=new Set<string>();const items=all.filter(item=>{const key=`${item.code}|${item.description.toLocaleLowerCase('sv-SE')}|${item.sourcePage}`;if(seen.has(key))return false;seen.add(key);return true});
  if(!items.length)throw new Error('Bildtolkningen hittade inga tabellrader som kunde tolkas som kontrollpunkter.');
  for(let i=0;i<items.length;i++){const item=items[i];await env.DB.prepare(`INSERT INTO governing_items(id,governing_document_id,code,description,section_code,section_title,item_type,responsible_role,evidence_required,handling_status,handling_comment,sort_order,source_note,source_page,source_quote,confidence,action_text,timing_text) VALUES(?,?,?,?,?,?,?,?,?,'unhandled','',?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),documentId,item.code,item.description,item.sectionCode,item.sectionTitle,item.itemType,item.responsibleRole,item.evidenceRequired,(i+1)*10,`Sida ${item.sourcePage} · ${item.sourceQuote}`,item.sourcePage,item.sourceQuote,0.99,item.action,item.timing).run()}
  await env.DB.prepare("UPDATE governing_documents SET status='active',updated_at=datetime('now') WHERE id=?").bind(documentId).run();
  const controlCount=items.filter(x=>x.itemType==='control').length;const documentationCount=items.filter(x=>x.itemType==='documentation').length;
  const summary=`Kontrollplan: ${controlCount} kontrollpunkter och ${documentationCount} dokumentationspunkter extraherade radvis.`;
  await env.DB.prepare(`INSERT INTO governing_document_analysis_runs(id,governing_document_id,analyzer,model,status,document_summary,item_count) VALUES(?,?,?,'${CONTROL_PLAN_VISION_MODEL}','completed',?,?)`).bind(crypto.randomUUID(),documentId,'control-plan-table-parser-v3',summary,items.length).run();
  return {ok:true,id:documentId,createdItems:items.length,provider:'workers-ai',analyzer:'control-plan-table-parser-v3',model:CONTROL_PLAN_VISION_MODEL,documentSummary:summary,conversionTokens,conversionMode:'pdf-instructed-vision-table-parser',renderedPages:images.length,pageResults,conversionQuality:'Varje PDF-sida transkriberas en gång med explicit OCR/tabellinstruktion; toMarkdown används endast som teknisk fallback vid visionsfel'};
}
