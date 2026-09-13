import puppeteer from '@cloudflare/puppeteer';

type Env={DB:D1Database;FILES:R2Bucket;AI:any;BROWSER:any;[key:string]:any};
type ItemType='control'|'documentation';
type SourcePage={page:number;text:string;source:'pdf-text-layer'|'moondream-ocr'|'pdf-text+ocr'};
type ControlItem={code:string;description:string;sectionCode:string;sectionTitle:string;itemType:ItemType;responsibleRole:string;evidenceRequired:string;sourceBasis:string;sourcePage:number;sourceQuote:string;action:string;timing:string};

const TEXT_MODEL='@cf/meta/llama-3.1-8b-instruct-fast';
const OCR_MODEL='@cf/moondream/moondream3.1-9B-A2B';
const ANALYZER='control-plan-source-text-v8';

function clean(v:unknown){return typeof v==='string'?v.trim():''}
function collapse(v:string){return v.replace(/\s+/g,' ').trim()}
function norm(v:string){return collapse(v).toLocaleLowerCase('sv-SE').replace(/&/g,' och ').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim()}
function sourceContains(source:string,value:unknown){const v=clean(value);return Boolean(v)&&norm(source).includes(norm(v))}
function sectionCode(code:string){const m=clean(code).match(/^(\d{1,2}|[A-Z])\./);return m?m[1]:''}
function docDescription(quote:string){return collapse(quote.replace(/^[•·\-*–—]\s*/,''))}
function bytesToBase64(bytes:ArrayBuffer){const input=new Uint8Array(bytes);let binary='';for(let i=0;i<input.length;i+=0x8000)binary+=String.fromCharCode(...input.subarray(i,Math.min(i+0x8000,input.length)));return btoa(binary)}

async function addColumn(db:D1Database,sql:string){try{await db.prepare(sql).run()}catch(error){const m=error instanceof Error?error.message:String(error);if(!m.toLowerCase().includes('duplicate column'))throw error}}
async function ensureSchema(db:D1Database){
  await addColumn(db,"ALTER TABLE governing_items ADD COLUMN source_page INTEGER");
  await addColumn(db,"ALTER TABLE governing_items ADD COLUMN source_quote TEXT NOT NULL DEFAULT ''");
  await addColumn(db,"ALTER TABLE governing_items ADD COLUMN source_basis TEXT NOT NULL DEFAULT ''");
  await addColumn(db,"ALTER TABLE governing_items ADD COLUMN confidence REAL NOT NULL DEFAULT 0");
  await addColumn(db,"ALTER TABLE governing_items ADD COLUMN action_text TEXT NOT NULL DEFAULT ''");
  await addColumn(db,"ALTER TABLE governing_items ADD COLUMN timing_text TEXT NOT NULL DEFAULT ''");
  await db.prepare(`CREATE TABLE IF NOT EXISTS governing_document_analysis_runs(id TEXT PRIMARY KEY,governing_document_id TEXT NOT NULL,analyzer TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,document_summary TEXT NOT NULL DEFAULT '',item_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT (datetime('now')),FOREIGN KEY(governing_document_id) REFERENCES governing_documents(id) ON DELETE CASCADE)`).run();
}

async function openPdf(browserBinding:any){
  if(!browserBinding)throw new Error('Browser Run-binding saknas för kontrollplansanalys.');
  const browser=await puppeteer.launch(browserBinding);const page=await browser.newPage();
  await page.setViewport({width:1700,height:2300,deviceScaleFactor:1});
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script></head><body></body></html>`,{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>Boolean((globalThis as any).pdfjsLib),{timeout:20000});
  return{browser,page};
}

async function extractTextPages(browserBinding:any,pdfBytes:ArrayBuffer,maxPages=20):Promise<SourcePage[]>{
  if(pdfBytes.byteLength>12*1024*1024)throw new Error('PDF-filen är för stor för kontrollplansanalys (max 12 MB i denna väg).');
  const{browser,page}=await openPdf(browserBinding);
  try{
    const base64=bytesToBase64(pdfBytes);
    const result=await page.evaluate(async({base64,maxPages}:{base64:string;maxPages:number})=>{
      const pdfjs=(globalThis as any).pdfjsLib;pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const raw=atob(base64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
      const pdf=await pdfjs.getDocument({data:bytes}).promise,count=Math.min(Number(pdf.numPages||0),maxPages),out:{page:number;text:string}[]=[];
      for(let n=1;n<=count;n++){
        const p=await pdf.getPage(n),content=await p.getTextContent();
        const items=(content.items||[]).map((item:any)=>({text:String(item?.str||'').trim(),x:Number(item?.transform?.[4]||0),y:Number(item?.transform?.[5]||0)})).filter((item:any)=>item.text);
        items.sort((a:any,b:any)=>Math.abs(b.y-a.y)>2?b.y-a.y:a.x-b.x);
        const lines:{y:number;items:{text:string;x:number}[]}[]=[];
        for(const item of items){let line=lines.find(x=>Math.abs(x.y-item.y)<=2.2);if(!line){line={y:item.y,items:[]};lines.push(line)}line.items.push({text:item.text,x:item.x})}
        lines.sort((a,b)=>b.y-a.y);out.push({page:n,text:lines.map(line=>line.items.sort((a,b)=>a.x-b.x).map(x=>x.text).join('\t')).join('\n')});
      }
      return out;
    },{base64,maxPages}) as {page:number;text:string}[];
    return result.map(x=>({page:x.page,text:clean(x.text),source:'pdf-text-layer' as const}));
  }finally{await browser.close().catch(()=>undefined)}
}

async function renderPages(browserBinding:any,pdfBytes:ArrayBuffer,maxPages=20){
  const{browser,page}=await openPdf(browserBinding);
  try{
    const base64=bytesToBase64(pdfBytes);
    const count=await page.evaluate(async({base64,maxPages}:{base64:string;maxPages:number})=>{
      const pdfjs=(globalThis as any).pdfjsLib;pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const raw=atob(base64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
      const pdf=await pdfjs.getDocument({data:bytes}).promise,total=Math.min(Number(pdf.numPages||0),maxPages);
      for(let n=1;n<=total;n++){const p=await pdf.getPage(n),viewport=p.getViewport({scale:2}),canvas=document.createElement('canvas');canvas.dataset.page=String(n);canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const ctx=canvas.getContext('2d',{alpha:false})!;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);await p.render({canvasContext:ctx,viewport}).promise;document.body.appendChild(canvas)}
      return total;
    },{base64,maxPages});
    const images:ArrayBuffer[]=[];for(let n=1;n<=count;n++){const handle=await page.$(`canvas[data-page="${n}"]`);if(!handle)continue;const shot=await handle.screenshot({type:'png'}) as Uint8Array;const copy=new Uint8Array(shot.byteLength);copy.set(shot);images.push(copy.buffer)}return images;
  }finally{await browser.close().catch(()=>undefined)}
}

const OCR_PROMPT=`Läs av all synlig text på denna sida ordagrant. Sammanfatta, förklara eller översätt inte. Bevara nummer, koder, rubriker och tabellceller. Skriv varje synlig tabellrad på egen rad med TAB mellan celler. Skriv [OLÄSLIGT] om något inte kan läsas. Returnera endast avläst text.`;
async function ocrPage(ai:any,image:ArrayBuffer,page:number):Promise<SourcePage>{const response=await ai.run(OCR_MODEL,{task:'query',image:`data:image/png;base64,${bytesToBase64(image)}`,question:OCR_PROMPT,reasoning:false}) as any;const text=clean(response?.answer);if(!text)throw new Error(`OCR-modellen gav ingen text för sida ${page}.`);return{page,text,source:'moondream-ocr'}}

function rowCodes(text:string){const found=new Set<string>(),normalized=text.replace(/(\d{1,2})\s*\.\s*(\d{1,2})/g,'$1.$2');for(const m of normalized.matchAll(/(?:^|[\s\t])((?:\d{1,2}|[A-Z])\.\d{1,2})(?=[\s\t]|$|[^0-9A-Za-z])/gm))found.add(m[1]);return[...found]}
function looksLikeTable(text:string){return /(moment\s*\/\s*kontrollpunkt|moment.*kontrollpunkt|kontrolleras av|hur kontrollen sker|mot vad kontrolleras)/i.test(text)}
function codeGaps(codes:string[]){const by=new Map<number,number[]>();for(const code of codes){const m=code.match(/^(\d+)\.(\d+)$/);if(!m)continue;const section=Number(m[1]),row=Number(m[2]),rows=by.get(section)||[];rows.push(row);by.set(section,rows)}for(const rows of by.values()){const u=[...new Set(rows)].sort((a,b)=>a-b);if(u.length&&u[0]>1)return true;for(let i=1;i<u.length;i++)if(u[i]-u[i-1]>1)return true}return false}
function needsOcr(page:SourcePage){if(collapse(page.text).length<120)return true;const codes=rowCodes(page.text);return(looksLikeTable(page.text)&&codes.length===0)||codeGaps(codes)}
function mergeText(a:string,b:string){if(!clean(a))return clean(b);if(!clean(b))return clean(a);return`${clean(a)}\n\n--- OCR-KOMPLETTERING ---\n${clean(b)}`}

function schema(){return{type:'object',additionalProperties:false,properties:{items:{type:'array',items:{type:'object',additionalProperties:false,properties:{code:{type:'string'},description:{type:'string'},sectionCode:{type:'string'},sectionTitle:{type:'string'},itemType:{type:'string',enum:['control','documentation']},responsibleRole:{type:'string'},evidenceRequired:{type:'string'},sourceQuote:{type:'string'},timing:{type:'string'}},required:['code','description','sectionCode','sectionTitle','itemType','responsibleRole','evidenceRequired','sourceQuote','timing']}}},required:['items']}}
function aiJson(response:any){if(response&&typeof response.response==='object'&&response.response!==null)return response.response;if(typeof response?.response==='string'){try{return JSON.parse(response.response)}catch{}}const text=response?.choices?.[0]?.message?.content;if(typeof text==='string'){try{return JSON.parse(text)}catch{}}return null}
function exactQuote(pageText:string,item:any){const requested=collapse(clean(item?.sourceQuote));if(requested&&collapse(pageText).includes(requested))return requested.slice(0,600);const lines=pageText.split(/\r?\n/).map(collapse).filter(Boolean),code=clean(item?.code),description=collapse(clean(item?.description));const byCode=code?lines.find(line=>line.replace(/(\d{1,2})\s*\.\s*(\d{1,2})/g,'$1.$2').includes(code)):undefined;if(byCode)return byCode.slice(0,600);return(description?lines.find(line=>line.includes(description)):'')?.slice(0,600)||''}
function verified(pageText:string,value:unknown){const v=clean(value);return v&&sourceContains(pageText,v)?v:''}
function normalizeDescription(type:ItemType,description:string,quote:string,pageText:string){if(type==='documentation')return docDescription(quote);if(sourceContains(pageText,description))return description;const shorter=description.split(/\s+\/\s+(?:vid|slutkontroll)\b/i)[0].trim();return shorter&&sourceContains(pageText,shorter)?shorter:description}

async function extractItems(ai:any,source:SourcePage):Promise<ControlItem[]>{
  const codes=rowCodes(source.text);
  const prompt=`Du får direkt källtext från sida ${source.page} i en svensk kontrollplan. Ingen sammanfattning har gjorts. Verifierade kontrollkoder: ${codes.length?codes.join(', '):'(inga)'}.
Regler: control får endast skapas med en verifierad kod. Varje verklig kontrollrad ska bli exakt en post. description ska motsvara Moment/kontrollpunkt så nära originalet som möjligt. sectionTitle, responsibleRole, evidenceRequired och timing får bara hämtas från uttrycklig text. sourceQuote ska vara ordagrant från källtexten. documentation får skapas för uttryckliga krav på handling/intyg/dokument/foto även utan kod, men kräver ordagrant sourceQuote. Hitta inte på krav, standarder eller ansvar. Returnera ingen sammanfattning.
KÄLLTEXT:\n---\n${source.text}\n---`;
  const response=await ai.run(TEXT_MODEL,{messages:[{role:'system',content:'Extrahera endast verifierbara styrposter ur given källtext. Lägg inte till sakinformation.'},{role:'user',content:prompt}],response_format:{type:'json_schema',json_schema:schema()},max_completion_tokens:7000,temperature:0}) as any;
  const parsed=aiJson(response);if(!parsed)throw new Error(`Textanalysen gav inget giltigt JSON-resultat för sida ${source.page}.`);
  const result:ControlItem[]=[];
  for(const raw of Array.isArray(parsed.items)?parsed.items:[]){
    const type:ItemType=raw?.itemType==='documentation'?'documentation':'control',code=clean(raw?.code),rawDescription=clean(raw?.description);if(!rawDescription)continue;if(type==='control'&&(!code||!codes.includes(code)))continue;
    const quote=exactQuote(source.text,raw);if(!quote)continue;const sec=type==='control'?sectionCode(code):'',description=normalizeDescription(type,rawDescription,quote,source.text),candidateBasis=clean(raw?.sectionCode);
    result.push({code:type==='control'?code:'',description,sectionCode:sec,sectionTitle:verified(source.text,raw?.sectionTitle),itemType:type,responsibleRole:verified(source.text,raw?.responsibleRole),evidenceRequired:verified(source.text,raw?.evidenceRequired),sourceBasis:candidateBasis&&candidateBasis!==sec&&sourceContains(source.text,candidateBasis)?candidateBasis:'',sourcePage:source.page,sourceQuote:quote,action:description,timing:verified(source.text,raw?.timing)});
  }
  return result;
}

export async function analyzeControlPlanDeterministically(env:Env,documentId:string){
  await ensureSchema(env.DB);if(!env.AI||typeof env.AI.run!=='function')throw new Error('Workers AI är inte konfigurerat.');if(!env.FILES||typeof env.FILES.get!=='function')throw new Error('Fillagringen är inte tillgänglig.');
  const document=await env.DB.prepare(`SELECT d.id,d.document_type,f.object_key FROM governing_documents d JOIN governing_document_files f ON f.document_id=d.id WHERE d.id=?`).bind(documentId).first<any>();if(!document)throw new Error('Styrdokumentet eller originalfilen hittades inte.');if(String(document.document_type)!=='control_plan')throw new Error('Dokumentet är inte en kontrollplan.');
  const existing=await env.DB.prepare('SELECT COUNT(*) count FROM governing_items WHERE governing_document_id=?').bind(documentId).first<any>();if(Number(existing?.count||0)>0)throw new Error('Dokumentet är redan analyserat.');
  const object=await env.FILES.get(String(document.object_key));if(!object)throw new Error('Originalfilen saknas i fillagringen.');const bytes=await object.arrayBuffer();

  let pages=await extractTextPages(env.BROWSER,bytes,20);const ocrPages=pages.filter(needsOcr).map(x=>x.page);
  if(ocrPages.length){const images=await renderPages(env.BROWSER,bytes,20);for(const pageNumber of ocrPages){const image=images[pageNumber-1];if(!image)continue;try{const ocr=await ocrPage(env.AI,image,pageNumber);pages=pages.map(p=>p.page===pageNumber?{page:p.page,text:mergeText(p.text,ocr.text),source:'pdf-text+ocr' as const}:p)}catch(error){console.warn('Control-plan OCR supplement failed',{page:pageNumber,error})}}}

  const all:ControlItem[]=[];const pageResults:any[]=[];
  for(const source of pages){const items=await extractItems(env.AI,source);all.push(...items);pageResults.push({page:source.page,source:source.source,sourceCharacters:source.text.length,detectedCodes:rowCodes(source.text),controls:items.filter(x=>x.itemType==='control').length,documentation:items.filter(x=>x.itemType==='documentation').length,ocrSupplemented:source.source==='pdf-text+ocr'})}
  const seen=new Set<string>(),items=all.filter(item=>{const key=item.itemType==='control'?`control|${item.code}|${item.sourcePage}`:`documentation|${norm(item.sourceQuote)}|${item.sourcePage}`;if(seen.has(key))return false;seen.add(key);return true});if(!items.length)throw new Error('Ingen styrande kontrollpunkt kunde verifieras direkt mot dokumentets källtext.');

  for(let i=0;i<items.length;i++){const item=items[i];await env.DB.prepare(`INSERT INTO governing_items(id,governing_document_id,code,description,section_code,section_title,item_type,responsible_role,evidence_required,handling_status,handling_comment,sort_order,source_note,source_basis,source_page,source_quote,confidence,action_text,timing_text) VALUES(?,?,?,?,?,?,?,?,?,'unhandled','',?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),documentId,item.code,item.description,item.sectionCode,item.sectionTitle,item.itemType,item.responsibleRole,item.evidenceRequired,(i+1)*10,`Sida ${item.sourcePage} · ${item.sourceQuote}`,item.sourceBasis,item.sourcePage,item.sourceQuote,0.99,item.action,item.timing).run()}
  await env.DB.prepare("UPDATE governing_documents SET status='active',updated_at=datetime('now') WHERE id=?").bind(documentId).run();
  const controls=items.filter(x=>x.itemType==='control').length,docs=items.filter(x=>x.itemType==='documentation').length,summary=`Kontrollplan: ${controls} verifierade kontrollpunkter och ${docs} verifierade dokumentationspunkter extraherade direkt ur källtext.`;
  await env.DB.prepare(`INSERT INTO governing_document_analysis_runs(id,governing_document_id,analyzer,model,status,document_summary,item_count) VALUES(?,?,?,?,'completed',?,?)`).bind(crypto.randomUUID(),documentId,ANALYZER,TEXT_MODEL,summary,items.length).run();
  return{ok:true,id:documentId,createdItems:items.length,provider:'workers-ai',analyzer:ANALYZER,model:TEXT_MODEL,documentSummary:summary,conversionMode:'pdf-source-text-locked-normalization',renderedPages:pages.length,ocrPages,pageResults,conversionQuality:'En sammanhållen pipeline: källtext/OCR -> verifierad postdetektion -> källåst normalisering -> databas. Ingen wrapper eller efterhandskorrigering används.'};
}
