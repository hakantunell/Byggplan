import puppeteer from '@cloudflare/puppeteer';

type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};

function clean(value:unknown){return typeof value==='string'?value.trim():''}

function bytesToBase64(bytes:ArrayBuffer){
  const input=new Uint8Array(bytes);let binary='';const chunkSize=0x8000;
  for(let i=0;i<input.length;i+=chunkSize){binary+=String.fromCharCode(...input.subarray(i,Math.min(i+chunkSize,input.length)))}
  return btoa(binary);
}

async function renderPdfPages(browserBinding:any,pdfBytes:ArrayBuffer,maxPages=20){
  if(!browserBinding)throw new Error('Browser Run-binding saknas.');
  if(pdfBytes.byteLength>12*1024*1024)throw new Error('PDF-filen är för stor för visionsdiagnostiken (max 12 MB).');
  const browser=await puppeteer.launch(browserBinding);
  try{
    const page=await browser.newPage();
    await page.setViewport({width:1700,height:2300,deviceScaleFactor:1});
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff}.pdf-page{display:block;margin:0 auto 24px auto;background:#fff}</style><script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script></head><body><main id="pages"></main></body></html>`,{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>Boolean((globalThis as any).pdfjsLib),{timeout:20000});
    const base64=bytesToBase64(pdfBytes);
    const totalPages=await page.evaluate(async({base64,maxPages}:{base64:string;maxPages:number})=>{
      const pdfjs=(globalThis as any).pdfjsLib;
      pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const raw=atob(base64);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
      const pdf=await pdfjs.getDocument({data:bytes}).promise;
      const count=Math.min(Number(pdf.numPages||0),maxPages);
      const host=document.getElementById('pages')!;
      for(let n=1;n<=count;n++){
        const p=await pdf.getPage(n);const viewport=p.getViewport({scale:2});
        const canvas=document.createElement('canvas');canvas.className='pdf-page';canvas.dataset.page=String(n);canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        const ctx=canvas.getContext('2d',{alpha:false})!;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
        await p.render({canvasContext:ctx,viewport}).promise;host.appendChild(canvas);
      }
      return count;
    },{base64,maxPages});
    const images:ArrayBuffer[]=[];
    for(let n=1;n<=totalPages;n++){
      const handle=await page.$(`canvas[data-page="${n}"]`);if(!handle)continue;
      const shot=await handle.screenshot({type:'png'}) as Uint8Array;
      images.push(shot.buffer.slice(shot.byteOffset,shot.byteOffset+shot.byteLength));
    }
    if(!images.length)throw new Error('Inga sidbilder kunde renderas.');
    return images;
  }finally{await browser.close().catch(()=>undefined)}
}

export function registerGoverningDocumentVisionDiagnosticsRoutes(app:RouteApp){
  app.post('/api/studio/governing-documents/:id/vision-conversion-diagnostics',async c=>{
    const id=c.req.param('id');
    if(!c.env.AI||typeof c.env.AI.toMarkdown!=='function')return c.json({ok:false,error:'Workers AI dokumentkonvertering är inte konfigurerad.'},503);
    if(!c.env.BROWSER)return c.json({ok:false,error:'Browser Run är inte konfigurerat.'},503);
    if(!c.env.FILES||typeof c.env.FILES.get!=='function')return c.json({ok:false,error:'Fillagringen är inte tillgänglig.'},503);
    const document=await c.env.DB.prepare(`SELECT d.id,d.title,d.document_type,d.source_filename,d.source_mime_type,f.object_key,f.original_name,f.content_type,f.size_bytes FROM governing_documents d JOIN governing_document_files f ON f.document_id=d.id WHERE d.id=?`).bind(id).first<any>();
    if(!document)return c.json({ok:false,error:'Styrdokumentet eller originalfilen hittades inte.'},404);
    const object=await c.env.FILES.get(String(document.object_key));if(!object)return c.json({ok:false,error:'Originalfilen saknas i fillagringen.'},404);
    const filename=clean(document.original_name)||clean(document.source_filename)||'styrdokument';
    const contentType=clean(document.content_type)||clean(document.source_mime_type)||'application/octet-stream';
    if(contentType!=='application/pdf')return c.json({ok:false,error:'Visionsdiagnostiken stöder just nu endast PDF.'},400);
    try{
      const bytes=await object.arrayBuffer();const images=await renderPdfPages(c.env.BROWSER,bytes,20);
      const pages:any[]=[];let totalTokens=0,totalCharacters=0;
      for(let i=0;i<images.length;i++){
        const converted=await c.env.AI.toMarkdown({name:`page-${i+1}.png`,blob:new Blob([images[i]],{type:'image/png'})},{conversionOptions:{output:{format:'markdown'},image:{descriptionLanguage:'sv'}}}) as any;
        const result=Array.isArray(converted)?converted[0]:converted;
        if(!result||result.format==='error')throw new Error(clean(result?.error)||`Kunde inte bildtolka sida ${i+1}.`);
        const markdown=clean(result?.data);const tokens=Number(result?.tokens||0);totalTokens+=tokens;totalCharacters+=markdown.length;
        pages.push({page:i+1,tokens,characters:markdown.length,markdown});
      }
      const combinedMarkdown=pages.map(p=>`### Sida ${p.page}\n${p.markdown}`).join('\n\n');
      return c.json({ok:true,id,title:clean(document.title),filename,sourceBytes:Number(document.size_bytes||0),renderedPages:pages.length,totalTokens,totalCharacters,pages,combinedMarkdown});
    }catch(error){const detail=error instanceof Error?error.message:String(error);console.error('Vision conversion diagnostics failed',error);return c.json({ok:false,error:`Kunde inte diagnostisera visionskonverteringen: ${detail}`},500)}
  });
}
