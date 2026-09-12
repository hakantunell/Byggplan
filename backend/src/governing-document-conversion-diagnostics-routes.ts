import puppeteer from '@cloudflare/puppeteer';

type RouteApp={post:(path:string,handler:(c:any)=>unknown)=>void};

function clean(value:unknown){return typeof value==='string'?value.trim():''}

async function convertDocument(ai:any,object:R2ObjectBody,filename:string,contentType:string){
  const bytes=await object.arrayBuffer();
  const converted=await ai.toMarkdown({
    name:filename||'styrdokument',
    blob:new Blob([bytes],{type:contentType||'application/octet-stream'})
  },{
    conversionOptions:{
      output:{format:'markdown'},
      pdf:{metadata:false}
    }
  }) as any;
  const result=Array.isArray(converted)?converted[0]:converted;
  if(!result||result.format==='error')throw new Error(clean(result?.error)||'Cloudflare kunde inte konvertera dokumentet till text.');
  const data=clean(result?.data);
  if(!data)throw new Error('Dokumentkonverteringen returnerade ingen text.');
  return {text:data,tokens:Number(result?.tokens||0),format:clean(result?.format)||'markdown'};
}

function bytesToBase64(bytes:ArrayBuffer){
  const input=new Uint8Array(bytes);let binary='';const chunkSize=0x8000;
  for(let i=0;i<input.length;i+=chunkSize)binary+=String.fromCharCode(...input.subarray(i,Math.min(i+chunkSize,input.length)));
  return btoa(binary);
}

async function openPdfPage(browserBinding:any,pdfBytes:ArrayBuffer,pageNumber:number,maxPages=20){
  if(!browserBinding)throw new Error('Browser Run-binding saknas.');
  if(pdfBytes.byteLength>12*1024*1024)throw new Error('PDF-filen är för stor för visionsdiagnostik (max 12 MB).');
  const browser=await puppeteer.launch(browserBinding);
  try{
    const page=await browser.newPage();
    await page.setViewport({width:1700,height:2300,deviceScaleFactor:1});
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff}.pdf-page{display:block;margin:0 auto;background:#fff}</style><script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script></head><body><main id="pages"></main></body></html>`,{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>Boolean((globalThis as any).pdfjsLib),{timeout:20000});
    const base64=bytesToBase64(pdfBytes);
    const meta=await page.evaluate(async({base64,pageNumber,maxPages}:{base64:string;pageNumber:number;maxPages:number})=>{
      const pdfjs=(globalThis as any).pdfjsLib;
      pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const raw=atob(base64);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
      const pdf=await pdfjs.getDocument({data:bytes}).promise;
      const total=Number(pdf.numPages||0);
      if(pageNumber<1||pageNumber>total||pageNumber>maxPages)return {total,error:`Sidnummer ${pageNumber} ligger utanför tillåtet intervall 1-${Math.min(total,maxPages)}.`};
      const p=await pdf.getPage(pageNumber);const viewport=p.getViewport({scale:2});
      const canvas=document.createElement('canvas');canvas.className='pdf-page';canvas.dataset.page=String(pageNumber);canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      const ctx=canvas.getContext('2d',{alpha:false})!;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
      await p.render({canvasContext:ctx,viewport}).promise;document.getElementById('pages')!.appendChild(canvas);
      return {total,error:''};
    },{base64,pageNumber,maxPages});
    if(meta.error)throw new Error(meta.error);
    const handle=await page.$(`canvas[data-page="${pageNumber}"]`);if(!handle)throw new Error(`Sida ${pageNumber} kunde inte renderas.`);
    const shot=await handle.screenshot({type:'png'}) as Uint8Array;
    return {image:shot.buffer.slice(shot.byteOffset,shot.byteOffset+shot.byteLength),totalPages:Number(meta.total||0)};
  }finally{await browser.close().catch(()=>undefined)}
}

async function renderPdfPages(browserBinding:any,pdfBytes:ArrayBuffer,maxPages=20){
  if(!browserBinding)throw new Error('Browser Run-binding saknas.');
  if(pdfBytes.byteLength>12*1024*1024)throw new Error('PDF-filen är för stor för visionsdiagnostik (max 12 MB).');
  const browser=await puppeteer.launch(browserBinding);
  try{
    const page=await browser.newPage();
    await page.setViewport({width:1700,height:2300,deviceScaleFactor:1});
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff}.pdf-page{display:block;margin:0 auto 24px;background:#fff}</style><script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script></head><body><main id="pages"></main></body></html>`,{waitUntil:'networkidle0'});
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
    if(!images.length)throw new Error('Inga PDF-sidor kunde renderas.');
    return images;
  }finally{await browser.close().catch(()=>undefined)}
}

async function convertImagePage(ai:any,image:ArrayBuffer,pageNumber:number){
  const converted=await ai.toMarkdown({name:`page-${pageNumber}.png`,blob:new Blob([image],{type:'image/png'})},{conversionOptions:{output:{format:'markdown'},image:{descriptionLanguage:'sv'}}}) as any;
  const result=Array.isArray(converted)?converted[0]:converted;
  if(!result||result.format==='error')throw new Error(clean(result?.error)||`Sida ${pageNumber} kunde inte bildtolkas.`);
  const text=clean(result?.data);
  if(!text)throw new Error(`Sida ${pageNumber} gav ingen text.`);
  return {text,tokens:Number(result?.tokens||0)};
}

async function loadPdfDocument(c:any,id:string){
  if(!c.env.AI||typeof c.env.AI.toMarkdown!=='function')return {response:c.json({ok:false,error:'Workers AI dokumentkonvertering är inte konfigurerad.'},503)};
  if(!c.env.BROWSER)return {response:c.json({ok:false,error:'Browser Run-binding saknas.'},503)};
  if(!c.env.FILES||typeof c.env.FILES.get!=='function')return {response:c.json({ok:false,error:'Fillagringen är inte tillgänglig.'},503)};
  const document=await c.env.DB.prepare(`SELECT d.id,d.title,d.document_type,d.source_filename,d.source_mime_type,
    f.object_key,f.original_name,f.content_type,f.size_bytes
    FROM governing_documents d JOIN governing_document_files f ON f.document_id=d.id WHERE d.id=?`).bind(id).first<any>();
  if(!document)return {response:c.json({ok:false,error:'Styrdokumentet eller originalfilen hittades inte.'},404)};
  const object=await c.env.FILES.get(String(document.object_key));if(!object)return {response:c.json({ok:false,error:'Originalfilen saknas i fillagringen.'},404)};
  const filename=clean(document.original_name)||clean(document.source_filename)||'styrdokument';
  const contentType=clean(document.content_type)||clean(document.source_mime_type)||'application/octet-stream';
  if(contentType!=='application/pdf'&&!filename.toLowerCase().endsWith('.pdf'))return {response:c.json({ok:false,error:'Visionsdiagnostiken är avsedd för PDF-dokument.'},400)};
  return {document,object,filename,contentType};
}

export function registerGoverningDocumentConversionDiagnosticsRoutes(app:RouteApp){
  app.post('/api/studio/governing-documents/:id/conversion-diagnostics',async c=>{
    const id=c.req.param('id');
    if(!c.env.AI||typeof c.env.AI.toMarkdown!=='function')return c.json({ok:false,error:'Workers AI dokumentkonvertering är inte konfigurerad.'},503);
    if(!c.env.FILES||typeof c.env.FILES.get!=='function')return c.json({ok:false,error:'Fillagringen är inte tillgänglig.'},503);
    const document=await c.env.DB.prepare(`SELECT d.id,d.title,d.document_type,d.source_filename,d.source_mime_type,
      f.object_key,f.original_name,f.content_type,f.size_bytes
      FROM governing_documents d JOIN governing_document_files f ON f.document_id=d.id WHERE d.id=?`).bind(id).first<any>();
    if(!document)return c.json({ok:false,error:'Styrdokumentet eller originalfilen hittades inte.'},404);
    const object=await c.env.FILES.get(String(document.object_key));
    if(!object)return c.json({ok:false,error:'Originalfilen saknas i fillagringen.'},404);
    try{
      const filename=clean(document.original_name)||clean(document.source_filename)||'styrdokument';
      const contentType=clean(document.content_type)||clean(document.source_mime_type)||'application/octet-stream';
      const converted=await convertDocument(c.env.AI,object,filename,contentType);
      const markdown=converted.text;const lines=markdown.split(/\r?\n/);const pipeLines=lines.filter(line=>line.includes('|')).length;const headingLines=lines.filter(line=>/^#{1,6}\s/.test(line.trim())).length;
      const maxReturnedCharacters=30000;const truncated=markdown.length>maxReturnedCharacters;
      return c.json({ok:true,id,title:clean(document.title),documentType:clean(document.document_type),filename,contentType,sourceBytes:Number(document.size_bytes||0),conversionTokens:converted.tokens,convertedCharacters:markdown.length,convertedLines:lines.length,markdownPipeLines:pipeLines,markdownHeadingLines:headingLines,truncated,markdownPreview:markdown.slice(0,maxReturnedCharacters),markdownTail:truncated?markdown.slice(-4000):''});
    }catch(error){const detail=error instanceof Error?error.message:String(error);return c.json({ok:false,error:`Kunde inte diagnostisera dokumentkonverteringen: ${detail}`},500)}
  });

  app.post('/api/studio/governing-documents/:id/vision-conversion-diagnostics',async c=>{
    const id=c.req.param('id');const loaded=await loadPdfDocument(c,id);if(loaded.response)return loaded.response;
    try{
      const bytes=await loaded.object!.arrayBuffer();const images=await renderPdfPages(c.env.BROWSER,bytes,20);
      const pages:any[]=[];let totalTokens=0,totalCharacters=0;
      for(let i=0;i<images.length;i++){const converted=await convertImagePage(c.env.AI,images[i],i+1);totalTokens+=converted.tokens;totalCharacters+=converted.text.length;pages.push({page:i+1,tokens:converted.tokens,characters:converted.text.length,lines:converted.text.split(/\r?\n/).length,markdown:converted.text})}
      const combinedMarkdown=pages.map(p=>`### Sida ${p.page}\n\n${p.markdown}`).join('\n\n');
      return c.json({ok:true,id,title:clean(loaded.document!.title),filename:loaded.filename,contentType:loaded.contentType,sourceBytes:Number(loaded.document!.size_bytes||0),renderedPages:pages.length,totalTokens,totalCharacters,combinedCharacters:combinedMarkdown.length,pages,combinedMarkdown});
    }catch(error){const detail=error instanceof Error?error.message:String(error);return c.json({ok:false,error:`Kunde inte diagnostisera bildtolkningen: ${detail}`},500)}
  });

  app.post('/api/studio/governing-documents/:id/vision-conversion-diagnostics/:page',async c=>{
    const id=c.req.param('id');const pageNumber=Number(c.req.param('page'));
    if(!Number.isInteger(pageNumber)||pageNumber<1||pageNumber>20)return c.json({ok:false,error:'Sida måste vara ett heltal mellan 1 och 20.'},400);
    const loaded=await loadPdfDocument(c,id);if(loaded.response)return loaded.response;
    try{
      const bytes=await loaded.object!.arrayBuffer();const rendered=await openPdfPage(c.env.BROWSER,bytes,pageNumber,20);const converted=await convertImagePage(c.env.AI,rendered.image,pageNumber);
      return c.json({ok:true,id,title:clean(loaded.document!.title),filename:loaded.filename,page:pageNumber,totalPages:rendered.totalPages,tokens:converted.tokens,characters:converted.text.length,lines:converted.text.split(/\r?\n/).length,markdown:converted.text});
    }catch(error){const detail=error instanceof Error?error.message:String(error);return c.json({ok:false,error:`Kunde inte diagnostisera sida ${pageNumber}: ${detail}`},500)}
  });
}