import { registerGoverningMappingRoutesV13 } from './governing-mapping-routes-v13';

type RouteApp={get:(path:string,handler:(c:any)=>unknown)=>void;put:(path:string,handler:(c:any)=>unknown)=>void};
type RequirementKind='work'|'control'|'administration'|'condition'|'operation'|'evidence'|'deadline';
type Atom={text:string;handling_kind:RequirementKind;handling_kinds:RequirementKind[]};

function norm(v:unknown){return String(v||'').toLocaleLowerCase('sv-SE').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim()}
function add(xs:RequirementKind[],x:RequirementKind){if(!xs.includes(x))xs.push(x)}
function remove(xs:RequirementKind[],x:RequirementKind){const i=xs.indexOf(x);if(i>=0)xs.splice(i,1)}

function classify(text:string,itemType=''){
 const t=norm(text),kinds:RequirementKind[]=[];
 const photo=/\b(ta|tag) (en )?bild\b|\bfotografera\b|\bfotodokumentera\b|\böversiktsbild\b/.test(t);
 const deadline=/inom \d+ år|inom \d+ (dag|vecka|månad)|före byggstart|före startbesked|innan startbesked|före gjutning|före övertäckning|innan .*läggs igen|före slutbesked|till slutbesked|snarast efter|så snart|i god tid|två veckor i förväg/.test(t);
 const operation=/slamtöm|skötsel|skötas|underhåll|drift|överlämn.*ny ägare|ägarbyte|hållas fri från växtlighet/.test(t);
 const administration=itemType==='administration'||itemType==='documentation'||/\b(lämna in|lämnas|skicka|skickas|samla|spara|registrera|boka|beställ|upprätta|upprättas|relationshandling|relationsritning|intyg|protokoll|rapport)\b/.test(t);
 const control=itemType==='measurement'||itemType==='visit'||itemType==='control'||/\b(kontrollera|kontroll|verifiera|verifier|mäta|mätning|besiktiga|besiktig|prova|provning|bedöma|bedömning|överensstämmelse|registrerat hos|sakkunnig|fackmannamässig)\b/.test(t);
 const work=/\b(utför|utföra|utföras|montera|installera|installation|anlägga|anläggas|förbereda|förberedelse|ordna|bygga|grundläggning|täckning|ventilation|eldstad|imkanal)\b/.test(t);
 const condition=itemType==='condition'||itemType==='information'||/får inte|ska vara|ska bestå|ska hållas|endast|där .*förekommer|om .*påträffas|om .*behöver|enligt .*handling|risk för/.test(t);
 if(operation)add(kinds,'operation');if(work)add(kinds,'work');if(control)add(kinds,'control');if(administration)add(kinds,'administration');if(condition)add(kinds,'condition');if(photo){add(kinds,'control');add(kinds,'evidence');remove(kinds,'work');if(!/skicka|lämna|rapport/.test(t))remove(kinds,'administration')}if(deadline)add(kinds,'deadline');
 if(!kinds.length)add(kinds,'work');
 let primary:RequirementKind='work';
 if(photo)primary='control';
 else if(/^\s*(lämna in|lämnas|skicka|skickas|samla|spara|registrera|boka|beställ|upprätta|upprättas)\b/.test(t)||/\b(intyg|protokoll|relationshandling|relationsritning)\b/.test(t))primary='administration';
 else if(/^\s*(kontrollera|verifiera|mäta|besiktiga|prova|bedöma)\b/.test(t)||itemType==='visit'||/\bbesök\b/.test(t))primary='control';
 else if(/^\s*(utför|montera|installera|anlägga|förbereda|ordna|bygga)\b/.test(t))primary='work';
 else if(operation)primary='operation';
 else if(deadline&&!work&&!control&&!administration)primary='deadline';
 else if(condition&&!work&&!control&&!administration)primary='condition';
 else if(control)primary='control';else if(work)primary='work';else if(administration)primary='administration';else if(condition)primary='condition';
 return{handling_kind:primary,handling_kinds:kinds};
}

function atomize(item:any):Atom[]{
 const original=String(item.description||'').trim();if(!original)return[];
 const parts=original.split(/\s+(?:och|samt)\s+(?=(?:infiltration|anläggningen|ledningar|marken|byggnaden|[A-ZÅÄÖ]))/i).map(x=>x.trim()).filter(Boolean);
 if(parts.length<2)return[];
 const atoms=parts.map(text=>({text,...classify(text,String(item.item_type||''))}));
 const signatures=new Set(atoms.map(a=>a.handling_kind));
 return signatures.size>1?atoms:[];
}

function timing(text:string){const t=norm(text);if(/innan .*läggs igen|före övertäckning/.test(t))return'Före övertäckning';if(/före gjutning/.test(t))return'Före gjutning';if(/före startbesked|innan startbesked/.test(t))return'Före startbesked';if(/före byggstart/.test(t))return'Före byggstart';if(/före slutbesked|till slutbesked/.test(t))return'Före slutbesked';if(/snarast efter|så snart/.test(t))return'Direkt efter färdigställande';if(/inom 2 år.*5 år|2 år.*5 år/.test(t))return'Tillståndsfrist: start inom 2 år, klart inom 5 år';return''}

function rerank(item:any,suggestions:any[]){
 const t=norm(item.description);const documentation=/intyg|protokoll|relationshandling|relationsritning|lämna in|skicka|samla|spara/.test(t);
 if(!documentation)return suggestions;
 return [...suggestions].sort((a,b)=>{
  const score=(s:any)=>{const x=norm(s.title);let n=Number(s.confidence||0);if(/spara|samla|skicka|lämna|intyg|protokoll|relations/.test(x))n+=30;if(/utför|montera|installera/.test(x))n-=20;return n};
  return score(b)-score(a);
 });
}

export function registerGoverningMappingRoutesV14(app:RouteApp){
 const proxy:RouteApp={
  get(path,handler){
   if(path!=='/api/studio/projects/:projectId/governing-mapping'){app.get(path,handler);return}
   app.get(path,async c=>{const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;const data:any=await response.clone().json().catch(()=>null);if(!data||!Array.isArray(data.items))return response;
    data.items=data.items.map((item:any)=>{const semantic=classify(String(item.description||''),String(item.item_type||''));const atoms=atomize(item);return{...item,...semantic,timing_label:timing(String(item.description||''))||item.timing_label||'',requirement_atoms:atoms}});
    if(data.suggestions&&typeof data.suggestions==='object')for(const item of data.items)data.suggestions[item.id]=rerank(item,Array.isArray(data.suggestions[item.id])?data.suggestions[item.id]:[]);
    data.runtime='mapping-v14';return c.json(data,response.status)});
  },
  put(path,handler){app.put(path,async c=>{const response:any=await handler(c);if(!response||typeof response.clone!=='function'||!response.ok)return response;const data:any=await response.clone().json().catch(()=>null);if(!data)return response;data.runtime='mapping-v14';return c.json(data,response.status)})}
 };
 registerGoverningMappingRoutesV13(proxy);
}
