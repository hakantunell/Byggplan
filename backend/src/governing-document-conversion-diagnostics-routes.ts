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
      const markdown=converted.text;
      const lines=markdown.split(/\r?\n/);
      const pipeLines=lines.filter(line=>line.includes('|')).length;
      const headingLines=lines.filter(line=>/^#{1,6}\s/.test(line.trim())).length;
      const maxReturnedCharacters=30000;
      const truncated=markdown.length>maxReturnedCharacters;
      return c.json({
        ok:true,
        id,
        title:clean(document.title),
        documentType:clean(document.document_type),
        filename,
        contentType,
        sourceBytes:Number(document.size_bytes||0),
        conversionTokens:converted.tokens,
        convertedCharacters:markdown.length,
        convertedLines:lines.length,
        markdownPipeLines:pipeLines,
        markdownHeadingLines:headingLines,
        truncated,
        markdownPreview:markdown.slice(0,maxReturnedCharacters),
        markdownTail:truncated?markdown.slice(-4000):''
      });
    }catch(error){
      console.error('Governing document conversion diagnostics failed',error);
      const detail=error instanceof Error?error.message:String(error);
      return c.json({ok:false,error:`Kunde inte diagnostisera dokumentkonverteringen: ${detail}`},500);
    }
  });
}
