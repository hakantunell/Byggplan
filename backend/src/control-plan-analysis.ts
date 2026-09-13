import puppeteer from '@cloudflare/puppeteer';

type Env={DB:D1Database;FILES:R2Bucket;BROWSER:any;[key:string]:any};
type PI={text:string;x:number;y:number;width:number};
type Page={page:number;width:number;items:PI[]};
type Line={y:number;items:PI[];text:string};
type Kind='description'|'method'|'basis'|'legal'|'responsible'|'timing'|'other';
type Col={kind:Kind;x:number;label:string};
type Item={code:string;description:string;sectionCode:string;sectionTitle:string;itemType:'control'|'documentation';responsibleRole:string;evidenceRequired:string;sourceBasis:string;sourcePage:number;sourceQuote:string;action:string;timing:string};

const ANALYZER='control-plan-layout-v11';
const clean=(v:unknown)=>typeof v==='string'?v.trim():'';
const collapse=(v:string)=>v.replace(/\s+/g,' ').trim();
const norm=(v:string)=>collapse(v).toLocaleLowerCase('sv-SE').replace(/&/g,' och ').replace(/[–—]/g,'-');
const sec=(code:string)=>code.split('.')[0]||'';

function codeIn(text:string){
  const normalized=text.replace(/(\d{1,2})\s*\.\s*(\d{1,2})/g,'$1.$2');
  const m=normalized.match(/(?:^|\s)((?:\d{1,2}|[A-Z])\.\d{1,2})(?=\s|$|[^0-9A-Za-z])/);
  return m?.[1]||'';
}

function joinPieces(items:PI[]){
  const sorted=[...items].sort((a,b)=>a.x-b.x);
  let out='';
  let prev:PI|undefined;
  for(const item of sorted){
    if(!prev){out=item.text;prev=item;continue}
    const gap=item.x-(prev.x+Math.max(0,prev.width));
    const letters=/^[A-Za-zÅÄÖåäö]+$/;
    const joinWord=gap<=0.8&&gap>=-1.5&&letters.test(prev.text)&&letters.test(item.text);
    out+=joinWord?'':' ';
    out+=item.text;
    prev=item;
  }
  return collapse(out);
}

function makeLines(items:PI[]):Line[]{
  const out:Line[]=[];
  for(const it of [...items].sort((a,b)=>Math.abs(b.y-a.y)>2.2?b.y-a.y:a.x-b.x)){
    let line=out.find(x=>Math.abs(x.y-it.y)<=2.2);
    if(!line){line={y:it.y,items:[],text:''};out.push(line)}
    line.items.push(it);
  }
  out.sort((a,b)=>b.y-a.y);
  for(const line of out){
    line.items.sort((a,b)=>a.x-b.x);
    line.text=joinPieces(line.items);
  }
  return out;
}

function isPageFooter(line:Line){
  return /^\s*\d+\s*\(\s*\d+\s*\)\s*$/.test(line.text);
}

function headerKind(text:string):Kind|null{
  const t=norm(text);
  if(/moment|kontrollpunkt/.test(t))return'description';
  if(/hur.*kontroll|kontroll.*sker|kontrollmetod/.test(t))return'method';
  if(/mot vad|kontrolleras mot|underlag/.test(t))return'basis';
  if(/pbl\s*\/\s*bbr|pbl.*bbr|avsnitt|lagrum|föreskrift|regelverk/.test(t))return'legal';
  if(/kontrolleras av|vem kontrollerar|ansvarig/.test(t))return'responsible';
  if(/när|tidpunkt|skede/.test(t))return'timing';
  return null;
}

function detectColumns(page:Page,lines:Line[]){
  const candidates=new Map<Kind,Col>();
  for(const line of lines){
    if(isPageFooter(line))continue;
    const lineKinds=line.items.map(it=>({it,kind:headerKind(it.text)})).filter(x=>x.kind) as {it:PI;kind:Kind}[];
    const looksLikeHeader=/\bnr\b|moment|kontrollpunkt|hur.*kontroll|mot vad|pbl\s*\/\s*bbr|kontrolleras av|signatur|anmärkning/i.test(norm(line.text));
    if(!looksLikeHeader&&lineKinds.length<2)continue;
    for(const {it,kind} of lineKinds){
      const existing=candidates.get(kind);
      if(!existing||it.x<existing.x)candidates.set(kind,{kind,x:it.x,label:it.text});
    }
  }
  if(!candidates.has('description')){
    const xs=lines.flatMap(line=>line.items.filter(i=>codeIn(i.text)).map(i=>i.x));
    candidates.set('description',{kind:'description',x:xs.length?Math.min(...xs):page.width*.04,label:'Moment/kontrollpunkt'});
  }
  return [...candidates.values()].sort((a,b)=>a.x-b.x);
}

function colFor(columns:Col[],item:PI):Kind{
  const center=item.x+Math.max(0,item.width)/2;
  for(let i=0;i<columns.length;i++){
    const left=i?(columns[i-1].x+columns[i].x)/2:-Infinity;
    const right=i<columns.length-1?(columns[i].x+columns[i+1].x)/2:Infinity;
    if(center>=left&&center<right)return columns[i].kind;
  }
  return'other';
}

function sectionHeading(text:string){
  if(codeIn(text))return null;
  const m=text.match(/^\s*(\d{1,2})\s*\.\s+([A-Za-zÅÄÖåäö][^\n]{1,80})\s*$/);
  if(!m)return null;
  const title=collapse(m[2]);
  if(/\b(nr|moment|kontrollpunkt|sida|datum|fastighet|byggherre|signatur|anmärkning)\b/i.test(title))return null;
  return{section:m[1],title};
}

function titles(lines:Line[]){
  const out=new Map<string,string>();
  for(const line of lines){
    const heading=sectionHeading(line.text);
    if(heading)out.set(heading.section,heading.title);
  }
  return out;
}

function isTableHeader(line:Line){
  const t=norm(line.text);
  return /\bnr\b/.test(t)&&(/moment|kontrollpunkt/.test(t)||/hur.*kontroll/.test(t)||/mot vad/.test(t)||/kontrolleras av/.test(t));
}

function isBoundary(line:Line){
  return Boolean(codeIn(line.text)||sectionHeading(line.text)||isTableHeader(line)||/handlingar.*lämnas.*slutbesked/i.test(norm(line.text)));
}

function assignCells(items:PI[],columns:Col[]){
  const cells=new Map<Kind,PI[]>();
  const lines=makeLines(items);
  for(const line of lines){
    let previous:PI|undefined;
    let previousKind:Kind|undefined;
    for(const item of [...line.items].sort((a,b)=>a.x-b.x)){
      let kind=colFor(columns,item);
      if(previous&&previousKind&&kind!==previousKind){
        const gap=item.x-(previous.x+Math.max(0,previous.width));
        const tiny=/^[A-Za-zÅÄÖåäö]{1,2}$/.test(item.text);
        const previousWord=/^[A-Za-zÅÄÖåäö]+$/.test(previous.text);
        if(tiny&&previousWord&&gap>=-1.5&&gap<=1.5)kind=previousKind;
      }
      const arr=cells.get(kind)||[];
      arr.push(item);
      cells.set(kind,arr);
      previous=item;
      previousKind=kind;
    }
  }
  return cells;
}

function cellText(items:PI[]){
  if(!items.length)return'';
  return collapse(makeLines(items).map(line=>joinPieces(line.items)).filter(Boolean).join(' '));
}

function parsePage(page:Page){
  const allLines=makeLines(page.items);
  const footerYs=allLines.filter(isPageFooter).map(line=>line.y);
  const usableItems=page.items.filter(item=>!footerYs.some(y=>Math.abs(y-item.y)<=2.2));
  const lines=makeLines(usableItems);
  const columns=detectColumns(page,lines);
  const sectionTitles=titles(lines);
  const anchors=lines.map((line,index)=>({line,index,code:codeIn(line.text)})).filter(x=>x.code);
  const items:Item[]=[];

  for(const anchor of anchors){
    let boundary:Line|undefined;
    for(let j=anchor.index+1;j<lines.length;j++){
      if(isBoundary(lines[j])){boundary=lines[j];break}
    }
    const top=anchor.line.y+2.5;
    const bottom=boundary?boundary.y+2.5:-Infinity;
    const rowItems=usableItems.filter(x=>x.y<=top&&x.y>bottom);
    const cells=assignCells(rowItems,columns);
    const cell=(kind:Kind)=>cellText(cells.get(kind)||[]);

    const re=new RegExp(`^\\s*${anchor.code.replace('.','\\s*\\.\\s*')}\\s*`);
    const description=collapse(cell('description').replace(re,''));
    if(!description)continue;

    const method=cell('method');
    const basis=cell('basis');
    const legal=cell('legal');
    const responsible=cell('responsible');
    const timing=cell('timing');
    const sourceBasis=[basis,legal].filter(Boolean).join(' · ');
    const quote=collapse([`${anchor.code} ${description}`,method,basis,legal,responsible,timing].filter(Boolean).join(' | '));

    items.push({
      code:anchor.code,
      description,
      sectionCode:sec(anchor.code),
      sectionTitle:sectionTitles.get(sec(anchor.code))||'',
      itemType:'control',
      responsibleRole:responsible,
      evidenceRequired:'',
      sourceBasis,
      sourcePage:page.page,
      sourceQuote:quote,
      action:description,
      timing
    });
  }

  const docsHeader=lines.findIndex(line=>/handlingar.*lämnas.*slutbesked/i.test(norm(line.text)));
  if(docsHeader>=0){
    for(let i=docsHeader+1;i<lines.length;i++){
      const q=lines[i].text;
      if(!/^[•·\-*–—]/.test(q))continue;
      const description=collapse(q.replace(/^[•·\-*–—]\s*/,''));
      if(!description)continue;
      items.push({
        code:'',description,sectionCode:'',sectionTitle:'Handlingar som lämnas in för slutbesked',itemType:'documentation',responsibleRole:'',evidenceRequired:'',sourceBasis:'',sourcePage:page.page,sourceQuote:q,action:description,timing:''
      });
    }
  }

  return{items,columns};
}

async function addCol(db:D1Database,sql:string){
  try{await db.prepare(sql).run()}catch(e){if(!String(e).toLowerCase().includes('duplicate column'))throw e}
}

async function ensure(db:D1Database){
  for(const sql of [
    "ALTER TABLE governing_items ADD COLUMN source_page INTEGER",
    "ALTER TABLE governing_items ADD COLUMN source_quote TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE governing_items ADD COLUMN source_basis TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE governing_items ADD COLUMN confidence REAL NOT NULL DEFAULT 0",
    "ALTER TABLE governing_items ADD COLUMN action_text TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE governing_items ADD COLUMN timing_text TEXT NOT NULL DEFAULT ''"
  ])await addCol(db,sql);
  await db.prepare(`CREATE TABLE IF NOT EXISTS governing_document_analysis_runs(id TEXT PRIMARY KEY,governing_document_id TEXT NOT NULL,analyzer TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,document_summary TEXT NOT NULL DEFAULT '',item_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
}

async function pages(binding:any,ab:ArrayBuffer):Promise<Page[]>{
  if(!binding)throw new Error('Browser Run-binding saknas.');
  const browser=await puppeteer.launch(binding),p=await browser.newPage();
  try{
    await p.setContent(`<!doctype html><script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>`,{waitUntil:'networkidle0'});
    await p.waitForFunction(()=>Boolean((globalThis as any).pdfjsLib),{timeout:20000});
    const bytes=Array.from(new Uint8Array(ab));
    return await p.evaluate(async (bytes:number[])=>{
      const pdfjs=(globalThis as any).pdfjsLib;
      pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const pdf=await pdfjs.getDocument({data:new Uint8Array(bytes)}).promise;
      const out:any[]=[];
      for(let n=1;n<=Math.min(pdf.numPages,20);n++){
        const pg=await pdf.getPage(n),viewport=pg.getViewport({scale:1}),content=await pg.getTextContent();
        const items=(content.items||[]).map((x:any)=>({
          text:String(x.str||'').trim(),
          x:Number(x.transform?.[4]||0),
          y:Number(x.transform?.[5]||0),
          width:Number(x.width||0)
        })).filter((x:any)=>x.text);
        out.push({page:n,width:viewport.width,items});
      }
      return out;
    },bytes) as Page[];
  }finally{
    await browser.close().catch(()=>undefined);
  }
}

export async function analyzeControlPlanDeterministically(env:Env,documentId:string){
  await ensure(env.DB);
  const document=await env.DB.prepare(`SELECT d.document_type,f.object_key FROM governing_documents d JOIN governing_document_files f ON f.document_id=d.id WHERE d.id=?`).bind(documentId).first<any>();
  if(!document)throw new Error('Styrdokumentet eller originalfilen hittades inte.');
  if(String(document.document_type)!=='control_plan')throw new Error('Dokumentet är inte en kontrollplan.');
  const existing=await env.DB.prepare('SELECT COUNT(*) count FROM governing_items WHERE governing_document_id=?').bind(documentId).first<any>();
  if(Number(existing?.count||0)>0)throw new Error('Dokumentet är redan analyserat.');
  const object=await env.FILES.get(String(document.object_key));
  if(!object)throw new Error('Originalfilen saknas i fillagringen.');
  const bytes=await object.arrayBuffer();
  if(bytes.byteLength>12*1024*1024)throw new Error('PDF-filen är för stor för kontrollplansanalys (max 12 MB).');

  const parsedPages=await pages(env.BROWSER,bytes),all:Item[]=[],pageResults:any[]=[];
  for(const page of parsedPages){
    const parsed=parsePage(page);
    all.push(...parsed.items);
    pageResults.push({
      page:page.page,
      source:'pdf-text-layout',
      detectedCodes:parsed.items.filter(x=>x.itemType==='control').map(x=>x.code),
      controls:parsed.items.filter(x=>x.itemType==='control').length,
      documentation:parsed.items.filter(x=>x.itemType==='documentation').length,
      columns:parsed.columns.map(c=>({kind:c.kind,x:Math.round(c.x),label:c.label}))
    });
  }

  const seen=new Set<string>();
  const items=all.filter(x=>{
    const key=x.itemType==='control'?`c|${x.code}|${x.sourcePage}`:`d|${norm(x.sourceQuote)}|${x.sourcePage}`;
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
  if(!items.length)throw new Error('Ingen kontrollpunkt kunde verifieras från PDF-layouten.');

  for(let i=0;i<items.length;i++){
    const x=items[i];
    await env.DB.prepare(`INSERT INTO governing_items(id,governing_document_id,code,description,section_code,section_title,item_type,responsible_role,evidence_required,handling_status,handling_comment,sort_order,source_note,source_basis,source_page,source_quote,confidence,action_text,timing_text) VALUES(?,?,?,?,?,?,?,?,?,'unhandled','',?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(),documentId,x.code,x.description,x.sectionCode,x.sectionTitle,x.itemType,x.responsibleRole,x.evidenceRequired,(i+1)*10,`Sida ${x.sourcePage} · ${x.sourceQuote}`,x.sourceBasis,x.sourcePage,x.sourceQuote,0.99,x.action,x.timing).run();
  }

  await env.DB.prepare("UPDATE governing_documents SET status='active',updated_at=datetime('now') WHERE id=?").bind(documentId).run();
  const controls=items.filter(x=>x.itemType==='control').length;
  const documentation=items.filter(x=>x.itemType==='documentation').length;
  const summary=`Kontrollplan: ${controls} layoutverifierade kontrollpunkter och ${documentation} dokumentationspunkter.`;
  await env.DB.prepare(`INSERT INTO governing_document_analysis_runs(id,governing_document_id,analyzer,model,status,document_summary,item_count) VALUES(?,?,?,?,'completed',?,?)`).bind(crypto.randomUUID(),documentId,ANALYZER,'pdfjs-layout-parser',summary,items.length).run();
  return{
    ok:true,id:documentId,createdItems:items.length,provider:'deterministic-layout',analyzer:ANALYZER,model:'pdfjs-layout-parser',documentSummary:summary,conversionMode:'pdf-positioned-table-layout',renderedPages:parsedPages.length,ocrPages:[],pageResults,
    conversionQuality:'PDF-textens x/y-positioner och textbredd bevaras. Sidfötter filtreras bort, textobjekt mappas till kolumner med sin geometriska mittpunkt och celltext byggs radvis. Små ordfragment nära en kolumngräns hålls ihop med föregående ord. Ingen AI används för att gissa kolumntillhörighet.'
  };
}
