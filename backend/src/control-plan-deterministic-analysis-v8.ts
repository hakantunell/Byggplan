import puppeteer from '@cloudflare/puppeteer';
import {analyzeControlPlanDeterministically as analyzeV7} from './control-plan-deterministic-analysis';

type Env={DB:D1Database;FILES:R2Bucket;BROWSER:any;[key:string]:any};

type PageText={page:number;text:string};

function clean(v:unknown){return typeof v==='string'?v.trim():''}
function collapse(v:string){return v.replace(/\s+/g,' ').trim()}
function norm(v:string){return collapse(v).toLocaleLowerCase('sv-SE').replace(/&/g,' och ').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim()}
function contains(source:string,value:string){const v=clean(value);return !v||norm(source).includes(norm(v))}
function sectionCodeFromCode(code:string){const m=clean(code).match(/^(\d{1,2}|[A-Z])\./);return m?m[1]:''}
function documentationDescription(quote:string){return collapse(quote.replace(/^[•·\-*–—]\s*/,''))}
function bytesToBase64(bytes:ArrayBuffer){const input=new Uint8Array(bytes);let binary='';for(let i=0;i<input.length;i+=0x8000)binary+=String.fromCharCode(...input.subarray(i,Math.min(i+0x8000,input.length)));return btoa(binary)}

async function addColumnIfMissing(db:D1Database,sql:string){try{await db.prepare(sql).run()}catch(error){const m=error instanceof Error?error.message:String(error);if(!m.toLowerCase().includes('duplicate column'))throw error}}

async function extractPdfTextPages(browserBinding:any,pdfBytes:ArrayBuffer,maxPages=20):Promise<PageText[]>{
  if(!browserBinding)throw new Error('Browser Run-binding saknas för källverifiering.');
  const browser=await puppeteer.launch(browserBinding);const page=await browser.newPage();
  try{
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script></head><body></body></html>`,{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>Boolean((globalThis as any).pdfjsLib),{timeout:20000});
    const base64=bytesToBase64(pdfBytes);
    return await page.evaluate(async({base64,maxPages}:{base64:string;maxPages:number})=>{
      const pdfjs=(globalThis as any).pdfjsLib;pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const raw=atob(base64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
      const pdf=await pdfjs.getDocument({data:bytes}).promise,count=Math.min(Number(pdf.numPages||0),maxPages),result:{page:number;text:string}[]=[];
      for(let n=1;n<=count;n++){
        const p=await pdf.getPage(n),content=await p.getTextContent();
        const items=(content.items||[]).map((item:any)=>({text:String(item?.str||'').trim(),x:Number(item?.transform?.[4]||0),y:Number(item?.transform?.[5]||0)})).filter((item:any)=>item.text);
        items.sort((a:any,b:any)=>Math.abs(b.y-a.y)>2?b.y-a.y:a.x-b.x);
        const lines:{y:number;items:{text:string;x:number}[]}[]=[];
        for(const item of items){let line=lines.find(candidate=>Math.abs(candidate.y-item.y)<=2.2);if(!line){line={y:item.y,items:[]};lines.push(line)}line.items.push({text:item.text,x:item.x})}
        lines.sort((a,b)=>b.y-a.y);result.push({page:n,text:lines.map(line=>line.items.sort((a,b)=>a.x-b.x).map(item=>item.text).join('\t')).join('\n')});
      }
      return result;
    },{base64,maxPages}) as PageText[];
  }finally{await browser.close().catch(()=>undefined)}
}

function verifiedOrBlank(pageText:string,value:unknown){const v=clean(value);return v&&contains(pageText,v)?v:''}

export async function analyzeControlPlanDeterministically(env:Env,documentId:string){
  const result:any=await analyzeV7(env as any,documentId);
  await addColumnIfMissing(env.DB,"ALTER TABLE governing_items ADD COLUMN source_basis TEXT NOT NULL DEFAULT ''");

  const file=await env.DB.prepare(`SELECT f.object_key FROM governing_document_files f WHERE f.document_id=?`).bind(documentId).first<any>();
  if(!file?.object_key)return result;
  const object=await env.FILES.get(String(file.object_key));if(!object)return result;
  const pages=await extractPdfTextPages(env.BROWSER,await object.arrayBuffer(),20);
  const pageByNumber=new Map(pages.map(p=>[p.page,p.text]));
  const rows=await env.DB.prepare(`SELECT id,code,description,section_code,section_title,item_type,responsible_role,evidence_required,COALESCE(source_basis,'') source_basis,source_page,source_quote,action_text,timing_text FROM governing_items WHERE governing_document_id=? ORDER BY sort_order,id`).bind(documentId).all();

  for(const row of rows.results as any[]){
    const pageText=pageByNumber.get(Number(row.source_page||0))||'',quote=clean(row.source_quote),itemType=String(row.item_type||'');
    const sectionCode=itemType==='control'?sectionCodeFromCode(String(row.code||'')):'';
    const sectionTitle=verifiedOrBlank(pageText,row.section_title);
    const responsibleRole=verifiedOrBlank(pageText,row.responsible_role);
    const evidenceRequired=verifiedOrBlank(pageText,row.evidence_required);
    const timing=verifiedOrBlank(pageText,row.timing_text);

    let description=clean(row.description);
    if(itemType==='documentation')description=documentationDescription(quote);
    else if(description&&!contains(pageText,description)){
      const withoutTail=description.split(/\s+\/\s+(?:vid|slutkontroll)\b/i)[0].trim();
      if(withoutTail&&contains(pageText,withoutTail))description=withoutTail;
    }

    let sourceBasis='';
    const oldSectionCode=clean(row.section_code);
    if(oldSectionCode&&oldSectionCode!==sectionCode&&contains(pageText,oldSectionCode))sourceBasis=oldSectionCode;
    const existingBasis=clean(row.source_basis);if(existingBasis&&contains(pageText,existingBasis))sourceBasis=existingBasis;

    const action=description;
    await env.DB.prepare(`UPDATE governing_items SET description=?,section_code=?,section_title=?,responsible_role=?,evidence_required=?,source_basis=?,action_text=?,timing_text=?,updated_at=datetime('now') WHERE id=?`).bind(description,sectionCode,sectionTitle,responsibleRole,evidenceRequired,sourceBasis,action,timing,String(row.id)).run();
  }

  await env.DB.prepare(`UPDATE governing_document_analysis_runs SET analyzer='control-plan-source-text-v8' WHERE governing_document_id=? AND analyzer='control-plan-source-text-v7' AND created_at=(SELECT MAX(created_at) FROM governing_document_analysis_runs WHERE governing_document_id=?)`).bind(documentId,documentId).run().catch(()=>undefined);
  return{...result,analyzer:'control-plan-source-text-v8',conversionMode:'pdf-source-text-locked-normalization',conversionQuality:'Detektion och verifierade koder är oförändrade från v7. Efter extraktion låses normaliserade fält mot faktisk PDF-text: section_code härleds från kontrollkoden, dokumentationsbeskrivning tas från källcitatet, ansvar/underlag/rubrik/tidpunkt behålls bara om de kan verifieras på sidan och action_text tillför ingen ny sakinformation.'};
}
